import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanEmptyDirs, cleanScratch, cutoffTime, throttled } from '../lib/cleanup.js'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-clean-'))
after(() => rmSync(ROOT, { recursive: true, force: true }))

const DAY = 24 * 60 * 60 * 1000

/**
 * 造一个 scratch 目录：名字 → 年龄（天）。目录用 dirs 指定。
 * @param {string} tag - 目录名，保证每个用例互不干扰。
 * @param {object} files - 文件名 → 年龄（天）。
 * @param {string[]} [dirs] - 额外的子目录，年龄取 30 天。
 * @returns {string} 目录路径。
 */
function fixture(tag, files, dirs = []) {
  const dir = join(ROOT, tag)
  mkdirSync(dir, { recursive: true })
  for (const [name, ageDays] of Object.entries(files)) {
    const path = join(dir, name)
    writeFileSync(path, 'x')
    const when = new Date(Date.now() - ageDays * DAY)
    utimesSync(path, when, when)
  }
  for (const name of dirs) {
    const path = join(dir, name)
    mkdirSync(path, { recursive: true })
    const when = new Date(Date.now() - 30 * DAY)
    utimesSync(path, when, when)
  }
  return dir
}

test('cutoffTime 按天数往前推', () => {
  assert.equal(cutoffTime(7, 1000 * DAY), 1000 * DAY - 7 * DAY)
})

test('只删超过保留期的条目，新的原样留着', async () => {
  const dir = fixture('mixed', { old: 10, fresh: 1 })
  const result = await cleanScratch({ dir, maxAgeDays: 7 })
  assert.deepEqual(result, { removed: 1, failed: 0, kept: 1 })
  assert.deepEqual(readdirSync(dir), ['fresh'])
})

test('过期目录整个删掉，含里面的文件', async () => {
  const dir = fixture('dirs', {}, ['old-run'])
  writeFileSync(join(dir, 'old-run', 'probe.mjs'), 'x')
  // 先写文件会把目录的修改时间刷新成「现在」，要重新压回 30 天前。
  const stale = new Date(Date.now() - 30 * DAY)
  utimesSync(join(dir, 'old-run'), stale, stale)
  const result = await cleanScratch({ dir, maxAgeDays: 7 })
  assert.equal(result.removed, 1)
  assert.deepEqual(readdirSync(dir), [])
})

test('目录里被刚写过时不删（目录的修改时间被刷新）', async () => {
  const dir = join(ROOT, 'active')
  mkdirSync(join(dir, 'work'), { recursive: true })
  const stale = new Date(Date.now() - 30 * DAY)
  utimesSync(join(dir, 'work'), stale, stale)
  writeFileSync(join(dir, 'work', 'file.txt'), 'x')
  const result = await cleanScratch({ dir, maxAgeDays: 7 })
  assert.equal(result.kept, 1)
  assert.equal(result.removed, 0)
})

test('dryRun 只统计不删除', async () => {
  const dir = fixture('dry', { old: 10 })
  const result = await cleanScratch({ dir, maxAgeDays: 7, dryRun: true })
  assert.equal(result.removed, 1)
  assert.deepEqual(readdirSync(dir), ['old'])
})

test('目录不存在时返回全零，不抛错', async () => {
  const result = await cleanScratch({ dir: join(ROOT, 'no-such-dir'), maxAgeDays: 7 })
  assert.deepEqual(result, { removed: 0, failed: 0, kept: 0 })
})

test('保留期边界：正好在分界线上的不删', async () => {
  const dir = fixture('edge', { exact: 0 })
  // 参照时刻与文件时间取同一个值：分两次读 Date.now() 会差几毫秒，条目就落到分界线之外。
  const now = Date.now()
  const mtime = now - 7 * DAY
  utimesSync(join(dir, 'exact'), new Date(mtime), new Date(mtime))
  const result = await cleanScratch({ dir, maxAgeDays: 7, now })
  assert.equal(result.removed, 0, '条目时间等于分界线时算「还在期内」')
})

test('throttled 在间隔内跳过，间隔外放行', async () => {
  let count = 0
  const run = throttled(60 * 60 * 1000)
  assert.equal(await run(async () => { count += 1 }), true)
  assert.equal(await run(async () => { count += 1 }), false)
  assert.equal(count, 1)
})

test('throttled 执行中重入直接跳过', async () => {
  let count = 0
  const run = throttled(0)
  const first = run(async () => {
    count += 1
    await new Promise(r => setTimeout(r, 20))
  })
  const second = await run(async () => { count += 1 })
  assert.equal(second, false)
  assert.equal(await first, true)
  assert.equal(count, 1)
})

test('递归删空目录：空的自底向上删，非空的留着，根不删', async () => {
  const dir = join(ROOT, 'empty-deep')
  mkdirSync(join(dir, 'a', 'b'), { recursive: true })
  mkdirSync(join(dir, 'keep'), { recursive: true })
  writeFileSync(join(dir, 'keep', 'probe.mjs'), 'x')
  mkdirSync(join(dir, 'lonely'), { recursive: true })
  const result = await cleanEmptyDirs({ dir, recursive: true })
  assert.deepEqual(result, { removed: 3, failed: 0, kept: 1 })
  assert.deepEqual(readdirSync(dir), ['keep'])
})

test('不递归时只删一级空目录，深层空目录不动', async () => {
  const dir = join(ROOT, 'empty-shallow')
  mkdirSync(join(dir, 'nested', 'inner'), { recursive: true })
  mkdirSync(join(dir, 'top-empty'), { recursive: true })
  const result = await cleanEmptyDirs({ dir })
  assert.deepEqual(result, { removed: 1, failed: 0, kept: 1 })
  assert.deepEqual(readdirSync(dir), ['nested'])
})

test('空目录清理支持 dryRun 与目录不存在', async () => {
  const dir = join(ROOT, 'empty-dry')
  mkdirSync(join(dir, 'blank'), { recursive: true })
  assert.equal((await cleanEmptyDirs({ dir, dryRun: true })).removed, 1)
  assert.deepEqual(readdirSync(dir), ['blank'])
  assert.deepEqual(await cleanEmptyDirs({ dir: join(ROOT, 'no-such-empty') }), { removed: 0, failed: 0, kept: 0 })
})
