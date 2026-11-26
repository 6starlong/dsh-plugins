export const STYLE = {
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
  label: { fontWeight: 600 },
  hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
  // 每个模块一张卡片；模块之间靠卡片边框与间距分组。
  card: { border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: 'var(--dsh-claude-card, var(--dsw-alias-bg-layer-3, rgba(128, 128, 128, 0.05)))' },
  // 模块关闭时整卡只剩标题行与开关，子设置连同保存按钮一起收起。
  cardTitle: { fontWeight: 600, fontSize: '15px' },
  cardDesc: { margin: '4px 0 0', opacity: 0.7, fontSize: '12px' },
  // 标题区与子设置之间的分割线。
  divider: { borderTop: '0.5px solid var(--dsh-claude-divider, var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3)))', margin: '14px 0' },
  // 页面顶部留白，避免标题贴边。
  pageHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '16px', marginBottom: '16px' },
  pageTitle: { fontWeight: 700, fontSize: '16px' },
}

/**
 * 主题适配器：默认基底是 DSH 客户端变量；命中适配器时只覆盖差异 token。
 * 加新主题=追加一项 detect + css，不改组件逻辑。
 */
export const THEME_ADAPTERS = [
  {
    id: 'claude',
    detect: () => {
      const probe = '--dsh-claude-card'
      const root = window.getComputedStyle(document.documentElement).getPropertyValue(probe).trim()
      const body = window.getComputedStyle(document.body).getPropertyValue(probe).trim()
      return Boolean(root || body)
    },
    css: `
.dsh-plugins-root[data-starlong-theme~='claude']{
  --sl-accent:var(--dsw-alias-brand-primary);
  --sl-on-accent:var(--dsw-alias-brand-text,#ffffff);
  --sl-hover-bg:var(--dsw-alias-brand-primary);
  --sl-badge-bg:var(--dsw-alias-brand-primary);
  --sl-badge-fg:var(--dsw-alias-brand-text,#ffffff);
}`,
  },
]
export const THEME_CSS = THEME_ADAPTERS.map(adapter => adapter.css).join('\n')

/**
 * GitHub 入口的悬停动效：底色渐显、图标变亮、
 * 「GitHub」文字从宽度 0 展开。内联样式写不了 :hover，只能注入样式表。
 */
export const REPO_CSS = `
.dsh-plugins-root{
  --sl-accent:var(--dsw-alias-border-selected,#adb2b8);
  --sl-on-accent:var(--dsw-alias-label-primary,inherit);
  --sl-hover-bg:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.16));
  --sl-badge-bg:var(--dsw-alias-bg-module-platform,rgba(128,128,128,.16));
  --sl-badge-fg:var(--dsw-alias-label-secondary,inherit);
}
.dsh-plugins-repo{flex:none;display:inline-flex;align-items:center;justify-content:center;height:24px;min-width:24px;padding:0 4px;border-radius:6px;text-decoration:none;transition:background-color .15s ease}
.dsh-plugins-repo svg{fill:var(--dsw-alias-label-secondary);transition:fill .15s ease}
.dsh-plugins-repo-label{max-width:0;margin-left:0;overflow:hidden;opacity:0;white-space:nowrap;font-size:13px;font-weight:500;color:var(--sl-on-accent);transition:max-width .15s ease,margin-left .15s ease,opacity .15s ease}
.dsh-plugins-repo:hover,.dsh-plugins-repo:focus-visible{background-color:var(--sl-hover-bg)}
.dsh-plugins-repo:hover svg,.dsh-plugins-repo:focus-visible svg{fill:var(--sl-on-accent)}
.dsh-plugins-repo:hover .dsh-plugins-repo-label,.dsh-plugins-repo:focus-visible .dsh-plugins-repo-label{max-width:6em;margin-left:6px;opacity:1}
.dsh-plugins-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:5px;padding:6px 12px;font:inherit;font-size:13px;font-weight:500;line-height:1.35;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .1s ease}
.dsh-plugins-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-plugins-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:1px}
.dsh-plugins-btn-cancel{background:transparent;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-plugins-btn-cancel:hover:not(:disabled){background:rgba(128,128,128,.12);border-color:rgba(128,128,128,.55)}
.dsh-plugins-btn-danger{background:transparent;border-color:rgba(217,72,65,.55);color:#e06c66}
.dsh-plugins-btn-danger:hover:not(:disabled){background:rgba(217,72,65,.14);border-color:rgba(217,72,65,.85)}
.dsh-plugins-btn-danger:active:not(:disabled){transform:translateY(1px)}
.dsh-plugins-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.dsh-plugins-tab{appearance:none;border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));border-radius:999px;padding:5px 14px;font:inherit;font-size:13px;font-weight:500;line-height:1.4;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.dsh-plugins-tab:hover:not(.is-active){border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.35))}
.dsh-plugins-tab.is-active{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));border-color:var(--sl-accent);color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.dsh-plugins-tab:focus-visible{outline:2px solid var(--dsw-alias-border-l3,rgba(128,128,128,.65));outline-offset:2px}
.dsh-plugins-root .dsh-plugins-version-badge{margin-left:6px;padding:0 5px;border-radius:999px;background:var(--sl-badge-bg);color:var(--sl-badge-fg);font-size:10px;line-height:14px;font-weight:600}
`