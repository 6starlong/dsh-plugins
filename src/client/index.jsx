/**
 * dsh-plugins 的浏览器半边：apply 只负责注册与模块装配。
 * 渲染组件拆在 components/ 与 panels/，构建期由 scripts/bundle-client.mjs 内联。
 */
import { PLUGIN_PACKAGE, NS, DEFAULT_IDLE_DAYS, DEFAULT_DELETE_DAYS, DEFAULT_BACKUP_REPO, DEFAULT_BACKUP_INTERVAL } from './shared/constants.js'
import { REPO_CSS, THEME_CSS } from './shared/styles.js'
import { MESSAGES } from './shared/messages.js'
import { sectionScope, DirectCardController, useStore } from './shared/form.js'
import { SettingsPage } from './components/SettingsPage.jsx'
import { SettingsIcon } from './components/icons.jsx'
import { publishDeleteTarget, DeleteSessionOverlay } from './components/DeleteOverlay.jsx'
import { SessionPanel } from './panels/SessionPanel.jsx'
import { BackupPanel } from './panels/BackupPanel.jsx'

/** 构建期注入：可嵌入的独立 npm 包面板，元数据含 id / titleKey / version / create。 */
const PANEL_MODULES = __PANEL_MODULES__
function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = REPO_CSS + '\n' + THEME_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-plugins 页头样式')
  ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-plugins 文案')
  const t = ctx.locale.bind(NS)
  const scope = ctx.configForms.get(PLUGIN_PACKAGE)
  // 原生会话右键 + 确认弹层跟随会话管理开关；服务/HMR 晚于插件就绪时再补注册。
  ctx.effect(() => {
    let disposeMenu
    let disposeOverlay
    let mountedService

    const enabled = () => {
      const value = scope.getSnapshot().value?.['session-manager']?.enabled
      return value === undefined ? true : value !== false
    }
    const dropMenu = () => {
      try { disposeMenu?.() } catch { /* 宿主已回收菜单服务 */ }
      disposeMenu = undefined
      mountedService = undefined
    }
    const dropOverlay = () => {
      try { disposeOverlay?.() } catch { /* 宿主已回收插槽服务 */ }
      disposeOverlay = undefined
    }

    const registerMenu = () => {
      if (!enabled()) { dropMenu(); return }
      let menus
      try { menus = ctx.get?.('contextMenus') ?? ctx.contextMenus } catch { menus = undefined }
      if (!menus || typeof menus.register !== 'function') return
      // 服务实例被替换（HMR/重建）时先释放旧注册，避免菜单项残留或重复。
      if (mountedService !== undefined && mountedService !== menus) dropMenu()
      if (disposeMenu !== undefined) return
      try {
        disposeMenu = menus.register({
          id: 'dsh-plugins.session-delete',
          target: 'session',
          order: 9999,
          observe: () => [ctx.locale, scope],
          resolve: ({ sessionId, displayTitle }) => [{
            id: 'delete-session',
            label: t('deleteSession'),
            icon: { key: 'workspace.delete' },
            danger: true,
            afterContent: true,
            run: () => publishDeleteTarget({ sessionId, title: displayTitle || sessionId }),
          }],
        })
        mountedService = menus
      } catch { disposeMenu = undefined }
    }

    const registerOverlay = () => {
      if (!enabled()) { dropOverlay(); return }
      if (disposeOverlay !== undefined) return
      try {
        disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-plugins.delete-session',
          locale: NS,
          inject: () => ({ t: ctx.locale.bind(NS) }),
        }, DeleteSessionOverlay))
      } catch { disposeOverlay = undefined }
    }

    const reconcile = () => { registerMenu(); registerOverlay() }
    reconcile()
    void Promise.resolve().then(() => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
    const offConfig = scope.subscribe(() => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
    const off = typeof ctx.on === 'function'
      ? ctx.on('slots/changed', () => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
      : undefined

    return () => {
      try { off?.() } catch { /* 宿主已回收事件服务 */ }
      try { offConfig() } catch { /* 宿主已回收配置服务 */ }
      dropMenu()
      dropOverlay()
    }
  }, 'dsh-plugins 会话右键删除')

  // 本地模块沿用同一套面板协议；字段与动作只在这里声明一次。
  const makeLocalPanel = (moduleScope, fields, Panel, hookName, actions) => {
    const card = new DirectCardController(moduleScope, fields)
    return {
      Component: Panel,
      t,
      inject: () => card.inject(hookName, actions),
      dispose: () => card.dispose(),
    }
  }

  const makeModule = meta => {
    const moduleScope = sectionScope(scope, meta.section)
    const switchCard = new DirectCardController(moduleScope, { enabled: { type: 'boolean', default: true } })
    const panel = meta.panel(ctx, moduleScope)
    const injected = panel.inject()
    const hookProps = {}
    for (const [name, hook] of Object.entries(injected.hooks || {})) {
      hookProps['use' + name.charAt(0).toUpperCase() + name.slice(1)] = selector => useStore(hook, selector)
    }
    const { hooks, ...panelActions } = injected
    return {
      id: meta.id,
      titleKey: meta.titleKey,
      descriptionKey: meta.descriptionKey,
      version: meta.version,
      useSwitch: switchCard.asHook(),
      toggleSwitch: next => switchCard.commit('enabled', next),
      Panel: panel.Component,
      panelT: panel.t,
      panelProps: { ...panelActions, ...hookProps },
      dispose: () => {
        try { switchCard.dispose() } catch { /* 宿主已回收表单服务 */ }
        try { panel.dispose() } catch { /* 宿主已回收表单服务 */ }
      },
    }
  }

  const modules = [
    ...Object.values(PANEL_MODULES).map(meta => makeModule({
      id: meta.id,
      section: meta.id,
      titleKey: meta.titleKey,
      descriptionKey: meta.descriptionKey,
      version: meta.version,
      panel: (c, s) => meta.create(c, s),
    })),
    makeModule({
      id: 'session-manager',
      section: 'session-manager',
      titleKey: 'sessionTitle',
      panel: (c, s) => makeLocalPanel(s, {
        enabled: { type: 'boolean', default: true },
        autoArchive: { type: 'boolean', default: true },
        idleDays: { type: 'number', default: DEFAULT_IDLE_DAYS },
        autoDelete: { type: 'boolean', default: false },
        deleteDays: { type: 'number', default: DEFAULT_DELETE_DAYS },
      }, SessionPanel, 'sessionCard', {
        toggleSessionAuto: 'autoArchive',
        setSessionIdleDays: 'idleDays',
        toggleSessionDelete: 'autoDelete',
        setSessionDeleteDays: 'deleteDays',
      }),
    }),
    makeModule({
      id: 'dsh-backup',
      section: 'dsh-backup',
      titleKey: 'backupTitle',
      panel: (c, s) => makeLocalPanel(s, {
        enabled: { type: 'boolean', default: true },
        repo: { type: 'string', default: DEFAULT_BACKUP_REPO },
        intervalHours: { type: 'number', default: Number(DEFAULT_BACKUP_INTERVAL) },
      }, BackupPanel, 'backupCard', {
        setBackupRepo: 'repo',
        setBackupInterval: 'intervalHours',
      }),
    }),
  ]

  ctx.effect(() => () => {
    for (const module of modules) {
      try { module.dispose() } catch { /* 宿主已回收表单服务 */ }
    }
  }, 'dsh-plugins 表单')

  ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => {
    const disposers = [
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PLUGIN_PACKAGE,
        // 导航按 order 升序排；取大值让套件页固定垫底。
        order: 1000,
        label: () => t('page'),
        locale: NS,
        inject: () => ({ modules }),
      }, SettingsPage)),
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: PLUGIN_PACKAGE,
      }, SettingsIcon)),
    ]
    return () => disposers.reverse().forEach(dispose => dispose?.())
  }), 'dsh-plugins 卡片与设置页')
}

module.exports.name = '@6starlong/dsh-plugins'
module.exports.inject = ['slots', 'locale', 'configForms']
module.exports.apply = apply