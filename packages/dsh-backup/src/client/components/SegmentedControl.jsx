import { jsx } from 'react/jsx-runtime'

/** 分段单选：选项为 [{ value, label }]，值相等的那段高亮。 */
export function SegmentedControl({ options, value, onChange, disabled, label }) {
  return jsx('div', {
    className: 'dsh-backup-segmented',
    role: 'group',
    'aria-label': label,
    children: options.map(option => jsx('button', {
      key: String(option.value),
      type: 'button',
      className: 'dsh-backup-segment' + (option.value === value ? ' is-active' : ''),
      'aria-pressed': option.value === value,
      disabled: !!disabled,
      onClick: () => onChange?.(option.value),
      children: option.label,
    }, 'seg-' + option.value)),
  })
}
