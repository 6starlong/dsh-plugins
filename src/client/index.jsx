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

/** 与 lib/config.js 的 schema 默认值一致；输入框留空时置灰显示。 */
const DEFAULT_MAX_AGE_DAYS = '3'

const STYLE = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  label: { fontWeight: 600 },
  hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
}

const MESSAGES = {
  zh: {
    title: '过期清理',
    description: '套件模块 dsh-disk-cleanup 的临时文件清理。',
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
  const prefix = ['config', section]
  const pick = value => value === undefined ? undefined : value?.config?.[section]
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
  const enabled = state.enabled.text === 'true'
  return jsxs(SettingsForm, {
    labels: formLabels(t),
    state,
    onSave: props.save,
    onDiscard: props.discard,
    children: [
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsx('span', { style: STYLE.label, children: t('title') }),
          jsx(Switch, {
            checked: enabled,
            label: t('title'),
            disabled,
            onChange: next => { props.edit('autoCleanup', String(next)) },
          }),
        ],
      }, 'toggle'),
      jsx('p', { style: STYLE.hint, children: t(enabled ? 'on' : 'off') }, 'hint'),
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
  })
}

class CleanupCardController {
  constructor(scope) {
    this.form = new SettingsFormModel(scope, [
      booleanField('autoCleanup'),
      settingsNumberField('cleanupMaxAgeDays'),
    ])
    this.store = this.form.bind(() => ({
      ...this.form.shell(),
      enabled: this.form.field('autoCleanup'),
      maxAgeDays: this.form.field('cleanupMaxAgeDays'),
    }))
  }
  inject() {
    return { hooks: { cleanupCard: this.store }, ...this.form.actions() }
  }
  dispose() {
    this.form.dispose()
  }
}

function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-starlong 文案')
  const t = ctx.locale.bind(NS)
  const card = new CleanupCardController(sectionScope(ctx.configForms.get(PLUGIN_PACKAGE), SECTION))
  ctx.effect(() => () => { try { card.dispose() } catch { /* 宿主已回收表单服务 */ } }, 'dsh-starlong 表单')
  ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: PLUGIN_PACKAGE,
    locale: NS,
    inject: () => card.inject(),
  }, CleanupCard))), 'dsh-starlong 卡片')
}

module.exports.name = 'dsh-starlong'
module.exports.inject = ['slots', 'locale', 'configForms']
module.exports.apply = apply
