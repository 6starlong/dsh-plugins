/**
 * 附件残留清理：已删会话留下的原件，以及过期的请求图片缓存。
 *
 * 原件删了不可恢复，必须解压全部会话确认零引用才动；请求图片是随时能重建的派生图，
 * 按最后修改时间过期即可。两者都只清超过保留期的条目。
 * @module dsh-disk-cleanup/attachments
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { cleanEmptyDirs, cutoffTime } from './cleanup.js'
import { dshHome } from './scratch.js'

/** 会话文件的后缀。 */
const SESSION_SUFFIX = '.zstd'
/** 会话里引用原件的字段形状。 */
const REF_PREFIX = Buffer.from('"attachmentId":"sha256:', 'utf8')
/** zstd 帧头魔数；会话可能由多个连续帧组成。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
/** 原件文件名：64 位十六进制。 */
const OBJECT_NAME = /^[0-9a-f]{64}$/
/** 首次扫描标记的位置。 */
const MARKER_DIR = ['cache', 'dsh-disk-cleanup']
const MARKER_FILE = 'attachments'

/**
 * 列出目录下的所有文件，递归但不跟符号链接。
 * @param {string} dir - 目录绝对路径。
 * @returns {Promise<{files: string[], failed: number}>} 文件列表与读取失败数。
 */
async function listFiles(dir) {
  const files = []
  let failed = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const sub = await listFiles(path)
        files.push(...sub.files)
        failed += sub.failed
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') failed += 1
  }
  return { files, failed }
}

/**
 * 解压会话：按 zstd 帧头切出每个帧，逐帧解压后拼接。
 * DSH 会话是多个连续帧，单帧解压只能拿到会话头，会漏掉消息里的图片引用。
 * @param {Buffer} buffer - 会话原始字节。
 * @returns {Buffer} 全部帧解压后的内容。
 */
function decompressSession(buffer) {
  const starts = []
  let at = 0
  while (true) {
    const i = buffer.indexOf(ZSTD_MAGIC, at)
    if (i < 0) break
    starts.push(i)
    at = i + ZSTD_MAGIC.length
  }
  if (starts.length <= 1) return zstdDecompressSync(buffer)
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const start = starts[k]
    const end = k + 1 < starts.length ? starts[k + 1] : buffer.length
    parts.push(zstdDecompressSync(buffer.subarray(start, end)))
  }
  return Buffer.concat(parts)
}

/**
 * 从解压后的会话内容里提取原件 id。
 *
 * 按字节找字段前缀，避免把整段会话转成字符串；损坏的 id 直接跳过。
 * @param {Buffer} buffer - 会话内容。
 * @param {Set<string>} ids - 累计的 id 集合。
 * @returns {void}
 */
function scanReferences(buffer, ids) {
  let from = 0
  while (from < buffer.length) {
    const at = buffer.indexOf(REF_PREFIX, from)
    if (at < 0) break
    const start = at + REF_PREFIX.length
    if (start + 64 <= buffer.length) {
      const id = buffer.toString('ascii', start, start + 64)
      if (OBJECT_NAME.test(id)) ids.add(id)
    }
    from = start
  }
}

/**
 * 解压全部会话，收集仍在被引用的原件 id。
 *
 * 会话按工作区分目录存放，所以要递归遍历；子会话同样可能持有附件引用，
 * 不能按来源或目录名跳过。单个会话损坏不影响其余，读不到任何一个时
 * 由调用方决定跳过清理，不能把「读不到」当成「没人用」。
 * @param {string} dir - 会话根目录。
 * @returns {Promise<{ids: Set<string>, sessions: number, readable: number}>} 引用集合与计数。
 */
export async function collectReferencedIds(dir) {
  const ids = new Set()
  if (typeof dir !== 'string' || dir === '') return { ids, sessions: 0, readable: 0 }
  let names
  try {
    names = await readdir(dir, { recursive: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      // 读不到会话根时不返回空集合伪装成「零引用」，让调用方跳过。
      return { ids, sessions: -1, readable: 0 }
    }
    return { ids, sessions: 0, readable: 0 }
  }
  let sessions = 0
  let readable = 0
  for (const name of names) {
    if (typeof name !== 'string' || !name.endsWith(SESSION_SUFFIX)) continue
    sessions += 1
    try {
      scanReferences(decompressSession(await readFile(join(dir, name))), ids)
      readable += 1
    } catch {
      /* 单个会话损坏就跳过 */
    }
  }
  return { ids, sessions, readable }
}

/**
 * 按最后修改时间清理目录里的过期文件，并删掉因此变空的目录。
 *
 * 用于请求图片缓存：它是按固定参数重建的派生图，删掉不会丢原始内容。
 * @param {object} options - 清理输入。
 * @param {string} options.dir - 缓存根目录。
 * @param {number} options.maxAgeDays - 保留天数。
 * @param {boolean} [options.dryRun] - 只统计不删除。
 * @param {number} [options.now] - 参照时刻（毫秒）。
 * @returns {Promise<{removed: number, failed: number, kept: number}>} 统计结果。
 */
export async function cleanExpiredFiles({ dir, maxAgeDays, dryRun = false, now = Date.now() }) {
  const result = { removed: 0, failed: 0, kept: 0 }
  if (typeof dir !== 'string' || dir === '') return result
  const { files, failed } = await listFiles(dir)
  result.failed += failed
  const cutoff = cutoffTime(maxAgeDays, now)
  for (const path of files) {
    let info
    try {
      info = await stat(path)
    } catch {
      result.failed += 1
      continue
    }
    if (info.mtimeMs >= cutoff) {
      result.kept += 1
      continue
    }
    if (dryRun) {
      result.removed += 1
      continue
    }
    try {
      await rm(path, { force: true })
      result.removed += 1
    } catch {
      result.failed += 1
    }
  }
  const empty = await cleanEmptyDirs({ dir, recursive: true, dryRun })
  result.removed += empty.removed
  result.failed += empty.failed
  result.kept += empty.kept
  return result
}

/**
 * 清理没有任何会话引用的原件。
 *
 * 会话有任何一个读不到就整批跳过：读不全等于引用集合不全，不能据此删图。
 * 只有「零引用」且「最后修改时间早于分界线」的才进候选。
 * @param {object} options - 清理输入。
 * @param {string} options.dir - 原件根目录。
 * @param {string} options.sessionsDir - 会话根目录。
 * @param {number} options.maxAgeDays - 保留天数。
 * @param {boolean} [options.dryRun] - 只统计不删除。
 * @param {number} [options.now] - 参照时刻（毫秒）。
 * @returns {Promise<{removed: number, failed: number, kept: number, candidates: number, skipped: boolean}>} 统计结果。
 */
export async function cleanOrphanObjects({ dir, sessionsDir, maxAgeDays, dryRun = false, now = Date.now() }) {
  const result = { removed: 0, failed: 0, kept: 0, candidates: 0, skipped: false }
  if (typeof dir !== 'string' || dir === '') {
    result.skipped = true
    return result
  }
  const { ids, sessions, readable } = await collectReferencedIds(sessionsDir)
  if (sessions <= 0 || readable < sessions) {
    result.skipped = true
    return result
  }
  // 会话都在却一个引用都没读出来，几乎一定是解析出了问题，
  // 不能拿空集合当成「谁都没用」，否则会把全部过期原件删光。
  if (ids.size === 0) {
    result.skipped = true
    return result
  }
  const cutoff = cutoffTime(maxAgeDays, now)
  const { files, failed } = await listFiles(dir)
  result.failed += failed
  for (const path of files) {
    let info
    try {
      info = await stat(path)
    } catch {
      result.failed += 1
      continue
    }
    const id = basename(path)
    if (ids.has(id) || info.mtimeMs >= cutoff) {
      result.kept += 1
      continue
    }
    result.candidates += 1
    if (dryRun) {
      result.removed += 1
      continue
    }
    try {
      await rm(path, { force: true })
      result.removed += 1
    } catch {
      result.failed += 1
    }
  }
  const empty = await cleanEmptyDirs({ dir, recursive: true, dryRun })
  result.removed += empty.removed
  result.failed += empty.failed
  result.kept += empty.kept
  return result
}

/** 首次扫描标记的完整路径。 */
function markerPath(home) {
  return join(home, ...MARKER_DIR, MARKER_FILE)
}

/**
 * 判断是不是首次清理附件。标记读不到时按「不是首次」处理，避免反复只统计不删。
 * @param {string} home - DSH home。
 * @returns {Promise<boolean>} 是首次时为 true。
 */
async function isFirstScan(home) {
  try {
    await stat(markerPath(home))
    return false
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

/**
 * 写下首次扫描标记。
 * @param {string} home - DSH home。
 * @returns {Promise<void>} 完成信号。
 */
async function markScanned(home) {
  try {
    await mkdir(join(home, ...MARKER_DIR), { recursive: true })
    await writeFile(markerPath(home), String(Date.now()), 'utf8')
  } catch {
    /* 标记写不进去不影响清理本身，至多下次再走一次首轮 */
  }
}

/**
 * 一次清理两个附件目录。
 *
 * 缓存按保留期直接清；原件首轮只统计，给用户一次核对的机会，之后才真删。
 * @param {object} options - 清理输入。
 * @param {string} [options.home] - DSH home。
 * @param {number} options.maxAgeDays - 保留天数。
 * @param {boolean} [options.dryRun] - 只统计不删除。
 * @param {number} [options.now] - 参照时刻（毫秒）。
 * @returns {Promise<{cache: object, objects: object, first: boolean}>} 两批统计与是否首轮。
 */
export async function cleanAttachmentLeftovers({ home = dshHome(), maxAgeDays, dryRun = false, now = Date.now() }) {
  const first = !dryRun && await isFirstScan(home)
  const cache = await cleanExpiredFiles({
    dir: join(home, 'cache', 'attachments', 'request-images'),
    maxAgeDays,
    dryRun,
    now,
  })
  const objects = await cleanOrphanObjects({
    dir: join(home, 'attachments', 'v1', 'objects'),
    sessionsDir: join(home, 'sessions'),
    maxAgeDays,
    dryRun: dryRun || first,
    now,
  })
  // 没有可清的东西就不落标记，免得只读会话也被创建一个缓存目录。
  if (first && (objects.candidates > 0 || cache.removed > 0)) await markScanned(home)
  return { cache, objects, first }
}
