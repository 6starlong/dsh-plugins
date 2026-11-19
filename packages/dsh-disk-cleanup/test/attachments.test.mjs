import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { cleanAttachmentLeftovers, cleanExpiredFiles, cleanOrphanObjects, collectReferencedIds } from '../lib/attachments.js'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-attach-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 18)
const OBJECTS = ['cache', 'attachments', 'request-images']

/**
 * 造一个带指定年龄的文件，父目录顺带建好。
 * @param {string} home - 临时 home。
 * @param {string} rel - 相对路径。
 * @param {string|Buffer} content - 内容。
 * @param {number} ageDays - 距参照时刻多少天。
 * @returns {string} 完整路径。
 */
function put(home, rel, content, ageDays) {
  const path = join(home, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
}

/**
 * 造一个带图片引用的压缩会话。
 * @param {string} home - 临时 home。
 * @param {string} rel - 会话相对路径。
 * @param {string[]} ids - 被引用的原件 id。
 * @returns {string} 完整路径。
 */
function session(home, rel, ids, frames = 1) {
  const text = JSON.stringify({ attachments: ids.map(id => ({ attachmentId: 'sha256:' + id })) })
  const buf = Buffer.from(text)
  if (frames <= 1) return put(home, rel, zstdCompressSync(buf), 1)
  // 拆成多帧：首帧只放会话头，其余帧各放一段引用。
  const pieces = []
  const head = '{"type":"session",'
  pieces.push(Buffer.from(head))
  const per = Math.ceil((text.length - head.length) / (frames - 1))
  for (let k = 0; k < frames - 1; k += 1) {
    pieces.push(Buffer.from(text.slice(head.length + k * per, head.length + (k + 1) * per)))
  }
  const packed = Buffer.concat(pieces.map(p => zstdCompressSync(p)))
  return put(home, rel, packed, 1)
}

test('解压全部会话，递归收集被引用的原件 id', async () => {
  const home = join(ROOT, 'refs')
  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)
  session(home, 'sessions/ws1/s1/session.v4.jsonl.zstd', [a])
  session(home, 'sessions/ws2/s2/session.v4.jsonl.zstd', [b])
  const { ids, sessions, readable } = await collectReferencedIds(join(home, 'sessions'))
  assert.equal(sessions, 2)
  assert.equal(readable, 2)
  assert.equal(ids.size, 2)
  assert.ok(ids.has(a) && ids.has(b))
})

test('多帧会话也能提取到后续帧里的引用', async () => {
  const home = join(ROOT, 'multiframe')
  const a = '1'.repeat(64)
  const b = '2'.repeat(64)
  // 头帧无引用，引用只在后续帧里；旧版单帧解压会漏掉它们。
  const text = JSON.stringify({ header: 'session', attachments: [{ attachmentId: 'sha256:' + a }, { attachmentId: 'sha256:' + b }] })
  const head = Buffer.from(JSON.stringify({ header: 'session' }))
  const body = Buffer.from(JSON.stringify({ attachments: [{ attachmentId: 'sha256:' + a }, { attachmentId: 'sha256:' + b }] }))
  put(home, 'sessions/ws/s1/session.v4.jsonl.zstd', Buffer.concat([zstdCompressSync(head), zstdCompressSync(body)]), 1)
  const { ids, sessions, readable } = await collectReferencedIds(join(home, 'sessions'))
  assert.equal(sessions, 1)
  assert.equal(readable, 1)
  assert.equal(ids.size, 2)
  assert.ok(ids.has(a) && ids.has(b))
});

test('缓存按保留期删过期文件并清掉空桶目录', async () => {
  const home = join(ROOT, 'cache-only')
  const old = put(home, join(...OBJECTS, 'aa', 'old'), 'x', 10)
  const fresh = put(home, join(...OBJECTS, 'bb', 'new'), 'x', 1)
  const result = await cleanExpiredFiles({ dir: join(home, ...OBJECTS), maxAgeDays: 3, now: NOW })
  // removed 含删掉的文件与随后变空的桶目录。
  assert.deepEqual(result, { removed: 2, failed: 0, kept: 2 })
  assert.equal(existsSync(old), false)
  assert.equal(existsSync(fresh), true)
  assert.equal(existsSync(join(home, ...OBJECTS, 'aa')), false)
})

test('原件只删零引用且过期的，被引用或未过期的留着', async () => {
  const home = join(ROOT, 'objects')
  const ref = 'c'.repeat(64)
  const orphan = 'd'.repeat(64)
  const freshOrphan = 'e'.repeat(64)
  session(home, 'sessions/ws/s1/session.v4.jsonl.zstd', [ref])
  const keptRef = put(home, join('attachments', 'v1', 'objects', 'cc', ref), 'x', 10)
  const removed = put(home, join('attachments', 'v1', 'objects', 'dd', orphan), 'x', 10)
  const keptFresh = put(home, join('attachments', 'v1', 'objects', 'ee', freshOrphan), 'x', 1)
  const result = await cleanOrphanObjects({
    dir: join(home, 'attachments', 'v1', 'objects'),
    sessionsDir: join(home, 'sessions'),
    maxAgeDays: 3,
    now: NOW,
  })
  // 1 个过期文件 + 1 个随之变空的桶目录。
  assert.equal(result.removed, 2)
  assert.equal(result.candidates, 1)
  assert.equal(result.skipped, false)
  assert.equal(existsSync(keptRef), true)
  assert.equal(existsSync(removed), false)
  assert.equal(existsSync(keptFresh), true)
})

test('会话都在但一个引用都没读出来时，整批跳过不动原件', async () => {
  const home = join(ROOT, 'empty-refs')
  const id = 'f'.repeat(64)
  // 会话可读但内容里没有任何附件引用，等同于解析退化，不能据此判定全都该删。
  put(home, 'sessions/ws/s1/session.v4.jsonl.zstd', zstdCompressSync(Buffer.from('{"type":"session"}')), 1)
  const old = put(home, join('attachments', 'v1', 'objects', 'ff', id), 'x', 30)
  const result = await cleanOrphanObjects({
    dir: join(home, 'attachments', 'v1', 'objects'),
    sessionsDir: join(home, 'sessions'),
    maxAgeDays: 3,
    now: NOW,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.removed, 0)
  assert.equal(existsSync(old), true)
});

test('会话读不到时整批跳过，绝不按零引用处理', async () => {
  const home = join(ROOT, 'no-sessions')
  const file = put(home, join('attachments', 'v1', 'objects', 'ff', 'f'.repeat(64)), 'x', 10)
  const result = await cleanOrphanObjects({
    dir: join(home, 'attachments', 'v1', 'objects'),
    sessionsDir: join(home, 'sessions'),
    maxAgeDays: 3,
    now: NOW,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.removed, 0)
  assert.equal(existsSync(file), true)
})

test('首轮只统计原件，缓存照常清；第二轮才真删原件', async () => {
  const home = join(ROOT, 'first-scan')
  const orphan = '1'.repeat(64)
  // 会话必须带至少一个引用，否则会命中「零引用整批跳过」护栏而不是测首轮行为。
  session(home, 'sessions/ws/s1/session.v4.jsonl.zstd', ['9'.repeat(64)])
  const object = put(home, join('attachments', 'v1', 'objects', 'aa', orphan), 'x', 10)
  const cached = put(home, join(...OBJECTS, 'bb', 'old'), 'x', 10)
  const first = await cleanAttachmentLeftovers({ home, maxAgeDays: 3, now: NOW })
  assert.equal(first.first, true)
  assert.equal(first.objects.removed, 1)
  assert.equal(existsSync(object), true)
  assert.equal(first.cache.removed, 2)
  assert.equal(existsSync(cached), false)
  const second = await cleanAttachmentLeftovers({ home, maxAgeDays: 3, now: NOW })
  assert.equal(second.first, false)
  assert.equal(second.objects.removed, 2)
  assert.equal(existsSync(object), false)
})

test('显式 dryRun 不写首轮标记，原件与缓存都只统计', async () => {
  const home = join(ROOT, 'explicit-dry')
  const orphan = '2'.repeat(64)
  session(home, 'sessions/ws/s1/session.v4.jsonl.zstd', ['9'.repeat(64)])
  const object = put(home, join('attachments', 'v1', 'objects', 'aa', orphan), 'x', 10)
  const cached = put(home, join(...OBJECTS, 'bb', 'old'), 'x', 10)
  const result = await cleanAttachmentLeftovers({ home, maxAgeDays: 3, dryRun: true, now: NOW })
  assert.equal(result.first, false)
  assert.equal(result.objects.removed, 1)
  assert.equal(result.cache.removed, 1)
  assert.equal(existsSync(object), true)
  assert.equal(existsSync(cached), true)
  const follow = await cleanAttachmentLeftovers({ home, maxAgeDays: 3, now: NOW })
  assert.equal(follow.first, true)
})

test('子会话的引用也计入，不按来源或目录名跳过', async () => {
  const home = join(ROOT, 'subagent')
  const real = 'a'.repeat(64)
  const inSub = 'b'.repeat(64)
  const subText = JSON.stringify({ type: 'session', origin: 'subagent', parentSession: 'p', attachments: [{ attachmentId: 'sha256:' + inSub }] })
  put(home, 'sessions/ws/sub/session.v4.jsonl.zstd', zstdCompressSync(Buffer.from(subText)), 1)
  session(home, 'sessions/ws/real/session.v4.jsonl.zstd', [real])
  const { ids, sessions, readable } = await collectReferencedIds(join(home, 'sessions'))
  assert.equal(sessions, 2)
  assert.equal(readable, 2)
  assert.equal(ids.size, 2)
  assert.ok(ids.has(real) && ids.has(inSub))
})

test('会话读不全时整批跳过，残缺引用集绝不用于删图', async () => {
  const home = join(ROOT, 'partial-read')
  const ref = 'c'.repeat(64)
  session(home, 'sessions/ws/ok/session.v4.jsonl.zstd', [])
  put(home, 'sessions/ws/broken/session.v4.jsonl.zstd', Buffer.from('not a zstd'), 1)
  const object = put(home, join('attachments', 'v1', 'objects', 'cc', ref), 'x', 10)
  const result = await cleanOrphanObjects({
    dir: join(home, 'attachments', 'v1', 'objects'),
    sessionsDir: join(home, 'sessions'),
    maxAgeDays: 3,
    now: NOW,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.removed, 0)
  assert.equal(existsSync(object), true)
})
