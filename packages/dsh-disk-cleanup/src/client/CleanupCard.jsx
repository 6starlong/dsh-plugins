import { Switch, SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsx, jsxs } from 'react/jsx-runtime'
import { STYLE } from './styles.js'
import { DEFAULT_MAX_AGE_DAYS } from './constants.js'

/**
 * 表单外框的文案。
 * @param {(key: string) => string} t - 翻译函数。
 * @returns {object} SettingsForm 需要的标签。
 */
export function formLabels(t) {
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
export function CleanupCard(props) {
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