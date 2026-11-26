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
/* 统一设置清单：左名称右控件，所有行同高同边距。 */
.dsh-backup-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22))}
.dsh-backup-setting-label{font-size:14px;font-weight:400;color:var(--dsw-alias-label-primary,inherit)}
.dsh-backup-setting-control{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;text-align:right}
.dsh-backup-setting-note{margin-top:4px;font-size:12px;opacity:.7}
.dsh-backup-field-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:8px 0}
.dsh-backup-field-control{display:flex;align-items:center;gap:6px}
.dsh-backup-field-label{font-size:14px;font-weight:400}
.dsh-backup-field-suffix{font-size:14px;opacity:.75}
.dsh-backup-number-input,.dsh-backup-text-input,.dsh-backup-select-input{padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:inherit;font:inherit;font-size:13px}
.dsh-backup-number-input{width:56px;text-align:center}
.dsh-backup-text-input{width:220px;box-sizing:border-box}
.dsh-backup-preset-name{width:120px}
.dsh-backup-select-input{max-width:180px}
.dsh-backup-disclosure{border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22))}
.dsh-backup-disclosure-head{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dsh-backup-disclosure-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1))}
.dsh-backup-disclosure-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:-2px}
.dsh-backup-disclosure-label{font-size:14px;font-weight:400}
.dsh-backup-disclosure-summary{margin-left:auto;max-width:60%;font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-backup-disclosure-caret{flex:0 0 auto;width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg);opacity:.55;transition:transform .15s ease}
.dsh-backup-disclosure.is-open .dsh-backup-disclosure-caret{transform:rotate(-135deg)}
.dsh-backup-disclosure-body{padding:2px 0 14px}
.dsh-backup-muted{font-size:12px;opacity:.55;padding:10px 0}
.dsh-backup-adjusted-list{display:flex;flex-direction:column;gap:6px}
.dsh-backup-regex-head{display:flex;align-items:center;gap:8px;font-size:13px}
.dsh-backup-regex-pending{font-size:12px;color:#f59e0b}
.dsh-backup-regex-row{display:flex;align-items:flex-start;gap:8px;margin-top:6px}
.dsh-backup-regex-input{flex:1;box-sizing:border-box;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.12));color:inherit;font:inherit;font-size:12px;resize:vertical}
.dsh-backup-preset-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-backup-export-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}
@media (prefers-reduced-motion:reduce){.dsh-backup-disclosure-caret{transition:none}}

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