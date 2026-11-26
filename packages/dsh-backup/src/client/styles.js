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
 * 备份卡片按钮样式：独立详情页也要有和套件一致的按钮外观。
 */
export const BACKUP_CSS = `
.dsh-plugins-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:5px;padding:6px 12px;font:inherit;font-size:13px;font-weight:500;line-height:1.35;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .1s ease}
.dsh-plugins-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-plugins-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:1px}
.dsh-plugins-btn-danger{background:transparent;border-color:rgba(217,72,65,.55);color:#e06c66}
.dsh-plugins-btn-danger:hover:not(:disabled){background:rgba(217,72,65,.14);border-color:rgba(217,72,65,.85)}
.dsh-plugins-btn-danger:active:not(:disabled){transform:translateY(1px)}
/* 备份树按档案清单设计：标题区承载状态，内容区沿用 DSH 侧边栏的行密度与图标语义。 */
.dsh-backup-tree-section{margin-top:2px}
.dsh-backup-tree-head{display:flex;align-items:center;gap:10px;min-height:32px}
.dsh-backup-tree-title{font-size:14px;font-weight:600;letter-spacing:.01em}
.dsh-backup-tree-summary{font-size:12px;color:var(--dsw-alias-label-secondary,inherit);opacity:.75;font-variant-numeric:tabular-nums}
.dsh-backup-tree-head-spacer{flex:1}
.dsh-backup-tree-status{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));font-size:11px;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-backup-tree-status-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f59e0b);box-shadow:0 0 0 3px rgba(245,158,11,.12);animation:dsh-backup-pulse 1.2s ease-in-out infinite}
@keyframes dsh-backup-pulse{0%,100%{opacity:.45}50%{opacity:1}}
.dsh-backup-tree-box{margin-top:10px;min-height:180px;max-height:320px;overflow-y:auto;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:8px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.06));box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
.dsh-backup-tree-skeleton{display:flex;flex-direction:column;gap:4px;padding:4px 2px}
.dsh-backup-tree-skeleton-row{display:flex;align-items:center;gap:10px;min-height:32px;padding:5px 10px}
.dsh-backup-tree-skeleton-icon{width:16px;height:16px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));animation:dsh-backup-shimmer 1.2s ease-in-out infinite}
.dsh-backup-tree-skeleton-line{height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));animation:dsh-backup-shimmer 1.2s ease-in-out infinite}
@keyframes dsh-backup-shimmer{0%,100%{opacity:.35}50%{opacity:.7}}
.dsh-backup-tree-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:162px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-backup-tree-empty-icon{color:var(--dsw-alias-state-warn-primary,#f59e0b);opacity:.55}
.dsh-backup-tree-empty-hint{font-size:12px;opacity:.55}
.dsh-backup-tree-item{margin:0;padding:0}
.dsh-backup-tree-row{display:flex;align-items:center;width:100%;min-width:0;min-height:32px;border-radius:var(--dsw-radius-md,6px)}
.dsh-backup-tree-row input[type=checkbox]{flex:0 0 auto;margin:0 4px 0 0;accent-color:var(--dsw-alias-state-warn-primary,#f59e0b);cursor:pointer}
.dsh-backup-tree-action{display:flex;flex:1;gap:6px;align-items:center;min-width:0;padding:5px 10px;color:inherit;font:inherit;text-align:left;background:transparent;border:0;border-radius:var(--dsw-radius-md,6px)}
button.dsh-backup-tree-action{cursor:pointer}
span.dsh-backup-tree-action{cursor:default}
.dsh-backup-tree-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:-2px}
.dsh-backup-tree-row:hover .dsh-backup-tree-action{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dsh-backup-tree-icon{flex:0 0 auto;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsh-backup-tree-file-icon{flex:0 0 auto}
.dsh-backup-tree-name{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px}
.dsh-backup-tree-size{flex:0 0 76px;padding-right:10px;text-align:right;opacity:.6;font-size:12px;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.dsh-backup-tree-status-dot,.dsh-backup-tree-skeleton-icon,.dsh-backup-tree-skeleton-line{animation:none}}
`