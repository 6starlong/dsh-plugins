import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { REPO_URL } from '../shared/constants.js'
import { STYLE, THEME_ADAPTERS } from '../shared/styles.js'
import { GitHubIcon } from './icons.jsx'
import { ModuleCard } from './ModuleCard.jsx'

/** 只输出命中的主题标记，配色交给 CSS 适配器，组件不感知具体主题。 */
function useThemeIds() {
  const [ids, setIds] = useState('')
  useEffect(() => {
    const detect = () => {
      const next = THEME_ADAPTERS.filter(adapter => adapter.detect()).map(adapter => adapter.id).join(' ')
      setIds(prev => (prev === next ? prev : next))
    }
    detect()
    const observer = new MutationObserver(detect)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])
  return ids
}

/** 设置页：左标题右 GitHub，名称下方胶囊切换模块卡片。 */
export function SettingsPage(props) {
  // 摘要视图只留页头，胶囊与卡片都不渲染，保持宿主概览里的原行为。
  const summary = props.view === 'summary'
  const [tab, setTab] = useState(props.modules[0]?.id)
  const themeIds = useThemeIds()
  const tabs = props.modules.map(module => ({ id: module.id, label: module.title || props.t(module.titleKey) }))
  return jsxs('div', {
    className: 'dsh-plugins-root',
    'data-starlong-theme': themeIds || undefined,
    children: [
      jsxs('div', {
        style: STYLE.pageHead,
        children: [
          jsx('span', { style: STYLE.pageTitle, children: props.t('page') }),
          jsx('a', {
            href: REPO_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            title: props.t('repo'),
            'aria-label': props.t('repo'),
            className: 'dsh-plugins-repo',
            children: jsxs('span', {
              style: { display: 'inline-flex', alignItems: 'center' },
              children: [
                jsx(GitHubIcon, {}, 'icon'),
                jsx('span', { className: 'dsh-plugins-repo-label', children: props.t('repoLabel') }, 'label'),
              ],
            }),
          }),
        ],
      }, 'head'),
      summary ? null : jsx('div', {
        className: 'dsh-plugins-tabs',
        role: 'tablist',
        children: tabs.map(item => jsx('button', {
          type: 'button',
          role: 'tab',
          key: item.id,
          'aria-selected': tab === item.id,
          className: 'dsh-plugins-tab' + (tab === item.id ? ' is-active' : ''),
          onClick: () => setTab(item.id),
          children: item.label,
        }, item.id)),
      }, 'tabs'),
      props.modules
        .filter(module => module.id === tab)
        .map(module => jsx(ModuleCard, { key: module.id, module, t: props.t, view: props.view }, module.id)),
    ],
  })
}