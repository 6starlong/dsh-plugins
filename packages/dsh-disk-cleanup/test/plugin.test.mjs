import { apply } from '../lib/index.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// scratch 位置由 DSH_HOME 决定；测试把它指到临时目录，不碰真实缓存。
const HOME = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-plugin-'))
process.env.DSH_HOME = HOME
after(() => rmSync(HOME, { recursive: true, force: true }))

/** 本测试里的 scratch 目录。 */
const SCRATCH = join(HOME, 'cache', 'scratch')

/** 默认配置：不碰真实访问控制列表。 */
const SAFE = { grantProcessWrite: false }

/** 工具是否被包装：execute 是否已替换成新的函数。 */
function isWrapped(host, name) {
  const tool = host.globals.get(name)
  return !!tool && tool.execute !== host.originals.get(name)
}

/** 命令串里某段前缀出现的次数，用来确认没有重复包裹。 */
function countOf(text, needle) {
  return text.split(needle).length - 1
}

/**
 * 造一个足够真的假 ctx：globals 里的工具对象是活引用，get 直接返回它。
 * @param {object} [options] - mode 指定沙箱模式，config 追加插件配置。
 * @returns {object} 假宿主。
 */
function fakeHost(options = {}) {
  const mode = options.mode ?? 'workspace-write'
  const workspaceRoot = options.workspaceRoot ?? 'C:\\ws'
  const globals = new Map()
  const originals = new Map()
  const registered = []
  const sections = []
  const listeners = []
  const agents = []
  const writableRoots = []

  const makeTool = (name) => {
    const execute = async (args) => ({ path: args.file_path ?? args.command, args })
    const tool = {
      name,
      description: name,
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      execute,
    }
    originals.set(name, execute)
    return tool
  }

  // 只放插件真正要包装的 shell 工具；文件工具不参与。
  for (const n of ['pwsh', 'bash', ...(options.tools ?? [])]) globals.set(n, makeTool(n))

  const sandboxPolicy = {
    resolve: () => ({ mode, workspaceRoot }),
    registerWritableRoot: (session, dir) => { writableRoots.push(dir); return () => {} },
  }

  // 记录每次查工具时传的作用域，用来断言没漏掉 agent。
  const scopeChecks = []
  // lateAgents 下攒起来、等服务就绪后才执行的 inject 回调。
  const deferred = []

  const ctx = {
    tools: {
      get: (n, scope) => { scopeChecks.push({ n, scope }); return globals.get(n) },
      register: (def) => { registered.push(def); return () => {} },
    },
    agents: { list: () => agents },
    on: (event, handler) => { listeners.push({ event, handler }); return () => {} },
    inject: (names, fn) => {
      const child = {
        sandboxPolicy,
        agents: { list: () => agents },
        // 真实宿主里插件可能比 agents 服务先加载；lateAgents 模拟这一段空窗期。
        systemPrompt: {
          getSectionOrder: () => 1200,
          section: (s) => { sections.push(s); return () => {} },
        },
      }
      if (options.lateAgents === true && Array.isArray(names) && names.includes('agents')) {
        deferred.push(() => fn(child))
        return () => {}
      }
      fn(child)
      return () => {}
    },
    effect: (fn) => { const dispose = fn(); return () => dispose() },
    // cordis 的定时器挂在当前 fiber 上，插件卸载时自动清；这里换成不起作用的替身。
    interval: () => () => {},
    emit: async (event, payload) => { for (const l of listeners) if (l.event === event) await l.handler(payload) },
  }
  /** 真实 cordis 的 agent 上下文要先 inject 才能读 ctx.tools，这里照样模拟。 */
  const agentTools = {
    get: (n, scope) => { scopeChecks.push({ n, scope }); return globals.get(n) },
    register: (def) => {
      registered.push(def)
      // 真实 ToolsService 注册后会发 tools/change；这里照样发，才能覆盖重入路径。
      for (const l of listeners) if (l.event === 'tools/change') l.handler()
      return () => {}
    },
  }
  const makeAgentCtx = () => ({
    inject: (names, fn) => { fn({ tools: agentTools }); return () => {} },
  })
  const agent = { ctx: makeAgentCtx(), session: { header: { cwd: workspaceRoot } } }
  agents.push(agent)
  /** 模拟 agents 服务就绪：补上服务并把攒下的 inject 回调跑掉。 */
  const releaseAgents = () => {
    ctx.agents = { list: () => agents }
    for (const run of deferred.splice(0)) run()
  }
  return { ctx, registered, sections, agent, globals, originals, makeAgentCtx, writableRoots, scopeChecks, releaseAgents, config: { ...SAFE, ...options.config } }
}

/** 装好插件并等一轮微任务，让 install 跑完。 */
async function boot(options) {
  const host = fakeHost(options)
  apply(host.ctx, host.config)
  // prepareAgent 里有一次真实的 mkdir，等它落地再断言。
  await new Promise(r => setTimeout(r, 20))
  return host
}

test('插件导出 name / inject / apply', () => {
  assert.equal(typeof apply, 'function')
})

test('apply 后只给 pwsh 与 bash 装包装', async () => {
  const host = await boot()
  assert.equal(isWrapped(host, 'pwsh'), true)
  assert.equal(isWrapped(host, 'bash'), true)
})

test('包装只替换 execute，工具其余字段原地保留', async () => {
  const host = await boot()
  const tool = host.globals.get('pwsh')
  assert.equal(tool.description, 'pwsh')
  assert.deepEqual(tool.parameters, { type: 'object', properties: {} })
  assert.equal(typeof tool.execute, 'function')
  assert.notEqual(tool.execute, host.originals.get('pwsh'))
})

test('pwsh 命令串被注入 TMP/TEMP', async () => {
  const host = await boot()
  const out = await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
  assert.ok(out.path.includes("$env:TMP='" + SCRATCH + "'"), out.path)
  assert.ok(out.path.endsWith('Get-ChildItem'))
})


test('ops_bash 也装上包装并注入 TMPDIR/TMP/TEMP', async () => {
  const host = await boot({ tools: ['ops_bash'] })
  assert.equal(isWrapped(host, 'pwsh'), true)
  assert.equal(isWrapped(host, 'bash'), true)
  assert.equal(isWrapped(host, 'ops_bash'), true)
  const out = await host.globals.get('ops_bash').execute({ command: 'echo hi' }, { agent: host.agent })
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
    assert.ok(out.path.includes(`export ${name}='${SCRATCH}'`), out.path)
  }
  assert.ok(out.path.endsWith('echo hi'))
})

test('workspace-write 下给 scratch 追加可写根', async () => {
  const host = await boot({ config: { grantProcessWrite: true } })
  await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
  assert.ok(host.writableRoots.some(dir => dir.toLowerCase() === SCRATCH.toLowerCase()),
    host.writableRoots.join(','))
})

test('read-only 下不注入环境', async () => {
  const host = await boot({ mode: 'read-only' })
  const shellOut = await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
  assert.equal(shellOut.path, 'Get-ChildItem')
})

test('系统提示 section 被注册且 order 紧跟 TOOL_WRITE', async () => {
  const host = await boot()
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].name, 'dsh-disk-cleanup')
  assert.equal(host.sections[0].order, 1201)
  const text = host.sections[0].text({ agent: host.agent })
  assert.ok(text.includes(SCRATCH), text)
})

test('read-only 下提示词 section 不产出文本', async () => {
  const host = await boot({ mode: 'read-only' })
  assert.equal(host.sections.length, 1)
  assert.equal(host.sections[0].text({ agent: host.agent }), '')
})

test('agent/created 事件给新 agent 也装上', async () => {
  const host = await boot()
  const fresh = { ctx: host.makeAgentCtx(), session: { header: { cwd: 'C:\\ws' } } }
  await host.ctx.emit('agent/created', { agent: fresh })
  assert.equal(isWrapped(host, 'pwsh'), true)
  assert.equal(isWrapped(host, 'bash'), true)
})

test('同一个 agent 不会被装两次', async () => {
  const host = await boot()
  await host.ctx.emit('agent/created', { agent: host.agent })
  const out = await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
  assert.equal(countOf(out.path, "$env:TMP='"), 1, out.path)
})

test('enabled=false 时什么都不做', async () => {
  const host = await boot({ config: { enabled: false } })
  assert.equal(isWrapped(host, 'pwsh'), false)
  assert.equal(isWrapped(host, 'bash'), false)
  assert.equal(host.sections.length, 0)
})

test('tools/change 不会导致重复包裹', async () => {
  const host = await boot()
  await new Promise(r => setImmediate(r))
  const out = await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
  assert.equal(countOf(out.path, "$env:TMP='"), 1, out.path)
})

test('目标工具晚注册时由 tools/change 补装', async () => {
  const host = fakeHost()
  // 先摘掉 bash，模拟插件加载顺序靠后。
  const removed = host.globals.get('bash')
  host.globals.delete('bash')
  apply(host.ctx, host.config)
  await new Promise(r => setImmediate(r))
  assert.equal(isWrapped(host, 'pwsh'), true)
  assert.equal(isWrapped(host, 'bash'), false)
  // 工具后来才注册，再发一次 tools/change
  host.globals.set('bash', removed)
  host.ctx.emit('tools/change', {})
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))
  assert.equal(isWrapped(host, 'bash'), true)
  const out = await host.globals.get('bash').execute({ command: 'echo hi' }, { agent: host.agent })
  assert.equal(countOf(out.path, 'export TMPDIR='), 1, out.path)
})
test('read-only 下不创建 scratch 目录', async () => {
  const prev = process.env.DSH_HOME
  const fresh = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-ro-'))
  process.env.DSH_HOME = fresh
  try {
    const host = await boot({ mode: 'read-only' })
    await host.globals.get('pwsh').execute({ command: 'Get-ChildItem' }, { agent: host.agent })
    assert.equal(existsSync(join(fresh, 'cache')), false, '只读模式不该在缓存目录留下任何东西')
  } finally {
    process.env.DSH_HOME = prev
    rmSync(fresh, { recursive: true, force: true })
  }
})

test('会话创建时就建好 scratch，不依赖 shell 命令执行', async () => {
  const prev = process.env.DSH_HOME
  const fresh = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-eager-'))
  process.env.DSH_HOME = fresh
  try {
    const host = await boot()
    assert.equal(isWrapped(host, 'pwsh'), true)
    assert.equal(isWrapped(host, 'bash'), true)
    assert.equal(existsSync(join(fresh, 'cache', 'scratch')), true, '会话创建时就该建好 scratch')
    assert.ok(host.writableRoots.some(dir => dir.toLowerCase() === join(fresh, 'cache', 'scratch').toLowerCase()),
      '不执行 shell 命令也该登记可写根: ' + host.writableRoots.join(','))
  } finally {
    process.env.DSH_HOME = prev
    rmSync(fresh, { recursive: true, force: true })
  }
})

test('文件工具路径：不执行 shell 也已登记可写根', async () => {
  const host = await boot({ config: { grantProcessWrite: false } })
  assert.ok(host.writableRoots.some(dir => dir.toLowerCase() === SCRATCH.toLowerCase()),
    '文件工具不经过 shell 包装，必须在会话创建时登记: ' + host.writableRoots.join(','))
})

test('read-only 下不登记可写根', async () => {
  const host = await boot({ mode: 'read-only', config: { grantProcessWrite: false } })
  assert.equal(host.writableRoots.length, 0, host.writableRoots.join(','))
})

/**
 * 在指定 DSH_HOME 下跑一次 boot，并在 scratch 里预置过期的残留。
 * @param {object} config - 插件配置。
 * @returns {Promise<{home: string, expired: string, fresh: string, host: object}>} 目录与宿主。
 */
async function bootWithScratch(config) {
  const prev = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-clean-'))
  process.env.DSH_HOME = home
  const scratch = join(home, 'cache', 'scratch')
  mkdirSync(scratch, { recursive: true })
  const expired = join(scratch, 'old-probe.mjs')
  const fresh = join(scratch, 'recent-probe.mjs')
  writeFileSync(expired, 'x')
  writeFileSync(fresh, 'x')
  const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  utimesSync(expired, stale, stale)
  utimesSync(scratch, stale, stale)
  try {
    const host = await boot({ config })
    await new Promise(r => setTimeout(r, 30))
    return { home, expired, fresh, host }
  } finally {
    process.env.DSH_HOME = prev
  }
}

test('启动时清掉 scratch 里过期的条目', async () => {
  const { home, expired, fresh } = await bootWithScratch({ grantProcessWrite: false })
  try {
    assert.equal(existsSync(expired), false, '30 天前的残留该被删掉')
    assert.equal(existsSync(fresh), true, '刚写的文件不该被删')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('autoCleanup=false 时一个都不删', async () => {
  const { home, expired } = await bootWithScratch({ grantProcessWrite: false, autoCleanup: false })
  try {
    assert.equal(existsSync(expired), true, '关掉清理后残留应保留')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('cleanupMaxAgeDays 变大后旧条目不再过期', async () => {
  const { home, expired } = await bootWithScratch({ grantProcessWrite: false, cleanupMaxAgeDays: 60 })
  try {
    assert.equal(existsSync(expired), true, '保留 60 天时 30 天前的文件还在期内')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('自己指定了 scratchDir 时不去动那个目录', async () => {
  const prev = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-own-'))
  const custom = mkdtempSync(join(tmpdir(), 'dsh-disk-cleanup-custom-'))
  process.env.DSH_HOME = home
  const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const leftover = join(custom, 'keep-me.txt')
  writeFileSync(leftover, 'x')
  utimesSync(leftover, stale, stale)
  utimesSync(custom, stale, stale)
  try {
    await boot({ config: { grantProcessWrite: false, scratchDir: custom } })
    await new Promise(r => setTimeout(r, 30))
    assert.equal(existsSync(leftover), true, '用户自己的目录不该被自动清理')
  } finally {
    process.env.DSH_HOME = prev
    rmSync(home, { recursive: true, force: true })
    rmSync(custom, { recursive: true, force: true })
  }
})

test('查 shell 工具时带上 agent 作用域', async () => {
  const host = await boot()
  const forShell = host.scopeChecks.filter(c => c.n === 'pwsh' || c.n === 'bash')
  assert.ok(forShell.length >= 2, '两个工具各查一次，实际查了 ' + host.scopeChecks.length + ' 次')
  assert.ok(forShell.every(c => c.scope === host.agent), '作用域必须是当前 agent')
})
