import { jsx, jsxs } from 'react/jsx-runtime'

/** 统一设置行：左侧名称，右侧控件与补充说明。 */
export function SettingRow({ label, control, note }) {
  return jsxs('div', {
    className: 'dsh-backup-setting-row',
    children: [
      jsx('span', { className: 'dsh-backup-setting-label', children: label }, 'label'),
      jsxs('div', {
        className: 'dsh-backup-setting-control',
        children: [
          control,
          note ? jsx('span', { className: 'dsh-backup-setting-note', children: note }, 'note') : null,
        ],
      }, 'control'),
    ],
  }, 'row')
}
