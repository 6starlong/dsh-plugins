import { jsx, jsxs } from 'react/jsx-runtime'
import { STYLE } from './styles.js'

/**
 * 天数输入行：标签 + 数字框 + 后缀，整组右对齐。
 * 归档天数与删除天数共用，钳制范围由 max 决定，回车与失焦都提交。
 */
export function DaysInput({ label, suffix, value, max, disabled, onCommit }) {
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

/** 文本输入行：标签 + 文本框，失焦或回车提交。 */
export function TextInput({ label, value, disabled, onCommit }) {
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