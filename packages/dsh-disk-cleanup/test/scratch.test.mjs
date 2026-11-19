import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { scratchDirFor, dshHome } from '../lib/scratch.js'
import { injectShellTemp, envPrefix, alreadySetsTemp, alreadySets } from '../lib/shell-env.js'
import { resolveConfig, DEFAULT_CONFIG } from '../lib/config.js'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-scratch-'))
after(() => rmSync(HOME, { recursive: true, force: true }))

test('workspace-write 也用 DSH_HOME/cache/scratch', () => {
  const dir = scratchDirFor({ mode: 'workspace-write', workspaceRoot: 'C:\\ws' })
  assert.equal(dir, join(dshHome(), 'cache', 'scratch'))
})

test('danger-full-access 用 DSH_HOME/cache/scratch', () => {
  const dir = scratchDirFor({ mode: 'danger-full-access', workspaceRoot: 'C:\\ws' })
  assert.equal(dir, join(dshHome(), 'cache', 'scratch'))
})

test('共享目录不可用时退到工作区里的 cache/scratch', () => {
  const dir = scratchDirFor({ mode: 'workspace-write', workspaceRoot: 'C:\\ws', sharedCache: false })
  assert.equal(dir, join('C:\\ws', 'cache', 'scratch'))
})

test('退路也缺工作区时仍用共享目录', () => {
  const dir = scratchDirFor({ mode: 'workspace-write', sharedCache: false })
  assert.equal(dir, join(dshHome(), 'cache', 'scratch'))
})

test('read-only 不启用', () => {
  assert.equal(scratchDirFor({ mode: 'read-only', workspaceRoot: 'C:\\ws' }), undefined)
})

test('显式配置优先于模式推导', () => {
  const dir = scratchDirFor({ mode: 'danger-full-access', workspaceRoot: 'C:\\ws', configured: 'D:\\scratch' })
  assert.equal(dir, 'D:\\scratch')
})

test('dshHome 尊重 DSH_HOME 环境变量', () => {
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = 'C:\\custom-home'
  try {
    assert.equal(dshHome(), 'C:\\custom-home')
  } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
})

test('dshHome 缺省是 ~/.dsh', () => {
  const saved = process.env.DSH_HOME
  delete process.env.DSH_HOME
  try {
    assert.equal(dshHome(), join(homedir(), '.dsh'))
  } finally {
    if (saved !== undefined) process.env.DSH_HOME = saved
  }
})

test('pwsh 前缀注入 TMP 与 TEMP', () => {
  const out = injectShellTemp('pwsh', 'Get-ChildItem', 'C:\\scratch')
  assert.ok(out.startsWith("$env:TMP='C:\\scratch'; $env:TEMP='C:\\scratch'; "))
  assert.ok(out.endsWith('Get-ChildItem'))
})

test('bash 前缀注入 TMPDIR/TMP/TEMP', () => {
  const out = injectShellTemp('bash', 'ls -la', '/tmp/scratch')
  assert.equal(out, "export TMPDIR='/tmp/scratch'; export TMP='/tmp/scratch'; export TEMP='/tmp/scratch'; ls -la")
})

test('用户自己设过的临时目录变量不覆盖', () => {
  assert.equal(alreadySetsTemp('pwsh', '$env:TEMP = "D:\\t"; Get-ChildItem'), true)
  assert.equal(alreadySetsTemp('bash', 'export TMPDIR=/x; ls'), true)
  // 只设了 TEMP：TEMP 保持用户的值，TMP 仍补上。
  const out = injectShellTemp('pwsh', '$env:TEMP = "D:\\t"; Get-ChildItem', 'C:\\scratch')
  assert.equal(out.includes("$env:TEMP='C:\\scratch'"), false, out)
  assert.ok(out.includes("$env:TMP='C:\\scratch'"), out)
  // 两个都设了：一个都不补。
  const both = '$env:TMP=\'D:\\a\'; $env:TEMP=\'D:\\b\'; Get-ChildItem'
  assert.equal(injectShellTemp('pwsh', both, 'C:\\scratch'), both)
})

test('没有目录时原样返回', () => {
  assert.equal(injectShellTemp('pwsh', 'ls', undefined), 'ls')
  assert.equal(injectShellTemp('pwsh', 'ls', ''), 'ls')
})

test('路径里的单引号被转义', () => {
  const out = envPrefix('pwsh', [['TEMP', "C:\\it's\\scratch"]])
  assert.ok(out.includes("C:\\it''s\\scratch"), out)
})


test('alreadySets 按变量名精确匹配', () => {
  assert.equal(alreadySets('pwsh', '$env:TEMPX = 1', 'TEMP'), false)
  assert.equal(alreadySets('pwsh', '$env:TEMP = 1', 'TEMP'), true)
  assert.equal(alreadySets('bash', 'export TEMP=/x; ls', 'TEMP'), true)
  assert.equal(alreadySets('bash', 'echo TEMP', 'TEMP'), false)
})

test('resolveConfig 用默认值补齐并拒绝错类型', () => {
  assert.deepEqual(resolveConfig(undefined), DEFAULT_CONFIG)
  const merged = resolveConfig({ enabled: false, scratchDir: '  X  ', injectShellTemp: 'yes' })
  assert.equal(merged.enabled, false)
  assert.equal(merged.scratchDir, 'X')
  assert.equal(merged.injectShellTemp, true)
  assert.equal(merged.promptSection, DEFAULT_CONFIG.promptSection)
})

test('resolveConfig 把保留天数夹到合法范围', () => {
  assert.equal(resolveConfig(undefined).cleanupMaxAgeDays, 3)
  assert.equal(resolveConfig({ cleanupMaxAgeDays: 0 }).cleanupMaxAgeDays, 1)
  assert.equal(resolveConfig({ cleanupMaxAgeDays: 9999 }).cleanupMaxAgeDays, 365)
  assert.equal(resolveConfig({ cleanupMaxAgeDays: 3.6 }).cleanupMaxAgeDays, 4)
  // 手写 YAML 里的 "7" 与设置页写回的 7 一样管用。
  assert.equal(resolveConfig({ cleanupMaxAgeDays: '7' }).cleanupMaxAgeDays, 7)
  assert.equal(resolveConfig({ cleanupMaxAgeDays: ' 30 ' }).cleanupMaxAgeDays, 30)
  assert.equal(resolveConfig({ cleanupMaxAgeDays: 'abc' }).cleanupMaxAgeDays, 3)
  assert.equal(resolveConfig({ autoCleanup: 'yes' }).autoCleanup, true)
})
