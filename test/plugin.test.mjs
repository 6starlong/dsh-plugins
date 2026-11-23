import { apply, name } from '../lib/index.js'
import { apply as applyMnemonPatch } from '../lib/modules/mnemon-patch.js'
import { apply as applySessionManager, isIdle, lastActivityAt, ledgerPath, resolveConfig } from '../lib/modules/session-manager/core.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * 造一套官方 JSONL 会话目录与宿主上下文。
 * run 会等首轮扫描真正结束（核心在 finally 里打 debug），不用固定 sleep 赌时序。
 */
function sessionFixture({ ids, listIds = ids, events, registry = {}, schedule, locate, extra = {} }) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-starlong-sessions-'))
  const dirs = new Map()
  for (const id of ids) {
    const directory = join(root, '--D-Workspace--', id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.v4.jsonl.zstd'), '')
    dirs.set(id, directory)
  }
  const disposers = []
  let settled = false
  const ctx = {
    sessionPersistence: {
      root,
      locate: locate ?? (header => ({ kind: 'jsonl', path: join(root, '--D-Workspace--', header.id, 'session.v4.jsonl.zstd') })),
      list: async () => listIds.map(id => ({
        header: { id, cwd: 'C:\\ws', title: `会话 ${id}`, createdAt: events.get(id)?.[0]?.time ?? Date.now() },
      })),
      open: async id => ({ read: async () => ({ events: events.get(id) }), close: async () => {} }),
    },
    workspaceRegistry: {
      pinnedSessionIds: [],
      archivedSessionIds: [],
      archiveSession: async () => {},
      unarchiveSession: async () => {},
      ...registry,
    },
    ...(schedule === undefined ? {} : { schedule }),
    ...extra,
    emit: () => {},
    effect: (fn) => { const dispose = fn(); disposers.push(dispose); return () => dispose() },
    logger: { info: () => {}, warn: () => {}, debug: () => { settled = true } },
  }
  return {
    ctx,
    root,
    dirs,
    /** 应用配置并等首轮扫描收尾；超时也返回，让断言暴露真实差异。 */
    async run(config) {
      applySessionManager(ctx, {
        'session-manager': { enabled: true, autoArchive: false, autoDelete: true, deleteDays: 90, ...config },
      })
      const deadline = Date.now() + 2000
      while (!settled && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
      disposers.forEach(dispose => dispose())
    },
    cleanup() { rmSync(root, { recursive: true, force: true }) },
  }
}

test('会话管理配置解代理并限制天数', () => {
  const cfg = resolveConfig({
    'session-manager': {
      enabled: { get: () => true },
      autoArchive: { get: () => true },
      idleDays: { get: () => 999 },
      autoDelete: { get: () => false },
      deleteDays: { get: () => 5000 },
    },
  })
  assert.deepEqual(cfg, { enabled: true, autoArchive: true, idleDays: 365, autoDelete: false, deleteDays: 999 })
})

test('最后活动时间取末条事件，缺省回退创建时间', () => {
  assert.equal(lastActivityAt({ createdAt: 100 }, [{ time: 200 }, { time: 300 }]), 300)
  assert.equal(lastActivityAt({ createdAt: 100 }, []), 100)
  assert.equal(lastActivityAt({ createdAt: '2026-01-01T00:00:00Z' }, []), Date.parse('2026-01-01T00:00:00Z'))
})

test('系统标记事件不算活动', () => {
  const events = [{ type: 'turn/end', time: 500 }, { type: 'session/end-seed', time: 9000 }]
  assert.equal(lastActivityAt({ createdAt: 100 }, events), 500)
  assert.equal(lastActivityAt({ createdAt: 100 }, [{ type: 'session/end-seed', time: 9000 }]), 100)
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

test('归档与删除都关闭时不读会话列表', async () => {
  let listed = 0
  let archived = false
  const ctx = {
    sessionPersistence: { list: async () => { listed += 1; return [] } },
    workspaceRegistry: { archiveSession: async () => { archived = true } },
    effect: (fn) => { fn(); return () => {} },
    logger: { info: () => {}, warn: () => {} },
  }
  applySessionManager(ctx, { 'session-manager': { enabled: true, autoArchive: false, autoDelete: false, idleDays: 3 } })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(listed, 0, '两个动作都关闭时不做任何扫描')
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
test('自动删除只处理非置顶且闲置满阈值的会话', async () => {
  const old = Date.now() - 100 * DAY
  const fresh = Date.now() - 1000
  const fx = sessionFixture({
    ids: ['gone', 'pinned', 'fresh', 'active'],
    events: new Map([['gone', [{ time: old }]], ['pinned', [{ time: old }]], ['fresh', [{ time: fresh }]], ['active', [{ time: old }]]]),
    registry: { pinnedSessionIds: ['pinned'] },
    extra: { sessions: { get: id => (id === 'active' ? { id } : undefined) } },
  })
  await fx.run({})
  assert.equal(existsSync(fx.dirs.get('gone')), false, '过期会话的目录应被删除')
  assert.equal(existsSync(fx.dirs.get('pinned')), true, '置顶会话不删')
  assert.equal(existsSync(fx.dirs.get('fresh')), true, '未满阈值不删')
  assert.equal(existsSync(fx.dirs.get('active')), true, '内存中仍存活的会话不删')
  fx.cleanup()
})

test('删除只认闲置天数，不要求会话已归档', async () => {
  const old = Date.now() - 100 * DAY
  const fx = sessionFixture({
    ids: ['idle'],
    events: new Map([['idle', [{ time: old }]]]),
    // 归档集合为空：未归档也要删。
    registry: { archivedSessionIds: [] },
  })
  await fx.run({})
  assert.equal(existsSync(fx.dirs.get('idle')), false, '未归档但闲置到期的会话也应删除')
  fx.cleanup()
})

test('被激活定时任务引用的会话不删除', async () => {
  const old = Date.now() - 100 * DAY
  const ids = ['idle', 'scheduled', 'paused', 'newtarget']
  const fx = sessionFixture({
    ids,
    events: new Map(ids.map(id => [id, [{ time: old }]])),
    // 只有 active 且 target 指向已有会话的任务构成保护；暂停任务与 new 目标不算。
    schedule: {
      catalog: async () => [
        { status: 'active', target: { kind: 'session', sessionId: 'scheduled' }, involvedSessionIds: ['scheduled'] },
        { status: 'paused', target: { kind: 'session', sessionId: 'paused' }, involvedSessionIds: ['paused'] },
        { status: 'active', target: { kind: 'new', create: { cwd: 'C:\\ws' } }, involvedSessionIds: ['newtarget'] },
      ],
    },
  })
  await fx.run({})
  assert.equal(existsSync(fx.dirs.get('idle')), false, '普通闲置会话应删除')
  assert.equal(existsSync(fx.dirs.get('scheduled')), true, '激活任务投递的会话不删')
  assert.equal(existsSync(fx.dirs.get('paused')), false, '暂停任务不构成保护，其会话按闲置删')
  assert.equal(existsSync(fx.dirs.get('newtarget')), false, 'new 目标没有实体会话，不构成保护')
  fx.cleanup()
})

test('读取定时任务失败时跳过本轮删除', async () => {
  const old = Date.now() - 100 * DAY
  const fx = sessionFixture({
    ids: ['idle'],
    events: new Map([['idle', [{ time: old }]]]),
    schedule: { catalog: async () => { throw new Error('schedule unavailable') } },
  })
  await fx.run({})
  assert.equal(existsSync(fx.dirs.get('idle')), true, '任务表读不到时宁可漏删')
  fx.cleanup()
})

for (const [label, makeLocate, kept] of [
  ['目录名与会话 id 不一致', ({ root, dirs }) => () => ({ kind: 'jsonl', path: join(dirs.get('not-the-id'), 'session.v4.jsonl.zstd') }), true],
  ['路径落在存储根之外', ({ root }) => () => ({ kind: 'jsonl', path: join(root, '..', 'sessions-evil', 'idle', 'session.v4.jsonl.zstd') }), false],
]) {
  test(`${label}时拒绝删除`, async () => {
    const old = Date.now() - 100 * DAY
    const fx = sessionFixture({
      ids: ['not-the-id'],
      listIds: ['idle'],
      events: new Map([['idle', [{ time: old }]]]),
    })
    if (kept) {
      fx.ctx.sessionPersistence.locate = makeLocate(fx)
    } else {
      const outside = join(fx.root, '..', 'sessions-evil', 'idle')
      mkdirSync(outside, { recursive: true })
      writeFileSync(join(outside, 'session.v4.jsonl.zstd'), '')
      fx.ctx.sessionPersistence.locate = makeLocate(fx)
      await fx.run({})
      assert.equal(existsSync(outside), true, '根外目录不得删除')
      rmSync(join(fx.root, '..', 'sessions-evil'), { recursive: true, force: true })
      fx.cleanup()
      return
    }
    await fx.run({})
    assert.equal(existsSync(fx.dirs.get('not-the-id')), true, '目录名不匹配时不得删除')
    fx.cleanup()
  })
}

test('删除后把会话记进台账，便于事后追溯', async () => {
  const old = Date.now() - 100 * DAY
  const fx = sessionFixture({
    ids: ['gone'],
    events: new Map([['gone', [{ time: old }]]]),
  })
  await fx.run({})
  const lines = readFileSync(ledgerPath(), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const entry = lines.at(-1)
  assert.equal(entry.action, 'delete')
  assert.equal(entry.id, 'gone')
  assert.equal(entry.cwd, 'C:\\ws')
  assert.equal(entry.idleDays, 90)
  assert.equal(Number.isFinite(Date.parse(entry.at)), true)
  assert.equal(Number.isFinite(Date.parse(entry.lastActivity)), true)
  fx.cleanup()
})

test('归档后同样写台账，并带上归档阈值', async () => {
  const old = Date.now() - 10 * DAY
  const fx = sessionFixture({
    ids: ['stale'],
    events: new Map([['stale', [{ time: old }]]]),
  })
  await fx.run({ autoArchive: true, autoDelete: false, idleDays: 3 })
  const lines = readFileSync(ledgerPath(), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const entry = lines.at(-1)
  assert.equal(entry.action, 'archive')
  assert.equal(entry.id, 'stale')
  assert.equal(entry.idleDays, 3)
  fx.cleanup()
})

test('读取会话后关闭句柄，不泄漏宿主句柄', async () => {
  const old = Date.now() - 100 * DAY
  let opened = 0
  let closed = 0
  const fx = sessionFixture({
    ids: ['idle'],
    events: new Map([['idle', [{ time: old }]]]),
  })
  const persistence = fx.ctx.sessionPersistence
  const originalOpen = persistence.open
  persistence.open = async id => {
    opened += 1
    const handle = await originalOpen(id)
    return { ...handle, close: async () => { closed += 1 } }
  }
  await fx.run({})
  assert.equal(opened, 1)
  assert.equal(closed, 1, '每读一个会话都要 close 对应句柄')
  fx.cleanup()
})

test('保留期策略优先于配置天数', async () => {
  const stale = Date.now() - 2 * DAY
  const ids = ['policy-short', 'policy-long', 'session-real']
  const policy = (id, fallback) => (id === 'policy-short' ? 1 : fallback)
  const fx = sessionFixture({
    ids,
    events: new Map(ids.map(id => [id, [{ time: stale }]])),
    extra: { get: key => (key === 'session-retention-policy' ? policy : undefined) },
  })
  await fx.run({ deleteDays: 90 })
  assert.equal(existsSync(fx.dirs.get('policy-short')), false, '策略给 1 天的会话被删')
  assert.equal(existsSync(fx.dirs.get('policy-long')), true, '策略交回默认天数的会话保留')
  assert.equal(existsSync(fx.dirs.get('session-real')), true, '未命中策略的会话保留')
  fx.cleanup()
})

test('没有策略服务时按配置天数删除', async () => {
  const stale = Date.now() - 2 * DAY
  const fx = sessionFixture({
    ids: ['session-plain'],
    events: new Map([['session-plain', [{ time: stale }]]]),
  })
  await fx.run({ deleteDays: 1 })
  assert.equal(existsSync(fx.dirs.get('session-plain')), false)
  fx.cleanup()
})

/** 造一套能观测 create 参数与工作目录调用的宿主。 */
function patchFixture(workspacePath) {
  const calls = []
  const provided = new Map()
  const workingDirectory = { set: async (agent, path) => { calls.push({ agent: agent.id, path }) } }
  const agents = {
    async create(options) {
      calls.push(options)
      const agent = { id: options.sessionId }
      await options.setup?.({ get: key => (key === 'workingDirectory' ? workingDirectory : undefined) }, agent)
      return { agent }
    },
  }
  const disposers = []
  const ctx = {
    agents,
    provide: (key, value) => { provided.set(key, value); return () => { provided.delete(key) } },
    get: key => (key === 'session-retention-policy' ? provided.get(key)
      : key === 'workingDirectory' ? workingDirectory
        : key === 'workspaceRegistry' ? { list: () => [{ path: workspacePath }] } : undefined),
    effect: fn => { disposers.push(fn()); return () => {} },
  }
  return { agents, calls, ctx, dispose: () => disposers.forEach(fn => fn()) }
}

test('mnemon 会话日志落到隔离目录，实际工作目录补回原处', async () => {
  const workspace = join(HOME, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const fx = patchFixture(workspace)
  applyMnemonPatch(fx.ctx)
  await fx.agents.create({ sessionId: 'mnemon-task-v1-x', meta: { cwd: workspace }, setup: async () => {} })
  await fx.agents.create({ sessionId: 'session-real', meta: { cwd: workspace } })
  assert.equal(fx.calls[0].meta.cwd, join(HOME, 'mnemon'), '名义目录改到 DSH 根下')
  assert.deepEqual(fx.calls[1], { agent: 'mnemon-task-v1-x', path: workspace }, '实际工作目录补回原处')
  assert.equal(fx.calls[2].meta.cwd, workspace, '非 mnemon 会话不改写')
  fx.dispose()
})

test('mnemon 会话提供 1 天保留期，其余会话交回配置天数', () => {
  const workspace = join(HOME, 'workspace3')
  mkdirSync(workspace, { recursive: true })
  const fx = patchFixture(workspace)
  applyMnemonPatch(fx.ctx)
  const policy = fx.ctx.get('session-retention-policy')
  assert.equal(typeof policy, 'function', '装配后应提供保留期策略')
  assert.equal(policy('mnemon-task-v1-a', 90), 1)
  assert.equal(policy('mnemon-run-v1-b', 90), 1)
  assert.equal(policy('mnemon-review-c', 90), 1)
  assert.equal(policy('session-real', 90), 90, '非 mnemon 会话沿用配置天数')
  fx.dispose()
})

test('子会话 cwd 已在隔离目录时退到注册表工作区', async () => {
  const workspace = join(HOME, 'workspace2')
  mkdirSync(workspace, { recursive: true })
  const fx = patchFixture(workspace)
  applyMnemonPatch(fx.ctx)
  await fx.agents.create({ sessionId: 'mnemon-run-v1-y', meta: { cwd: join(HOME, 'mnemon') } })
  assert.equal(fx.calls[0].meta.cwd, join(HOME, 'mnemon'), '子会话日志同样落在隔离目录')
  assert.deepEqual(fx.calls[1], { agent: 'mnemon-run-v1-y', path: workspace }, '实际目录退到注册表工作区')
  fx.dispose()
})


/** 造一个注册了删除路由的宿主；子代理谱系由 header.origin / parentSession 给出。 */
function deleteRouteFixture(specs = [], liveIds = []) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-starlong-delete-route-'))
  const dirs = new Map()
  const list = []
  for (const spec of specs) {
    const directory = join(root, '--D-Workspace--', spec.id)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'session.v4.jsonl.zstd'), '')
    dirs.set(spec.id, directory)
    list.push({ header: {
      id: spec.id, cwd: 'C:\\ws', title: spec.title ?? spec.id,
      origin: spec.origin, parentSession: spec.parentSession,
    } })
  }
  let handler
  let registeredPath
  const webServer = { register: def => { registeredPath = def.path; handler = def.handler; return () => {} } }
  const ctx = {
    sessionPersistence: {
      root,
      locate: header => ({ kind: 'jsonl', path: join(root, '--D-Workspace--', header.id, 'session.v4.jsonl.zstd') }),
      list: async () => list,
      open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }),
    },
    workspaceRegistry: { pinnedSessionIds: [], archivedSessionIds: [], archiveSession: async () => {}, unarchiveSession: async () => {} },
    sessions: { get: id => (liveIds.includes(id) ? { id } : undefined) },
    agents: { get: () => undefined },
    get: key => (key === 'webServer' ? webServer : key === 'sessions' ? ctx.sessions : undefined),
    effect: fn => { fn(); return () => {} },
    emit: () => {},
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  applySessionManager(ctx, { 'session-manager': { enabled: true, autoArchive: false, autoDelete: false } })
  return {
    ctx, root, dirs,
    get handler() { return handler },
    get registeredPath() { return registeredPath },
    cleanup() { rmSync(root, { recursive: true, force: true }) },
  }
}

async function callDeleteRoute(fx, options = {}) {
  const { body = { sessionId: 'main' }, headers = {}, method = 'POST', remoteAddress = '127.0.0.1' } = options
  const listeners = {}
  let raw = ''
  const request = {
    method,
    headers: { host: '127.0.0.1:5124', 'x-starlong-delete': '1', ...headers },
    socket: { remoteAddress },
    on: (event, fn) => { listeners[event] = fn },
  }
  const response = { status: undefined, payload: undefined, writeHead(status) { this.status = status }, end(text) { this.payload = text ? JSON.parse(text) : undefined } }
  const pending = fx.handler(request, response)
  listeners.data?.(JSON.stringify(body))
  listeners.end?.()
  await pending
  return response
}

test('删除路由注册在固定端点，手动删主会话并清理直系孤儿子代理', async () => {
  const fx = deleteRouteFixture([
    { id: 'main' },
    { id: 'child', origin: 'subagent', parentSession: 'main' },
    { id: 'fork', parentSession: 'main' },
    { id: 'live-child', origin: 'subagent', parentSession: 'main' },
  ], ['live-child'])
  const res = await callDeleteRoute(fx, { body: { sessionId: 'main' } })
  assert.equal(fx.registeredPath, '/api/starlong/session-manager/delete')
  assert.equal(res.status, 200)
  assert.equal(res.payload.ok, true)
  assert.deepEqual(res.payload.orphans, ['child'])
  assert.equal(existsSync(fx.dirs.get('main')), false, '主会话应被删')
  assert.equal(existsSync(fx.dirs.get('child')), false, '直系孤儿子代理应被顺带删')
  assert.equal(existsSync(fx.dirs.get('fork')), true, '历史 fork 不带 origin，不能当孤儿删')
  assert.equal(existsSync(fx.dirs.get('live-child')), true, '仍在内存的子代理不删')
  const lines = readFileSync(ledgerPath(), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const manual = lines.find(entry => entry.id === 'main' && entry.action === 'delete-manual')
  const orphan = lines.find(entry => entry.id === 'child' && entry.action === 'delete-orphan')
  assert.ok(manual, '手动删除应写明来源')
  assert.equal(manual.source, 'manual')
  assert.equal(orphan?.source, 'orphan')
  assert.equal(orphan?.parentId, 'main')
  fx.cleanup()
})

test('删除路由拒绝非 POST 与非本机同源请求', async () => {
  const fx = deleteRouteFixture([{ id: 'main' }])
  const post = await callDeleteRoute(fx, { method: 'GET' })
  assert.equal(post.status, 405)
  const noToken = await callDeleteRoute(fx, { headers: { 'x-starlong-delete': undefined } })
  assert.equal(noToken.status, 403)
  const remote = await callDeleteRoute(fx, { remoteAddress: '10.0.0.1' })
  assert.equal(remote.status, 403)
  const crossSite = await callDeleteRoute(fx, { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)
  const crossOrigin = await callDeleteRoute(fx, { headers: { origin: 'http://evil.example' } })
  assert.equal(crossOrigin.status, 403)
  const empty = await callDeleteRoute(fx, { body: {} })
  assert.equal(empty.status, 400)
  const missing = await callDeleteRoute(fx, { body: { sessionId: 'not-there' } })
  assert.equal(missing.status, 404)
  assert.equal(existsSync(fx.dirs.get('main')), true, '非法请求不得删任何会话')
  fx.cleanup()
})

test('删除路由接受 IPv6 回环来源', async () => {
  const fx = deleteRouteFixture([{ id: 'main' }])
  const res = await callDeleteRoute(fx, { remoteAddress: '::1', headers: { host: '[::1]:5124' } })
  assert.equal(res.status, 200)
  assert.equal(res.payload.ok, true)
  fx.cleanup()
})

test('会话目录定位失败时返回错误而非成功', async () => {
  const fx = deleteRouteFixture([{ id: 'main' }])
  fx.ctx.sessionPersistence.locate = () => undefined
  const res = await callDeleteRoute(fx)
  assert.equal(res.status, 404)
  assert.equal(res.payload.ok, false)
  assert.equal(res.payload.error, 'locate-failed')
  assert.equal(existsSync(fx.dirs.get('main')), true)
  fx.cleanup()
})

