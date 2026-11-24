/**
 * dsh-starlong 的浏览器半边：聚合各模块的配置卡片。
 * 宿主按 bundle id 出配置区，所以卡片 key 用套件名；表单作用域靠 sectionScope
 * 收敛到各模块自己的嵌套段，模块间字段不会打架。
 *
 * @module dsh-starlong/client
 */
import { Switch, SettingsForm, SettingsFormModel, settingsNumberField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'

// 构建时由 scripts/build.mjs 从 dsh-disk-cleanup 包版本注入，避免卡片里写死版本号。
const DISK_CLEANUP_VERSION = '__DISK_CLEANUP_VERSION__'

/** 包名：plugins.bundle.config 的槽位 key，也是配置表单的命名空间。 */
const PLUGIN_PACKAGE = 'dsh-starlong'
/** 本卡片编辑的模块段。 */
const DISK_CLEANUP_SECTION = 'dsh-disk-cleanup'
/** 会话管理模块的段：开关、自动归档与自动删除配置。 */
const SESSION_SECTION = 'session-manager'
/** DSH 备份模块的段：开关、目标仓库与同步频率。 */
const BACKUP_SECTION = 'dsh-backup'
/** 本地化命名空间。 */
const NS = 'settings.starlong.diskCleanup'
/** 套件仓库：设置页头右侧的 GitHub 入口。 */
const REPO_URL = 'https://github.com/6starlong/dsh-starlong'
/** 手动删除端点与同源头：与服务端 session-manager/core.js 对齐。 */
const DELETE_ROUTE = '/api/starlong/session-manager/delete'
const DELETE_TOKEN_HEADER = 'x-starlong-delete'
/** 本地备份端点与同源头：与服务端 dsh-backup/index.js 对齐。 */
const BACKUP_EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
const BACKUP_DOWNLOAD_ROUTE = '/api/starlong/dsh-backup/download'
const BACKUP_TOKEN_HEADER = 'x-starlong-backup'
const BACKUP_TREE_ROUTE = '/api/starlong/dsh-backup/tree'
const BACKUP_PRESET_ROUTE = '/api/starlong/dsh-backup/preset'

/** 与 lib/config.js 的 schema 默认值一致；输入框留空时置灰显示。 */
const DEFAULT_MAX_AGE_DAYS = '3'
const DEFAULT_IDLE_DAYS = '3'
const DEFAULT_DELETE_DAYS = '90'
const DEFAULT_BACKUP_REPO = '6starlong/agent-backups'
const DEFAULT_BACKUP_INTERVAL = '6'

const STYLE = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  label: { fontWeight: 600 },
  hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
  // 每个模块一张卡片；模块之间靠卡片边框与间距分组。
  card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: 'var(--dsh-claude-card, var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.05)))' },
  // 模块关闭时整卡只剩标题行与开关，子设置连同保存按钮一起收起。
  cardTitle: { fontWeight: 600, fontSize: '15px' },
  cardDesc: { margin: '4px 0 0', opacity: 0.7, fontSize: '12px' },
  // 标题区与子设置之间的分割线。
  divider: { borderTop: '0.5px solid var(--dsh-claude-divider, var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3)))', margin: '14px 0' },
  // 页面顶部留白，避免标题贴边。
  pageHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '16px', marginBottom: '16px' },
  pageTitle: { fontWeight: 700, fontSize: '16px' },
}

/**
 * 主题适配器：默认基底是 DSH 客户端变量；命中适配器时只覆盖差异 token。
 * 加新主题=追加一项 detect + css，不改组件逻辑。
 */
const THEME_ADAPTERS = [
  {
    id: 'claude',
    detect: () => {
      const probe = '--dsh-claude-card'
      const root = window.getComputedStyle(document.documentElement).getPropertyValue(probe).trim()
      const body = window.getComputedStyle(document.body).getPropertyValue(probe).trim()
      return Boolean(root || body)
    },
    css: `
.dsh-starlong-root[data-starlong-theme~='claude']{
  --sl-accent:var(--dsw-alias-brand-primary);
  --sl-on-accent:var(--dsw-alias-brand-text,#ffffff);
  --sl-hover-bg:var(--dsw-alias-brand-primary);
  --sl-badge-bg:var(--dsw-alias-brand-primary);
  --sl-badge-fg:var(--dsw-alias-brand-text,#ffffff);
}`,
  },
]
const THEME_CSS = THEME_ADAPTERS.map(adapter => adapter.css).join('\n')

/**
 * GitHub 入口的悬停动效：底色渐显、图标变亮、
 * 「GitHub」文字从宽度 0 展开。内联样式写不了 :hover，只能注入样式表。
 */
const REPO_CSS = `
.dsh-starlong-root{
  --sl-accent:var(--dsw-alias-border-selected,#adb2b8);
  --sl-on-accent:var(--dsw-alias-label-primary,inherit);
  --sl-hover-bg:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.16));
  --sl-badge-bg:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.16));
  --sl-badge-fg:var(--dsw-alias-label-secondary,inherit);
}
.dsh-starlong-repo{flex:none;display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 4px;border-radius:6px;text-decoration:none;transition:background-color .15s ease}
.dsh-starlong-repo svg{fill:var(--dsw-alias-label-secondary);transition:fill .15s ease}
.dsh-starlong-repo-label{max-width:0;margin-left:0;overflow:hidden;opacity:0;white-space:nowrap;font-size:13px;font-weight:500;color:var(--sl-on-accent);transition:max-width .15s ease,margin-left .15s ease,opacity .15s ease}
.dsh-starlong-repo:hover,.dsh-starlong-repo:focus-visible{background-color:var(--sl-hover-bg)}
.dsh-starlong-repo:hover svg,.dsh-starlong-repo:focus-visible svg{fill:var(--sl-on-accent)}
.dsh-starlong-repo:hover .dsh-starlong-repo-label,.dsh-starlong-repo:focus-visible .dsh-starlong-repo-label{max-width:6em;margin-left:6px;opacity:1}
.dsh-starlong-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:5px;padding:6px 12px;font:inherit;font-size:13px;font-weight:500;line-height:1.35;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .1s ease}
.dsh-starlong-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-starlong-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:1px}
.dsh-starlong-btn-cancel{background:transparent;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-starlong-btn-cancel:hover:not(:disabled){background:rgba(128,128,128,.12);border-color:rgba(128,128,128,.55)}
.dsh-starlong-btn-danger{background:transparent;border-color:rgba(217,72,65,.55);color:#e06c66}
.dsh-starlong-btn-danger:hover:not(:disabled){background:rgba(217,72,65,.14);border-color:rgba(217,72,65,.85)}
.dsh-starlong-btn-danger:active:not(:disabled){transform:translateY(1px)}
.dsh-starlong-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.dsh-starlong-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-radius:999px;padding:5px 14px;font:inherit;font-size:13px;font-weight:500;line-height:1.4;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.dsh-starlong-tab:hover:not(.is-active){border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.35))}
.dsh-starlong-tab.is-active{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-color:var(--sl-accent);color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.dsh-starlong-tab:focus-visible{outline:2px solid var(--dsw-alias-border-l3,rgba(128,128,128,.65));outline-offset:2px}
.dsh-starlong-root .dsh-starlong-version-badge{margin-left:6px;padding:0 5px;border-radius:999px;background:var(--sl-badge-bg);color:var(--sl-badge-fg);font-size:10px;line-height:14px;font-weight:600}
`

const MESSAGES = {
  zh: {
    title: '磁盘清理',
    sessionTitle: '会话管理',
    sessionOn: '自动归档你一段时间未使用的会话。已置顶的会话永远不会被归档，也不会删除任何内容。',
    sessionOff: '关闭后不再自动归档闲置会话。',
    autoArchive: '自动归档闲置会话',
    idleDays: '自动归档闲置满',
    idleDaysSuffix: '天的会话',
    autoDelete: '自动删除闲置会话',
    deleteOn: '永久删除长期未使用的会话，删除后无法恢复。',
    deleteOff: '关闭后不再自动删除会话。',
    deleteDays: '自动删除闲置满',
    deleteDaysSuffix: '天的会话',
    description: '把临时文件移出工作区，并按保留天数自动清理过期的暂存文件。',
    auto: '自动清理',
    on: '开启后按保留天数清理临时文件与图片缓存，回收无主原件，并清掉残留空目录。',
    off: '关闭后不再自动清理。',
    maxAge: '保留天数',
    maxAgeHint: '临时文件和图片缓存，超过这个天数没改动就清掉；原始图片只有确认没有引用时才会删。',
    invalid: '请填一个正整数，或留空使用默认值。',
    overridden: '已覆盖',
    reset: '恢复默认',
    save: '保存',
    saving: '保存中…',
    saveFailed: '宿主没有接受这些值，已保留以便重试。',
    readonly: '当前配置为只读，无法修改。',
    unavailable: '该插件当前未加载，暂时无法配置。',
    page: 'Starlong',
    repo: '在 GitHub 上打开本插件',
    repoLabel: 'GitHub',
    deleteSession: '删除会话',
    deleteConfirmTitle: '永久删除会话',
    deleteConfirmBody: '该会话及其子会话将被永久删除，且无法恢复。',
    deleteCancel: '取消',
    deleteConfirm: '确认删除',
    deleteDeleting: '删除中…',
    deleteError: '删除失败',
    backupTitle: '备份同步',
    backupOn: '默认排除可再生文件，其余全部打包；勾选决定纳入项，包内 _manifest.json 记录排除清单。',
    backupSelected: '本次导出',
    backupPhysical: '总占用',
    backupRepo: '目标仓库',
    backupInterval: '同步间隔',
    backupIntervalSuffix: '小时',
    backupRegex: '额外排除正则（gitignore 风格，逗号/换行分隔）',
    backupRegexApply: '应用规则',
    backupRegexPending: '有未应用的修改',
    backupRefresh: '刷新目录',
    backupRefreshing: '扫描中…',
    backupPresetName: '预设名称',
    backupSavePreset: '保存勾选为预设',
    backupAdjusted: '手动调整',
    backupInclude: '纳入',
    backupExclude: '排除',
    backupRevert: '撤销',
    backupDefaultPreset: '默认预设',
    backupDeletePreset: '删除预设',
    backupExport: '导出 .zip',
    backupExporting: '导出中…',
    backupDownload: '下载',
    backupResult: '已打包',
    backupFiles: '个文件',
    backupExcludedCount: '项排除',
    backupError: '导出失败',
  },
}

/** 布尔字段：开关写文本，parse 变成真正的布尔值。 */
function booleanField(field) {
  return {
    field,
    format: value => String(value !== false),
    parse: text => ({ kind: 'set', value: text === 'true' }),
  }
}

function formLabels(t) {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readonly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/**
 * 把套件条目的表单作用域收敛到某个模块段。
 * SettingsFormModel 只认扁平字段；mutate 的 path 前面补上段路径即可写回嵌套配置。
 */
function sectionScope(scope, section) {
  // 设置服务的 value/mutate 根就是插件 config 本体，路径直接从段名开始。
  const prefix = [section]
  const pick = value => value === undefined ? undefined : value?.[section]
  return {
    subscribe: cb => scope.subscribe(cb),
    getSnapshot: () => {
      const snap = scope.getSnapshot()
      return { ...snap, value: pick(snap.value), base: pick(snap.base), user: pick(snap.user) }
    },
    mutate: (ops, revision) => scope.mutate(
      ops.map(op => ({ ...op, path: [...prefix, ...op.path] })),
      revision,
    ),
  }
}

/** @param {object} props - 槽位注入的属性。 */
function CleanupCard(props) {
  const { t, useCleanupCard } = props
  const state = useCleanupCard(snapshot => snapshot)
  if (props.view === 'summary') return null
  const disabled = !state.writable || state.saving
  const moduleOn = state.moduleEnabled.text === 'true'
  const enabled = state.enabled.text === 'true'
  const head = jsxs('div', {
    children: [
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('span', { style: { display: 'flex', alignItems: 'center' }, children: [jsx('span', { style: STYLE.cardTitle, children: t('title') }, 'text'), jsx('span', { className: 'dsh-starlong-version-badge', style: { display: 'inline-block', marginTop: '4px' }, children: 'v' + DISK_CLEANUP_VERSION }, 'version')] }, 'heading'),
          jsx(Switch, {
            checked: moduleOn,
            label: t('title'),
            disabled: !state.writable,
            onChange: props.toggleModule,
          }),
        ],
      }, 'row'),
      jsx('p', { style: STYLE.cardDesc, children: t('description') }, 'desc'),
    ],
  }, 'module')
  if (!moduleOn) {
    return jsxs('div', {
      style: STYLE.card,
      children: [
        head,
        state.moduleFailed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
      ],
    })
  }
  return jsx('div', {
    style: STYLE.card,
    children: jsxs(SettingsForm, {
      labels: formLabels(t),
      state,
      onSave: props.save,
      onDiscard: props.discard,
      children: [
        head,
        jsx('div', { style: STYLE.divider }, 'divider'),
        jsx('p', { style: STYLE.hint, children: state.moduleFailed ? t('saveFailed') : t(enabled ? 'on' : 'off') }, 'hint'),
        jsxs('div', {
          style: STYLE.row,
          children: [
            jsx('span', { children: t('auto') }),
            jsx(Switch, {
              checked: enabled,
              label: t('auto'),
              disabled,
              onChange: next => { props.edit('autoCleanup', String(next)) },
            }),
          ],
        }, 'toggle'),
        jsx(SettingsValueField, {
          id: 'plugin-config-starlong-disk-cleanup-maxage',
          label: t('maxAge'),
          hint: t('maxAgeHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalid'),
          numeric: true,
          placeholder: DEFAULT_MAX_AGE_DAYS,
          disabled,
          ...state.maxAgeDays,
          onEdit: text => { props.edit('cleanupMaxAgeDays', text) },
          onReset: () => { props.resetField('cleanupMaxAgeDays') },
        }, 'maxage'),
      ],
    }),
  })
}

class CleanupCardController {
  constructor(scope) {
    this.scope = scope
    // 模块开关的乐观值：直写期间先按目标值渲染，宿主镜像确认后清除。
    this.modulePending = null
    this.moduleFailed = false
    this.form = new SettingsFormModel(scope, [
      booleanField('enabled'),
      booleanField('autoCleanup'),
      settingsNumberField('cleanupMaxAgeDays'),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      moduleEnabled: this.modulePending === null
        ? this.form.field('enabled')
        : { text: String(this.modulePending), overridden: true, invalid: false },
      moduleFailed: this.moduleFailed,
      enabled: this.form.field('autoCleanup'),
      maxAgeDays: this.form.field('cleanupMaxAgeDays'),
    }))
    this.unsubscribe = scope.subscribe(() => {
      if (this.modulePending !== null && scope.getSnapshot().value?.enabled === this.modulePending) {
        this.modulePending = null
        this.form.publish()
      }
    })
  }
  // 模块开关绕过表单暂存/保存直写配置：不产生 dirty/saving，关闭时子设置立即收起。
  toggleModule(next) {
    this.modulePending = next
    this.moduleFailed = false
    this.form.publish()
    const fail = () => {
      this.modulePending = null
      this.moduleFailed = true
      this.form.publish()
    }
    this.scope.mutate([{ op: 'set', path: ['enabled'], value: next }])
      .then(ok => { if (!ok) fail() })
      .catch(fail)
  }
  inject() {
    return { hooks: { cleanupCard: this.store }, toggleModule: next => this.toggleModule(next), ...this.form.actions() }
  }
  dispose() {
    this.unsubscribe()
    this.form.dispose()
  }
}

/**
 * 直写配置卡片控制器：字段按声明的类型读默认值，乐观写入并带 revision 提交。
 * 快照按值缓存，避免 useSyncExternalStore 因新对象无限重渲染。
 */
class DirectCardController {
  constructor(scope, fields) {
    this.scope = scope
    this.fields = fields
    this.pending = new Map()
    this.failed = new Map()
    this.listeners = new Set()
    this.cached = undefined
    // 宿主镜像追上乐观值后清掉；任何配置变化都把新状态推给卡片。
    this.unsubscribe = scope.subscribe(() => {
      const value = scope.getSnapshot().value || {}
      for (const [field, next] of this.pending) {
        if (value[field] === next) this.pending.delete(field)
      }
      this.emit()
    })
  }
  emit() {
    for (const cb of this.listeners) cb()
  }
  snapshot() {
    const snap = this.scope.getSnapshot()
    const value = snap.value || {}
    const writable = snap.writable !== false
    const failed = this.failed.size > 0
    const state = { writable, failed }
    let changed = this.cached === undefined
      || this.cached.writable !== writable
      || this.cached.failed !== failed
    for (const [field, spec] of Object.entries(this.fields)) {
      const raw = this.pending.has(field) ? this.pending.get(field) : value[field]
      let current
      if (spec.type === 'boolean') {
        current = raw === undefined ? spec.default : raw !== false
      } else if (spec.type === 'string') {
        current = raw === undefined ? spec.default : String(raw)
      } else {
        const parsed = Number(raw ?? spec.default)
        current = Number.isFinite(parsed) ? parsed : spec.default
      }
      if (this.cached === undefined || this.cached[field] !== current) changed = true
      state[field] = current
    }
    if (changed) this.cached = state
    return this.cached
  }
  commit(field, next) {
    this.pending.set(field, next)
    this.failed.delete(field)
    this.emit()
    const fail = () => {
      this.pending.delete(field)
      this.failed.set(field, true)
      this.emit()
    }
    // 直写必须带上当前 revision，否则宿主按过期写入拒绝，乐观值会回滚成默认值。
    const revision = this.scope.getSnapshot().revision
    this.scope.mutate([{ op: 'set', path: [field], value: next }], revision)
      .then(ok => { if (!ok) fail() })
      .catch(fail)
  }
  inject(hookName, actions) {
    return {
      hooks: {
        [hookName]: {
          subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
          getSnapshot: () => this.snapshot(),
        },
      },
      ...actions,
    }
  }
  dispose() {
    this.unsubscribe()
    this.listeners.clear()
  }
}

/** 会话管理卡片：模块开关 + 自动归档开关 + 行尾天数输入，无保存按钮。 */
/**
 * 天数输入行：标签 + 数字框 + 后缀，整组右对齐。
 * 归档天数与删除天数共用，钳制范围由 max 决定，回车与失焦都提交。
 */
function DaysInput({ label, suffix, value, max, disabled, onCommit }) {
  return jsxs('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' },
    children: [
      jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: label }, 'label'),
      jsx('input', {
        type: 'number',
        min: 1,
        max,
        step: 1,
        defaultValue: String(value),
        disabled,
        'aria-label': label,
        style: {
          width: '56px',
          padding: '4px 8px',
          textAlign: 'center',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
          borderRadius: '6px',
          background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
          color: 'inherit',
          fontWeight: 400,
          fontSize: '14px',
        },
        onBlur: event => {
          const parsed = Number.parseInt(event.target.value, 10)
          if (!Number.isFinite(parsed)) {
            event.target.value = String(value)
            return
          }
          const days = Math.min(max, Math.max(1, parsed))
          event.target.value = String(days)
          if (days !== value) onCommit(days)
        },
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
      }, String(value)),
      jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: suffix }, 'suffix'),
    ],
  }, 'days')
}

function SessionCard(props) {
  const { t, useSessionCard } = props
  const state = useSessionCard(snapshot => snapshot)
  if (props.view === 'summary') return null
  const head = jsxs('div', {
    children: [
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsx('span', { style: STYLE.cardTitle, children: t('sessionTitle') }),
          jsx(Switch, {
            checked: state.enabled,
            label: t('sessionTitle'),
            disabled: !state.writable,
            onChange: props.toggleSession,
          }),
        ],
      }, 'row'),
    ],
  }, 'module')
  if (!state.enabled) {
    return jsxs('div', {
      style: STYLE.card,
      children: [
        head,
        state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
      ],
    })
  }
  return jsxs('div', {
    style: STYLE.card,
    children: [
      head,
      jsx('div', { style: STYLE.divider }, 'divider'),
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('div', {
            style: { minWidth: 0 },
            children: [
              jsx('div', { style: STYLE.label, children: t('autoArchive') }, 'label'),
              jsx('p', {
                style: STYLE.cardDesc,
                children: t(state.autoArchive ? 'sessionOn' : 'sessionOff'),
              }, 'hint'),
            ],
          }, 'text'),
          jsx(Switch, {
            checked: state.autoArchive,
            label: t('autoArchive'),
            disabled: !state.writable,
            onChange: props.toggleSessionAuto,
          }, 'switch'),
        ],
      }, 'toggle'),
      jsx(DaysInput, {
        label: t('idleDays'),
        suffix: t('idleDaysSuffix'),
        value: state.idleDays,
        max: 365,
        disabled: !state.writable,
        onCommit: props.setSessionIdleDays,
      }, 'idle'),
      jsx('div', { style: STYLE.divider }, 'divider-delete'),
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('div', {
            style: { minWidth: 0 },
            children: [
              jsx('div', { style: STYLE.label, children: t('autoDelete') }, 'label'),
              jsx('p', {
                style: STYLE.cardDesc,
                children: t(state.autoDelete ? 'deleteOn' : 'deleteOff'),
              }, 'hint'),
            ],
          }, 'text'),
          jsx(Switch, {
            checked: state.autoDelete,
            label: t('autoDelete'),
            disabled: !state.writable,
            onChange: props.toggleSessionDelete,
          }, 'switch'),
        ],
      }, 'toggle-delete'),
      jsx(DaysInput, {
        label: t('deleteDays'),
        suffix: t('deleteDaysSuffix'),
        value: state.deleteDays,
        max: 999,
        disabled: !state.writable,
        onCommit: props.setSessionDeleteDays,
      }, 'delete'),
    ],
  })
}

/** 文本输入行：标签 + 文本框，失焦或回车提交。 */
function TextInput({ label, value, disabled, onCommit }) {
  return jsxs('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '16px' },
    children: [
      jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: label }, 'label'),
      jsx('input', {
        type: 'text',
        key: value,
        defaultValue: value,
        disabled,
        'aria-label': label,
        style: {
          width: '220px', padding: '4px 8px',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
          borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
          color: 'inherit', fontWeight: 400, fontSize: '14px',
        },
        onBlur: event => {
          const next = event.target.value.trim()
          if (next && next !== value) onCommit(next)
          else event.target.value = value
        },
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
      }, 'input'),
    ],
  }, 'text')
}

/** 多行词表输入：失焦或回车外的点击提交，改动即写配置。 */
function TextAreaInput({ label, value, disabled, onCommit }) {
  return jsxs('div', {
    style: { marginTop: '12px' },
    children: [
      jsx('div', { style: { ...STYLE.label, fontSize: '13px', marginBottom: '4px' }, children: label }, 'label'),
      jsx('textarea', {
        key: value,
        defaultValue: value,
        disabled,
        rows: 2,
        'aria-label': label,
        style: {
          width: '100%', boxSizing: 'border-box', padding: '6px 8px',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
          borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
          color: 'inherit', font: 'inherit', fontSize: '12px', resize: 'vertical',
        },
        onBlur: event => {
          const next = event.target.value.trim()
          if (next !== value) onCommit(next)
          else event.target.value = value
        },
      }, 'input'),
    ],
  })
}

/** 体积显示：保留一位小数，避免长数字撑破布局。 */
function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return value.toFixed(1) + ' ' + units[i]
}

/** 把内部规则名翻成人话；完整规则放 title 供排查。 */
function reasonLabel(reason) {
  const s = String(reason || '')
  const i = s.indexOf(':')
  const key = i < 0 ? s : s.slice(0, i)
  return {
    override: '手动排除', regex: '自定义规则', clientDir: '客户端运行目录',
    dependency: '依赖目录', pathSegment: '可再生目录',
    extension: '可再生文件', namePattern: '临时或锁文件',
  }[key] || '已排除'
}

/** 备份同步卡片：开关 + 目录树勾选 + 正则 + 命名预设 + 本地导出。 */
function BackupCard(props) {
  const { t, useBackupCard } = props
  const state = useBackupCard(snapshot => snapshot)
  const [treeData, setTreeData] = useState({})
  const [expanded, setExpanded] = useState({})
  const [overrides, setOverrides] = useState({})
  const [regex, setRegex] = useState('')
  const [regexDraft, setRegexDraft] = useState('')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [presetDraft, setPresetDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (!state.enabled) return undefined
    let cancelled = false
    const boot = async () => {
      setLoading(true)
      try {
        const res = await fetch(resolveApiUrl(BACKUP_TREE_ROUTE), {
          method: 'POST',
          headers: { 'content-type': 'application/json', [BACKUP_TOKEN_HEADER]: '1' },
          body: JSON.stringify({ path: '', overrides: {}, regex: '' }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
        if (cancelled) return
        setTreeData({ '': data.nodes || [] })
        setSummary(data.stats || null)
        setPresets(data.presets || [])
      } catch (e) { if (!cancelled) setError(e?.message || '') }
      finally { if (!cancelled) setLoading(false) }
    }
    void boot()
    return () => { cancelled = true }
  }, [state.enabled])

  if (props.view === 'summary') return null
  const head = jsxs('div', {
    children: [
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsx('span', { style: STYLE.cardTitle, children: t('backupTitle') }),
          jsx(Switch, {
            checked: state.enabled,
            label: t('backupTitle'),
            disabled: !state.writable,
            onChange: props.toggleBackup,
          }),
        ],
      }, 'row'),
    ],
  }, 'module')
  if (!state.enabled) {
    return jsxs('div', {
      style: STYLE.card,
      children: [head, state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null],
    })
  }

  const request = async (route, body) => {
    const res = await fetch(resolveApiUrl(route), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [BACKUP_TOKEN_HEADER]: '1' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
    return data
  }
  const loadChildren = async (path, ov, rg) => {
    const data = await request(BACKUP_TREE_ROUTE, { path, overrides: ov, regex: rg })
    setTreeData(prev => ({ ...prev, [path]: data.nodes || [] }))
    setPresets(data.presets || [])
  }
  const reloadAll = async (ov, rg) => {
    setLoading(true)
    setError(null)
    try {
      const data = await request(BACKUP_TREE_ROUTE, { path: '', overrides: ov, regex: rg })
      const next = { '': data.nodes || [] }
      for (const path of Object.keys(expanded)) {
        if (path !== '') {
          const sub = await request(BACKUP_TREE_ROUTE, { path, overrides: ov, regex: rg })
          next[path] = sub.nodes || []
        }
      }
      setTreeData(next)
      setSummary(data.stats || null)
      setPresets(data.presets || [])
    } catch (e) { setError(e?.message || '') }
    finally { setLoading(false) }
  }
  const toggleNode = async node => {
    const next = { ...overrides }
    const prefix = node.rel + '/'
    if (!node.included) {
      // 纳入时清掉子树内更精确的排除覆盖，否则半勾父节点勾选后仍是半勾
      next[node.rel] = true
      for (const key of Object.keys(next)) {
        if (key !== node.rel && key.startsWith(prefix) && next[key] === false) delete next[key]
      }
    } else {
      next[node.rel] = false
    }
    setOverrides(next)
    await reloadAll(next, regex)
  }
  const toggleExpand = async node => {
    if (node.kind !== 'directory') return
    const was = !!expanded[node.rel]
    setExpanded(prev => ({ ...prev, [node.rel]: !was }))
    if (was || treeData[node.rel]) return
    try { await loadChildren(node.rel, overrides, regex) } catch (e) { setError(e?.message || '') }
  }
  const applyRegex = () => {
    if (regexDraft === regex) return
    setRegex(regexDraft)
    void reloadAll(overrides, regexDraft)
  }
  const savePreset = async () => {
    const name = presetDraft.trim()
    if (!name) return
    try {
      const data = await request(BACKUP_PRESET_ROUTE, { action: 'save', name, overrides, regex: regexDraft })
      setPresets(data.presets || [])
      setPresetName(name)
    } catch (e) { setError(e?.message || '') }
  }
  const loadPreset = async name => {
    const target = name ?? presetName
    if (!target) {
      setOverrides({}); setRegex(''); setRegexDraft(''); setExpanded({})
      await reloadAll({}, '')
      return
    }
    try {
      const data = await request(BACKUP_PRESET_ROUTE, { action: 'load', name: target })
      const ov = data.overrides || {}
      const rg = data.regex || ''
      setOverrides(ov); setRegex(rg); setRegexDraft(rg); setExpanded({})
      await reloadAll(ov, rg)
    } catch (e) { setError(e?.message || '') }
  }
  const removeOverride = async key => {
    const next = { ...overrides }
    delete next[key]
    setOverrides(next)
    await reloadAll(next, regex)
  }
  const deletePreset = async () => {
    if (!presetName) return
    try {
      const data = await request(BACKUP_PRESET_ROUTE, { action: 'delete', name: presetName })
      setPresets(data.presets || [])
      setPresetName('')
    } catch (e) { setError(e?.message || '') }
  }
  const runExport = async () => {
    if (exporting) return
    setExporting(true)
    setError(null)
    setResult(null)
    try {
      const data = await request(BACKUP_EXPORT_ROUTE, { overrides, regex })
      setResult(data)
    } catch (e) { setError(e?.message || '') }
    finally { setExporting(false) }
  }
  const renderNode = (node, depth) => jsxs('div', {
    key: node.rel,
    style: { paddingLeft: depth * 14, display: 'flex', alignItems: 'center', gap: '6px', minHeight: '26px', fontSize: '13px' },
    children: [
      node.kind === 'directory' ? jsx('button', {
        type: 'button', className: 'dsh-starlong-btn',
        style: { padding: '0 6px', minWidth: '22px' },
        onClick: () => toggleExpand(node),
        children: expanded[node.rel] ? '−' : '+',
      }, 'toggle') : jsx('span', { style: { width: '22px', display: 'inline-block' } }, 'spacer'),
      jsx('input', {
        type: 'checkbox', checked: node.included,
        ref: el => { if (el) el.indeterminate = !!node.partial },
        onChange: () => toggleNode(node),
        'aria-label': node.rel,
        title: node.partial ? '部分子项未纳入（复合态）' : undefined,
      }, 'check'),
      jsx('span', {
        style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: node.included ? 1 : 0.55 },
        title: node.reason && !node.included ? node.rel + '\n' + reasonLabel(node.reason) : node.rel,
        children: node.name,
      }, 'name'),
      jsx('span', { style: { width: '76px', flexShrink: 0, textAlign: 'right', opacity: 0.6, fontSize: '12px' }, children: formatBytes(node.size) }, 'size'),
    ],
  })
  const renderTree = (nodes, depth) => (nodes || []).map(node => jsxs('div', {
    key: node.rel,
    children: [
      renderNode(node, depth),
      node.kind === 'directory' && expanded[node.rel] ? renderTree(treeData[node.rel], depth + 1) : null,
    ],
  }, 'branch'))
  return jsxs('div', {
    style: STYLE.card,
    children: [
      head,
      jsx('div', { style: STYLE.divider }, 'divider'),
      jsx('p', { style: STYLE.cardDesc, children: t('backupOn') }, 'hint'),
      jsx(TextInput, { label: t('backupRepo'), value: state.repo, disabled: !state.writable, onCommit: props.setBackupRepo }, 'repo'),
      jsx(DaysInput, { label: t('backupInterval'), suffix: t('backupIntervalSuffix'), value: state.intervalHours, max: 168, disabled: !state.writable, onCommit: props.setBackupInterval }, 'interval'),
      jsx('div', { style: STYLE.divider }, 'divider-tree'),
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsx('span', { style: STYLE.label, children: t('backupTitle') + ' · ~/.dsh' }, 'tree-label'),
          summary ? jsx('span', {
            style: { opacity: 0.7, fontSize: '12px', marginLeft: '10px' },
            children: t('backupSelected') + ' ' + formatBytes(summary.includeBytes) + ' · ' + t('backupPhysical') + ' ' + formatBytes(summary.includeBytes + summary.excludeBytes),
          }, 'summary') : null,
          jsx('button', {
            type: 'button', className: 'dsh-starlong-btn', disabled: loading,
            onClick: () => reloadAll(overrides, regex),
            children: loading ? t('backupRefreshing') : t('backupRefresh'),
          }, 'refresh'),
        ],
      }, 'tree-head'),
      jsx('div', {
        style: {
          marginTop: '8px', maxHeight: '320px', overflowY: 'auto',
          border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
          borderRadius: '6px', padding: '6px',
        },
        children: renderTree(treeData[''], 0),
      }, 'tree'),
      jsxs('div', {
        style: { marginTop: '10px' },
        children: [
          jsx('div', {
            style: { ...STYLE.row, gap: '8px', alignItems: 'center' },
            children: t('backupAdjusted') + ' ' + Object.keys(overrides).length,
          }, 'adjusted-head'),
          ...Object.entries(overrides).map(([rel, inc]) => jsxs('div', {
            key: rel,
            style: { ...STYLE.row, gap: '8px', alignItems: 'center', marginTop: '4px', fontSize: '12px' },
            children: [
              jsx('span', {
                title: rel,
                style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                children: rel,
              }, 'adjusted-rel-' + rel),
              jsx('span', {
                style: { color: inc ? '#10b981' : '#ef4444' },
                children: inc ? t('backupInclude') : t('backupExclude'),
              }, 'adjusted-state-' + rel),
              jsx('button', {
                type: 'button', className: 'dsh-starlong-btn',
                disabled: loading,
                onClick: () => removeOverride(rel),
                children: t('backupRevert'),
              }, 'adjusted-revert-' + rel),
            ],
          }, 'adjusted-' + rel)),
        ],
      }, 'adjusted-section'),
      jsxs('div', {
        style: { marginTop: '10px' },
        children: [
          jsxs('div', {
            style: { ...STYLE.row, gap: '8px', alignItems: 'center' },
            children: [
              jsx('span', { style: STYLE.label, children: t('backupRegex') }, 'regex-label'),
              regexDraft !== regex ? jsx('span', {
                style: { fontSize: '12px', color: '#f59e0b' },
                children: t('backupRegexPending'),
              }, 'regex-pending') : null,
            ],
          }, 'regex-head'),
          jsxs('div', {
            style: { display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '6px' },
            children: [
              jsx('textarea', {
                value: regexDraft, rows: 2,
                'aria-label': t('backupRegex'), placeholder: t('backupRegex'),
                style: {
                  flex: 1, boxSizing: 'border-box', padding: '6px 8px',
                  border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
                  borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
                  color: 'inherit', font: 'inherit', fontSize: '12px', resize: 'vertical',
                },
                onChange: e => setRegexDraft(e.target.value),
              }, 'regex'),
              jsx('button', {
                type: 'button', className: 'dsh-starlong-btn',
                disabled: loading || regexDraft === regex,
                onClick: applyRegex,
                children: t('backupRegexApply'),
              }, 'regex-apply'),
            ],
          }, 'regex-row'),
        ],
      }, 'regex-section'),
      jsxs('div', {
        style: { ...STYLE.row, marginTop: '10px', gap: '8px', flexWrap: 'wrap' },
        children: [
          jsx('select', {
            value: presetName, onChange: e => { setPresetName(e.target.value); void loadPreset(e.target.value) },
            style: {
              padding: '4px 8px', border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
              color: 'inherit', fontSize: '13px',
            },
            children: [jsx('option', { value: '', children: t('backupDefaultPreset') }, 'default')].concat(
              presets.map(n => jsx('option', { value: n, children: n }, n))
            ),
          }, 'preset-select'),
          jsx('input', {
            type: 'text', value: presetDraft, onChange: e => setPresetDraft(e.target.value),
            placeholder: t('backupPresetName'),
            style: {
              width: '120px', padding: '4px 8px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
              color: 'inherit', fontSize: '13px',
            },
          }, 'preset-draft'),
          jsx('button', { type: 'button', className: 'dsh-starlong-btn', onClick: savePreset, children: t('backupSavePreset') }, 'preset-save'),
          presetName ? jsx('button', { type: 'button', className: 'dsh-starlong-btn dsh-starlong-btn-danger', onClick: deletePreset, children: t('backupDeletePreset') }, 'preset-delete') : null,
        ],
      }, 'preset-row'),
      jsx('div', { style: STYLE.divider }, 'divider-export'),
      jsxs('div', {
        style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
        children: [
          jsx('button', {
            type: 'button', className: 'dsh-starlong-btn',
            disabled: exporting || !state.writable,
            onClick: runExport,
            children: exporting ? t('backupExporting') : t('backupExport'),
          }, 'export'),
          result ? jsx('a', {
            className: 'dsh-starlong-btn',
            href: resolveApiUrl(BACKUP_DOWNLOAD_ROUTE + '?name=' + encodeURIComponent(result.name)),
            download: result.name,
            children: t('backupDownload'),
          }, 'download') : null,
        ],
      }, 'actions'),
      result ? jsx('p', {
        style: STYLE.hint,
        children: t('backupResult') + '：' + result.name + ' · ' + result.includeFiles + t('backupFiles') + ' · ' + result.excludeItems + t('backupExcludedCount'),
      }, 'result') : null,
      error ? jsx('p', { role: 'alert', style: { ...STYLE.hint, color: '#f87171' }, children: t('backupError') + '：' + error }, 'error') : null,
    ],
  })
}

/** GitHub 标记图标（16px 官方轮廓）。 */
function GitHubIcon({ size = 16 }) {
  return jsx('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true',
    children: jsx('path', {
      d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z',
    }),
  })
}

/** 只输出命中的主题标记，配色交给 CSS 适配器，组件不感知具体主题。 */
function useThemeIds() {
  const [ids, setIds] = useState('')
  useEffect(() => {
    const detect = () => {
      const next = THEME_ADAPTERS.filter(adapter => adapter.detect()).map(adapter => adapter.id).join(' ')
      setIds(prev => (prev === next ? prev : next))
    }
    detect()
    const observer = new MutationObserver(detect)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])
  return ids
}

/** 设置页：左标题右 GitHub，名称下方胶囊切换模块卡片。 */
function SettingsPage(props) {
  // 摘要视图只留页头，胶囊与卡片都不渲染，保持宿主概览里的原行为。
  const summary = props.view === 'summary'
  const [tab, setTab] = useState('cleanup')
  const themeIds = useThemeIds()
  const tabs = [
    { id: 'cleanup', label: props.t('title') },
    { id: 'session', label: props.t('sessionTitle') },
    { id: 'backup', label: props.t('backupTitle') },
  ]
  return jsxs('div', {
    className: 'dsh-starlong-root',
    'data-starlong-theme': themeIds || undefined,
    children: [
      jsxs('div', {
        style: STYLE.pageHead,
        children: [
          jsx('span', { style: STYLE.pageTitle, children: props.t('page') }),
          jsx('a', {
            href: REPO_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: props.t('repo'),
            'aria-label': props.t('repo'),
            className: 'dsh-starlong-repo',
            children: jsxs('span', {
              style: { display: 'inline-flex', alignItems: 'center' },
              children: [
                jsx(GitHubIcon, {}, 'icon'),
                jsx('span', { className: 'dsh-starlong-repo-label', children: props.t('repoLabel') }, 'label'),
              ],
            }),
          }),
        ],
      }, 'head'),
      summary ? null : jsx('div', {
        className: 'dsh-starlong-tabs',
        role: 'tablist',
        children: tabs.map(item => jsx('button', {
          type: 'button',
          role: 'tab',
          key: item.id,
          'aria-selected': tab === item.id,
          className: 'dsh-starlong-tab' + (tab === item.id ? ' is-active' : ''),
          onClick: () => setTab(item.id),
          children: item.label,
        }, item.id)),
      }, 'tabs'),
      tab === 'cleanup' ? jsx(CleanupCard, props, 'cleanup') : null,
      tab === 'session' ? jsx(SessionCard, props, 'session') : null,
      tab === 'backup' ? jsx(BackupCard, props, 'backup') : null,
    ],
  })
}

/** 设置导航图标：双星芒。 */
function SettingsIcon({ size = 16 }) {
  return jsxs('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
    children: [
      jsx('path', { d: 'M6.5 1.5c0 3 1 4 4 5-3 1-4 2-4 5 0-3-1-4-4-5 3-1 4-2 4-5Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }, 'main'),
      jsx('path', { d: 'M12 9c0 1.6.5 2.1 2.1 2.9-1.6.8-2.1 1.3-2.1 2.9 0-1.6-.5-2.1-2.1-2.9C11.5 11.1 12 10.6 12 9Z', stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round' }, 'spark'),
    ],
  })
}

/**
 * 删除请求状态：右键菜单只发布目标，确认弹层订阅；模块级单例供两处共用。
 */
let deleteTarget = null
const deleteListeners = new Set()
function publishDeleteTarget(next) {
  deleteTarget = next
  for (const listener of deleteListeners) listener()
}
function useDeleteRequest() {
  return useSyncExternalStore(
    cb => { deleteListeners.add(cb); return () => deleteListeners.delete(cb) },
    () => deleteTarget,
    () => deleteTarget,
  )
}

/** 把根绝对路径端点挂到页面 base 下，兼容带路径前缀的反向代理。 */
function resolveApiUrl(path) {
  if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return path
  const doc = typeof document === 'undefined' ? undefined : document
  const base = doc?.baseURI
  if (typeof base !== 'string' || base === '') return path
  try {
    const url = new URL(base)
    const lastSlash = url.pathname.lastIndexOf('/')
    const last = url.pathname.slice(lastSlash + 1)
    if (/\.(html?|php|aspx?|jsp)$/i.test(last)) url.pathname = url.pathname.slice(0, lastSlash + 1)
    else if (!url.pathname.endsWith('/')) url.pathname += '/'
    return new URL(path.slice(1), url.href).href
  } catch { return path }
}

/** 永久删除确认卡：贴在目标会话行旁，确认后请求本机删除路由。 */
function DeleteSessionOverlay({ t }) {
  const request = useDeleteRequest()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [pos, setPos] = useState(null)
  const cardRef = useRef(null)

  useLayoutEffect(() => {
    if (request == null || typeof document === 'undefined') { setPos(null); return }
    let row = null
    const update = () => {
      const card = cardRef.current
      const w = card?.offsetWidth || 300
      const h = card?.offsetHeight || 180
      if (row === null || !row.isConnected) {
        try { row = document.querySelector('[data-row-key="session:' + (globalThis.CSS?.escape ? CSS.escape(request.sessionId) : request.sessionId) + '"]') } catch { row = null }
      }
      let top, left
      if (row) {
        const rect = row.getBoundingClientRect()
        top = Math.min(Math.max(16, rect.top - 4), Math.max(16, window.innerHeight - 16 - h))
        left = rect.right + 8 + w > window.innerWidth - 16 ? Math.max(16, rect.left - w - 8) : rect.right + 8
      } else {
        top = Math.max(16, (window.innerHeight - h) / 2)
        left = Math.max(16, (window.innerWidth - w) / 2)
      }
      setPos(prev => prev !== null && prev.top === top && prev.left === left ? prev : { top, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [request])

  // 点击弹框外部关闭；延后一帧挂载，避免打开菜单的那次 pointerdown 立刻关掉弹框。
  useEffect(() => {
    if (request == null || typeof document === 'undefined') return undefined
    let remove = () => {}
    const frame = requestAnimationFrame(() => {
      const onPointerDown = (event) => {
        if (deleting || cardRef.current?.contains(event.target)) return
        publishDeleteTarget(null)
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      remove = () => document.removeEventListener('pointerdown', onPointerDown, true)
    })
    return () => { cancelAnimationFrame(frame); remove() }
  }, [request, deleting])

  if (request == null) return null
  const cancel = () => { if (!deleting) publishDeleteTarget(null) }
  const confirm = async () => {
    if (deleting) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(resolveApiUrl(DELETE_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [DELETE_TOKEN_HEADER]: '1' },
        body: JSON.stringify({ sessionId: request.sessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
      publishDeleteTarget(null)
    } catch (e) {
      setError(t('deleteError') + ': ' + (e?.message || ''))
    } finally {
      setDeleting(false)
    }
  }
  return jsx('div', {
    ref: cardRef,
    role: 'dialog',
    style: {
      position: 'fixed', top: pos?.top ?? 16, left: pos?.left ?? 16, zIndex: 10000,
      width: 300, padding: 16, borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
      background: 'var(--dsw-alias-bg-layer-3, rgba(32, 32, 32, 0.98))',
      color: 'inherit', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
    },
    children: jsxs('div', {
      children: [
        jsx('div', { style: { fontWeight: 600, marginBottom: 8 }, children: t('deleteConfirmTitle') }, 'title'),
        jsx('div', { style: { opacity: 0.8, fontSize: 12, marginBottom: 4, wordBreak: 'break-all' }, children: '「' + request.title + '」' }, 'name'),
        jsx('p', { style: { opacity: 0.7, fontSize: 12, margin: '0 0 12px' }, children: t('deleteConfirmBody') }, 'body'),
        error ? jsx('p', { role: 'alert', style: { color: '#f87171', fontSize: 12, margin: '0 0 8px' }, children: error }, 'error') : null,
        jsxs('div', {
          style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
          children: [
            jsx('button', { type: 'button', className: 'dsh-starlong-btn dsh-starlong-btn-cancel', disabled: deleting, onClick: cancel, children: t('deleteCancel') }, 'cancel'),
            jsx('button', { type: 'button', className: 'dsh-starlong-btn dsh-starlong-btn-danger', disabled: deleting, onClick: confirm, children: deleting ? t('deleteDeleting') : t('deleteConfirm') }, 'confirm'),
          ],
        }, 'actions'),
      ],
    }, 'content'),
  }, 'card')
}

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = REPO_CSS + '\n' + THEME_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-starlong 页头样式')
  ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-starlong 文案')
  const t = ctx.locale.bind(NS)
  // 原生会话右键 + 确认弹层：宿主服务/HMR 可能晚于本插件就绪，
  // 即时 + 微任务 + slots/changed 三次注册兜底，避免菜单或弹层静默丢失。
  ctx.effect(() => {
    let disposeMenu
    let disposeOverlay
    let mountedService

    const registerMenu = () => {
      let menus
      try { menus = ctx.get?.('contextMenus') ?? ctx.contextMenus } catch { menus = undefined }
      if (!menus || typeof menus.register !== 'function') return
      // 服务实例被替换（HMR/重建）时先释放旧注册，避免菜单项残留或重复。
      if (mountedService !== undefined && mountedService !== menus) {
        try { disposeMenu?.() } catch { /* 宿主已回收菜单服务 */ }
        disposeMenu = undefined
        mountedService = undefined
      }
      if (disposeMenu !== undefined) return
      try {
        disposeMenu = menus.register({
          id: 'dsh-starlong.session-delete',
          target: 'session',
          order: 9999,
          observe: () => [ctx.locale],
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
      if (disposeOverlay !== undefined) return
      try {
        disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-starlong.delete-session',
          locale: NS,
          inject: () => ({ t: ctx.locale.bind(NS) }),
        }, DeleteSessionOverlay))
      } catch { disposeOverlay = undefined }
    }

    const reconcile = () => { registerMenu(); registerOverlay() }
    reconcile()
    void Promise.resolve().then(() => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
    const off = typeof ctx.on === 'function'
      ? ctx.on('slots/changed', () => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
      : undefined

    return () => {
      try { off?.() } catch { /* 宿主已回收事件服务 */ }
      try { disposeMenu?.() } catch { /* 宿主已回收菜单服务 */ }
      try { disposeOverlay?.() } catch { /* 宿主已回收插槽服务 */ }
    }
  }, 'dsh-starlong 会话右键删除')
  const scope = ctx.configForms.get(PLUGIN_PACKAGE)
  const card = new CleanupCardController(sectionScope(scope, DISK_CLEANUP_SECTION))
  const sessionCard = new DirectCardController(sectionScope(scope, SESSION_SECTION), {
    enabled: { type: 'boolean', default: true },
    autoArchive: { type: 'boolean', default: true },
    idleDays: { type: 'number', default: DEFAULT_IDLE_DAYS },
    autoDelete: { type: 'boolean', default: false },
    deleteDays: { type: 'number', default: DEFAULT_DELETE_DAYS },
  })
  const backupCard = new DirectCardController(sectionScope(scope, BACKUP_SECTION), {
    enabled: { type: 'boolean', default: true },
    repo: { type: 'string', default: DEFAULT_BACKUP_REPO },
    intervalHours: { type: 'number', default: Number(DEFAULT_BACKUP_INTERVAL) },
  })
  ctx.effect(() => () => {
    try { card.dispose() } catch { /* 宿主已回收表单服务 */ }
    try { sessionCard.dispose() } catch { /* 宿主已回收表单服务 */ }
    try { backupCard.dispose() } catch { /* 宿主已回收表单服务 */ }
  }, 'dsh-starlong 表单')
  ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => {
    const disposers = [
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PLUGIN_PACKAGE,
        // 导航按 order 升序排；取大值让套件页固定垫底。
        order: 1000,
        label: () => t('page'),
        locale: NS,
        inject: () => {
          const base = card.inject()
          const session = sessionCard.inject('sessionCard', {
            toggleSession: next => sessionCard.commit('enabled', next),
            toggleSessionAuto: next => sessionCard.commit('autoArchive', next),
            setSessionIdleDays: days => sessionCard.commit('idleDays', days),
            toggleSessionDelete: next => sessionCard.commit('autoDelete', next),
            setSessionDeleteDays: days => sessionCard.commit('deleteDays', days),
          })
          const backup = backupCard.inject('backupCard', {
            toggleBackup: next => backupCard.commit('enabled', next),
            setBackupRepo: value => backupCard.commit('repo', value),
            setBackupInterval: hours => backupCard.commit('intervalHours', hours),
          })
          // 三张卡片的 hooks 必须合并；浅展开会互相覆盖 hooks 对象。
          return { ...base, ...session, ...backup, hooks: { ...base.hooks, ...session.hooks, ...backup.hooks } }
        },
      }, SettingsPage)),
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: PLUGIN_PACKAGE,
      }, SettingsIcon)),
    ]
    return () => disposers.reverse().forEach(dispose => dispose?.())
  }), 'dsh-starlong 卡片与设置页')
}

module.exports.name = 'dsh-starlong'
module.exports.inject = ['slots', 'locale', 'configForms']
module.exports.apply = apply