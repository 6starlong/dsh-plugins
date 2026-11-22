/**
 * 会话管理核心：给 DSH 内置归档加一层「闲置满 N 天」的定时触发。
 *
 * 归档判定与写入仍由 workspaceRegistry.archiveSession 完成：活跃会话（turn、
 * job、subagent、schedule）由它的 workspace/session-activity 准入拒绝。
 * 这里只做内置 API 不做的事：定期扫描、预过滤置顶会话，并在
 * 关闭开关时中止本轮归档，避免界面与后台不同步。
 * @module dsh-starlong/modules/session-manager/core
 */
const DAY_MS = 24 * 60 * 60 * 1000
const CHECK_INTERVAL_MS = 30 * 60 * 1000
const DEFAULT_IDLE_DAYS = 3

/** 子插件身份：挂在根套件下，随 volatile 配置重挂。 */
export const name = 'dsh-starlong-session-manager'
/** 必需服务：归档注册表、持久化会话。 */
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

/** 配置归一：布尔按原值，天数限到 1..365 并取整。 */
export function resolveConfig(raw) {
  const section = readSection(raw)
  const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback
  const requested = typeof section.idleDays === 'string' && section.idleDays.trim() !== ''
    ? Number(section.idleDays.trim())
    : section.idleDays
  const days = Number.isFinite(requested)
    ? Math.min(365, Math.max(1, Math.round(requested)))
    : DEFAULT_IDLE_DAYS
  return {
    enabled: bool(section.enabled, true),
    autoArchive: bool(section.autoArchive, true),
    idleDays: days,
  }
}

/** 事件时间可能是毫秒数或 ISO 字符串，统一成毫秒数。 */
function eventTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : Number(value)
  return Number.isFinite(time) ? time : undefined
}

/** 最后活动时间：取事件末条时间，没有事件时回退会话创建时间。 */
export function lastActivityAt(header, events) {
  const fromEvent = eventTime(events?.at(-1)?.time)
  return fromEvent ?? eventTime(header?.createdAt)
}

/** 是否闲置满阈值。 */
export function isIdle(lastActivity, now, idleDays) {
  const threshold = idleDays * DAY_MS
  return lastActivity !== undefined && threshold > 0 && now - lastActivity >= threshold
}

/**
 * 装配子插件。启动先扫一遍，之后每半小时扫一遍；重复触发串行化。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - 套件完整配置（volatile 字段是取值代理）。
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  if (!cfg.enabled || !cfg.autoArchive) return
  const persistence = ctx.sessionPersistence
  const registry = ctx.workspaceRegistry
  if (!persistence || !registry) return

  let sweeping = false
  let disposed = false
  const sweep = async () => {
    if (disposed || sweeping) return
    sweeping = true
    const candidates = []
    try {
      // 内置归档不保护置顶；活跃会话（含定时任务）交给内置准入拒绝。
      const pinned = new Set(registry.pinnedSessionIds ?? [])
      const archived = new Set(registry.archivedSessionIds ?? [])
      if (disposed) return
      const snapshots = await persistence.list()
      if (disposed) return
      const now = Date.now()

      // 扫描阶段只读会话时间；全部筛完再进入归档阶段，避免边扫边写。
      for (const snapshot of snapshots) {
        if (disposed) break
        const id = snapshot?.header?.id
        if (id === undefined || archived.has(id) || pinned.has(id)) continue

        let handle
        let lastActivity
        try {
          handle = await persistence.open(id, 'read')
          const { events } = await handle.read()
          lastActivity = lastActivityAt(snapshot.header, events)
        } catch (error) {
          if (error?.name !== 'SessionPersistenceNotFoundError') {
            ctx.logger?.warn?.('[dsh-starlong] 读取会话时间失败: %s', error)
          }
          continue
        } finally {
          if (handle) await handle.close().catch(() => {})
        }
        if (!isIdle(lastActivity, now, cfg.idleDays)) continue
        candidates.push(id)
      }
      if (disposed) return

      // 内置只有单会话归档接口；逐个调用才能保留活跃会话的准入拒绝。
      // 每次调用前检查取消标记，关闭开关后不再产生新的归档。
      for (const id of candidates) {
        if (disposed) break
        try {
          // 不带 stopActivity：活跃会话让内置准入拒绝，而不是替用户停掉工作。
          await registry.archiveSession(id)
          ctx.logger?.info?.('[dsh-starlong] 已归档闲置会话 %s', id)
        } catch (error) {
          // 活跃/未知都是预期结果，不刷日志；其余异常才提示。
          if (error?.name === 'WorkspaceActiveSessionError'
            || error?.name === 'WorkspaceUnknownSessionError') continue
          ctx.logger?.warn?.('[dsh-starlong] 归档会话失败: %s', error)
        }
      }
    } catch (error) {
      ctx.logger?.warn?.('[dsh-starlong] 自动归档扫描失败: %s', error)
    } finally {
      sweeping = false
    }
  }

  void sweep()
  ctx.effect(() => {
    const timer = setInterval(() => { void sweep() }, CHECK_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, 'dsh-starlong 会话自动归档')
}
