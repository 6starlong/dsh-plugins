/**
 * 临时目录的清理：scratch 的过期条目，以及残留的空目录。
 *
 * 只删 scratch 自己的条目：临时文件都是「写完就不再需要」的一次性产物，
 * 删掉不会影响工作区里的项目。
 * 空目录清理只认「目录为空」，不猜是谁留下的，也不删有内容的目录。
 * @module dsh-disk-cleanup/cleanup
 */
import { lstat, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** 一天有多少毫秒。 */
const DAY_MS = 24 * 60 * 60 * 1000

/** 启动之后自动清理的最小间隔。 */
export const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * 算出某个时刻的过期分界线。
 *
 * 用「条目自己的最后修改时间」判断，不用访问时间：Windows 默认关闭最后访问时间的
 * 更新，读过的文件会一直显示成很久没动过。
 * @param {number} maxAgeDays - 保留天数。
 * @param {number} [now] - 参照时刻（毫秒）。
 * @returns {number} 早于这个时刻的条目该删。
 */
export function cutoffTime(maxAgeDays, now = Date.now()) {
  return now - maxAgeDays * DAY_MS
}

/**
 * 列出目录下的直接条目（不看内容）。
 * @param {string} dir - 目录绝对路径。
 * @returns {Promise<Array<{name: string, path: string, directory: boolean, mtimeMs: number}>>} 条目列表。
 */
async function listEntries(dir) {
  const names = await readdir(dir)
  const entries = []
  for (const name of names) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      entries.push({ name, path, directory: info.isDirectory(), mtimeMs: info.mtimeMs })
    } catch {
      /* 单个条目读不到就跳过，不影响整批 */
    }
  }
  return entries
}

/**
 * 清掉 scratch 目录里超过保留期的条目。
 *
 * 只删顶层条目，且只删「条目本身最后一次改动早于分界线」的：目录里某个子文件
 * 刚被写过，目录的修改时间会一并刷新，正在用的工作目录不会被误删。
 * 单个条目删不掉（Windows 上文件被别的进程占着）就跳过，不中断整批。
 * @param {object} options - 清理输入。
 * @param {string} options.dir - scratch 目录。
 * @param {number} options.maxAgeDays - 保留天数。
 * @param {boolean} [options.dryRun] - 只统计不删除。
 * @param {number} [options.now] - 参照时刻（毫秒），测试用。
 * @returns {Promise<{removed: number, failed: number, kept: number}>} 统计结果；目录不存在时全为 0。
 */
export async function cleanScratch({ dir, maxAgeDays, dryRun = false, now = Date.now() }) {
  const result = { removed: 0, failed: 0, kept: 0 }
  if (typeof dir !== 'string' || dir === '') return result
  let entries
  try {
    entries = await listEntries(dir)
  } catch (error) {
    // 目录不存在是常态（还没人写过临时文件），其余错误要知道，否则清理会静默失效。
    if (error?.code === 'ENOENT') return result
    result.failed += 1
    return result
  }
  const cutoff = cutoffTime(maxAgeDays, now)
  for (const entry of entries) {
    if (entry.mtimeMs >= cutoff) {
      result.kept += 1
      continue
    }
    if (dryRun) {
      result.removed += 1
      continue
    }
    try {
      await rm(entry.path, { recursive: true, force: true })
      result.removed += 1
    } catch {
      result.failed += 1
    }
  }
  return result
}

/**
 * 建一个「按间隔节流」的执行器：调用 execute 时，距离上次真正执行不足间隔就跳过。
 *
 * 不用常驻定时器：插件每次加载先跑一次，之后由调用方的周期触发兜底，
 * 进程重启也只会重新跑一次，不会因为错过时间点堆起补偿。
 * @param {number} intervalMs - 最小间隔（毫秒）。
 * @returns {(run: () => Promise<unknown>) => Promise<boolean>} 执行器；真的执行了返回 true。
 */
export function throttled(intervalMs) {
  let last = 0
  let running = false
  return async (run) => {
    if (running) return false
    const now = Date.now()
    if (last !== 0 && now - last < intervalMs) return false
    running = true
    last = now
    try {
      await run()
      return true
    } finally {
      running = false
    }
  }
}

/**
 * 清掉目录下的空目录，只删「一个条目都没有」的目录。
 *
 * recursive 为真时自底向上：空的子目录先删，父目录因此变空后一并删；
 * 为假时只看直接子目录，不往里走。两种都不删 dir 本身。
 * 用 rmdir 而不是 rm：目录此刻若被写入了内容，rmdir 会失败，不会连内容一起删。
 * @param {object} options - 清理输入。
 * @param {string} options.dir - 待清理的目录根。
 * @param {boolean} [options.recursive] - 是否递归进子目录。
 * @param {boolean} [options.dryRun] - 只统计不删除。
 * @returns {Promise<{removed: number, failed: number, kept: number}>} 统计结果；目录不存在时全为 0。
 */
export async function cleanEmptyDirs({ dir, recursive = false, dryRun = false }) {
  const result = { removed: 0, failed: 0, kept: 0 }
  if (typeof dir !== 'string' || dir === '') return result
  await pruneChildren(dir, recursive, dryRun, result)
  return result
}

/**
 * 删掉 dir 下所有空的子目录，返回 dir 清理后是否也空了。
 *
 * 返回值一路往上传，dryRun 下也能算出「子目录删掉后父目录跟着变空」的连锁，
 * 而不是只看目录此刻的内容。
 * @param {string} dir - 当前层目录。
 * @param {boolean} recursive - 是否继续往子目录里走。
 * @param {boolean} dryRun - 只统计不删除。
 * @param {{removed: number, failed: number, kept: number}} result - 累计统计。
 * @returns {Promise<boolean>} dir 清理后是否为空；读不到时按非空处理。
 */
async function pruneChildren(dir, recursive, dryRun, result) {
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error?.code !== 'ENOENT') result.failed += 1
    return false
  }
  let hasContent = false
  for (const name of names) {
    const target = join(dir, name)
    let info
    try {
      info = await lstat(target)
    } catch {
      hasContent = true
      continue
    }
    // 符号链接和 junction 不进也不删，否则会递归到别的目录树里。
    if (!info.isDirectory() || info.isSymbolicLink()) {
      hasContent = true
      continue
    }
    let empty
    if (recursive) {
      empty = await pruneChildren(target, true, dryRun, result)
    } else {
      let left
      try {
        left = await readdir(target)
        empty = left.length === 0
      } catch {
        hasContent = true
        result.kept += 1
        continue
      }
    }
    if (!empty) {
      hasContent = true
      result.kept += 1
      continue
    }
    if (dryRun) {
      result.removed += 1
      continue
    }
    try {
      await rmdir(target)
      result.removed += 1
    } catch {
      result.failed += 1
      hasContent = true
    }
  }
  return !hasContent
}
