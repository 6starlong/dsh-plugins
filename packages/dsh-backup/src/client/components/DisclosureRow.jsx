import { jsx, jsxs } from 'react/jsx-runtime'

/** 可折叠设置行：标题与摘要常驻，点击展开下面的大块内容。 */
export function DisclosureRow({ label, summary, open, onToggle, children }) {
  return jsxs('div', {
    className: 'dsh-backup-disclosure' + (open ? ' is-open' : ''),
    children: [
      jsxs('button', {
        type: 'button',
        className: 'dsh-backup-disclosure-head',
        'aria-expanded': !!open,
        onClick: onToggle,
        children: [
          jsx('span', { className: 'dsh-backup-disclosure-label', children: label }, 'label'),
          jsx('span', { className: 'dsh-backup-disclosure-summary', children: summary }, 'summary'),
          jsx('span', { className: 'dsh-backup-disclosure-caret', 'aria-hidden': true }, 'caret'),
        ],
      }, 'head'),
      open ? jsx('div', { className: 'dsh-backup-disclosure-body', children }, 'body') : null,
    ],
  }, 'row')
}
