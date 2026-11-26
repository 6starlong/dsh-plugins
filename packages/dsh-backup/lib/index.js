/**
 * DSH 备份模块：按规则预设扫描 ~/.dsh 并导出 zip。
 * @module dsh-plugins/dsh-backup/index
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import { buildMatcher, dshHome, describeChildren, scanTree, DEFAULT_PRESET } from './rules.js'
import { writeZip } from './zip.js'

export { Config } from './config.js'

export const name = 'dsh-plugins-dsh-backup'
export const inject = []

const SECTION = 'dsh-backup'
const EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
const DOWNLOAD_ROUTE = '/api/starlong/dsh-backup/download'
const TOKEN_HEADER = 'x-starlong-backup'
const EXPORT_DIR = 'backups'
const PRESET_DIR = join(EXPORT_DIR, 'presets')
const ZIP_NAME = /^dsh-backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/
const PRESET_NAME = /^[A-Za-z0-9_-]{1,40}$/
const TREE_ROUTE = '/api/starlong/dsh-backup/tree'
const PRESET_ROUTE = '/api/starlong/dsh-backup/preset'
const REVEAL_ROUTE = '/api/starlong/dsh-backup/reveal'
const VERSIONS_ROUTE = '/api/starlong/dsh-backup/versions'

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

/** 扫描并写一份 zip 到指定目录（默认 backups），返回统计；手动导出与自动备份共用。 */
async function createBackup(home, options, ctx, preset, outDirOverride) {
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
  }
  const entries = [...scanned.included, { rel: '_manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }]
  const result = await writeZip(join(outDir, zipName), entries)
  return { name: zipName, bytes: result.bytes, ...scanned.stats }
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
 * 装配模块。只注册导出/下载/树/预设/打开目录/版本路由；开关关闭时不注册。
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
        const result = await createBackup(home, options, ctx, body?.preset, dir)
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
    ]
    return () => {
      clearInterval(timer)
      for (const dispose of disposers) { try { dispose?.() } catch {} }
    }
  }, 'dsh-plugins 备份导出路由')
}