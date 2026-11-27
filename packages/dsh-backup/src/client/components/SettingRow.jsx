import { jsx, jsxs } from 'react/jsx-runtime'

/** 统一设置行：左侧标题与描述，右侧表单控件。 */
export function SettingRow({ label, description, control, onClick, expanded }) {
  return jsxs('div', {
    className: 'dsh-backup-setting-row',
    role: onClick ? 'button' : undefined,
    tabIndex: onClick ? 0 : undefined,
    'aria-expanded': onClick ? Boolean(expanded) : undefined,
    onClick,
    onKeyDown: onClick ? event => {
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(event) }
    } : undefined,
    children: [
      jsxs('div', {
        className: 'dsh-backup-setting-text',
        children: [
          jsx('span', { className: 'dsh-backup-setting-label', children: label }, 'label'),
          description ? jsx('span', { className: 'dsh-backup-setting-desc', children: description }, 'desc') : null,
        ],
      }, 'text'),
      jsx('div', { className: 'dsh-backup-setting-control', children: control }, 'control'),
    ],
  }, 'row')
}
