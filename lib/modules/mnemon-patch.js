/**
 * dsh-mnemon 的运行时补丁模块：把后台任务会话的日志落到独立项目目录。
 *
 * dsh-mnemon 每次后台任务都用全新的 mnemon-task-v1-<uuid> 建会话，cwd 取真实工作区，
 * 这些一次性会话于是和工作区会话挤在同一个项目目录里，越积越多。这里包装
 * agents.create，把它们的名义目录改到 DSH 根下的 mnemon，日志落到独立项目目录。
 *
 * 只改名义目录而不切回工作目录，agent 会在 mnemon 数据目录里读写，所以包装里必须
 * 补一次 workingDirectory.set。子会话的 cwd 继承自父会话，父会话已被改到名义目录，
 * 取不到原目录时退到注册表里的第一个工作区；再取不到就放弃改写，让会话留在原处，
 * 而不是让 agent 在数据目录里干活。
 *
 * 这些会话一次性使用、永不续接，按全局保留天数会堆到上万条，所以同时通过
 * session-retention-policy 服务给它们单独定 1 天保留期，session-manager 每轮扫描现取。
 *
 * 不改 dsh-mnemon 的包文件，升级 dsh-mnemon 不会丢补丁。
 * @module dsh-plugins/modules/mnemon-patch
 */
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** 子插件身份：没有配置字段，随套件装配一次。 */
export const name = 'dsh-plugins-mnemon-patch'
/** 必需服务：只有包装 agents.create 需要它。 */
export const inject = ['agents']

/**
 * mnemon 自建会话的 id 前缀。只认这一段而不是逐个列变体：已知有
 * mnemon-task-v1-、mnemon-run-v1-、mnemon-review-v1-、mnemon-review-owner-v1-，
 * 插件升级还可能加新的，逐个列会漏。
 */
const PREFIX = 'mnemon-'
/** 覆盖标记，挂在 agents 实例上；重复装配时不再叠一层包装。 */
const PATCHED = Symbol.for('dsh-plugins.mnemon-patch')
/** mnemon 会话的保留天数：用完即弃，留一天够排查。 */
const RETENTION_DAYS = 1
/** 保留期策略的服务名，会话管理扫描时按 id 现取。 */
const RETENTION_SERVICE = 'session-retention-policy'

/** 是否 mnemon 自建会话。 */
function isMnemonSession(id) {
  return typeof id === 'string' && id.startsWith(PREFIX)
}

/**
 * 保留期策略：mnemon 会话固定 1 天，其余会话交回调用方给的默认天数。
 * @param {string} id - 会话 id。
 * @param {number} fallback - 用户配置的删除天数。
 * @returns {number} 实际使用的天数。
 */
function retentionDays(id, fallback) {
  return isMnemonSession(id) ? RETENTION_DAYS : fallback
}

/** 名义项目目录：DSH 根下的 mnemon，与 mnemon 自己的数据目录同址。 */
function quarantineDirectory() {
  const home = process.env.DSH_HOME?.trim()
  const root = home !== undefined && home !== '' ? resolve(home) : join(homedir(), '.dsh')
  return join(root, 'mnemon')
}

/** 目录存在才算可用：workingDirectory.set 对不存在的路径会直接抛错。 */
async function isDirectory(path) {
  if (typeof path !== 'string' || path === '') return false
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** 实际工作目录：优先原 cwd，取不到退到注册表里的第一个工作区。 */
async function workingTarget(ctx, requested, quarantine) {
  if (requested !== undefined && requested !== quarantine && await isDirectory(requested)) return requested
  const registry = ctx.get?.('workspaceRegistry') ?? ctx.workspaceRegistry
  const list = typeof registry?.list === 'function' ? registry.list() : []
  for (const workspace of list) {
    const path = typeof workspace?.path === 'string' && isAbsolute(workspace.path) ? resolve(workspace.path) : undefined
    if (path !== undefined && path !== quarantine && await isDirectory(path)) return path
  }
  return undefined
}

/**
 * 装配模块。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 */
export function apply(ctx) {
  // 先挂策略：agents 不可用时日志隔离不做，但保留期仍应生效。
  if (typeof ctx.provide === 'function') ctx.provide(RETENTION_SERVICE, retentionDays)
  const agents = ctx.get?.('agents') ?? ctx.agents
  if (agents === undefined || typeof agents.create !== 'function' || agents[PATCHED] !== undefined) return
  const original = agents.create
  const directory = quarantineDirectory()
  let prepared = false

  agents[PATCHED] = original
  agents.create = async function createWithMnemonDirectory(options) {
    const meta = options?.meta
    if (!isMnemonSession(options?.sessionId) || meta === null || typeof meta !== 'object') {
      return Reflect.apply(original, this, [options])
    }
    const requested = typeof meta.cwd === 'string' && isAbsolute(meta.cwd) ? resolve(meta.cwd) : undefined
    const target = await workingTarget(ctx, requested, resolve(directory))
    if (target === undefined) return Reflect.apply(original, this, [options])
    if (!prepared) {
      await mkdir(directory, { recursive: true })
      prepared = true
    }
    const setup = options.setup
    const patched = {
      ...options,
      meta: { ...meta, cwd: directory },
      setup: async (agentCtx, agent) => {
        // 先跑原 setup：mnemon 自己可能已经把目录切到它的兜底工作区，这里再覆盖成原目录。
        await setup?.(agentCtx, agent)
        if (agent === undefined) return
        const workingDirectory = agentCtx?.get?.('workingDirectory')
          ?? ctx.get?.('workingDirectory') ?? ctx.workingDirectory
        if (typeof workingDirectory?.set !== 'function') return
        await workingDirectory.set(agent, target, options.signal)
      },
    }
    return Reflect.apply(original, this, [patched])
  }

  ctx.effect(() => () => {
    if (agents[PATCHED] === undefined) return
    agents.create = agents[PATCHED]
    delete agents[PATCHED]
  }, 'dsh-plugins mnemon 补丁')
}
