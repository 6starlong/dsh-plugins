import { jsx, jsxs } from 'react/jsx-runtime'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

/** 折叠行：左侧固定标题与描述，右侧配置区按钮才触发展开。 */
export function DisclosureRow({ label, description, open, onToggle, actionLabel, control, children }) {
  return jsxs('div', {
    className: 'dsh-backup-disclosure',
    children: [
      jsxs('div', {
        className: 'dsh-backup-setting-row',
        children: [
          jsxs('div', {
            className: 'dsh-backup-setting-text',
            children: [
              jsx('span', { className: 'dsh-backup-setting-label', children: label }, 'label'),
              description ? jsx('span', { className: 'dsh-backup-setting-desc', children: description }, 'desc') : null,
            ],
          }, 'text'),
          jsxs('div', {
            className: 'dsh-backup-setting-control',
            children: [
              control ?? null,
              jsx(Button, {
                variant: 'ghost', size: 'sm',
                'aria-expanded': !!open,
                className: 'dsh-backup-disclosure-toggle',
                onClick: onToggle,
                children: actionLabel,
              }, 'toggle'),
            ],
          }, 'control'),
        ],
      }, 'head'),
      open ? jsx('div', { className: 'dsh-backup-disclosure-body', children }, 'body') : null,
    ],
  }, 'row')
}
