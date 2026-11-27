/**
 * DSH 备份模块：按规则预设扫描 ~/.dsh 并导出 zip。
 * @module dsh-plugins/dsh-backup/index
 */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { buildMatcher, dshHome, describeChildren, scanTree, DEFAULT_PRESET } from './rules.js'
import { checkVerifier } from './crypto.js'
import { peekAesVerifier, readZip, writeZip } from './zip.js'

export { Config } from './config.js'

export const name = 'dsh-plugins-dsh-backup'
export const inject = []

const SECTION = 'dsh-backup'
const EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
const DOWNLOAD_ROUTE = '/api/starlong/dsh-backup/download'
const TOKEN_HEADER = 'x-starlong-backup'
const EXPORT_DIR = 'backups'
const PRESET_DIR = join(EXPORT_DIR, 'presets')
const PRESET_REL = EXPORT_DIR + '/presets'
const ZIP_NAME = /^dsh-backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/
const PRESET_NAME = /^[A-Za-z0-9_-]{1,40}$/
const TREE_ROUTE = '/api/starlong/dsh-backup/tree'
const PRESET_ROUTE = '/api/starlong/dsh-backup/preset'
const REVEAL_ROUTE = '/api/starlong/dsh-backup/reveal'
const VERSIONS_ROUTE = '/api/starlong/dsh-backup/versions'
const VERIFY_ROUTE = '/api/starlong/dsh-backup/verify'
const RESTORE_ROUTE = '/api/starlong/dsh-backup/restore'
const RESTORE_STREAM_ROUTE = '/api/starlong/dsh-backup/restore-stream'
const UPLOAD_ROUTE = '/api/starlong/dsh-backup/upload'
const UPLOAD_PREFIX = 'dsh-backup-upload-'
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
const PROFILE_NAME = /^[A-Za-z0-9_-]{1,64}$/
const PLUGIN_INSTALL_TIMEOUT_MS = 10 * 60 * 1000

/** volatile 代理取真实值。 */
function unwrap(raw, fallback) {
  if (raw !== null && typeof raw === 'object' && typeof raw.get === 'function') return raw.get()
  return raw === undefined || raw === null ? fallback : raw
}

function readSection(config) {
  const section = config !== null && typeof config === 'object' ? config[SECTION] : undefined
  return section !== null && typeof section === 'object' ? section : {}
}

function requestHost(request) {
  const headers = request?.headers ?? {}
  const raw = headers.host ?? headers[':authority']
  return typeof raw === 'string' ? raw : ''
}

function isLoopbackHost(value) {
  const raw = String(value ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (raw === '::1') return true
  const host = raw.startsWith('::ffff:') ? raw.slice(7) : raw.split(':')[0]
  return host === 'localhost' || host === 'localhost.' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/** 导出是写操作：约定头 + 回环 + 同源站点头，与删除路由同等级。 */
function isTrustedExport(request) {
  if (request?.headers?.[TOKEN_HEADER] !== '1') return false
  if (!isLoopbackHost(request?.socket?.remoteAddress)) return false
  const site = request?.headers?.['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  const origin = request?.headers?.origin
  if (origin === undefined || origin === '') {
    const host = requestHost(request)
    try { return host !== '' && isLoopbackHost(new URL('http://' + host).hostname) } catch { return false }
  }
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopbackHost(url.hostname) && url.host === requestHost(request)
  } catch { return false }
}

/** 下载是读操作且文件名受限；浏览器 <a> 不会带约定头，只校验回环与站点头。 */
function isTrustedDownload(request) {
  if (!isLoopbackHost(request?.socket?.remoteAddress)) return false
  const site = request?.headers?.['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

function readJsonBody(request) {
  return new Promise(resolve => {
    let raw = ''
    let overflow = false
    request.on?.('data', chunk => {
      if (overflow) return
      raw += chunk
      if (raw.length > 64 * 1024) { overflow = true; resolve(undefined) }
    })
    request.on?.('end', () => {
      if (overflow) return
      try { resolve(JSON.parse(raw)) } catch { resolve(undefined) }
    })
    request.on?.('error', () => resolve(undefined))
  })
}

function sendJson(response, status, value) {
  response?.writeHead?.(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response?.end?.(JSON.stringify(value))
}

/** DSH 官方鉴权：connection 服务存在时按其裁决；缺失时返回 undefined 由调用方退回本地校验。 */
function connectionRejection(ctx, request) {
  let connection
  try { connection = Reflect.get(ctx, 'connection') } catch { return undefined }
  if (connection === undefined || typeof connection.requestRejection !== 'function') return undefined
  try { return connection.requestRejection(request) } catch { return undefined }
}

/** 官方鉴权优先，非 undefined 时按状态码拒绝。 */
function rejectByConnection(ctx, request, response) {
  const status = connectionRejection(ctx, request)
  if (status === undefined) return false
  response?.writeHead?.(status)
  response?.end?.()
  return true
}

/** 请求体的 overrides/regex 优先，回落命名预设，再回落空值。 */
function mergeOptions(body, named) {
  const rawOverrides = body?.overrides !== null && typeof body?.overrides === 'object' ? body.overrides : null
  const rawRegex = typeof body?.regex === 'string' ? body.regex : null
  return { overrides: rawOverrides ?? named?.overrides ?? {}, regex: rawRegex ?? named?.regex ?? '' }
}

/** 从备份文件名解析时刻；写入端用本地时间拼 stamp，这里对称解析。 */
function stampTime(name) {
  const match = /^dsh-backup_([0-9]{4})-([0-9]{2})-([0-9]{2})_([0-9]{2})-([0-9]{2})-([0-9]{2})[.]zip$/.exec(name)
  if (!match) return null
  const time = new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6])
  return Number.isNaN(time.getTime()) ? null : time.getTime()
}

/** 最近一份备份的时刻；没有合规备份返回 null，调度方据此立即备份。 */
async function lastBackupTime(home) {
  let names
  try { names = await readdir(join(home, EXPORT_DIR)) } catch { return null }
  let latest = null
  for (const name of names) {
    const time = stampTime(name)
    if (time !== null && (latest === null || time > latest)) latest = time
  }
  return latest
}

/** 只保留最近 keep 份备份，按文件名时刻降序删除更旧的。 */
async function pruneBackups(home, keepRaw) {
  const keep = Math.max(3, Math.min(30, Math.round(Number(keepRaw) || 7)))
  let names
  try { names = await readdir(join(home, EXPORT_DIR)) } catch { return 0 }
  const list = names.map(name => ({ name, time: stampTime(name) })).filter(item => item.time !== null)
  if (list.length <= keep) return 0
  list.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name))
  let removed = 0
  for (const item of list.slice(keep)) {
    try { await unlink(join(home, EXPORT_DIR, item.name)); removed++ } catch { /* 已消失或占用 */ }
  }
  return removed
}

/** 预设强制注入：按真实相对路径进包，还原时原样写回 backups/presets。 */
async function collectPresetEntries(home) {
  const entries = []
  let names
  try { names = await readdir(join(home, PRESET_DIR)) } catch { return entries }
  for (const name of names) {
    if (!name.endsWith('.json') || !PRESET_NAME.test(name.slice(0, -5))) continue
    try {
      entries.push({ rel: PRESET_REL + '/' + name, data: await readFile(join(home, PRESET_DIR, name)) })
    } catch { /* 扫描期间消失 */ }
  }
  return entries
}

/** 导出时记录各 profile 的包依赖，供还原后按锁文件补齐 node_modules。 */
async function collectPluginProfiles(home) {
  const profiles = []
  let names
  try { names = await readdir(join(home, 'profiles')) } catch { return profiles }
  for (const name of names) {
    if (!PROFILE_NAME.test(name)) continue
    try {
      const pkg = JSON.parse(await readFile(join(home, 'profiles', name, 'package.json'), 'utf8'))
      const deps = pkg !== null && typeof pkg === 'object' && pkg.dependencies !== null && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
      profiles.push({ name, dependencies: deps })
    } catch { /* 没有可读 package.json 的 profile 跳过 */ }
  }
  return profiles
}

/** DSH 桌面内置 pnpm：启动方式与 CLI 一致，但不写 profile 的 pnpm-lock.yaml。 */
function resolvePnpmLauncher() {
  const fromEnv = process.env.DSH_PNPM_MJS
  const resources = process.resourcesPath
  const entry = typeof fromEnv === 'string' && fromEnv !== ''
    ? fromEnv
    : typeof resources === 'string' && resources !== ''
      ? join(resources, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')
      : null
  if (entry === null) return null
  const bin = typeof resources === 'string' && resources !== '' ? join(resources, 'runtime', 'bin') : dirname(entry)
  return {
    command: process.execPath,
    args: ['--expose-internals', entry],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: bin + delimiter + (process.env.PATH ?? ''),
    },
  }
}

function runInstallCommand(command, args, options) {
  return new Promise(resolve => {
    let child
    try { child = spawn(command, args, options) } catch (error) { resolve({ ok: false, error: error?.message || String(error) }); return }
    let output = ''
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => { child.kill?.(); finish({ ok: false, error: 'install timeout' }) }, PLUGIN_INSTALL_TIMEOUT_MS)
    child.stdout?.on?.('data', chunk => { output += chunk })
    child.stderr?.on?.('data', chunk => { output += chunk })
    child.on?.('error', error => finish({ ok: false, error: error?.message || String(error) }))
    child.on?.('close', code => finish({ ok: code === 0, error: code === 0 ? '' : (output.trim().slice(-500) || 'exit ' + code) }))
  })
}

/** 还原末尾按备份时的 profile 依赖清单执行一次 pnpm install，缺哪些补哪些。 */
export async function installProfilePlugins(home, profiles, runner = runInstallCommand) {
  const result = { profiles: 0, installed: 0, failed: [], skipped: [] }
  if (!Array.isArray(profiles) || profiles.length === 0) return result
  const launcher = resolvePnpmLauncher()
  if (launcher === null) {
    result.skipped.push({ reason: 'pnpm launcher unavailable', profiles: profiles.length })
    return result
  }
  for (const profile of profiles) {
    if (!profile || !PROFILE_NAME.test(profile.name)) continue
    const deps = profile.dependencies
    if (deps === null || typeof deps !== 'object' || Object.keys(deps).length === 0) {
      result.skipped.push({ profile: profile.name, reason: 'no dependencies' })
      continue
    }
    const cwd = join(home, 'profiles', profile.name)
    const locked = await stat(join(cwd, 'pnpm-lock.yaml')).then(info => info.isFile()).catch(() => false)
    const args = [...launcher.args, 'install', locked ? '--frozen-lockfile' : '--no-frozen-lockfile']
    result.profiles++
    const run = await runner(launcher.command, args, { cwd, env: launcher.env, windowsHide: true })
    if (run.ok) result.installed += Object.keys(deps).length
    else result.failed.push({ profile: profile.name, error: run.error })
  }
  return result
}

/** 扫描并写一份 zip 到指定目录（默认 backups），返回统计；手动导出与自动备份共用。 */
async function createBackup(home, options, ctx, preset, outDirOverride, password = '') {
  const matcher = buildMatcher(DEFAULT_PRESET, options.regex)
  const scanned = await scanTree(home, matcher, count => {
    ctx.logger?.debug?.('[dsh-plugins] 备份扫描 ' + count + ' 项')
  }, options.overrides)
  const outDir = typeof outDirOverride === 'string' && outDirOverride !== '' ? outDirOverride : join(home, EXPORT_DIR)
  await mkdir(outDir, { recursive: true })
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '_' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '-' + pad(now.getSeconds())
  const zipName = 'dsh-backup_' + stamp + '.zip'
  const manifest = {
    createdAt: now.toISOString(), home,
    preset: typeof preset === 'string' && preset !== '' ? preset : null,
    overrides: options.overrides, regex: options.regex,
    stats: scanned.stats,
    excluded: scanned.excluded,
    plugins: await collectPluginProfiles(home),
    checksums: {},
  }
  // 预设强制入包，不受勾选影响；按 rel 去重，避免 overrides 已纳入时重复条目。
  const presets = await collectPresetEntries(home)
  const known = new Set(scanned.included.map(item => item.rel))
  const injected = presets.filter(item => !known.has(item.rel))
  // 清单是最后一个条目，惰性生成以便拿到 onEntry 已填好的指纹；每个文件只读一次盘
  const entries = [...scanned.included, ...injected, { rel: '_manifest.json', data: () => Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }]
  const result = await writeZip(join(outDir, zipName), entries, undefined, (rel, data) => {
    if (rel !== '_manifest.json') manifest.checksums[rel] = createHash('sha256').update(data).digest('hex')
  }, password)
  return { name: zipName, bytes: result.bytes, ...scanned.stats, injectedPresets: injected.length, pluginProfiles: manifest.plugins.length }
}

/** 对已解压条目逐项核对清单 SHA256，不读盘、不解密；供还原复用，避免二次全量校验。 */
function verifyEntries(entries) {
  const meta = entries.find(entry => entry.rel === '_manifest.json')
  if (!meta) return { ok: false, error: 'missing manifest' }
  let manifest
  try { manifest = JSON.parse(meta.data.toString('utf8')) }
  catch (error) { return { ok: false, code: error?.code ?? 'read', error: error?.message || String(error) } }
  const checksums = manifest.checksums !== null && typeof manifest.checksums === 'object' ? manifest.checksums : {}
  const byRel = new Map(entries.filter(entry => entry.rel !== '_manifest.json').map(entry => [entry.rel, entry]))
  const missing = []
  const mismatch = []
  for (const [rel, expected] of Object.entries(checksums)) {
    const entry = byRel.get(rel)
    if (!entry) { missing.push(rel); continue }
    if (createHash('sha256').update(entry.data).digest('hex') !== expected) mismatch.push(rel)
  }
  return { ok: missing.length === 0 && mismatch.length === 0, count: Object.keys(checksums).length, missing, mismatch }
}

/** 单独校验路由：读一次 zip 解压后交给 verifyEntries。 */
async function verifyBackup(filePath, password = '') {
  let entries
  try { entries = readZip(await readFile(filePath), password) }
  catch (error) { return { ok: false, code: error?.code ?? 'read', error: error?.message || String(error) } }
  return verifyEntries(entries)
}

/** 导入前只验口令：读首个 AES 条目的 salt+校验值比对，明文包直接放行，不解压不哈希。 */
async function checkBackupPassword(filePath, password = '') {
  try {
    const head = await peekAesVerifier(filePath)
    if (head === null) return { ok: true }
    if (!checkVerifier(head, password)) return { ok: false, code: 'password', error: 'wrong password' }
    return { ok: true }
  } catch (error) {
    return { ok: false, code: error?.code ?? 'read', error: error?.message || String(error) }
  }
}

/** 从 backups 选备份：显式文件名走白名单，空值或 latest 取最新一份。 */
async function resolveBackupName(home, name) {
  if (typeof name === 'string' && name !== '' && name !== 'latest') {
    return ZIP_NAME.test(name) ? name : null
  }
  let names
  try { names = await readdir(join(home, EXPORT_DIR)) } catch { return null }
  const list = names.map(n => ({ n, t: stampTime(n) })).filter(x => x.t !== null)
  if (list.length === 0) return null
  list.sort((a, b) => b.t - a.t || b.n.localeCompare(a.n))
  return list[0].n
}

/** 解析还原目标：优先用前端传来的本地绝对路径，否则回退到 backups 目录内的文件名。 */
async function resolveRestoreFile(home, request, body) {
  const raw = typeof body?.path === 'string' ? body.path.trim() : ''
  if (raw !== '') {
    if (!isAbsolute(raw) || !raw.toLowerCase().endsWith('.zip')) return null
    const st = await stat(raw).catch(() => null)
    return st?.isFile() ? raw : null
  }
  const name = await resolveBackupName(home, requestName(request, body))
  return name === null ? null : join(home, EXPORT_DIR, basename(name))
}

/** workspace.json 是域状态表：有官方注册表时实时同步运行态。 */
function normalizeWorkspaceState(raw) {
  let obj = null
  try { obj = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { obj = null }
  const base = obj !== null && typeof obj === 'object' ? obj : {}
  const tables = base.tables !== null && typeof base.tables === 'object' ? base.tables : {}
  const workspaces = tables.workspaces !== null && typeof tables.workspaces === 'object' ? tables.workspaces : {}
  const list = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item !== ''))] : []
  const records = {}
  for (const [id, rec] of Object.entries(workspaces)) {
    if (rec === null || typeof rec !== 'object') continue
    records[id] = { ...rec, sessionIds: list(rec.sessionIds) }
  }
  return { tables: { ...tables, workspaces: records } }
}

function normalizeWorkspacePath(value) {
  return typeof value === 'string' ? value.replace(/\//g, '\\').toLowerCase() : ''
}

async function collectSessionWorkdirs(home, entries) {
  const grouped = new Map()
  const add = (name, raw) => {
    const cwd = raw?.record?.identity?.cwd
    if (typeof cwd !== 'string' || cwd === '') return
    const key = normalizeWorkspacePath(cwd)
    if (!grouped.has(key)) grouped.set(key, { cwd, ids: [] })
    grouped.get(key).ids.push(name)
  }
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const match = /^storages\/session_projcache\/sessions\/([^/]+)\.json$/i.exec(String(entry?.rel ?? '').replace(/\\/g, '/'))
      if (!match) continue
      try { add(match[1], JSON.parse(entry.data.toString('utf8'))) } catch { /* 投影缓存解析失败按缺失处理 */ }
    }
    return grouped
  }
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  let names
  try { names = await readdir(dir) } catch { return grouped }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try { add(name.slice(0, -5), JSON.parse(await readFile(join(dir, name), 'utf8'))) } catch { /* 投影缓存解析失败按缺失处理 */ }
  }
  return grouped
}

function getWorkspaceRegistry(ctx) {
  try { return ctx.get?.('workspaceRegistry') ?? ctx.workspaceRegistry } catch { return undefined }
}

/** 官方注册表实时同步：按路径复用或创建工作区，备份会话覆盖冲突归属，不写 workspace.json。 */
async function applyWorkspaceRegistry(registry, backupBytes, home, entries) {
  const backup = normalizeWorkspaceState(Buffer.isBuffer(backupBytes) ? backupBytes.toString('utf8') : backupBytes)
  const current = (await registry.list?.()) ?? []
  const owners = new Map()
  for (const ws of current) for (const sid of ws.sessionIds ?? []) owners.set(sid, ws)
  const byPath = new Map()
  let touched = 0
  for (const rec of Object.values(backup.tables.workspaces)) {
    if (!rec || typeof rec.path !== 'string' || rec.path === '') continue
    const info = await stat(rec.path).catch(() => null)
    if (!info?.isDirectory()) continue
    let ws
    try { ws = await registry.resolveByPath?.(rec.path) } catch { ws = undefined }
    if (!ws && typeof registry.create === 'function') {
      try { ws = await registry.create(rec.path, rec.title) } catch { ws = undefined }
    }
    if (!ws) continue
    byPath.set(normalizeWorkspacePath(rec.path), ws)
    if (typeof rec.title === 'string' && typeof ws.setTitle === 'function' && rec.title !== ws.title) {
      try { await ws.setTitle(rec.title) } catch { /* 同名冲突保留当前标题 */ }
    }
    for (const sid of rec.sessionIds) {
      const owner = owners.get(sid)
      if (owner && owner.id !== ws.id && typeof owner.detachSession === 'function') {
        try { await owner.detachSession(sid) } catch { /* 会话已不在该工作区 */ }
        owners.delete(sid)
      }
      if (!(ws.sessionIds ?? []).includes(sid) && typeof ws.attachSession === 'function') {
        try { await ws.attachSession(sid) } catch { /* cwd 不匹配或会话不存在则跳过 */ }
        owners.set(sid, ws)
      }
    }
    touched++
  }
  for (const { cwd, ids } of (await collectSessionWorkdirs(home, entries)).values()) {
    const ws = byPath.get(normalizeWorkspacePath(cwd))
    if (!ws) continue
    for (const sid of ids) {
      const owner = owners.get(sid)
      if (owner && owner.id !== ws.id && typeof owner.detachSession === 'function') {
        try { await owner.detachSession(sid) } catch { /* 会话已不在该工作区 */ }
        owners.delete(sid)
      }
      if (!(ws.sessionIds ?? []).includes(sid) && typeof ws.attachSession === 'function') {
        try { await ws.attachSession(sid) } catch { /* cwd 不匹配或会话不存在则跳过 */ }
        owners.set(sid, ws)
      }
    }
  }
  return touched
}

/** 上传产生的临时 zip：用于区分需要在校验/还原后清理的文件。 */
function isUploadedTemp(filePath) {
  return resolve(dirname(filePath)) === resolve(tmpdir()) && basename(filePath).startsWith(UPLOAD_PREFIX)
}

/** 兼容前端 POST body 与既有 GET query 两种传名方式。 */
function requestName(request, body) {
  if (typeof body?.name === 'string' && body.name !== '') return body.name
  try { return new URL(request?.url ?? '/', 'http://localhost').searchParams.get('name') ?? '' } catch { return '' }
}

/** 口令只接受字符串；空字符串表示明文包，自动备份不传即保持明文。 */
function readPassword(body) {
  return typeof body?.password === 'string' ? body.password : ''
}

/**
 * 增量还原：只写备份包里的文件，同名覆盖，不删除原有文件，依赖目录整棵跳过。
 * 校验不通过时一个字节都不写；dryRun 只返回将要写入的路径。
 */
async function restoreBackup(filePath, home, dryRun, onPhase, ctx, password = '') {
  let entries
  try {
    entries = readZip(await readFile(filePath), password)
  } catch (error) {
    return { ok: false, code: error?.code === 'password' ? 'password' : 'read', error: error?.message || String(error) }
  }
  if (!entries.some(entry => entry.rel === '_manifest.json')) {
    return { ok: false, code: 'manifest', error: 'missing manifest' }
  }
  const verified = verifyEntries(entries)
  if (!verified.ok) {
    return { ok: false, code: 'integrity', error: 'integrity check failed', missing: verified.missing, mismatch: verified.mismatch }
  }
  let manifest = null
  const registry = getWorkspaceRegistry(ctx)
  if (!dryRun && entries.some(entry => entry.rel === 'storages/workspace.json') && !registry) {
    return { ok: false, code: 'workspace-registry', error: 'workspaceRegistry unavailable' }
  }
  try {
    const meta = entries.find(entry => entry.rel === '_manifest.json')
    if (meta) manifest = JSON.parse(meta.data.toString('utf8'))
  } catch { manifest = null }
  onPhase?.(1)
  const files = []
  let written = 0
  let overwritten = 0
  let skippedDependencies = 0
  let skippedConflicts = 0
  let skippedIdentical = 0
  let workspaceMerged = 0
  for (const entry of entries) {
    if (entry.rel === '_manifest.json') continue
    const rel = safeRel(entry.rel)
    if (rel === null) return { ok: false, code: 'unsafe', error: 'unsafe path: ' + entry.rel }
    if (rel.split('/').includes('node_modules')) { skippedDependencies++; continue }
    const target = join(home, rel)
    const current = await stat(target).catch(() => null)
    if (current?.isDirectory()) { skippedConflicts++; continue }
    if (rel === 'storages/workspace.json' && !dryRun) {
      workspaceMerged = await applyWorkspaceRegistry(registry, entry.data, home, entries)
      files.push({ rel, action: current ? 'overwrite' : 'create' })
      if (current) overwritten++
      else written++
      continue
    }
    const readonly = Boolean(current) && (current.mode & 0o200) === 0
    if (readonly && current.size === entry.data.length &&
        createHash('sha256').update(await readFile(target)).digest('hex') === createHash('sha256').update(entry.data).digest('hex')) {
      skippedIdentical++
      continue
    }
    files.push({ rel, action: current ? 'overwrite' : 'create' })
    if (dryRun) continue
    await mkdir(dirname(target), { recursive: true })
    if (readonly) await chmod(target, current.mode | 0o200)
    await writeFile(target, entry.data)
    if (readonly) await chmod(target, current.mode & 0o777)
    if (current) overwritten++
    else written++
  }
  onPhase?.(2)
  const plugins = dryRun
    ? { profiles: 0, installed: 0, failed: [], skipped: [{ reason: 'dryRun' }] }
    : await installProfilePlugins(home, manifest?.plugins)
  const result = { ok: plugins.failed.length === 0, dryRun: Boolean(dryRun), total: files.length, written, overwritten, skippedDependencies, skippedConflicts, skippedIdentical, workspaceMerged, files, plugins }
  if (!result.ok) { result.code = 'install'; result.error = 'plugin install failed' }
  onPhase?.(3, result)
  return result
}

/** 命名预设只在 backups/presets 下读写，名称白名单防路径穿越。 */
async function loadNamed(home, name) {
  if (typeof name !== 'string' || !PRESET_NAME.test(name)) return null
  try {
    const raw = await readFile(join(home, PRESET_DIR, name + '.json'), 'utf8')
    const obj = JSON.parse(raw)
    return {
      overrides: obj.overrides !== null && typeof obj.overrides === 'object' ? obj.overrides : {},
      regex: typeof obj.regex === 'string' ? obj.regex : '',
    }
  } catch { return null }
}

async function listNamed(home) {
  try {
    const names = await readdir(join(home, PRESET_DIR))
    return names.filter(n => n.endsWith('.json') && PRESET_NAME.test(n.slice(0, -5))).map(n => n.slice(0, -5)).sort()
  } catch { return [] }
}

/** 相对路径白名单：拒绝绝对路径与 .. 段，供树展开使用。 */
function safeRel(value) {
  const norm = String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (norm === '') return ''
  return norm.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..') ? norm : null
}

/**
 * 装配模块。只注册导出/下载/树/预设/打开目录/版本/校验/还原/流式还原/上传路由；开关关闭时不注册。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - 套件 config。
 */
export function apply(ctx, config) {
  const section = readSection(config)
  if (unwrap(section.enabled, true) === false) return
  ctx.effect(() => {
    let webServer
    try { webServer = ctx.get?.('webServer') ?? ctx.webServer } catch { webServer = undefined }
    if (!webServer || typeof webServer.register !== 'function') return () => {}

    const onExport = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const home = dshHome()
      const named = await loadNamed(home, body?.preset)
      const options = mergeOptions(body, named)
      const dir = typeof body?.dir === 'string' && body.dir.trim() !== '' ? body.dir.trim() : null
      try {
        const result = await createBackup(home, options, ctx, body?.preset, dir, readPassword(body))
        if (dir === null) await pruneBackups(home, unwrap(section.retention, 7))
        sendJson(response, 200, { ok: true, ...result })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 备份导出失败：' + (error?.message || String(error)))
        sendJson(response, 500, { ok: false, error: error?.message || String(error) })
      }
    }

    const onDownload = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedDownload(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      let name = ''
      try {
        name = new URL(request?.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
      } catch { return sendJson(response, 400, { ok: false, error: 'bad request' }) }
      if (!ZIP_NAME.test(name)) return sendJson(response, 400, { ok: false, error: 'bad name' })
      const filePath = join(dshHome(), EXPORT_DIR, basename(name))
      try {
        const st = await stat(filePath)
        const data = await readFile(filePath)
        response?.writeHead?.(200, {
          'content-type': 'application/zip',
          'content-length': String(st.size),
          'content-disposition': 'attachment; filename="' + basename(filePath) + '"',
          'cache-control': 'no-store',
        })
        response?.end?.(data)
      } catch {
        sendJson(response, 404, { ok: false, error: 'not found' })
      }
    }

    const onTree = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const rel = safeRel(body?.path)
      if (rel === null) return sendJson(response, 400, { ok: false, error: 'bad path' })
      const home = dshHome()
      const named = await loadNamed(home, body?.preset)
      const options = mergeOptions(body, named)
      try {
        const matcher = buildMatcher(DEFAULT_PRESET, options.regex)
        const result = rel === ''
          ? await describeChildren(home, rel, matcher, options.overrides, true)
          : { nodes: await describeChildren(home, rel, matcher, options.overrides), stats: null }
        sendJson(response, 200, { ok: true, path: rel, nodes: result.nodes, stats: result.stats, presets: await listNamed(home) })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 备份树扫描失败：' + (error?.message || String(error)))
        sendJson(response, 500, { ok: false, error: error?.message || String(error) })
      }
    }

    const onPreset = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const action = body?.action
      const home = dshHome()
      if (action === 'list') return sendJson(response, 200, { ok: true, presets: await listNamed(home) })
      if (action === 'load') {
        const named = await loadNamed(home, body?.name)
        if (!named) return sendJson(response, 404, { ok: false, error: 'not found' })
        return sendJson(response, 200, { ok: true, name: body.name, overrides: named.overrides, regex: named.regex })
      }
      const name = body?.name
      if (typeof name !== 'string' || !PRESET_NAME.test(name)) return sendJson(response, 400, { ok: false, error: 'bad name' })
      const dir = join(home, PRESET_DIR)
      if (action === 'save') {
        const overrides = body.overrides !== null && typeof body.overrides === 'object' ? body.overrides : {}
        const regex = typeof body.regex === 'string' ? body.regex.slice(0, 4096) : ''
        try {
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, name + '.json'), JSON.stringify({ name, overrides, regex, savedAt: new Date().toISOString() }, null, 2))
          return sendJson(response, 200, { ok: true, name, presets: await listNamed(home) })
        } catch (error) {
          return sendJson(response, 500, { ok: false, error: error?.message || String(error) })
        }
      }
      if (action === 'delete') {
        try { await unlink(join(dir, name + '.json')) } catch { /* 已不存在 */ }
        return sendJson(response, 200, { ok: true, name, presets: await listNamed(home) })
      }
      return sendJson(response, 400, { ok: false, error: 'bad action' })
    }

    /** 打开备份目录：路径由服务端算定，前端不传路径，避免任意目录被调起。 */
    const onReveal = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const dir = join(dshHome(), EXPORT_DIR)
      try {
        await mkdir(dir, { recursive: true })
        const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
        const child = spawn(command, [dir], { detached: true, stdio: 'ignore' })
        child.on?.('error', error => ctx.logger?.warn?.('[dsh-plugins] 打开备份目录失败：' + (error?.message || String(error))))
        child.unref?.()
        sendJson(response, 200, { ok: true, path: dir })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error?.message || String(error) })
      }
    }

    /** 版本概览：只读 backups 目录，返回份数与最近备份时刻。 */
    const onVersions = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      let names
      try { names = await readdir(join(dshHome(), EXPORT_DIR)) } catch { names = [] }
      const times = names.map(stampTime).filter(time => time !== null)
      const latest = times.length > 0 ? new Date(Math.max(...times)).toISOString() : null
      sendJson(response, 200, { ok: true, count: times.length, latest })
    }

    /** 校验备份包：只认约定头与回环同源，支持本地绝对路径或 backups 内文件名，返回缺失/不符清单。 */
    const onVerify = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const home = dshHome()
      const filePath = await resolveRestoreFile(home, request, body)
      if (filePath === null) return sendJson(response, 400, { ok: false, error: 'bad path' })
      const result = body?.passwordOnly === true
        ? await checkBackupPassword(filePath, readPassword(body))
        : await verifyBackup(filePath, readPassword(body))
      if (!result.ok && isUploadedTemp(filePath)) {
        await unlink(filePath).catch(() => {})
      }
      sendJson(response, result.ok ? 200 : 409, result)
    }

    /** 会话内文件选择器拿不到真实路径：客户端把 zip 字节本地上传，流式落到临时文件。 */
    const onUpload = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const tmp = join(tmpdir(), UPLOAD_PREFIX + randomUUID() + '.zip')
      let handle
      let ok = false
      try {
        handle = await open(tmp, 'wx', 0o600)
        let size = 0
        for await (const chunk of request) {
          size += chunk.length
          if (size > MAX_UPLOAD_BYTES) { sendJson(response, 413, { ok: false, error: 'zip too large' }); return }
          await handle.write(chunk)
        }
        await handle.close()
        handle = undefined
        if (size < 4) { sendJson(response, 400, { ok: false, error: 'empty zip' }); return }
        const head = Buffer.alloc(4)
        const reader = await open(tmp, 'r')
        try { await reader.read(head, 0, 4, 0) } finally { await reader.close() }
        if (head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) { sendJson(response, 400, { ok: false, error: 'not a zip' }); return }
        ok = true
        sendJson(response, 200, { ok: true, path: tmp, size })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: error?.message || String(error) })
      } finally {
        if (handle) await handle.close().catch(() => {})
        if (!ok) await unlink(tmp).catch(() => {})
      }
    }

    /** 增量还原：支持任意本地 zip 路径，校验通过后只覆盖同名文件，不删原有文件，依赖目录跳过。 */
    const onRestore = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const home = dshHome()
      const filePath = await resolveRestoreFile(home, request, body)
      if (filePath === null) return sendJson(response, 400, { ok: false, error: 'bad path' })
      const uploaded = isUploadedTemp(filePath)
      let status
      let payload
      try {
        payload = await restoreBackup(filePath, home, body?.dryRun === true, undefined, ctx, readPassword(body))
        status = payload.ok ? 200 : 409
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 还原失败：' + (error?.message || String(error)))
        status = 500
        payload = { ok: false, error: error?.message || String(error) }
      } finally {
        if (uploaded) await unlink(filePath).catch(() => {})
      }
      sendJson(response, status, payload)
    }

    /** 流式还原：文件写入与依赖安装由服务端按真实阶段推送，安装完成才发 done。 */
    const onRestoreStream = async (request, response) => {
      if (rejectByConnection(ctx, request, response)) return
      if (!isTrustedExport(request)) return sendJson(response, 403, { ok: false, error: 'forbidden' })
      const body = await readJsonBody(request) ?? {}
      const home = dshHome()
      const filePath = await resolveRestoreFile(home, request, body)
      if (filePath === null) return sendJson(response, 400, { ok: false, error: 'bad path' })
      const uploaded = isUploadedTemp(filePath)
      response?.writeHead?.(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      response?.flushHeaders?.()
      const emit = (event, data) => {
        response?.write?.('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
      }
      try {
        const payload = await restoreBackup(filePath, home, body?.dryRun === true, phase => {
          if (phase < 3) emit('stage', { phase })
        }, ctx, readPassword(body))
        if (payload.ok) emit('done', { ok: true, result: payload })
        else emit('error', { error: payload.error || '还原失败', code: payload.code, result: payload })
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 还原失败：' + (error?.message || String(error)))
        emit('error', { error: error?.message || String(error) })
      } finally {
        if (uploaded) await unlink(filePath).catch(() => {})
        response?.end?.()
      }
    }

    /** 启动即检查一次，之后每分钟复查：距最近备份满间隔就备一份；DSH 关闭时随 effect 停止。 */
    const CHECK_MS = 60_000
    let timer
    let running = false
    const checkAutoBackup = async () => {
      if (running) return
      const hours = Math.max(0, Math.min(168, Math.round(Number(unwrap(section.autoBackupHours, 0)) || 0)))
      if (hours === 0) return
      const home = dshHome()
      const last = await lastBackupTime(home)
      if (last !== null && Date.now() - last < hours * 3600_000) return
      running = true
      try {
        const presetName = unwrap(section.preset, '')
        const named = await loadNamed(home, presetName)
        await createBackup(home, { overrides: named?.overrides ?? {}, regex: named?.regex ?? '' }, ctx, presetName)
        await pruneBackups(home, unwrap(section.retention, 7))
        ctx.logger?.info?.('[dsh-plugins] 自动备份完成')
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 自动备份失败：' + (error?.message || String(error)))
      } finally {
        running = false
      }
    }
    timer = setInterval(() => { void checkAutoBackup() }, CHECK_MS)
    timer.unref?.()
    void checkAutoBackup()

    const disposers = [
      webServer.register({ kind: 'exact', path: EXPORT_ROUTE, handler: onExport }),
      webServer.register({ kind: 'exact', path: DOWNLOAD_ROUTE, handler: onDownload }),
      webServer.register({ kind: 'exact', path: TREE_ROUTE, handler: onTree }),
      webServer.register({ kind: 'exact', path: PRESET_ROUTE, handler: onPreset }),
      webServer.register({ kind: 'exact', path: REVEAL_ROUTE, handler: onReveal }),
      webServer.register({ kind: 'exact', path: VERSIONS_ROUTE, handler: onVersions }),
      webServer.register({ kind: 'exact', path: VERIFY_ROUTE, handler: onVerify }),
      webServer.register({ kind: 'exact', path: RESTORE_ROUTE, handler: onRestore }),
      webServer.register({ kind: 'exact', path: RESTORE_STREAM_ROUTE, handler: onRestoreStream }),
      webServer.register({ kind: 'exact', path: UPLOAD_ROUTE, handler: onUpload }),
    ]
    return () => {
      clearInterval(timer)
      for (const dispose of disposers) { try { dispose?.() } catch {} }
    }
  }, 'dsh-plugins 备份导出路由')
}