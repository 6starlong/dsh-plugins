/**
 * 会话管理核心：闲置自动归档与闲置自动删除。
 *
 * 归档走 DSH 内置 workspaceRegistry.archiveSession；DSH 没有删除会话的业务 API，
 * 删除由本模块自己完成：定位转录目录 → 清投影缓存行 → 摘工作区台账
 * → 删目录 → 清归档标记 → 通知客户端刷新。
 * @module dsh-plugins/modules/session-manager/core
 */
import { appendFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative as relativePath, resolve } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const DEFAULT_IDLE_DAYS = 3
const DEFAULT_DELETE_DAYS = 90
const MAX_IDLE_DAYS = 365
const MAX_DELETE_DAYS = 999
const LEDGER_NAME = 'session-manager.jsonl'
const LEDGER_MAX_LINES = 2000
const LEDGER_KEEP_LINES = 1000
const DELETE_ROUTE = '/api/starlong/session-manager/delete'
const DELETE_TOKEN_HEADER = 'x-starlong-delete'

/** 请求头取值：host 可能被代理改写成 :authority。 */
function requestHost(request) {
  const headers = request?.headers ?? {}
  const raw = headers.host ?? headers[':authority']
  return typeof raw === 'string' ? raw : ''
}

/** 回环地址判定：含 localhost、127.x、::1 与 IPv4 映射的 ::ffff:127.x。 */
function isLoopbackHost(value) {
  const raw = String(value ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (raw === '::1') return true
  const host = raw.startsWith('::ffff:') ? raw.slice(7) : raw.split(':')[0]
  return host === 'localhost' || host === 'localhost.' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/**
 * 只接受本机同源请求：约定头 + 回环来源 + 同源站点头 + origin 与 host 对齐。
 * 缺 origin 时按 host 的回环归属放行，兼容同源 GET/POST 不带 origin 的客户端。
 */
function isTrustedLocalRequest(request) {
  if (request?.headers?.[DELETE_TOKEN_HEADER] !== '1') return false
  if (!isLoopbackHost(request?.socket?.remoteAddress)) return false
  const site = request?.headers?.['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  const origin = request?.headers?.origin
  if (origin === undefined || origin === '') {
    const host = requestHost(request)
    try { return host !== '' && isLoopbackHost(new URL(`http://${host}`).hostname) } catch { return false }
  }
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopbackHost(url.hostname) && url.host === requestHost(request)
  } catch { return false }
}

/** 读 JSON 请求体；不是合法 JSON 时返回 undefined。 */
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

/** 写 JSON 响应；响应对象缺方法时静默跳过，不让路由抛错。 */
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

/** 子插件身份：挂在根套件下，随 volatile 配置重挂。 */
export const name = 'dsh-plugins-session-manager'
/** 必需服务：归档注册表、持久化会话。其余服务用 ctx.get 取，缺失时降级。 */
export const inject = ['sessionPersistence', 'workspaceRegistry']

/** 判断是不是 volatile 取值代理（只有一个 get 的普通对象）。 */
function isVolatile(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    && Object.getOwnPropertyNames(value).join() === 'get'
}

/** 把配置段里的 volatile 代理解成普通值；适配器也复用它。 */
export function readSection(config) {
  const section = config !== null && typeof config === 'object' && !Array.isArray(config)
    ? config['session-manager']
    : undefined
  if (section === null || typeof section !== 'object') return {}
  return Object.fromEntries(Object.entries(section).map(([key, value]) => [
    key,
    isVolatile(value) ? value.get() : value,
  ]))
}

/** 天数归一：接受数字或数字字符串，限到给定范围。 */
function normalizeDays(value, fallback, max) {
  const requested = typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : value
  if (!Number.isFinite(requested)) return fallback
  return Math.min(max, Math.max(1, Math.round(requested)))
}

/** 配置归一：布尔按原值，天数钳制到各自范围。 */
export function resolveConfig(raw) {
  const section = readSection(raw)
  const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback
  return {
    enabled: bool(section.enabled, true),
    autoArchive: bool(section.autoArchive, true),
    idleDays: normalizeDays(section.idleDays, DEFAULT_IDLE_DAYS, MAX_IDLE_DAYS),
    autoDelete: bool(section.autoDelete, false),
    deleteDays: normalizeDays(section.deleteDays, DEFAULT_DELETE_DAYS, MAX_DELETE_DAYS),
  }
}

/**
 * 删除/归档台账路径。放在 storages 下与其他插件状态并列，因为它要长期保留
 * 并能被程序读回，不是随时可丢的调试文本。
 */
export function ledgerPath() {
  const home = process.env.DSH_HOME?.trim() ? process.env.DSH_HOME.trim() : join(homedir(), '.dsh')
  return join(home, 'storages', LEDGER_NAME)
}

/** 追加一条台账记录；超过上限时只保留最近的若干行。记录失败不影响删除结果。 */
export async function appendLedger(entry) {
  const file = ledgerPath()
  try {
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
    const lines = (await readFile(file, 'utf8')).split('\n').filter(line => line !== '')
    if (lines.length > LEDGER_MAX_LINES) {
      await writeFile(file, `${lines.slice(-LEDGER_KEEP_LINES).join('\n')}\n`, 'utf8')
    }
  } catch { /* 台账只是审计线索，写不进去也要继续删 */ }
}

/** 事件时间可能是毫秒数或 ISO 字符串，统一成毫秒数。 */
function eventTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number(value)
  return Number.isFinite(time) ? time : undefined
}

/**
 * 系统写入的标记事件，不代表用户活动。会话关闭时补写的 session/end-seed
 * 会把闲置时长重置成关闭那一刻，导致本该清理的会话被长期保留。
 */
const MARKER_EVENTS = new Set(['session/end-seed'])

/** 最后活动时间：跳过系统标记事件取末条时间，没有可用事件时回退会话创建时间。 */
export function lastActivityAt(header, events) {
  if (Array.isArray(events)) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (MARKER_EVENTS.has(event?.type)) continue
      const time = eventTime(event?.time)
      if (time !== undefined) return time
    }
  }
  return eventTime(header?.createdAt)
}

/**
 * 会话的删除阈值。默认走用户配置的天数；别的模块可以通过
 * session-retention-policy 服务给特定类别的会话单独定保留期。
 * 每轮扫描现取，模块重挂或后装配都不会丢失。
 */
function deleteDaysFor(ctx, id, fallback) {
  const policy = ctx.get?.('session-retention-policy')
  const days = typeof policy === 'function' ? policy(id, fallback) : undefined
  return Number.isFinite(days) && days > 0 ? days : fallback
}

/** 是否闲置满阈值。 */
export function isIdle(lastActivity, now, days) {
  const threshold = days * DAY_MS
  return lastActivity !== undefined && threshold > 0 && now - lastActivity >= threshold
}

/** 只读打开会话并取最后活动时间；句柄必须关闭，否则每轮扫描都会在宿主里漏一个。 */
async function readLastActivity(ctx, persistence, snapshot) {
  const id = snapshot?.header?.id
  let handle
  try {
    handle = await persistence.open(id, 'read')
    const { events } = await handle.read()
    return lastActivityAt(snapshot.header, events)
  } catch (error) {
    if (error?.name !== 'SessionPersistenceNotFoundError') {
      ctx.logger?.warn?.('[dsh-plugins] 读取会话时间失败: %s', error)
    }
    return undefined
  } finally {
    if (handle !== undefined) await handle.close?.().catch(() => {})
  }
}

/** 持久化后端的存储根目录；用于确认待删目录在根内。 */
function persistenceRoot(persistence) {
  const root = persistence.root ?? persistence.config?.root
  return typeof root === 'string' && isAbsolute(root) ? resolve(root) : undefined
}

/**
 * 解析会话的转录目录。只认官方 JSONL 布局（<root>/<project>/<id>/session.vN.jsonl[.zstd]），
 * 目录名必须等于会话 id 且位于存储根内，否则放弃删除而不是猜路径。
 * locate/root 只存在于 JSONL 后端的私有实现上，换后端时这里会走放弃分支而不是误删。
 */
async function sessionDirectory(persistence, header) {
  if (typeof persistence.locate !== 'function') return undefined
  const root = persistenceRoot(persistence)
  if (root === undefined) return undefined
  let location
  try {
    location = persistence.locate(header)
  } catch {
    return undefined
  }
  if (location === undefined || typeof location.path !== 'string' || !isAbsolute(location.path)) {
    return undefined
  }
  if (!/^session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.zstd)?$/.test(basename(location.path))) return undefined
  const directory = dirname(location.path)
  if (basename(directory) !== header.id) return undefined
  // 用相对路径判边界：startsWith 会把同级的 sessions-evil 也当成根内。
  const relative = relativePath(root, resolve(directory))
  if (relative === '' || relative.startsWith('..') || isAbsolute(relative)) return undefined
  try {
    const info = await lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) return undefined
  } catch {
    return undefined
  }
  return directory
}

/**
 * 激活的定时任务所投递的会话。口径与内置归档准入一致：只认 status 为 active、
 * 且 target 指向已有会话的任务；new 类目标还没有实体会话，不参与。
 * 读取失败时返回 undefined，调用方据此放弃本轮删除而不是猜。
 */
async function scheduledSessionIds(ctx) {
  const schedule = ctx.get?.('schedule') ?? ctx.schedule
  if (schedule === undefined || typeof schedule.catalog !== 'function') return new Set()
  try {
    const tasks = await schedule.catalog()
    const ids = new Set()
    for (const task of tasks) {
      if (task?.status !== 'active') continue
      const target = task.target
      if (target === undefined || target.kind === 'new' || typeof target.sessionId !== 'string') continue
      ids.add(target.sessionId)
    }
    return ids
  } catch (error) {
    ctx.logger?.warn?.('[dsh-plugins] 读取定时任务失败，跳过本轮删除: %s', error)
    return undefined
  }
}

/**
 * 装配子插件。启动先扫一遍，之后每半小时扫一遍；重复触发串行化。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - 套件完整配置（volatile 字段是取值代理）。
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return
  const persistence = ctx.sessionPersistence
  const registry = ctx.workspaceRegistry
  if (!persistence || !registry) return

  let sweeping = false
  let disposed = false

  /** 会话是否仍被宿主持有；只删冷会话，避免内存里留悬空对象。 */
  const isLive = id => {
    const sessions = ctx.get?.('sessions') ?? ctx.sessions
    if (sessions?.get?.(id) !== undefined) return true
    const agents = ctx.get?.('agents') ?? ctx.agents
    return agents?.get?.(id)?.status === 'running'
  }

  /** 用公开接口把会话从所属工作区的台账摘掉；找不到工作区就跳过。 */
  const detachFromWorkspace = async (id, cwd) => {
    if (typeof cwd !== 'string' || cwd === '' || typeof registry.resolveByPath !== 'function') return
    try {
      const workspace = await registry.resolveByPath(cwd)
      if (workspace === undefined || !workspace.sessionIds.includes(id)) return
      await workspace.detachSession(id)
    } catch (error) {
      ctx.logger?.warn?.('[dsh-plugins] 摘除工作区记录失败: %s', error)
    }
  }

  /** 永久删除一个冷会话及其全部痕迹。任何一步失败都不回滚，只记日志。 */
  const deleteSession = async (snapshot, meta = {}) => {
    const id = snapshot?.header?.id
    if (typeof id !== 'string' || id === '') return false
    const directory = await sessionDirectory(persistence, snapshot.header)
    if (directory === undefined) {
      ctx.logger?.warn?.('[dsh-plugins] 无法定位会话目录，跳过删除 %s', id)
      return false
    }
    const cache = ctx.get?.('sessionProjectionCache') ?? ctx.sessionProjectionCache
    if (cache !== undefined && typeof cache.requireTable === 'function') {
      try {
        await cache.requireTable().delete(id)
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 清理投影缓存失败: %s', error)
      }
    }
    // 先摘台账再删目录：目录消失后工作区实体只能靠 header 缺失被动过滤，
    // 持久化的候选记录要等下一次写入才收敛。
    await detachFromWorkspace(id, snapshot.header.cwd)
    await rm(directory, { recursive: true, force: true })
    try {
      await registry.unarchiveSession?.(id)
    } catch { /* 不在归档集合里就是无操作 */ }
    try {
      ctx.emit?.('api-session/removed', id)
    } catch { /* 通知失败不影响删除结果 */ }
    const source = meta.source ?? 'auto'
    const labels = { manual: '已手动删除会话', orphan: '已清理孤儿子代理', auto: '已删除闲置会话' }
    ctx.logger?.info?.('[dsh-plugins] %s %s', labels[source] ?? labels.auto, id)
    await appendLedger({
      at: new Date().toISOString(),
      action: source === 'auto' ? 'delete' : 'delete-' + source,
      id,
      title: snapshot.header.title,
      cwd: snapshot.header.cwd,
      createdAt: snapshot.header.createdAt,
      lastActivity: meta.lastActivity === undefined ? undefined : new Date(meta.lastActivity).toISOString(),
      idleDays: meta.idleDays,
      source,
      ...(meta.parentId === undefined ? {} : { parentId: meta.parentId }),
    })
    return true
  }

  /**
   * 手动删除：先删目标，再删它的直系子代理（origin==='subagent' 且 parentSession 指向目标）。
   * 不认普通 fork——历史 fork 也带 parentSession，只看它会误删。
   * 子代理仍在内存或运行中则跳过，避免删掉正在工作的会话。
   */
  const deleteSessionWithOrphans = async id => {
    const snapshots = await persistence.list()
    const target = snapshots.find(snapshot => snapshot?.header?.id === id)
    if (target === undefined) return { ok: false, error: 'not-found' }
    const orphans = snapshots.filter(snapshot => {
      const header = snapshot?.header
      if (header === undefined || header.id === id) return false
      return header.origin === 'subagent' && header.parentSession === id && !isLive(header.id)
    })
    if (!await deleteSession(target, { source: 'manual' })) return { ok: false, error: 'locate-failed' }
    const removed = []
    for (const orphan of orphans) {
      if (await deleteSession(orphan, { source: 'orphan', parentId: id })) removed.push(orphan.header.id)
    }
    return { ok: true, orphans: removed }
  }

  const archiveSweep = async skipIds => {
    // 内置归档不保护置顶；活跃会话（含定时任务）交给内置准入拒绝。
    const pinned = new Set(registry.pinnedSessionIds ?? [])
    const archived = new Set(registry.archivedSessionIds ?? [])
    if (disposed) return
    const snapshots = await persistence.list()
    if (disposed) return
    const now = Date.now()
    const candidates = []
    const archivedTitles = new Map()
    const archivedCwds = new Map()

    // 扫描阶段只读会话时间；全部筛完再进入归档阶段，避免边扫边写。
    for (const snapshot of snapshots) {
      if (disposed) break
      const id = snapshot?.header?.id
      if (id === undefined || archived.has(id) || pinned.has(id) || skipIds.has(id)) continue
      const lastActivity = await readLastActivity(ctx, persistence, snapshot)
      if (!isIdle(lastActivity, now, cfg.idleDays)) continue
      candidates.push(id)
      archivedTitles.set(id, snapshot.header.title)
      archivedCwds.set(id, snapshot.header.cwd)
    }
    if (disposed) return

    // 内置只有单会话归档接口；逐个调用才能保留活跃会话的准入拒绝。
    // 每次调用前检查取消标记，关闭开关后不再产生新的归档。
    for (const id of candidates) {
      if (disposed) break
      try {
        // 不带 stopActivity：活跃会话让内置准入拒绝，而不是替用户停掉工作。
        await registry.archiveSession(id)
        skipIds.add(id)
        ctx.logger?.info?.('[dsh-plugins] 已归档闲置会话 %s', id)
        await appendLedger({
          at: new Date().toISOString(),
          action: 'archive',
          id,
          title: archivedTitles.get(id),
          cwd: archivedCwds.get(id),
          idleDays: cfg.idleDays,
        })
      } catch (error) {
        // 活跃/未知都是预期结果，不刷日志；其余异常才提示。
        if (error?.name === 'WorkspaceActiveSessionError'
          || error?.name === 'WorkspaceUnknownSessionError') continue
        ctx.logger?.warn?.('[dsh-plugins] 归档会话失败: %s', error)
      }
    }
  }

  const deleteSweep = async skipIds => {
    // 判定只认闲置天数：置顶、仍在内存、被激活定时任务引用的会话跳过，其余到点就删。
    const pinned = new Set(registry.pinnedSessionIds ?? [])
    if (disposed) return
    const scheduled = await scheduledSessionIds(ctx)
    if (scheduled === undefined || disposed) return
    const snapshots = await persistence.list()
    if (disposed) return
    const now = Date.now()
    const candidates = []

    for (const snapshot of snapshots) {
      if (disposed) break
      const id = snapshot?.header?.id
      if (id === undefined || skipIds.has(id) || pinned.has(id) || scheduled.has(id)) continue
      if (isLive(id)) continue
      const lastActivity = await readLastActivity(ctx, persistence, snapshot)
      const idleDays = deleteDaysFor(ctx, id, cfg.deleteDays)
      if (!isIdle(lastActivity, now, idleDays)) continue
      candidates.push({ snapshot, lastActivity, idleDays })
    }
    if (disposed) return

    for (const candidate of candidates) {
      if (disposed) break
      try {
        await deleteSession(candidate.snapshot, candidate)
      } catch (error) {
        ctx.logger?.warn?.('[dsh-plugins] 删除会话失败: %s', error)
      }
    }
  }

  const sweep = async () => {
    if (disposed || sweeping) return
    sweeping = true
    try {
      // 本轮刚归档的会话不参与删除，避免两个阈值相同的那一轮自相矛盾。
      const skipIds = new Set()
      if (!disposed && cfg.autoArchive) await archiveSweep(skipIds)
      if (!disposed && cfg.autoDelete) await deleteSweep(skipIds)
    } catch (error) {
      ctx.logger?.warn?.('[dsh-plugins] 会话管理扫描失败: %s', error)
    } finally {
      sweeping = false
      // 每轮结束打一条 debug：既方便排查，也让测试能等扫描真正收尾。
      ctx.logger?.debug?.('[dsh-plugins] 会话管理扫描结束')
    }
  }

  // 本机删除路由：只收同源回环 POST，交给删除链处理并联清理。
  // 服务缺失或注册失败只降级，不影响自动归档/删除。
  ctx.effect(() => {
    const webServer = ctx.get?.('webServer') ?? ctx.webServer
    if (webServer === undefined || typeof webServer.register !== 'function') return () => {}
    let disposeRoute
    try {
      disposeRoute = webServer.register({
        kind: 'exact',
        path: DELETE_ROUTE,
        handler: async (request, response) => {
          if (rejectByConnection(ctx, request, response)) return
          if (request.method !== 'POST') {
            response?.writeHead?.(405, { allow: 'POST' })
            response?.end?.()
            return
          }
          if (!isTrustedLocalRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'forbidden' })
            return
          }
          const body = await readJsonBody(request)
          const id = typeof body?.sessionId === 'string' ? body.sessionId : ''
          if (id === '') {
            sendJson(response, 400, { ok: false, error: 'invalid session id' })
            return
          }
          try {
            const result = await deleteSessionWithOrphans(id)
            sendJson(response, result.ok ? 200 : 404, result)
          } catch (error) {
            ctx.logger?.warn?.('[dsh-plugins] 手动删除会话失败: %s', error)
            sendJson(response, 500, { ok: false, error: 'delete failed' })
          }
        },
      })
    } catch (error) {
      ctx.logger?.warn?.('[dsh-plugins] 注册删除路由失败: %s', error)
    }
    return () => {
      try { disposeRoute?.() } catch { /* 宿主已回收服务 */ }
    }
  }, 'dsh-plugins 会话删除路由')

  void sweep()
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep() }, CHECK_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, 'dsh-plugins 会话管理')
}
