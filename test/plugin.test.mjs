import { apply, name } from '../lib/index.js'
import { apply as applySessionManager, isIdle, lastActivityAt, resolveConfig } from '../lib/modules/session-manager/core.js'
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
    mountNames: [],
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
      host.mountNames.push(p.name)
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
  assert.equal(mountsNamed(host, 'dsh-disk-cleanup').length, 1)
  assert.equal(host.volatileHandlers.length, 2)
  // 模拟宿主提交 volatile 新值后广播事件。
  section.enabled = { get: () => false }
  host.volatileHandlers[0]([['dsh-disk-cleanup', 'enabled']])
  assert.equal(host.disposes, 1, '旧模块 fiber 应被卸载')
  assert.equal(mountsNamed(host, 'dsh-disk-cleanup').length, 1, 'enabled=false 不应重挂')
  section.enabled = { get: () => true }
  host.volatileHandlers[0]([['dsh-disk-cleanup', 'enabled']])
  assert.equal(mountsNamed(host, 'dsh-disk-cleanup').length, 2, '重新开启应重挂')
})

const DAY = 24 * 60 * 60 * 1000

const mountsNamed = (host, pluginName) => host.mounts.filter((_cfg, index) => host.mountNames[index] === pluginName)

test('会话管理配置解代理并限制天数', () => {
  const cfg = resolveConfig({
    'session-manager': {
      enabled: { get: () => true },
      autoArchive: { get: () => true },
      idleDays: { get: () => 999 },
    },
  })
  assert.deepEqual(cfg, { enabled: true, autoArchive: true, idleDays: 365 })
})

test('最后活动时间取末条事件，缺省回退创建时间', () => {
  assert.equal(lastActivityAt({ createdAt: 100 }, [{ time: 200 }, { time: 300 }]), 300)
  assert.equal(lastActivityAt({ createdAt: 100 }, []), 100)
  assert.equal(lastActivityAt({ createdAt: '2026-01-01T00:00:00Z' }, []), Date.parse('2026-01-01T00:00:00Z'))
})

test('闲置判定按阈值 inclusive', () => {
  const now = 10 * DAY
  assert.equal(isIdle(7 * DAY, now, 3), true)
  assert.equal(isIdle(7 * DAY + 1, now, 3), false)
  assert.equal(isIdle(undefined, now, 3), false)
})

test('自动归档不预过滤定时任务会话，交给内置准入判定', async () => {
  const now = Date.now()
  const old = now - 4 * DAY
  const recent = now - 1000
  const events = new Map([
    ['idle', [{ time: old }]],
    ['pinned', [{ time: old }]],
    ['scheduled', [{ time: old }]],
    ['archived', [{ time: old }]],
    ['fresh', [{ time: recent }]],
  ])
  const archivedCalls = []
  const disposers = []
  const ctx = {
    sessionPersistence: {
      list: async () => [...events.keys()].map(id => ({ header: { id, createdAt: old } })),
      open: async (id) => ({
        read: async () => ({ events: events.get(id) }),
        close: async () => {},
      }),
    },
    workspaceRegistry: {
      pinnedSessionIds: ['pinned'],
      archivedSessionIds: ['archived'],
      archiveSession: async (id) => { archivedCalls.push(id) },
    },
    // 回归保留：核心不应再利用 schedule 预过滤，定时任务交给内置准入。
    schedule: {
      catalog: async () => [{
        status: 'active',
        involvedSessionIds: ['scheduled'],
        target: { kind: 'session', sessionId: 'scheduled' },
      }],
    },
    effect: (fn) => { const dispose = fn(); disposers.push(dispose); return () => dispose() },
    logger: { info: () => {}, warn: () => {} },
  }
  applySessionManager(ctx, { 'session-manager': { enabled: true, autoArchive: true, idleDays: 3 } })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(archivedCalls, ['idle', 'scheduled'])
  disposers.forEach(dispose => dispose())
})

test('关闭自动归档会中断本轮剩余归档', async () => {
  const now = Date.now()
  const old = now - 4 * DAY
  const ids = ['first', 'second']
  const events = new Map(ids.map(id => [id, [{ time: old }]]))
  const archivedCalls = []
  const readOrder = []
  let disposeSweep

  const ctx = {
    sessionPersistence: {
      list: async () => ids.map(id => ({ header: { id, createdAt: old } })),
      open: async (id) => {
        readOrder.push('open:' + id)
        return { read: async () => ({ events: events.get(id) }), close: async () => {} }
      },
    },
    workspaceRegistry: {
      pinnedSessionIds: [],
      archivedSessionIds: [],
      archiveSession: async (id) => {
        archivedCalls.push(id)
        if (id === 'first') disposeSweep?.()
      },
    },
    effect: (fn) => { const dispose = fn(); disposeSweep = dispose; return () => dispose() },
    logger: { info: () => {}, warn: () => {} },
  }

  applySessionManager(ctx, { 'session-manager': { enabled: true, autoArchive: true, idleDays: 3 } })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(readOrder, ['open:first', 'open:second'])
  assert.deepEqual(archivedCalls, ['first'])
})

test('autoArchive=false 时核心不启动扫描', async () => {
  let archived = false
  const ctx = {
    sessionPersistence: { list: async () => [] },
    workspaceRegistry: { archiveSession: async () => { archived = true } },
    effect: (fn) => { fn(); return () => {} },
    logger: { info: () => {}, warn: () => {} },
  }
  applySessionManager(ctx, { 'session-manager': { enabled: true, autoArchive: false, idleDays: 3 } })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(archived, false)
})

test('会话管理子 fiber 收到完整配置，不会被二次解包', () => {
  const host = mockHost()
  const section = {
    enabled: { get: () => true },
    autoArchive: { get: () => false },
    idleDays: { get: () => 3 },
  }
  apply(host, { 'session-manager': section })
  const passed = mountsNamed(host, 'dsh-starlong-session-manager')[0]
  assert.equal(passed['session-manager'].autoArchive.get(), false)
  assert.equal(resolveConfig(passed).autoArchive, false)
})

test('会话管理配置变化会重挂子 fiber', () => {
  const host = mockHost()
  const section = {
    enabled: { get: () => true },
    autoArchive: { get: () => true },
    idleDays: { get: () => 3 },
  }
  apply(host, { 'session-manager': section })
  assert.equal(mountsNamed(host, 'dsh-starlong-session-manager').length, 1)
  section.idleDays = { get: () => 7 }
  host.volatileHandlers[1]([['session-manager', 'idleDays']])
  assert.equal(mountsNamed(host, 'dsh-starlong-session-manager').length, 2)
  section.enabled = { get: () => false }
  host.volatileHandlers[1]([['session-manager', 'enabled']])
  assert.equal(mountsNamed(host, 'dsh-starlong-session-manager').length, 2)
  assert.equal(host.disposes, 2)
})

test('交给子 fiber 的配置是解代理后的普通值', () => {
  const host = mockHost()
  const section = {
    enabled: { get: () => true },
    autoCleanup: { get: () => true },
    cleanupMaxAgeDays: { get: () => 7 },
  }
  apply(host, { 'dsh-disk-cleanup': section })
  assert.equal(mountsNamed(host, 'dsh-disk-cleanup').length, 1)
  const passed = mountsNamed(host, 'dsh-disk-cleanup')[0]
  assert.equal(passed.enabled, true)
  assert.equal(typeof passed.enabled, 'boolean')
  assert.equal(passed.autoCleanup, true)
  assert.equal(passed.cleanupMaxAgeDays, 7)
})
