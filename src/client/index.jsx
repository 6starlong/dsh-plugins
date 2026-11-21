/**
 * dsh-starlong 的浏览器半边：聚合各模块的配置卡片。
 * 宿主按 bundle id 出配置区，所以卡片 key 用套件名；表单作用域靠 sectionScope
 * 收敛到各模块自己的嵌套段，模块间字段不会打架。
 *
 * @module dsh-starlong/client
 */
import { Switch, SettingsForm, SettingsFormModel, settingsNumberField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsx, jsxs } from 'react/jsx-runtime'

/** 包名：plugins.bundle.config 的槽位 key，也是配置表单的命名空间。 */
const PLUGIN_PACKAGE = 'dsh-starlong'
/** 本卡片编辑的模块段。 */
const SECTION = 'dsh-disk-cleanup'
/** 本地化命名空间。 */
const NS = 'settings.starlong.diskCleanup'
/** 套件仓库：设置页头右侧的 GitHub 入口。 */
const REPO_URL = 'https://github.com/6starlong/dsh-starlong'

/** 与 lib/config.js 的 schema 默认值一致；输入框留空时置灰显示。 */
const DEFAULT_MAX_AGE_DAYS = '3'

const STYLE = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  label: { fontWeight: 600 },
  hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
  // 每个模块一张卡片；模块之间靠卡片边框与间距分组。
  card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: 'var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.05))' },
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
 * GitHub 入口的悬停动效：底色渐显、图标变亮、
 * 「GitHub」文字从宽度 0 展开。内联样式写不了 :hover，只能注入样式表。
 */
const REPO_CSS = `
.dsh-starlong-repo{flex:none;display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 4px;border-radius:6px;text-decoration:none;transition:background-color .15s ease}
.dsh-starlong-repo svg{fill:var(--dsw-alias-label-secondary);transition:fill .15s ease}
.dsh-starlong-repo-label{max-width:0;margin-left:0;overflow:hidden;opacity:0;white-space:nowrap;font-size:13px;font-weight:500;color:var(--dsw-alias-brand-text,#ffffff);transition:max-width .15s ease,margin-left .15s ease,opacity .15s ease}
.dsh-starlong-repo:hover,.dsh-starlong-repo:focus-visible{background-color:var(--dsw-alias-brand-primary,#d97757)}
.dsh-starlong-repo:hover svg,.dsh-starlong-repo:focus-visible svg{fill:var(--dsw-alias-brand-text,#ffffff)}
.dsh-starlong-repo:hover .dsh-starlong-repo-label,.dsh-starlong-repo:focus-visible .dsh-starlong-repo-label{max-width:6em;margin-left:6px;opacity:1}
`

const MESSAGES = {
  zh: {
    title: '磁盘清理',
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
          jsx('span', { style: STYLE.cardTitle, children: t('title') }),
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

/** GitHub 标记图标（16px 官方轮廓）。 */
function GitHubIcon({ size = 16 }) {
  return jsx('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true',
    children: jsx('path', {
      d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z',
    }),
  })
}

/** 设置页：左标题右 GitHub，模块各占一张卡片。 */
function SettingsPage(props) {
  return jsxs('div', {
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
      jsx(CleanupCard, props, 'cleanup'),
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

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = REPO_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'dsh-starlong 页头样式')
  ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-starlong 文案')
  const t = ctx.locale.bind(NS)
  const card = new CleanupCardController(sectionScope(ctx.configForms.get(PLUGIN_PACKAGE), SECTION))
  ctx.effect(() => () => { try { card.dispose() } catch { /* 宿主已回收表单服务 */ } }, 'dsh-starlong 表单')
  ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => {
    const disposers = [
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: PLUGIN_PACKAGE,
        // 导航按 order 升序排；取大值让套件页固定垫底。
        order: 1000,
        label: () => t('page'),
        locale: NS,
        inject: () => card.inject(),
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
