import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { jsx, jsxs } from 'react/jsx-runtime'
import { STYLE } from '../shared/styles.js'

/**
 * 通用模块卡片：根包只负责标题、模块开关和容器，配置内容由组件插槽渲染。
 * npm 子包面板与根包本地面板走同一入口，重复外壳不再按模块实现。
 */
export function ModuleCard(props) {
  const { module, t, view } = props
  if (view === 'summary') return null
  const state = module.useSwitch(snapshot => snapshot)
  const title = module.title || t(module.titleKey)
  const description = module.description || (module.descriptionKey ? t(module.descriptionKey) : null)
  const head = jsxs('div', {
    children: [
      jsxs('div', {
        style: STYLE.row,
        children: [
          jsxs('span', {
            style: { display: 'flex', alignItems: 'center' },
            children: [
              jsx('span', { style: STYLE.cardTitle, children: title }, 'text'),
              module.version ? jsx('span', {
                className: 'dsh-plugins-version-badge',
                style: { display: 'inline-block', marginTop: '4px' },
                children: 'v' + module.version,
              }, 'version') : null,
            ],
          }, 'heading'),
          jsx(Switch, {
            checked: state.enabled === true,
            label: title,
            disabled: !state.writable,
            onChange: module.toggleSwitch,
          }),
        ],
      }, 'row'),
      description ? jsx('p', { style: STYLE.cardDesc, children: description }, 'desc') : null,
    ],
  }, 'module')
  if (state.enabled !== true) {
    return jsxs('div', {
      style: STYLE.card,
      children: [head, state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null],
    })
  }
  return jsxs('div', {
    style: STYLE.card,
    children: [
      head,
      jsx('div', { style: STYLE.divider }, 'divider'),
      jsx(module.Panel, { ...module.panelProps, t: module.panelT || t, view }, 'panel'),
    ],
  })
}