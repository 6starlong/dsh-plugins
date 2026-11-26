import { jsx, jsxs } from 'react/jsx-runtime'
import { STYLE } from './styles.js'

/** 天数输入：默认作为独立行；bare 模式只返回控件，交给 SettingRow 排列。 */
export function DaysInput({ label, suffix, value, max, disabled, onCommit, bare }) {
  const input = jsx('input', {
    type: 'number',
    min: 1,
    max,
    step: 1,
    key: String(value),
    defaultValue: String(value),
    disabled,
    'aria-label': label,
    className: 'dsh-backup-number-input',
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
  }, 'input')
  const control = jsxs('div', {
    className: 'dsh-backup-field-control',
    children: [input, jsx('span', { className: 'dsh-backup-field-suffix', children: suffix }, 'suffix')],
  }, 'control')
  if (bare) return control
  return jsxs('div', {
    className: 'dsh-backup-field-row',
    children: [jsx('span', { className: 'dsh-backup-field-label', children: label }, 'label'), control],
  }, 'days')
}

/** 文本输入：失焦或回车提交；bare 模式只返回控件。 */
export function TextInput({ label, value, disabled, onCommit, bare }) {
  const input = jsx('input', {
    type: 'text',
    key: value,
    defaultValue: value,
    disabled,
    'aria-label': label,
    className: 'dsh-backup-text-input',
    onBlur: event => {
      const next = event.target.value.trim()
      if (next && next !== value) onCommit(next)
      else event.target.value = value
    },
    onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
  }, 'input')
  if (bare) return input
  return jsxs('div', {
    className: 'dsh-backup-field-row',
    children: [jsx('span', { className: 'dsh-backup-field-label', children: label }, 'label'), input],
  }, 'text')
}

/** 多行词表输入：失焦提交，改动即写配置。 */
export function TextAreaInput({ label, value, disabled, onCommit }) {
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
