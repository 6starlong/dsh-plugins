/**
 * 权限模式 → scratch 目录；目录创建。
 * @module dsh-disk-cleanup/scratch
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 解析 DSH 的 home 目录：优先环境变量 DSH_HOME，否则 ~/.dsh。
 * @returns {string} 绝对路径。
 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * 共享的 scratch 目录：DSH home 下的 cache/scratch。
 * @returns {string} 绝对路径。
 */
export function sharedScratchDir() {
  return join(dshHome(), 'cache', 'scratch')
}

/**
 * 按权限模式给出 scratch 目录。
 *
 * 两种可写模式都优先用 DSH home 下的共享目录，工作区因此不会长出临时文件；
 * 共享目录写不进去时（无法追加可写根）退到工作区里的 cache/scratch。
 * @param {object} options - 解析输入。
 * @param {string} [options.mode] - 沙箱模式：workspace-write / danger-full-access / read-only。
 * @param {string} [options.workspaceRoot] - 会话工作区根。
 * @param {string} [options.configured] - 配置里显式指定的目录，优先于模式推导。
 * @param {boolean} [options.sharedCache] - 是否可以用 DSH home 下的共享目录。
 * @returns {string | undefined} 绝对路径；read-only 或无可用根时返回 undefined。
 */
export function scratchDirFor({ mode, workspaceRoot, configured, sharedCache = true } = {}) {
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  if (mode === 'read-only') return undefined
  const shared = sharedScratchDir()
  if (sharedCache) return shared
  if (typeof workspaceRoot === 'string' && workspaceRoot.trim() !== '') {
    return join(workspaceRoot, 'cache', 'scratch')
  }
  return shared
}

/**
 * 确保目录存在（幂等）。
 * @param {string} dir - 目录绝对路径。
 * @returns {Promise<void>} 完成信号。
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}
