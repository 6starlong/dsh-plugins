import { apply, name } from '../lib/index.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-starlong-'))
process.env.DSH_HOME = HOME
after(() => rmSync(HOME, { recursive: true, force: true }))

/** 只提供 disk-cleanup 注册路径需要的宿主方法，不碰真实文件系统。 */
function mockHost() {
  const globals = new Map()
  for (const n of ['pwsh', 'bash']) {
    globals.set(n, {
      name: n,
      description: n,
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      async execute() { return {} },
    })
  }
  const agents = []
  const sandboxPolicy = {
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:\\ws' }),
    registerWritableRoot: () => () => {},
  }
  const host = {
    // 模块挂子 fiber 的观测点：挂载配置、卸载次数、volatile 事件处理器。
    mounts: [],
    disposes: 0,
    volatileHandlers: [],
    tools: { get: (n) => globals.get(n), register: () => () => {} },
    agents: { list: () => agents },
    on: (event, fn) => { if (event === 'loader/volatile-update') host.volatileHandlers.push(fn); return () => {} },
    inject: (_names, fn) => {
      fn({
        sandboxPolicy,
        agents: { list: () => agents },
        systemPrompt: { getSectionOrder: () => 1200, section: () => () => {} },
      })
      return () => {}
    },
    effect: (fn) => { const dispose = fn(); return () => dispose() },
    interval: () => () => {},
    emit: async () => {},
    plugin: (p, cfg) => {
      host.mounts.push(cfg)
      p.apply(host, cfg)
      return { dispose: () => { host.disposes += 1 } }
    },
  }
  return host
}

test('导出插件身份', () => {
  assert.equal(name, 'dsh-starlong')
  assert.equal(typeof apply, 'function')
})

test('装配已登记模块', () => {
  assert.doesNotThrow(() => apply(mockHost(), {}))
})

test('模块配置段可关闭 disk-cleanup', () => {
  assert.doesNotThrow(() => apply(mockHost(), { 'dsh-disk-cleanup': { enabled: false } }))
})
test('enabled 是 volatile：改开关只重挂模块，不重启套件', () => {
  const host = mockHost()
  const section = { enabled: { get: () => true } }
  apply(host, { 'dsh-disk-cleanup': section })
  assert.equal(host.mounts.length, 1)
  assert.equal(host.volatileHandlers.length, 1)
  // 模拟宿主提交 volatile 新值后广播事件。
  section.enabled = { get: () => false }
  host.volatileHandlers[0]([['dsh-disk-cleanup', 'enabled']])
  assert.equal(host.disposes, 1, '旧模块 fiber 应被卸载')
  assert.equal(host.mounts.length, 1, 'enabled=false 不应重挂')
  section.enabled = { get: () => true }
  host.volatileHandlers[0]([['dsh-disk-cleanup', 'enabled']])
  assert.equal(host.mounts.length, 2, '重新开启应重挂')
})

test('交给子 fiber 的配置是解代理后的普通值', () => {
  const host = mockHost()
  const section = {
    enabled: { get: () => true },
    autoCleanup: { get: () => true },
    cleanupMaxAgeDays: { get: () => 7 },
  }
  apply(host, { 'dsh-disk-cleanup': section })
  assert.equal(host.mounts.length, 1)
  const passed = host.mounts[0]
  assert.equal(passed.enabled, true)
  assert.equal(typeof passed.enabled, 'boolean')
  assert.equal(passed.autoCleanup, true)
  assert.equal(passed.cleanupMaxAgeDays, 7)
})
