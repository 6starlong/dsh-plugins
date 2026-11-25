/**
 * DSH 备份模块：按规则预设扫描 ~/.dsh 并导出 zip。
 * @module dsh-plugins/dsh-backup/index
 */
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { buildMatcher, dshHome, describeChildren, scanTree, DEFAULT_PRESET } from './rules.js'
import { writeZip } from './zip.js'

export { Config } from './config.js'

export const name = 'dsh-plugins-dsh-backup'
export const inject = []

const SECTION = 'dsh-backup'
const EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
const DOWNLOAD_ROUTE = '/api/starlong/dsh-backup/download'
const TOKEN_HEADER = 'x-starlong-backup'
const EXPORT_DIR = join('backups', 'starlong')
const PRESET_DIR = join(EXPORT_DIR, 'presets')
const ZIP_NAME = /^dsh-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/
const PRESET_NAME = /^[A-Za-z0-9_-]{1,40}$/
const TREE_ROUTE = '/api/starlong/dsh-backup/tree'
const PRESET_ROUTE = '/api/starlong/dsh-backup/preset'

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

/** 命名预设只在 backups/starlong/presets 下读写，名称白名单防路径穿越。 */
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
 * 装配模块。只注册导出/下载路由；开关关闭时不注册。
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
      try {
        const matcher = buildMatcher(DEFAULT_PRESET, options.regex)
        const scanned = await scanTree(home, matcher, count => {
          ctx.logger?.debug?.('[dsh-plugins] 备份扫描 ' + count + ' 项')
        }, options.overrides)
        const outDir = join(home, EXPORT_DIR)
        await mkdir(outDir, { recursive: true })
        const now = new Date()
        const pad = value => String(value).padStart(2, '0')
        const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '-' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '-' + pad(now.getSeconds())
        const zipName = 'dsh-backup-' + stamp + '.zip'
        const manifest = {
          createdAt: now.toISOString(), home,
          preset: typeof body?.preset === 'string' ? body.preset : null,
          overrides: options.overrides, regex: options.regex,
          stats: scanned.stats,
          excluded: scanned.excluded,
        }
        const entries = [...scanned.included, { rel: '_manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }]
        const result = await writeZip(join(outDir, zipName), entries)
        sendJson(response, 200, { ok: true, name: zipName, bytes: result.bytes, ...scanned.stats })
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

    const a = webServer.register({ kind: 'exact', path: EXPORT_ROUTE, handler: onExport })
    const b = webServer.register({ kind: 'exact', path: DOWNLOAD_ROUTE, handler: onDownload })
    const c = webServer.register({ kind: 'exact', path: TREE_ROUTE, handler: onTree })
    const d = webServer.register({ kind: 'exact', path: PRESET_ROUTE, handler: onPreset })
    return () => {
      try { a?.() } catch {}
      try { b?.() } catch {}
      try { c?.() } catch {}
      try { d?.() } catch {}
    }
  }, 'dsh-plugins 备份导出路由')
}