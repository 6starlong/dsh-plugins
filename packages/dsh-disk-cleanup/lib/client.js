// 由 scripts/build.mjs 生成，不要手改。
window.__ModuleLoader__.load({
  id: "@6starlong/dsh-disk-cleanup",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    // ---- index.jsx ----
    /**
     * dsh-disk-cleanup 的浏览器半边：「过期清理」配置卡片。
     *
     * 宿主按 schema 自动生成的表单只有字段、没有说明与文案，所以宿主侧关掉自动表单
     * （见 lib/index.js 的 settings.configure），由本文件在 plugins.bundle.config 槽里
     * 渲染一张自己的卡片。
     *
     * 槽位 key 与配置表单的命名空间都用包名：宿主按包名判断插件详情页要不要出配置区，
     * 也按同名的 profile 条目读配置。
     *
     * 这张卡片只碰 autoCleanup（是否自动清理）与 cleanupMaxAgeDays（保留天数）两个
     * volatile 字段，其余字段仍走 cordis.patch.yml。
     *
     * @module dsh-disk-cleanup/client
     */
    const { Switch, SettingsForm, SettingsFormModel, settingsNumberField, SettingsValueField } = require("@deepseek-ai/dsh-client-ui-primitives")
    const { jsx, jsxs } = require("react/jsx-runtime")
    /*
     * 客户端插件的身份（name / inject）由入口在 factory 里挂到 module.exports 上：
     * 宿主 ModuleLoader 读的就是这个导出对象，闭包产物里不能写 export。
     */

    /** 包名：既是 plugins.bundle.config 的槽位 key，也是配置表单的命名空间。 */
    const PLUGIN_PACKAGE = '@6starlong/dsh-disk-cleanup'
    /** 本地化命名空间。 */
    const NS = 'settings.diskCleanup'

    /** 保留天数默认值，与 lib/config.js 的 schema 默认值保持一致；输入框留空时置灰显示。 */
    const DEFAULT_MAX_AGE_DAYS = '3'

    /** 卡片里最小的必要样式：开关行左右排布、说明文字弱化。 */
    const STYLE = {
      row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      label: { fontWeight: 600 },
      hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
    }

    /** 文案。宿主界面是中文，随宿主语言只给一份中文。 */
    const MESSAGES = {
      zh: {
        title: '过期清理',
        description: '自动清理过期临时文件、请求图片缓存与无主附件残留，并清掉残留空目录。',
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

    /**
     * 布尔字段：开关写 'true' / 'false' 文本，再由 parse 变成真正的布尔值。
     * @param {string} field - 字段名。
     * @returns {object} 字段转换规则。
     */
    function booleanField(field) {
      return {
        field,
        format: value => String(value !== false),
        parse: text => ({ kind: 'set', value: text === 'true' }),
      }
    }

    /**
     * 表单外框的文案。
     * @param {(key: string) => string} t - 翻译函数。
     * @returns {object} SettingsForm 需要的标签。
     */
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
     * 设置卡片。槽位注入 hooks.cleanupCard 与表单动作，形状与 dsh-rewind 的卡片一致。
     * @param {object} props - 槽位注入的属性。
     * @returns {object | null} 卡片元素；摘要视图不出内容。
     */
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
            id: 'plugin-config-disk-cleanup-maxage',
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

    /**
     * 表单模型与卡片状态的接线。
     */
    class CleanupCardController {
      /** @param {object} scope - 宿主该条目的配置表单。 */
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

      /** @returns {object} 槽位注入的 hooks 与动作。 */
      inject() {
        return { hooks: { cleanupCard: this.store }, ...this.form.actions() }
      }

      dispose() {
        this.form.dispose()
      }
    }

    /**
     * 客户端插件入口。
     * @param {object} ctx - 客户端根上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-disk-cleanup 文案')
      const t = ctx.locale.bind(NS)
      const card = new CleanupCardController(ctx.configForms.get(PLUGIN_PACKAGE))
      ctx.effect(() => () => {
        try {
          card.dispose()
        } catch { /* 宿主回收表单服务后，表单已经自己关掉了 */ }
      }, 'dsh-disk-cleanup 表单')
      ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: PLUGIN_PACKAGE,
        locale: NS,
        inject: () => card.inject(),
      }, CleanupCard))), 'dsh-disk-cleanup 卡片')
    }

    module.exports.name = '@6starlong/dsh-disk-cleanup'
    module.exports.inject = ['slots', 'locale', 'configForms']
    module.exports.apply = apply
    return module.exports;
  },
});
