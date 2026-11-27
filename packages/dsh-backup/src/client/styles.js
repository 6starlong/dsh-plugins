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
.dsh-plugins-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;font-weight:500;line-height:1.35;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .1s ease}
.dsh-plugins-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-plugins-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:1px}
.dsh-plugins-btn-danger{background:transparent;border-color:rgba(217,72,65,.55);color:#e06c66}
.dsh-plugins-btn-danger:hover:not(:disabled){background:rgba(217,72,65,.14);border-color:rgba(217,72,65,.85)}
.dsh-plugins-btn-danger:active:not(:disabled){transform:translateY(1px)}
.dsh-backup-form button.dsh-backup-danger-text{color:#e06c66}
.dsh-backup-form button.dsh-backup-danger-text:hover:not(:disabled){color:#f87171;background:rgba(217,72,65,.14)}
/* 统一设置清单：左侧标题与描述，右侧表单控件；行间用淡顶边，最后一行无线。 */
.dsh-backup-form{--dsh-backup-radius:8px}
.dsh-backup-form button:not(.dsh-backup-tree-action):not(.dsh-backup-select-option):not(.dsh-backup-segment):not(.dsh-backup-tree-revert),
.dsh-backup-form input:not([type=checkbox]){box-sizing:border-box;height:28px;min-height:28px;padding:0 10px;border-radius:var(--dsh-backup-radius)!important;font:inherit;font-size:13px}
.dsh-backup-form textarea{border-radius:var(--dsh-backup-radius)!important;font-size:13px}
.dsh-backup-number-input,.dsh-backup-text-input,.dsh-backup-preset-name{border-radius:var(--dsh-backup-radius)!important}
.dsh-backup-form > * + *{border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsh-backup-form > .dsh-backup-form-note{border-top:0}
.dsh-backup-setting-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0}
.dsh-backup-setting-text{display:flex;flex-direction:column;gap:4px;min-width:0}
.dsh-backup-setting-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-backup-setting-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-backup-setting-control{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;text-align:right}
.dsh-backup-field-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0}
.dsh-backup-field-control{display:flex;align-items:center;gap:6px}
.dsh-backup-field-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-backup-field-suffix{font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary)}
.dsh-backup-number-input{width:64px}
.dsh-backup-text-input{width:220px}
.dsh-backup-preset-name{box-sizing:border-box;flex:none;width:160px;height:28px;font-size:13px}
.dsh-backup-preset-save{box-sizing:border-box;flex:none;height:28px;padding:0 12px;font-size:13px}
.dsh-backup-select{position:relative;max-width:170px}
.dsh-backup-select-trigger{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;height:28px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsh-backup-radius);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.dsh-backup-select-trigger:hover{border-color:var(--dsw-alias-border-l2)}
.dsh-backup-select-trigger:disabled{opacity:.5;cursor:default}
.dsh-backup-select-caret{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-backup-select-menu{position:absolute;z-index:20;top:calc(100% + 4px);left:0;right:0;min-width:100%;max-height:220px;overflow-y:auto;padding:4px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsh-backup-radius);background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px rgba(0,0,0,.24)}
.dsh-backup-select-option{display:block;width:100%;padding:6px 8px;border:0;border-radius:var(--dsh-backup-radius);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.dsh-backup-select-option:hover{background:var(--dsw-alias-bg-layer-3)}
.dsh-backup-select-option.is-selected{color:var(--dsw-alias-brand-primary)}
.dsh-backup-regex-row{padding:12px 0}
.dsh-backup-regex-label{margin-bottom:8px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-backup-regex-control{display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:0}
.dsh-backup-regex-input{box-sizing:border-box;width:100%;min-height:64px;max-height:120px;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsh-backup-radius);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;resize:vertical}
.dsh-backup-preset-save-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:12px 0}
.dsh-backup-preset-label{flex:none;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-backup-preset-controls{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}
.dsh-backup-sync-body > * + *{border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsh-backup-combined-body{display:flex;flex-direction:column}
.dsh-backup-combined-body > .dsh-backup-combined-section{border-top:0.5px solid var(--dsw-alias-border-l1)}
.dsh-backup-combined-section{padding:0}
.dsh-backup-preset-save-row + *{border-top:0.5px solid var(--dsw-alias-border-l1);padding-top:12px}
.dsh-backup-disclosure-toggle{flex:none}
.dsh-backup-muted{font-size:12px;color:var(--dsw-alias-label-secondary);padding:8px 0}
.dsh-backup-segmented{display:inline-flex;align-items:center;gap:2px;padding:2px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsh-backup-radius);background:var(--dsw-alias-bg-layer-1)}
.dsh-backup-segment{box-sizing:border-box;min-width:46px;height:24px;padding:0 8px;border:0;border-radius:calc(var(--dsh-backup-radius) - 2px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.dsh-backup-segment:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-backup-segment.is-active{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.dsh-backup-segment:disabled{opacity:.5;cursor:not-allowed}
.dsh-backup-version-text{font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-backup-tree-adjusted{margin-top:12px;padding-bottom:12px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
.dsh-backup-tree-adjusted-row{display:flex;align-items:center;gap:8px;min-height:26px;font-size:12px}
.dsh-backup-tree-adjusted-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.dsh-backup-tree-adjusted-state{flex:none;font-size:12px}
.dsh-backup-tree-adjusted-state.is-in{color:var(--dsw-alias-state-success-primary,#10b981)}
.dsh-backup-tree-adjusted-state.is-out{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsh-backup-tree-revert{padding:2px 8px;border:0;border-radius:var(--dsh-backup-radius);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-backup-tree-revert:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-backup-tree-revert:disabled{opacity:.45;cursor:not-allowed}

/* 备份树按档案清单设计：标题区承载状态，内容区沿用 DSH 侧边栏的行密度与图标语义。 */
.dsh-backup-tree-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px}
.dsh-backup-tree-head-actions{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-backup-tree-estimate{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-backup-tree-box{margin-top:8px;min-height:180px;max-height:320px;overflow-y:auto;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsh-backup-radius);padding:6px;background:var(--dsw-alias-bg-layer-1)}
.dsh-backup-tree-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:162px;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:var(--dsh-backup-radius);color:var(--dsw-alias-label-secondary,inherit)}
.dsh-backup-tree-empty-icon{color:var(--dsw-alias-state-warn-primary,#f59e0b);opacity:.55}
.dsh-backup-tree-empty-hint{font-size:12px;opacity:.55}
.dsh-backup-tree-skeleton{display:flex;flex-direction:column;gap:4px;padding:4px 2px}
.dsh-backup-tree-skeleton-row{display:flex;align-items:center;gap:10px;min-height:26px;padding:3px 8px}
.dsh-backup-tree-skeleton-icon{width:16px;height:16px;border-radius:var(--dsh-backup-radius);background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));animation:dsh-backup-shimmer 1.2s ease-in-out infinite}
.dsh-backup-tree-skeleton-line{height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.18));animation:dsh-backup-shimmer 1.2s ease-in-out infinite}
@keyframes dsh-backup-shimmer{0%,100%{opacity:.35}50%{opacity:.7}}
.dsh-backup-tree-item{margin:0;padding:0}
.dsh-backup-tree-row{box-sizing:border-box;display:grid;grid-template-columns:auto minmax(0,1fr) 96px;align-items:center;column-gap:6px;width:100%;min-width:0;min-height:26px;border-radius:var(--dsh-backup-radius)}
.dsh-backup-tree-action:hover{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08))}
.dsh-backup-tree-row input[type=checkbox]{margin:0;accent-color:var(--dsw-alias-state-warn-primary,#f59e0b);cursor:pointer}
.dsh-backup-tree-action{box-sizing:border-box;display:flex;width:100%;gap:6px;align-items:center;min-width:0;padding:3px 8px;color:inherit;font:inherit;text-align:left;background:transparent;border:0;border-radius:var(--dsh-backup-radius)}
button.dsh-backup-tree-action{cursor:pointer}
span.dsh-backup-tree-action{cursor:default}
.dsh-backup-tree-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#d97757);outline-offset:-2px}
.dsh-backup-tree-icon{flex:0 0 auto;color:var(--dsw-alias-state-warn-primary,#f59e0b)}
.dsh-backup-tree-file-icon{flex:0 0 auto}
.dsh-backup-tree-name{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px}
.dsh-backup-tree-size{box-sizing:border-box;justify-self:end;width:96px;padding-right:12px;text-align:right;white-space:nowrap;opacity:.6;font-size:12px;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.dsh-backup-tree-skeleton-icon,.dsh-backup-tree-skeleton-line{animation:none}}
/* 一键还原：导入行内展开，进度中不关闭；校验与恢复由服务端执行。 */
.dsh-backup-restore-inline{margin:0 0 14px;padding:12px 0 12px 72px}
.dsh-backup-restore-fields{display:flex;flex-direction:column;gap:10px}
.dsh-backup-restore-field{display:flex;align-items:center;gap:8px;min-height:34px}
.dsh-backup-restore-label{flex:none;width:52px;opacity:.7;font-size:13px}
.dsh-backup-restore-value{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:13px}
.dsh-backup-restore-input{flex:1;min-width:0;box-sizing:border-box;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:6px;background:transparent;color:inherit;font-size:13px}
.dsh-backup-restore-hint{margin:8px 0 0;opacity:.7;font-size:12px;line-height:1.5}
.dsh-backup-restore-error{margin:8px 0 0;color:#f87171;font-size:12px;line-height:1.5}
.dsh-backup-restore-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px}
.dsh-backup-restore-steps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.dsh-backup-restore-step{display:flex;align-items:center;gap:10px;font-size:13px;opacity:.5}
.dsh-backup-restore-step.is-active{opacity:1;font-weight:500}
.dsh-backup-restore-step.is-done{opacity:.75}
.dsh-backup-restore-dot{box-sizing:border-box;flex:none;width:18px;height:18px;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.5));border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px}
.dsh-backup-restore-step.is-active .dsh-backup-restore-dot{border-color:var(--dsw-alias-text-muted,rgba(160,160,160,.9));background:transparent;color:inherit}
.dsh-backup-restore-step.is-done .dsh-backup-restore-dot{border-color:var(--dsw-alias-state-success-primary,#10b981);color:var(--dsw-alias-state-success-primary,#10b981)}
.dsh-backup-restore-result{margin-top:12px}
.dsh-backup-restore-summary{display:block;opacity:.8;font-size:12px;line-height:1.5}
.dsh-backup-restart{margin:6px 0 0;color:var(--dsw-alias-state-warn-primary,#f59e0b);font-size:12px}
`
