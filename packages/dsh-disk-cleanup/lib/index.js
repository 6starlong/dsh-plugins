/**
 * dsh-disk-cleanup —— 给临时文件一个专用目录。
 *
 * 四条机制：
 *  - shell 环境注入：在 pwsh / bash 命令串前把 TMP / TEMP / TMPDIR 指向 scratch，
 *    让脚本里的临时文件默认落在工作区之外。
 *  - 权限补齐：会话一创建就给 scratch 追加可写根（文件工具）和访问控制
 *    列表授权（受限子进程），不依赖 shell 命令是否执行。
 *  - 系统提示：说明临时文件写 scratch、用户文件留在工作区。
 *  - 清理：插件加载时扫一遍 scratch、请求图片缓存与无主原件，清掉过期条目和空目录，之后定时检查。
 * @module dsh-disk-cleanup
 */
import { Config, resolveConfig } from './config.js'
import { CLEANUP_INTERVAL_MS, cleanEmptyDirs, cleanScratch, throttled } from './cleanup.js'
import { cleanAttachmentLeftovers } from './attachments.js'
import { dshHome, ensureDir, scratchDirFor, sharedScratchDir } from './scratch.js'
import { injectShellTemp } from './shell-env.js'
import { grantProcessWrite, revokeAll } from './acl.js'
import { scratchPromptText } from './prompt.js'

/** Cordis 插件身份（与包名一致）。 */
export const name = '@6starlong/dsh-disk-cleanup'
/** 必需服务：工具注册表与 agent 注册表。 */
export const inject = ['tools', 'agents']

/** 插件配置 schema：宿主用它渲染设置页表单。 */
export { Config }

/** agent → 已装好包装的工具名。用来避免重复注册，也用来记下「当时还没加载」的工具。 */
const installed = new WeakMap()

/** 已替换过 execute 的活工具对象；防止 tools/change 重复包裹导致 execute 层层嵌套。 */
const wrappedTools = new WeakSet()

/** 正在安装中的 agent。注册包装会触发 tools/change，不挡住就会重入、重复注册同一个工具名并抛错。 */
const installing = new WeakSet()

/**
 * 插件入口。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - cordis.patch.yml 里的 config。
 */
export function apply(ctx, config) {
  const cfg = resolveConfig(config)
  if (!cfg.enabled) return

  /** 可选服务：拿不到就退化（只保留能用的那部分），绝不因此报错。 */
  let sandboxPolicy
  ctx.inject(['sandboxPolicy'], (child) => { sandboxPolicy = child.sandboxPolicy })

  // 设置页由本插件自己的卡片渲染（客户端半边注册在 plugins.bundle.config 槽），
  // 关掉宿主按 schema 自动生成的那份，免得同一份配置出现两套控件。
  ctx.inject(['settings'], (child) => {
    try {
      child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-disk-cleanup 设置卡片')
    } catch { /* 宿主没有设置服务时保持默认，不影响其余机制 */ }
  })


  /**
   * 清理入口。插件加载时跑一次，之后每 CLEANUP_INTERVAL_MS 最多再跑一次；
   * 没有常驻定时器，进程重启等于重新起算；附件首轮只多写一个标记文件。
   * @returns {Promise<void>}
   */
  const runCleanup = throttled(CLEANUP_INTERVAL_MS)
  /**
   * 执行一次清理（受节流控制）。
   *
   * 只清共享 scratch：配置里自己指了别处的用户，目录里的东西未必可丢，不替他决定。
   * 附件清理也只受总开关控制：请求图片缓存按保留期清，无主原件先比对全部会话。
   * DSH home 下一级的空目录与它们无关，单独清。
   * @returns {Promise<void>}
   */
  async function cleanup() {
    if (!cfg.autoCleanup) return
    try {
      await runCleanup(async () => {
        if (cfg.scratchDir === '') {
          const scratch = sharedScratchDir()
          await cleanScratch({ dir: scratch, maxAgeDays: cfg.cleanupMaxAgeDays })
          await cleanEmptyDirs({ dir: scratch, recursive: true })
        }
        const home = dshHome()
        const attachments = await cleanAttachmentLeftovers({
          home,
          maxAgeDays: cfg.cleanupMaxAgeDays,
        })
        if (attachments.first && attachments.objects.candidates > 0) {
          console.info(
            `[dsh-disk-cleanup] 首次扫描发现 ${attachments.objects.candidates} 个无主原件，本次只记录不删除。`
          )
        }
        await cleanEmptyDirs({ dir: home })
      })
    } catch {
      /* 清理只是收尾，失败了不能连带插件加载失败 */
    }
  }

  /**
   * 会话 → 已完成的授权。键里带模式与目录，模式一变就重新授权。
   * @type {WeakMap<object, {key: string, promise: Promise<boolean>}>}
   */
  const prepared = new WeakMap()

  /**
   * 会话 → 实际生效的落点。退路可能改掉 scratch 位置，系统提示要跟着改口。
   * @type {WeakMap<object, object>}
   */
  const effective = new WeakMap()

  /** session → 已登记过的可写目录，避免同一目录重复注册。 */
  const writableRoots = new WeakMap()

  /** registerWritableRoot 返回的撤销函数，插件卸载时统一撤销。 */
  const rootDisposers = new Set()

  /** agent → 已经登记过的目录，避免同一 agent 重复登记。 */
  const agentRoots = new WeakMap()

  /**
   * 当前驱动链里的会话；工具执行上下文拿不到 agent 时用它兜底。
   * @returns {object | undefined} 会话对象。
   */
  function currentSession() {
    try {
      return ctx.agents?.currentInitiator?.()?.session
    } catch {
      return undefined
    }
  }

  /**
   * 取一个可选服务：优先用注入回调拿到的，其次直接问上下文。
   * 注入回调是异步触发的，落点计算可能早于它，所以这里必须能自己取到。
   * @param {string} serviceName - 服务名。
   * @param {unknown} injected - 注入回调里拿到的实例。
   * @returns {unknown} 服务实例，取不到时为 undefined。
   */
  function service(serviceName, injected) {
    if (injected !== undefined) return injected
    try {
      return typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 读一个会话解析后的沙箱策略。
   * @param {object | undefined} session - 会话对象。
   * @returns {{mode?: string, workspaceRoot?: string}} 策略；取不到时为空对象。
   */
  function policyFor(session) {
    const policyService = service('sandboxPolicy', sandboxPolicy)
    try {
      return policyService?.resolve({ session }) ?? {}
    } catch {
      return {}
    }
  }

  /**
   * 算出一个会话的落点信息。纯计算，不建目录、不授权。
   *
   * 每次调用都重新读策略：模式可能在会话中途变化，缓存住旧模式会把临时文件
   * 送进当时并不允许写的目录。
   * @param {object | undefined} session - 会话对象。
   * @returns {{mode?: string, workspaceRoot?: string, scratchDir?: string}} 落点信息。
   */
  function resolveState(session) {
    const policy = policyFor(session)
    const mode = policy.mode
    const workspaceRoot = policy.workspaceRoot ?? session?.header?.cwd
    const state = { mode, workspaceRoot, scratchDir: undefined }
    if (mode === undefined || mode === 'read-only') return state

    const scratchDir = scratchDirFor({ mode, workspaceRoot, configured: cfg.scratchDir })
    if (scratchDir === undefined) return state
    state.scratchDir = scratchDir

    return state
  }

  /**
   * 让一个目录可写：建出来，并补上文件工具与受限子进程各自的权限。
   * @param {object} session - 会话对象。
   * @param {string} mode - 沙箱模式。
   * @param {string | undefined} workspaceRoot - 工作区根。
   * @param {string} dir - 目标目录。
   * @returns {Promise<boolean>} 是否可用。
   */
  async function makeWritable(session, mode, workspaceRoot, dir) {
    try {
      await ensureDir(dir)
    } catch {
      return false
    }
    // 文件工具的可写根与「是否给子进程补访问控制项」是两件事，分开判断。
    let rooted = true
    const policyService = service('sandboxPolicy', sandboxPolicy)
    try {
      if (typeof policyService?.registerWritableRoot !== 'function') rooted = false
      else {
        let seen = writableRoots.get(session)
        if (seen === undefined) {
          seen = new Set()
          writableRoots.set(session, seen)
        }
        if (!seen.has(dir)) {
          const dispose = policyService.registerWritableRoot(session, dir)
          seen.add(dir)
          if (typeof dispose === 'function') rootDisposers.add(dispose)
        }
      }
    } catch {
      rooted = false
    }
    // 完全权限下没有围栏，不需要给受限子进程补访问控制项。
    if (mode === 'danger-full-access') return rooted
    const processWritable = cfg.grantProcessWrite
      ? await grantProcessWrite(workspaceRoot, dir)
      : true
    return rooted && processWritable
  }

  /**
   * 落实落点：建目录并补权限。首次真正要用时才调用——
   * 会话创建那一刻策略还没落定，提前算会把临时文件送进错误的目录。
   * @param {object | undefined} session - 会话对象。
   * @param {object} state - resolveState 的结果，可能被就地修正为退路目录。
   * @returns {Promise<boolean>} 是否可用。
   */
  function activate(session, state) {
    if (session === undefined || session === null) return Promise.resolve(false)
    if (state.scratchDir === undefined) return Promise.resolve(false)
    const key = [state.mode, state.scratchDir].join('|')
    const cached = prepared.get(session)
    if (cached !== undefined && cached.key === key) return cached.promise
    const promise = (async () => {
      const dirs = [state.scratchDir]
      let ok = true
      for (const dir of dirs) {
        if (!(await makeWritable(session, state.mode, state.workspaceRoot, dir))) {
          ok = false
          break
        }
      }
      if (ok) {
        effective.set(session, state)
        return true
      }
      // 共享目录拿不到权限时退回工作区里的 cache/scratch：至少写入能成。
      if (state.mode !== 'workspace-write' || typeof state.workspaceRoot !== 'string') return false
      const fallback = scratchDirFor({
        mode: state.mode,
        workspaceRoot: state.workspaceRoot,
        configured: cfg.scratchDir,
        sharedCache: false,
      })
      if (fallback === undefined) return false
      if (!(await makeWritable(session, state.mode, state.workspaceRoot, fallback))) return false
      state.scratchDir = fallback
      effective.set(session, state)
      return true
    })()
    prepared.set(session, { key, promise })
    return promise
  }

  /**
   * 会话创建完成后立即把 scratch 登记为可写目录。
   *
   * 不能等到 shell 命令执行：文件工具（write / edit）不经过 shell 包装，
   * 而 resume / fork 之后原先的登记会失效，agent/created 会再次触发。
   * 登记只是把目录加进可写允许列表，不改变权限模式；明确只读时跳过。
   * @param {object} agent - agent 实例（真实宿主里带 session）。
   * @returns {Promise<boolean>} 是否登记成功。
   */
  function prepareAgent(agent) {
    const session = agent?.session
    if (session === undefined || session === null) return Promise.resolve(false)
    const policy = policyFor(session)
    if (policy.mode === 'read-only') return Promise.resolve(false)
    const workspaceRoot = policy.workspaceRoot ?? session?.header?.cwd
    // 目录位置与模式无关；只在补访问控制项时区分完全权限（无需给受限进程授权）。
    const mode = policy.mode === 'danger-full-access' ? 'danger-full-access' : 'workspace-write'
    const scratchDir = scratchDirFor({
      mode,
      workspaceRoot,
      configured: cfg.scratchDir,
    })
    if (scratchDir === undefined) return Promise.resolve(false)
    let seen = agentRoots.get(agent)
    if (seen === undefined) {
      seen = new Set()
      agentRoots.set(agent, seen)
    }
    if (seen.has(scratchDir)) return Promise.resolve(true)
    // 不让同一 agent 并发重复走一遍授权；失败则连标记一起撤掉，留给下一次重试。
    const promise = makeWritable(session, mode, workspaceRoot, scratchDir)
    seen.add(scratchDir)
    void promise.then((ok) => { if (!ok) seen.delete(scratchDir) }, () => { seen.delete(scratchDir) })
    return promise
  }

  /**
   * 包装 shell 工具：在命令串前注入临时目录。
   * 查工具要带 agent 作用域，否则只读到全局层，工具恒为 undefined。
   * 直接替换活对象的 execute，而不是 register 同名工具——dsh-ops 已用带 when
   * 的条件注册占用了 ops_bash 工具名，再 register 会重名冲突抛错。
   * @param {object} agentCtx - agent 作用域上下文。
   * @param {object} agent - 当前 agent，作为工具视图的作用域。
   * @param {'pwsh' | 'bash' | 'ops_bash'} shell - 工具名；非 pwsh 一律按 bash 处理。
   * @returns {boolean} 是否包装成功。
   */
  function wrapShell(agentCtx, agent, shell) {
    if (!cfg.injectShellTemp) return false
    const live = agentCtx.tools.get(shell, agent)
    if (live === undefined || live === null || typeof live !== 'object') return false
    if (typeof live.execute !== 'function' || wrappedTools.has(live)) return wrappedTools.has(live)
    // 工具定义对象就是注册进 registry 的原对象，替换 execute 即改调用行为。
    const original = live.execute
    live.execute = async function (args, exec) {
      const input = args !== null && typeof args === 'object' ? args : {}
      if (typeof input.command !== 'string' || input.command === '') return original(args, exec)
      const execAgent = exec?.agent ?? exec?.caller
      const session = execAgent?.session ?? currentSession()
      const state = resolveState(session)
      if (state.scratchDir === undefined) return original(args, exec)
      if (!(await activate(session, state))) return original(args, exec)
      // activate 成功即保证 scratchDir 有值。
      const command = injectShellTemp(shell, input.command, state.scratchDir)
      if (command === input.command) return original(args, exec)
      return original({ ...input, command }, exec)
    }
    wrappedTools.add(live)
    return true
  }

  /** 只包装 shell 工具；文件工具的落点由模型自己决定。 */
  const TARGETS = ['pwsh', 'bash', 'ops_bash']

  /**
   * 给一个 agent 装上全部包装；已经装过的跳过。
   * @param {object} agent - agent 实例。
   * @returns {Promise<void>}
   */
  async function install(agent) {
    if (agent === undefined || agent === null) return
    if (installing.has(agent)) return
    installing.add(agent)
    try {
      await installNow(agent)
    } finally {
      installing.delete(agent)
    }
  }

  /**
   * install 的实际内容，由 install 负责重入保护。
   * 目标工具当时还没注册时留待 tools/change 重试，不会永久漏掉。
   * @param {object} agent - agent 实例。
   * @returns {Promise<void>}
   */
  async function installNow(agent) {
    const agentCtx = agent.ctx
    if (agentCtx === undefined || typeof agentCtx.inject !== 'function') return
    let done = installed.get(agent)
    if (done === undefined) {
      done = new Set()
      installed.set(agent, done)
    }
    const ready = TARGETS.filter(
      toolName => !done.has(toolName) && ctx.tools.get(toolName, agent) !== undefined
    )
    if (ready.length === 0) return
    // 真实的 agent 上下文要求先声明依赖才能读 ctx.tools；注册仍落在该 agent 的作用域层。
    await new Promise((resolve) => {
      agentCtx.inject(['tools'], (child) => {
        // 只有真的注册成功才记进 done；目标工具还没出现时留白，等 tools/change 再补。
        for (const toolName of ready) {
          if (wrapShell(child, agent, toolName)) done.add(toolName)
        }
        resolve()
      })
    })
  }

  // agent/created 是串行且被 await 的；返回 Promise 保证输入放行前
  // 包装已装好、scratch 已登记为可写目录。
  ctx.on('agent/created', ({ agent }) =>
    Promise.all([install(agent), prepareAgent(agent)]).then(() => undefined))
  // 工具注册表变化时补装：目标工具可能比本插件晚加载。
  ctx.on('tools/change', () => {
    let list
    try { list = ctx.agents?.list() } catch { list = undefined }
    if (!Array.isArray(list)) return
    for (const agent of list) {
      void install(agent)
      void prepareAgent(agent)
    }
  })
  // agents 服务可能晚于本插件注册，等它就绪后补装一遍。
  ctx.inject(['agents'], (child) => {
    for (const agent of child.agents.list()) {
      void install(agent)
      void prepareAgent(agent)
    }
  })

  // 启动就跑一次清理，之后每 CLEANUP_INTERVAL_MS 再触发一次。
  // 用原生定时器而不是 ctx.interval：后者要注入 cordis 的 timer 服务，
  // 宿主没装就会整个插件起不来，为一次清理不值得。
  // 定时器随插件的 effect 一起清掉，节流器保证两次真正落地间隔不小于间隔值。
  void cleanup()
  ctx.effect(() => {
    const timer = setInterval(() => { void cleanup() }, CLEANUP_INTERVAL_MS)
    // 不阻止进程退出：清理本身不紧急，宿主该退就退。
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  })

  if (cfg.promptSection) {
    ctx.inject(['systemPrompt'], (child) => {
      // 排在 write 工具的说明之后；取不到宿主顺序时用固定兜底值。
      let order = 1201
      try {
        const baseOrder = child.systemPrompt.getSectionOrder('TOOL_WRITE')
        if (Number.isFinite(baseOrder)) order = baseOrder + 1
      } catch {
        /* 宿主未提供顺序表时保留兜底值 */
      }
      child.systemPrompt.section({
        name: '@6starlong/dsh-disk-cleanup',
        order,
        text: (context) => {
          const session = context?.agent?.session ?? currentSession()
          // 只读会话没有可写落点，讲了也是假的：整段不注入。
          if (policyFor(session).mode === 'read-only') return ''
          const fresh = resolveState(session)
          // 退路可能把 scratch 挪到了工作区，提示要跟着改口；但模式变了（比如切成只读）就先以新模式为准。
          const applied = session === undefined ? undefined : effective.get(session)
          const state = fresh.scratchDir === undefined ? fresh : applied ?? fresh
          return scratchPromptText({ scratchDir: state.scratchDir })
        },
      })
    })
  }

  // 插件卸载时撤销可写根登记、释放授权对象。目录上的访问控制项是 standing 的，
  // 留着给之后的会话复用——撤销了下一个会话就会被挡住。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of rootDisposers) {
        try { dispose() } catch { /* 单个撤销失败不阻塞其余 */ }
      }
      rootDisposers.clear()
      revokeAll()
    })
  }
}
