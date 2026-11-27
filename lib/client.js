// 由 scripts/build.mjs 生成，不要手改。
window.__ModuleLoader__.load({
  id: "@6starlong/dsh-plugins",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var __PANEL_MODULES__ = {};

    ;(function () {
      var module = { exports: {} };
      var exports = module.exports;
      const { useSyncExternalStore, useEffect, useState, useRef } = require("react")
      const { jsx, jsxs } = require("react/jsx-runtime")
      const { Input, Button, FileTypeIcon, classifyFileType } = require("@deepseek-ai/dsh-client-ui-primitives")

      // ---- constants.js ----
      /** npm 包名：plugins.bundle.config 的槽位 key。 */
      const PLUGIN_PACKAGE = '@6starlong/dsh-backup'
      /** 配置表单短名：与 cordis.patch.yml 的 id 及根包配置段一致。 */
      const CONFIG_NS = 'dsh-backup'
      /** 本地化命名空间。 */
      const NS = 'settings.backup'
      /** 默认值与 lib/config.js 的 schema 对齐。 */
      const DEFAULT_REPO = ''
      const DEFAULT_INTERVAL_HOURS = 6
      const DEFAULT_AUTO_BACKUP_HOURS = 0
      const DEFAULT_RETENTION = 7
      const DEFAULT_PRESET = ''

      // ---- form.js ----

      /**
       * 把套件条目的表单作用域收敛到某个模块段。
       * SettingsFormModel 只认扁平字段；mutate 的 path 前面补上段路径即可写回嵌套配置。
       */
      function sectionScope(scope, section) {
        // 设置服务的 value/mutate 根就是插件 config 本体，路径直接从段名开始。
        const prefix = [section]
        const pick = value => value === undefined ? undefined : value?.[section]
        return {
          subscribe: cb => scope.subscribe(cb),
          getSnapshot: () => {
            const snap = scope.getSnapshot()
            return { ...snap, value: pick(snap.value), base: pick(snap.base), user: pick(snap.user) }
          },
          mutate: (ops, revision) => scope.mutate(
            ops.map(op => ({ ...op, path: [...prefix, ...op.path] })),
            revision,
          ),
        }
      }

      /**
       * 直写配置卡片控制器：字段按声明的类型读默认值，乐观写入并带 revision 提交。
       * 快照按值缓存，避免 useSyncExternalStore 因新对象无限重渲染。
       */
      class DirectCardController {
        constructor(scope, fields) {
          this.scope = scope
          this.fields = fields
          this.pending = new Map()
          this.failed = new Map()
          this.listeners = new Set()
          this.cached = undefined
          // 宿主镜像追上乐观值后清掉；任何配置变化都把新状态推给卡片。
          this.unsubscribe = scope.subscribe(() => {
            const value = scope.getSnapshot().value || {}
            for (const [field, next] of this.pending) {
              if (value[field] === next) this.pending.delete(field)
            }
            this.emit()
          })
        }
        emit() {
          for (const cb of this.listeners) cb()
        }
        snapshot() {
          const snap = this.scope.getSnapshot()
          const value = snap.value || {}
          const writable = snap.writable !== false
          const failed = this.failed.size > 0
          const state = { writable, failed }
          let changed = this.cached === undefined
            || this.cached.writable !== writable
            || this.cached.failed !== failed
          for (const [field, spec] of Object.entries(this.fields)) {
            const raw = this.pending.has(field) ? this.pending.get(field) : value[field]
            let current
            if (spec.type === 'boolean') {
              current = raw === undefined ? spec.default : raw !== false
            } else if (spec.type === 'string') {
              current = raw === undefined ? spec.default : String(raw)
            } else {
              const parsed = Number(raw ?? spec.default)
              current = Number.isFinite(parsed) ? parsed : spec.default
            }
            if (this.cached === undefined || this.cached[field] !== current) changed = true
            state[field] = current
          }
          if (changed) this.cached = state
          return this.cached
        }
        commit(field, next) {
          this.pending.set(field, next)
          this.failed.delete(field)
          this.emit()
          const fail = () => {
            this.pending.delete(field)
            this.failed.set(field, true)
            this.emit()
          }
          // 直写必须带上当前 revision，否则宿主按过期写入拒绝，乐观值会回滚成默认值。
          const revision = this.scope.getSnapshot().revision
          this.scope.mutate([{ op: 'set', path: [field], value: next }], revision)
            .then(ok => { if (!ok) fail() })
            .catch(fail)
        }
        inject(hookName, actions) {
          const handlers = Object.fromEntries(
            Object.entries(actions).map(([name, field]) => [name, next => this.commit(field, next)]),
          )
          return {
            hooks: {
              [hookName]: {
                subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
                getSnapshot: () => this.snapshot(),
              },
            },
            ...handlers,
          }
        }
        /** 宿主 hook 形状，供 useStore 包装成 React hook。 */
        hook() {
          return {
            subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
            getSnapshot: () => this.snapshot(),
          }
        }
        asHook() {
          const hook = this.hook()
          return selector => useStore(hook, selector)
        }
        dispose() {
          this.unsubscribe()
          this.listeners.clear()
        }
      }

      /** 把宿主 hook 形状转成 React hook；selector 直接透传，快照由控制器缓存。 */
      function useStore(hook, selector) {
        const read = () => {
          const value = hook.getSnapshot()
          return typeof selector === 'function' ? selector(value) : value
        }
        return useSyncExternalStore(hook.subscribe, read, read)
      }

      // ---- messages.js ----
      /** 备份模块文案：由备份包自己注册，根包不再持有备份文案。 */
      const MESSAGES = {
        zh: {
          title: '备份同步',
          description: '按目录勾选与规则打包 ~/.dsh 用户数据，支持命名预设并导出 zip。',
          backupSync: 'GitHub 同步',
          backupSyncDesc: '导出目录与定时同步',
          backupRepo: '目标仓库',
          backupRepoDesc: '导出的 zip 保存目录',
          backupInterval: '同步间隔',
          backupIntervalDesc: '定时打包的间隔小时数',
          backupIntervalSuffix: '小时',
          backupList: '备份预设',
          backupListDesc: '选择纳入备份的文件与目录，支持预设与排除规则',
          backupRegex: '自定义排除规则',
          backupRegexPlaceholder: 'gitignore 风格，逗号或换行分隔',
          backupRegexApply: '应用规则',
          backupRefresh: '刷新目录',
          backupRefreshing: '扫描中…',
          backupEstimate: '预计导出',
          backupEmpty: '暂无可备份内容',
          backupEmptyHint: '扫描完成后可在此勾选纳入项',
          backupPreset: '预设',
          backupPresetName: '预设名称',
          backupSavePreset: '保存',
          backupInclude: '纳入',
          backupExclude: '排除',
          backupRevert: '撤销',
          backupDefaultPreset: '默认',
          backupDeletePreset: '删除',
          backupFolder: '备份文件夹',
          backupFolderDesc: '立即备份与命名预设的保存位置',
          backupReveal: '显示',
          backupExportTitle: '导出备份',
          backupImportTitle: '导入备份',
          backupExport: '导出',
          backupImport: '导入',
          backupImportZip: '导入',
          backupAutoBackup: '自动备份',
          backupAutoBackupDesc: 'DSH 运行期间按间隔备份，关闭后不运行',
          backupAutoOff: '关闭',
          backupHour1: '1小时',
          backupHour6: '6小时',
          backupDay1: '1天',
          backupWeek1: '1周',
          backupRetention: '保留份数',
          backupRetentionDesc: '超出份数的旧备份自动清理，最少 3 份',
          backupVersion: '版本',
          backupVersionsNone: '暂无',
          backupVersionsCount: '份备份',
          backupVersionsLatest: '最新',
          backupBackupNow: '立即备份',
          backupExporting: '导出中…',
          backupError: '导出失败',
          backupRestoreBody: '选择本地备份 zip；先恢复文件，同名覆盖、不删原有文件，按会话同步工作区归属，再按备份依赖清单安装插件。',
          backupRestoreCancel: '取消',
          backupRestoreClose: '关闭',
          backupRestorePhaseVerify: '校验备份包',
          backupRestorePhaseFiles: '恢复文件',
          backupRestorePhaseModules: '安装插件',
          backupRestorePhaseDone: '还原完成',
          backupRestoreFailed: '还原失败',
          backupRestoreFile: '文件',
          backupRestoreUnselected: '未选择文件',
          backupRestoreChoose: '选择...',
          backupRestoring: '还原中…',
          backupReimport: '重新导入',
          backupRestoreNeedFile: '请先选择文件',
          backupPassword: '口令',
          backupPasswordPlaceholder: '留空不加密，推荐 8 位以上',
          backupPasswordConfirm: '确认口令',
          backupPasswordMismatch: '两次口令不一致',
          backupPasswordWrong: '口令错误或备份已损坏',
          backupRestoreRestart: '需重启 DSH 后生效。',
          backupRestoreSummary: '新增 {added} 个文件，覆盖 {overwritten} 个，安装 {installed} 个插件，已合并 workspace.json。',
          backupRestorePluginFailed: '，{count} 个安装失败',
          backupConfigure: '配置',
          backupEdit: '编辑',
        },
      }

      // ---- styles.js ----
      const STYLE = {
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
      const BACKUP_CSS = `
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

      // ---- fields.jsx ----



      /** 天数输入：默认作为独立行；bare 模式只返回控件，交给 SettingRow 排列。 */
      function DaysInput({ label, suffix, value, max, disabled, onCommit, bare }) {
        const input = jsx(Input, {
          type: 'number',
          min: 1,
          max,
          step: 1,
          key: String(value),
          defaultValue: String(value),
          disabled,
          'aria-label': label,
          className: 'dsh-backup-number-input',
          onBlur: event => {
            const parsed = Number.parseInt(event.target.value, 10)
            if (!Number.isFinite(parsed)) {
              event.target.value = String(value)
              return
            }
            const days = Math.min(max, Math.max(1, parsed))
            event.target.value = String(days)
            if (days !== value) onCommit(days)
          },
          onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
        }, 'input')
        const control = jsxs('div', {
          className: 'dsh-backup-field-control',
          children: [input, jsx('span', { className: 'dsh-backup-field-suffix', children: suffix }, 'suffix')],
        }, 'control')
        if (bare) return control
        return jsxs('div', {
          className: 'dsh-backup-field-row',
          children: [jsx('span', { className: 'dsh-backup-field-label', children: label }, 'label'), control],
        }, 'days')
      }

      /** 文本输入：失焦或回车提交；bare 模式只返回控件。 */
      function TextInput({ label, value, disabled, onCommit, bare }) {
        const input = jsx(Input, {
          type: 'text',
          key: value,
          defaultValue: value,
          disabled,
          'aria-label': label,
          className: 'dsh-backup-text-input',
          onBlur: event => {
            const next = event.target.value.trim()
            if (next && next !== value) onCommit(next)
            else event.target.value = value
          },
          onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
        }, 'input')
        if (bare) return input
        return jsxs('div', {
          className: 'dsh-backup-field-row',
          children: [jsx('span', { className: 'dsh-backup-field-label', children: label }, 'label'), input],
        }, 'text')
      }

      /** 多行词表输入：失焦提交，改动即写配置。 */
      function TextAreaInput({ label, value, disabled, onCommit }) {
        return jsxs('div', {
          style: { marginTop: '12px' },
          children: [
            jsx('div', { style: { ...STYLE.label, fontSize: '13px', marginBottom: '4px' }, children: label }, 'label'),
            jsx('textarea', {
              key: value,
              defaultValue: value,
              disabled,
              rows: 2,
              'aria-label': label,
              style: {
                width: '100%', boxSizing: 'border-box', padding: '6px 8px',
                border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
                borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
                color: 'inherit', font: 'inherit', fontSize: '12px', resize: 'vertical',
              },
              onBlur: event => {
                const next = event.target.value.trim()
                if (next !== value) onCommit(next)
                else event.target.value = value
              },
            }, 'input'),
          ],
        })
      }

      // ---- components/SettingRow.jsx ----

      /** 统一设置行：左侧标题与描述，右侧表单控件。 */
      function SettingRow({ label, description, control, onClick, expanded }) {
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

      // ---- components/RestoreOverlay.jsx ----


      /** 一键还原：导入行内展开的提示与步骤，校验与恢复由服务端真实执行。 */
      const PHASES = ['backupRestorePhaseVerify', 'backupRestorePhaseFiles', 'backupRestorePhaseModules', 'backupRestorePhaseDone']

      function RestoreOverlay({ t, open, phase, result, error, onClose }) {
        const done = phase >= PHASES.length - 1
        const failed = phase === -2
        const busy = phase >= 0 && !done && !failed

        // 进度中不响应 Esc，避免长任务被误关。
        useEffect(() => {
          if (!open) return undefined
          const onKeyDown = event => { if (event.key === 'Escape' && !busy) onClose() }
          document.addEventListener('keydown', onKeyDown)
          return () => document.removeEventListener('keydown', onKeyDown)
        }, [open, busy, onClose])

        if (!open) return null
        const plugins = result?.plugins ?? {}
        const installFailed = plugins.failed?.length ?? 0
        const summary = result
          ? t('backupRestoreSummary')
              .replace('{added}', String(result.written ?? 0))
              .replace('{overwritten}', String(result.overwritten ?? 0))
              .replace('{installed}', String(plugins.installed ?? 0)) +
            (installFailed > 0 ? t('backupRestorePluginFailed').replace('{count}', String(installFailed)) : '')
          : ''
        return jsxs('div', {
          className: 'dsh-backup-restore-panel',
          children: [
            jsx('ul', {
              className: 'dsh-backup-restore-steps',
              children: PHASES.map((key, i) => {
                const finished = i < phase || done
                return jsxs('li', {
                  className: 'dsh-backup-restore-step' + (finished ? ' is-done' : '') + (i === phase && !done ? ' is-active' : ''),
                  children: [
                    jsx('span', { className: 'dsh-backup-restore-dot', children: finished ? '✓' : '' }, 'dot-' + i),
                    jsx('span', { children: t(key) }, 'label-' + i),
                  ],
                }, 'step-' + i)
              }),
            }, 'steps'),
            failed ? jsx('p', { className: 'dsh-backup-restore-error', role: 'alert', children: t('backupRestoreFailed') + '：' + (error || '') }, 'error') : null,
            done ? jsxs('div', {
              className: 'dsh-backup-restore-result',
              children: [
                jsx('span', { className: 'dsh-backup-restore-summary', children: summary }, 'summary'),
                jsx('p', { className: 'dsh-backup-restart', children: t('backupRestoreRestart') }, 'restart'),
              ],
            }, 'result') : null,
          ],
        })
      }

      // ---- components/DisclosureRow.jsx ----


      /** 折叠行：左侧固定标题与描述，右侧配置区按钮才触发展开。 */
      function DisclosureRow({ label, description, open, onToggle, actionLabel, control, children }) {
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

      // ---- api.js ----
      /** 本地备份端点与同源头：与服务端包 packages/dsh-backup/lib/index.js 对齐。 */
      const BACKUP_EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
      const BACKUP_TOKEN_HEADER = 'x-starlong-backup'
      const BACKUP_TREE_ROUTE = '/api/starlong/dsh-backup/tree'
      const BACKUP_PRESET_ROUTE = '/api/starlong/dsh-backup/preset'
      const BACKUP_REVEAL_ROUTE = '/api/starlong/dsh-backup/reveal'
      const BACKUP_VERSIONS_ROUTE = '/api/starlong/dsh-backup/versions'
      const BACKUP_VERIFY_ROUTE = '/api/starlong/dsh-backup/verify'
      const BACKUP_RESTORE_STREAM_ROUTE = '/api/starlong/dsh-backup/restore-stream'
      const BACKUP_UPLOAD_ROUTE = '/api/starlong/dsh-backup/upload'

      /** 把根绝对路径端点挂到页面 base 下，兼容带路径前缀的反向代理。 */
      function resolveApiUrl(path) {
        if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return path
        const doc = typeof document === 'undefined' ? undefined : document
        const base = doc?.baseURI
        if (typeof base !== 'string' || base === '') return path
        try {
          const url = new URL(base)
          const lastSlash = url.pathname.lastIndexOf('/')
          const last = url.pathname.slice(lastSlash + 1)
          if (/\.(html?|php|aspx?|jsp)$/i.test(last)) url.pathname = url.pathname.slice(0, lastSlash + 1)
          else if (!url.pathname.endsWith('/')) url.pathname += '/'
          return new URL(path.slice(1), url.href).href
        } catch { return path }
      }

      // ---- components/SegmentedControl.jsx ----

      /** 分段单选：选项为 [{ value, label }]，值相等的那段高亮。 */
      function SegmentedControl({ options, value, onChange, disabled, label }) {
        return jsx('div', {
          className: 'dsh-backup-segmented',
          role: 'group',
          'aria-label': label,
          children: options.map(option => jsx('button', {
            key: String(option.value),
            type: 'button',
            className: 'dsh-backup-segment' + (option.value === value ? ' is-active' : ''),
            'aria-pressed': option.value === value,
            disabled: !!disabled,
            onClick: () => onChange?.(option.value),
            children: option.label,
          }, 'seg-' + option.value)),
        })
      }

      // ---- BackupPanel.jsx ----










      /** 体积显示：保留一位小数，避免长数字撑破布局。 */
      function formatBytes(bytes) {
        const n = Number(bytes) || 0
        if (n < 1024) return n + ' B'
        const units = ['KB', 'MB', 'GB', 'TB']
        let value = n / 1024
        let i = 0
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
        return value.toFixed(1) + ' ' + units[i]
      }

      /** 最近备份时间：当天只显示时分，跨天显示完整日期时间。 */
      function formatBackupTime(iso) {
        if (!iso) return ''
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) return ''
        const pad = n => String(n).padStart(2, '0')
        const now = new Date()
        const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
        const hm = pad(date.getHours()) + ':' + pad(date.getMinutes())
        return sameDay ? hm : date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + hm
      }

      /** 把内部规则名翻成人话；完整规则放 title 供排查。 */
      function reasonLabel(reason) {
        const s = String(reason || '')
        const i = s.indexOf(':')
        const key = i < 0 ? s : s.slice(0, i)
        return {
          override: '手动排除', regex: '自定义规则', clientDir: '客户端运行目录',
          dependency: '依赖目录', pathSegment: '可再生目录',
          extension: '可再生文件', namePattern: '临时或锁文件', backupArchive: '备份产物',
        }[key] || '已排除'
      }

      /** 备份同步卡片：开关 + 目录树勾选 + 正则 + 命名预设 + 本地导出。 */
      function BackupPanel(props) {
        const { t, useBackupCard } = props
        const state = useBackupCard(snapshot => snapshot)
        const [treeData, setTreeData] = useState({})
        const [summary, setSummary] = useState(null)
        const [expanded, setExpanded] = useState({})
        const [overrides, setOverrides] = useState({})
        const [regex, setRegex] = useState('')
        const [regexDraft, setRegexDraft] = useState('')
        const [presets, setPresets] = useState([])
        const [presetName, setPresetName] = useState('')
        const [presetOpen, setPresetOpen] = useState(false)
        const [presetDraft, setPresetDraft] = useState('')
        const [loading, setLoading] = useState(false)
        const [exporting, setExporting] = useState(false)
        const [exportOpen, setExportOpen] = useState(false)
        const [exportPassword, setExportPassword] = useState('')
        const [exportConfirm, setExportConfirm] = useState('')
        const [exportError, setExportError] = useState('')
        const [backingUp, setBackingUp] = useState(false)
        const [restoreOpen, setRestoreOpen] = useState(false)
        const [restorePhase, setRestorePhase] = useState(-1)
        const [restoreResult, setRestoreResult] = useState(null)
        const [restoreError, setRestoreError] = useState('')
        const [restoreFileName, setRestoreFileName] = useState('')
        const [restorePassword, setRestorePassword] = useState('')
        const [restoreStarted, setRestoreStarted] = useState(false)
        const [restoreValidated, setRestoreValidated] = useState(false)
        const restoreStartedRef = useRef(false)
        const fileInputRef = useRef(null)
        const restoreFileRef = useRef(null)
        const [versions, setVersions] = useState({ count: 0, latest: null })
        const [error, setError] = useState(null)
        const [sectionOpen, setSectionOpen] = useState({})
        const treeBoxRef = useRef(null)
        const [treeHeight, setTreeHeight] = useState(null)
        const toggleSection = key => setSectionOpen(prev => ({ ...prev, [key]: !prev[key] }))
        const iconKindForRel = rel => {
          for (const nodes of Object.values(treeData)) {
            const node = (nodes || []).find(item => item.rel === rel)
            if (node) return node.kind === 'directory' ? 'folder' : classifyFileType(node.name)
          }
          return classifyFileType(rel.split(/[\\/]/).pop() || rel)
        }

        useEffect(() => {
          let cancelled = false
          const boot = async () => {
            // 选中预设时交给下面的回读 effect 加载，避免空规则树请求覆盖预设树
            if (state.preset) return
            setLoading(true)
            try {
              const res = await fetch(resolveApiUrl(BACKUP_TREE_ROUTE), {
                method: 'POST',
                headers: { 'content-type': 'application/json', [BACKUP_TOKEN_HEADER]: '1' },
                body: JSON.stringify({ path: '', overrides: {}, regex: '' }),
              })
              const data = await res.json().catch(() => ({}))
              if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
              if (cancelled) return
              setTreeData({ '': data.nodes || [] })
              setSummary(data.stats || null)
              setPresets(data.presets || [])
            } catch (e) { if (!cancelled) setError(e?.message || '') }
            finally { if (!cancelled) setLoading(false) }
          }
          void boot()
          return () => { cancelled = true }
        }, [])

        const request = async (route, body) => {
          const res = await fetch(resolveApiUrl(route), {
            method: 'POST',
            headers: { 'content-type': 'application/json', [BACKUP_TOKEN_HEADER]: '1' },
            body: JSON.stringify(body),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data?.ok !== true) {
            const err = new Error(data?.error || String(res.status))
            err.code = data?.code
            throw err
          }
          return data
        }
        const uploadFile = async file => {
          const res = await fetch(resolveApiUrl(BACKUP_UPLOAD_ROUTE), {
            method: 'POST',
            headers: { 'content-type': 'application/octet-stream', [BACKUP_TOKEN_HEADER]: '1' },
            body: file,
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
          return data
        }
        const streamRestore = async (payload, onStage) => {
          const res = await fetch(resolveApiUrl(BACKUP_RESTORE_STREAM_ROUTE), {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'accept': 'text/event-stream', [BACKUP_TOKEN_HEADER]: '1' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || String(res.status))
          }
          const reader = res.body?.getReader?.()
          if (!reader) throw new Error('当前环境不支持流式读取')
          const decoder = new TextDecoder()
          let buffer = ''
          let finalResult = null
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let at
            while ((at = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, at)
              buffer = buffer.slice(at + 2)
              const lines = block.split('\n')
              const event = (lines.find(line => line.startsWith('event:')) || '').slice(6).trim() || 'message'
              const raw = (lines.find(line => line.startsWith('data:')) || '').slice(5).trim()
              if (!raw) continue
              const data = JSON.parse(raw)
              if (event === 'stage') onStage?.(data.phase)
              else if (event === 'done') finalResult = data.result
              else if (event === 'error') {
                const err = new Error(data.error || '还原失败')
                err.code = data.code
                throw err
              }
            }
          }
          if (!finalResult) throw new Error('还原结束但未返回结果')
          return finalResult
        }
        const loadVersions = async () => {
          try {
            const data = await request(BACKUP_VERSIONS_ROUTE, {})
            setVersions({ count: data.count || 0, latest: data.latest || null })
          } catch { /* 版本概览失败不影响设置页 */ }
        }
        useEffect(() => { void loadVersions() }, [])
        // 原生文件选择器选 zip；会话内 pathFor 拿不到真实路径，保留 File 供上传字节。
        const pickRestoreFile = event => {
          const input = event?.target
          const file = input?.files?.[0]
          if (input) input.value = ''
          resetRestore()
          if (!file) return
          if (!/\.zip$/i.test(file.name || '')) {
            setRestoreError('请选择 zip 备份文件')
            setRestorePhase(-2)
            setRestoreOpen(true)
            return
          }
          restoreFileRef.current = file
          setRestoreFileName(file.name)
          setRestoreOpen(true)
        }
        const toggleRestoreRow = () => {
          if (restoreOpen) {
            if (restoreBusy) return
            setRestoreOpen(false)
            return
          }
          resetRestore()
          setRestoreOpen(true)
        }
        const resetRestore = () => {
          restoreFileRef.current = null
          restoreStartedRef.current = false
          setRestoreFileName('')
          setRestorePassword('')
          setRestoreStarted(false)
          setRestoreValidated(false)
          setRestoreError('')
          setRestoreResult(null)
          setRestorePhase(-1)
        }
        const verifyRestore = async path => {
          setRestoreValidated(false)
          try {
            await request(BACKUP_VERIFY_ROUTE, { path, password: restorePassword || undefined, passwordOnly: true })
            return true
          } catch (e) {
            setRestoreError(e?.code === 'password' ? t('backupPasswordWrong') : (e?.message || String(e)))
            setRestorePhase(-2)
            return false
          }
        }
        const runRestore = async () => {
          const file = restoreFileRef.current
          if (!file || restoreStartedRef.current) return
          restoreStartedRef.current = true
          setRestoreStarted(true)
          setRestoreError('')
          setRestoreResult(null)
          setRestorePhase(0)
          try {
            const uploaded = await uploadFile(file)
            if (!await verifyRestore(uploaded.path)) {
              restoreStartedRef.current = false
              setRestoreStarted(false)
              return
            }
            setRestoreValidated(true)
            const payload = { path: uploaded.path, password: restorePassword || undefined }
            const result = await streamRestore(payload, phase => {
              if (phase < 3) setRestorePhase(phase)
            })
            setRestoreResult(result)
            setRestorePhase(3)
          } catch (e) {
            setRestoreError(e?.code === 'password' ? t('backupPasswordWrong') : (e?.message || String(e)))
            setRestorePhase(-2)
            setRestoreStarted(false)
          } finally {
            restoreStartedRef.current = false
          }
        }
        const closeRestore = () => { setRestoreOpen(false) }
        const restoreBusy = restoreStarted && restorePhase < 3
        useEffect(() => {
          const active = state.preset || ''
          if (active && active !== presetName) {
            setPresetName(active)
            void loadPreset(active)
          }
        }, [state.preset])

        const loadChildren = async (path, ov, rg) => {
          const data = await request(BACKUP_TREE_ROUTE, { path, overrides: ov, regex: rg })
          setTreeData(prev => ({ ...prev, [path]: data.nodes || [] }))
          setPresets(data.presets || [])
        }
        const reloadAll = async (ov, rg) => {
          setTreeHeight(treeBoxRef.current?.offsetHeight ?? null)
          setLoading(true)
          setError(null)
          try {
            const data = await request(BACKUP_TREE_ROUTE, { path: '', overrides: ov, regex: rg })
            const next = { '': data.nodes || [] }
            for (const path of Object.keys(expanded)) {
              if (path !== '') {
                const sub = await request(BACKUP_TREE_ROUTE, { path, overrides: ov, regex: rg })
                next[path] = sub.nodes || []
              }
            }
            setTreeData(next)
            setSummary(data.stats || null)
            setPresets(data.presets || [])
          } catch (e) { setError(e?.message || '') }
          finally { setLoading(false); setTreeHeight(null) }
        }
        const toggleNode = async node => {
          const next = { ...overrides }
          const prefix = node.rel + '/'
          if (!node.included) {
            // 纳入时清掉子树内更精确的排除覆盖，否则半勾父节点勾选后仍是半勾
            next[node.rel] = true
            for (const key of Object.keys(next)) {
              if (key !== node.rel && key.startsWith(prefix) && next[key] === false) delete next[key]
            }
          } else {
            next[node.rel] = false
          }
          setOverrides(next)
          await reloadAll(next, regex)
        }
        const toggleExpand = async node => {
          if (node.kind !== 'directory') return
          const was = !!expanded[node.rel]
          setExpanded(prev => ({ ...prev, [node.rel]: !was }))
          if (was || treeData[node.rel]) return
          try { await loadChildren(node.rel, overrides, regex) } catch (e) { setError(e?.message || '') }
        }
        const applyRegex = () => {
          if (regexDraft === regex) return
          setRegex(regexDraft)
          void reloadAll(overrides, regexDraft)
        }
        const savePreset = async () => {
          const name = presetDraft.trim()
          if (!name) return
          try {
            const data = await request(BACKUP_PRESET_ROUTE, { action: 'save', name, overrides, regex: regexDraft })
            setPresets(data.presets || [])
            setPresetName(name)
            props.setBackupPreset?.(name)
          } catch (e) { setError(e?.message || '') }
        }
        const loadPreset = async name => {
          const target = name ?? presetName
          if (!target) {
            setOverrides({}); setRegex(''); setRegexDraft(''); setExpanded({})
            props.setBackupPreset?.('')
            await reloadAll({}, '')
            return
          }
          try {
            const data = await request(BACKUP_PRESET_ROUTE, { action: 'load', name: target })
            const ov = data.overrides || {}
            const rg = data.regex || ''
            setOverrides(ov); setRegex(rg); setRegexDraft(rg); setExpanded({})
            props.setBackupPreset?.(target)
            await reloadAll(ov, rg)
          } catch (e) { setError(e?.message || '') }
        }
        const removeOverride = async key => {
          const next = { ...overrides }
          delete next[key]
          setOverrides(next)
          await reloadAll(next, regex)
        }
        const deletePreset = async () => {
          if (!presetName) return
          try {
            const data = await request(BACKUP_PRESET_ROUTE, { action: 'delete', name: presetName })
            setPresets(data.presets || [])
            setPresetName('')
            props.setBackupPreset?.('')
          } catch (e) { setError(e?.message || '') }
        }
        const revealFolder = async () => {
          try { await request(BACKUP_REVEAL_ROUTE, {}) } catch (e) { setError(e?.message || '') }
        }
        const pickDirectory = async () => {
          const picker = globalThis.__DSH_DIRECTORY_PICKER__
          if (picker && typeof picker.pick === 'function') return picker.pick()
          throw new Error('目录选择器不可用')
        }
        const runExport = async () => {
          if (exporting) return
          let dir
          try { dir = await pickDirectory() } catch (e) { setError(e?.message || '目录选择器不可用'); return }
          if (!dir) return
          setExporting(true)
          setError(null)
          try {
            await request(BACKUP_EXPORT_ROUTE, { overrides, regex, preset: presetName || undefined, dir, password: exportPassword || undefined })
            await loadVersions()
          } catch (e) { setError(e?.message || '') }
          finally { setExporting(false) }
        }
        const toggleExportRow = () => {
          if (exporting) return
          if (exportOpen) { setExportOpen(false); return }
          setExportPassword('')
          setExportConfirm('')
          setExportError('')
          setExportOpen(true)
        }
        const confirmExport = () => {
          if (exportPassword !== exportConfirm) { setExportError(t('backupPasswordMismatch')); return }
          setExportError('')
          void runExport()
        }
        const runBackupNow = async () => {
          if (backingUp) return
          setBackingUp(true)
          setError(null)
          try {
            await request(BACKUP_EXPORT_ROUTE, { overrides, regex, preset: presetName || undefined })
            await loadVersions()
          } catch (e) { setError(e?.message || '') }
          finally { setBackingUp(false) }
        }
        const renderNode = (node, depth) => jsxs('div', {
          key: node.rel,
          className: 'dsh-backup-tree-item',
          children: [
            jsxs('div', {
              className: 'dsh-backup-tree-row',
              style: { paddingLeft: depth * 18 },
              children: [
                jsx('input', {
                  type: 'checkbox', checked: node.included,
                  ref: el => { if (el) el.indeterminate = !!node.partial },
                  onChange: () => toggleNode(node),
                  onClick: event => event.stopPropagation(),
                  'aria-label': node.rel,
                  title: node.partial ? '部分子项未纳入（复合态）' : undefined,
                }, 'check'),
                node.kind === 'directory'
                  ? jsxs('button', {
                    type: 'button',
                    className: 'dsh-backup-tree-action',
                    'aria-expanded': !!expanded[node.rel],
                    onClick: () => toggleExpand(node),
                    children: [
                      jsx(FileTypeIcon, { kind: 'folder', size: 14, className: 'dsh-backup-tree-icon' }, 'folder'),
                      jsx('span', {
                        className: 'dsh-backup-tree-name',
                        style: { opacity: node.included ? 1 : 0.55 },
                        title: node.reason && !node.included ? node.rel + '\n' + reasonLabel(node.reason) : node.rel,
                        children: node.name,
                      }, 'name'),
                    ],
                  }, 'label')
                  : jsxs('span', {
                    className: 'dsh-backup-tree-action',
                    'aria-disabled': true,
                    children: [
                      jsx(FileTypeIcon, { kind: classifyFileType(node.name), size: 14, className: 'dsh-backup-tree-file-icon' }, 'file-icon'),
                      jsx('span', {
                        className: 'dsh-backup-tree-name',
                        style: { opacity: node.included ? 1 : 0.55 },
                        title: node.reason && !node.included ? node.rel + '\n' + reasonLabel(node.reason) : node.rel,
                        children: node.name,
                      }, 'name'),
                    ],
                  }, 'label'),
                jsx('span', { className: 'dsh-backup-tree-size', children: formatBytes(node.size) }, 'size'),
              ],
            }, 'row'),
          ],
        })
        const renderTree = (nodes, depth) => (nodes || []).map(node => jsxs('div', {
          key: node.rel,
          children: [
            renderNode(node, depth),
            node.kind === 'directory' && expanded[node.rel] ? renderTree(treeData[node.rel], depth + 1) : null,
          ],
        }, 'branch'))
        const presetControl = jsxs('div', {
          className: 'dsh-backup-select',
          onBlur: ev => { if (!ev.currentTarget.contains(ev.relatedTarget)) setPresetOpen(false) },
          children: [
            jsxs('button', {
              type: 'button', className: 'dsh-backup-select-trigger',
              'aria-haspopup': 'listbox', 'aria-expanded': presetOpen,
              onClick: () => setPresetOpen(v => !v),
              children: [
                jsx('span', { children: presetName || t('backupDefaultPreset') }, 'label'),
                jsx('span', { className: 'dsh-backup-select-caret', children: '▾' }, 'caret'),
              ],
            }, 'trigger'),
            presetOpen ? jsx('div', {
              className: 'dsh-backup-select-menu', role: 'listbox',
              children: [
                jsx('button', {
                  key: '__default__', type: 'button', role: 'option', 'aria-selected': !presetName,
                  className: 'dsh-backup-select-option' + (!presetName ? ' is-selected' : ''),
                  onClick: () => { setPresetOpen(false); setPresetName(''); void loadPreset('') },
                  children: t('backupDefaultPreset'),
                }, 'opt-default'),
                ...presets.map(n => jsx('button', {
                  key: n, type: 'button', role: 'option', 'aria-selected': n === presetName,
                  className: 'dsh-backup-select-option' + (n === presetName ? ' is-selected' : ''),
                  onClick: () => { setPresetOpen(false); setPresetName(n); void loadPreset(n) },
                  children: n,
                }, 'opt-' + n)),
              ],
            }, 'menu') : null,
          ],
        }, 'preset-select-control')
        return jsxs('div', {
          className: 'dsh-backup-form',
          children: [
            state.failed ? jsx('p', { className: 'dsh-backup-form-note', style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
            jsx(DisclosureRow, {
              label: t('backupSync'),
              description: t('backupSyncDesc'),
              open: !!sectionOpen.sync,
              onToggle: () => toggleSection('sync'),
              actionLabel: sectionOpen.sync ? t('backupRestoreClose') : t('backupEdit'),
              children: jsxs('div', {
                className: 'dsh-backup-sync-body',
                children: [
                  jsx(SettingRow, {
                    label: t('backupRepo'),
                    description: t('backupRepoDesc'),
                    control: jsx(TextInput, { label: t('backupRepo'), value: state.repo, disabled: !state.writable, onCommit: props.setBackupRepo, bare: true }, 'repo-input'),
                  }, 'repo-row'),
                  jsx(SettingRow, {
                    label: t('backupInterval'),
                    description: t('backupIntervalDesc'),
                    control: jsx(DaysInput, { label: t('backupInterval'), suffix: t('backupIntervalSuffix'), value: state.intervalHours, max: 168, disabled: !state.writable, onCommit: props.setBackupInterval, bare: true }, 'interval-input'),
                  }, 'interval-row'),
                ],
              }, 'sync-body'),
            }, 'sync-disclosure'),
            jsx(DisclosureRow, {
              label: t('backupList'),
              description: t('backupListDesc'),
              open: !!sectionOpen.tree,
              onToggle: () => toggleSection('tree'),
              actionLabel: sectionOpen.tree ? t('backupRestoreClose') : t('backupConfigure'),
              control: presetControl,
              children: jsxs('div', {
                className: 'dsh-backup-combined-body',
                children: [
                  jsxs('div', {
                    className: 'dsh-backup-combined-section',
                    children: [
                  jsxs('div', {
                    className: 'dsh-backup-preset-save-row',
                    children: [
                      jsx('span', { className: 'dsh-backup-preset-label', children: t('backupPreset') }, 'preset-label'),
                      jsxs('div', {
                        className: 'dsh-backup-preset-controls',
                        children: [
                          jsx(Input, {
                            type: 'text', value: presetDraft, onChange: e => setPresetDraft(e.target.value),
                            placeholder: t('backupPresetName'), 'aria-label': t('backupPresetName'),
                            className: 'dsh-backup-preset-name',
                          }, 'preset-draft'),
                          jsx(Button, { variant: 'outline', size: 'sm', className: 'dsh-backup-preset-save', onClick: savePreset, children: t('backupSavePreset') }, 'preset-save'),
                          presetName ? jsx(Button, { variant: 'ghost', size: 'sm', className: 'dsh-backup-danger-text', onClick: deletePreset, children: t('backupDeletePreset') }, 'preset-delete') : null,
                        ],
                      }, 'preset-controls'),
                    ],
                  }, 'preset-save-row'),
                      jsxs('div', {
                        className: 'dsh-backup-tree-head',
                        children: [
                          jsxs('div', {
                            className: 'dsh-backup-tree-head-actions',
                            children: [
                              jsx(Button, {
                                variant: 'outline', size: 'sm', disabled: loading,
                                onClick: () => reloadAll(overrides, regex),
                                children: loading ? t('backupRefreshing') : t('backupRefresh'),
                              }, 'refresh'),
                            ],
                          }, 'tree-actions'),
                          jsx('span', { className: 'dsh-backup-tree-estimate', children: summary ? t('backupEstimate') + ' ' + formatBytes(summary.includeBytes) : t('backupEstimate') + ' …' }, 'estimate'),
                        ],
                      }, 'tree-head'),
                      jsx('div', {
                        className: 'dsh-backup-tree-box',
                        ref: treeBoxRef,
                        style: treeHeight !== null ? { height: treeHeight } : undefined,
                        children: loading
                          ? jsxs('div', { className: 'dsh-backup-tree-skeleton', 'aria-hidden': true, children: [70, 54, 76, 48, 62].map((w, i) => jsxs('div', { className: 'dsh-backup-tree-skeleton-row', children: [jsx('span', { className: 'dsh-backup-tree-skeleton-icon' }, 'icon'), jsx('span', { className: 'dsh-backup-tree-skeleton-line', style: { width: w + '%' } }, 'line')] }, 'sk-' + i)) }, 'skeleton')
                          : (treeData[''] || []).length
                            ? renderTree(treeData[''], 0)
                            : jsxs('div', { className: 'dsh-backup-tree-empty', children: [jsx(FileTypeIcon, { kind: 'folder', size: 28, className: 'dsh-backup-tree-empty-icon' }, 'empty-icon'), jsx('span', { children: t('backupEmpty') }, 'empty-title'), jsx('span', { className: 'dsh-backup-tree-empty-hint', children: t('backupEmptyHint') }, 'empty-hint')] }, 'tree-empty'),
                      }, 'tree'),
                      Object.keys(overrides).length ? jsxs('div', {
                        className: 'dsh-backup-tree-adjusted',
                        children: Object.entries(overrides).map(([rel, inc]) => jsxs('div', {
                          key: rel,
                          className: 'dsh-backup-tree-adjusted-row',
                          children: [
                            jsx(FileTypeIcon, { kind: iconKindForRel(rel), size: 14, className: 'dsh-backup-tree-file-icon' }, 'adjusted-icon-' + rel),
                            jsx('span', {
                              title: rel,
                              className: 'dsh-backup-tree-adjusted-name',
                              children: rel,
                            }, 'adjusted-rel-' + rel),
                            jsx('span', {
                              className: inc ? 'dsh-backup-tree-adjusted-state is-in' : 'dsh-backup-tree-adjusted-state is-out',
                              children: inc ? t('backupInclude') : t('backupExclude'),
                            }, 'adjusted-state-' + rel),
                            jsx('button', {
                              type: 'button', className: 'dsh-backup-tree-revert',
                              disabled: loading,
                              onClick: () => removeOverride(rel),
                              children: t('backupRevert'),
                            }, 'adjusted-revert-' + rel),
                          ],
                        }, 'adjusted-' + rel)),
                      }, 'adjusted-inline') : null,
                    ],
                  }, 'tree-section'),
                  jsxs('div', {
                    className: 'dsh-backup-regex-row',
                    children: [
                      jsx('div', { className: 'dsh-backup-regex-label', children: t('backupRegex') }, 'regex-label'),
                      jsxs('div', {
                        className: 'dsh-backup-regex-control',
                        children: [
                          jsx('textarea', {
                            value: regexDraft, rows: 2,
                            'aria-label': t('backupRegex'), placeholder: t('backupRegexPlaceholder'),
                            className: 'dsh-backup-regex-input',
                            onChange: e => setRegexDraft(e.target.value),
                          }, 'regex'),
                          jsx(Button, {
                            variant: 'outline', size: 'sm',
                            disabled: loading || regexDraft === regex,
                            onClick: applyRegex,
                            children: t('backupRegexApply'),
                          }, 'regex-apply'),
                        ],
                      }, 'regex-control'),
                    ],
                  }, 'regex-row'),
                ],
              }, 'combined-body'),
            }, 'tree-disclosure'),
            jsx(SettingRow, {
              label: t('backupExportTitle'),
              control: exportOpen
                ? jsx(Button, { variant: 'ghost', size: 'sm', disabled: exporting, onClick: toggleExportRow, children: t('backupRestoreClose') }, 'close')
                : jsx(Button, { variant: 'ghost', size: 'sm', onClick: toggleExportRow, children: t('backupExport') }, 'export'),
            }, 'export-row'),
            exportOpen ? jsxs('div', {
              className: 'dsh-backup-restore-inline',
              children: [
                jsxs('div', {
                  className: 'dsh-backup-restore-fields',
                  children: [
                    jsx('div', {
                      className: 'dsh-backup-restore-field',
                      children: [
                        jsx('span', { className: 'dsh-backup-restore-label', children: t('backupPassword') }, 'password-label'),
                        jsx('input', {
                          type: 'password',
                          className: 'dsh-backup-restore-input',
                          placeholder: t('backupPasswordPlaceholder'),
                          value: exportPassword,
                          disabled: exporting,
                          onChange: event => setExportPassword(event.target.value),
                        }, 'password-input'),
                      ],
                    }, 'password-field'),
                    jsx('div', {
                      className: 'dsh-backup-restore-field',
                      children: [
                        jsx('span', { className: 'dsh-backup-restore-label', children: t('backupPasswordConfirm') }, 'confirm-label'),
                        jsx('input', {
                          type: 'password',
                          className: 'dsh-backup-restore-input',
                          placeholder: t('backupPasswordPlaceholder'),
                          value: exportConfirm,
                          disabled: exporting,
                          onChange: event => setExportConfirm(event.target.value),
                        }, 'confirm-input'),
                      ],
                    }, 'confirm-field'),
                  ],
                }, 'fields'),
                exportError ? jsx('p', { className: 'dsh-backup-restore-error', role: 'alert', children: exportError }, 'error') : null,
                jsx('div', {
                  className: 'dsh-backup-restore-actions',
                  children: [
                    jsx(Button, { variant: 'ghost', size: 'sm', disabled: exporting, onClick: toggleExportRow, children: t('backupRestoreCancel') }, 'cancel'),
                    jsx(Button, {
                      variant: 'outline', size: 'sm', disabled: exporting || !state.writable,
                      onClick: confirmExport,
                      children: exporting ? t('backupExporting') : t('backupExport'),
                    }, 'export'),
                  ],
                }, 'actions'),
              ],
            }, 'export-inline') : null,
            jsx(SettingRow, {
              label: t('backupImportTitle'),
              control: restoreOpen
                ? jsx(Button, { variant: 'ghost', size: 'sm', disabled: restoreBusy, onClick: toggleRestoreRow, children: t('backupRestoreClose') }, 'close')
                : jsx(Button, { variant: 'ghost', size: 'sm', onClick: toggleRestoreRow, children: t('backupImportZip') }, 'import'),
            }, 'import-row'),
            restoreOpen ? jsxs('div', {
              className: 'dsh-backup-restore-inline',
              children: [
                jsx('input', { ref: fileInputRef, type: 'file', accept: '.zip', style: { display: 'none' }, onChange: pickRestoreFile }, 'file-input'),
                jsxs('div', {
                  className: 'dsh-backup-restore-fields',
                  children: [
                    jsx('div', {
                      className: 'dsh-backup-restore-field',
                      children: [
                        jsx('span', { className: 'dsh-backup-restore-label', children: t('backupRestoreFile') }, 'label'),
                        jsx('span', { className: 'dsh-backup-restore-value', title: restoreFileName || undefined, children: restoreFileName || t('backupRestoreUnselected') }, 'value'),
                        jsx(Button, { variant: 'ghost', size: 'sm', disabled: restoreBusy, onClick: () => fileInputRef.current?.click(), children: t('backupRestoreChoose') }, 'choose'),
                      ],
                    }, 'file-field'),
                    jsx('div', {
                      className: 'dsh-backup-restore-field',
                      children: [
                        jsx('span', { className: 'dsh-backup-restore-label', children: t('backupPassword') }, 'password-label'),
                        jsx('input', {
                          type: 'password',
                          className: 'dsh-backup-restore-input',
                          placeholder: t('backupPasswordPlaceholder'),
                          value: restorePassword,
                          disabled: restoreBusy,
                          onChange: event => setRestorePassword(event.target.value),
                        }, 'password-input'),
                      ],
                    }, 'password-field'),
                  ],
                }, 'fields'),
                jsx('p', { className: 'dsh-backup-restore-hint', children: t('backupRestoreBody') }, 'hint'),
                !restoreStarted && restoreError ? jsx('p', { className: 'dsh-backup-restore-error', role: 'alert', children: restoreError }, 'pre-error') : null,
                restoreStarted && restoreValidated ? jsx(RestoreOverlay, {
                  t, open: restoreOpen, phase: restorePhase,
                  result: restoreResult, error: restoreError, onClose: closeRestore,
                }, 'restore-overlay') : null,
                jsx('div', {
                  className: 'dsh-backup-restore-actions',
                  children: [
                    jsx(Button, { variant: 'ghost', size: 'sm', disabled: restoreBusy, onClick: closeRestore, children: t('backupRestoreCancel') }, 'cancel'),
                    jsx(Button, {
                      variant: 'outline', size: 'sm', disabled: restoreBusy,
                      onClick: () => {
                        if (!restoreFileRef.current) {
                          setRestoreError(t('backupRestoreNeedFile'))
                          return
                        }
                        if (restorePhase === 3) { resetRestore(); return }
                        void runRestore()
                      },
                      children: restorePhase === 3 ? t('backupReimport') : (restoreBusy ? t('backupRestoring') : t('backupImport')),
                    }, 'import'),
                  ],
                }, 'footer'),
              ],
            }, 'restore-inline') : null,
            jsx(SettingRow, {
              label: t('backupAutoBackup'),
              description: t('backupAutoBackupDesc'),
              control: jsx(SegmentedControl, {
                label: t('backupAutoBackup'),
                options: [
                  { value: 0, label: t('backupAutoOff') },
                  { value: 1, label: t('backupHour1') },
                  { value: 6, label: t('backupHour6') },
                  { value: 24, label: t('backupDay1') },
                  { value: 168, label: t('backupWeek1') },
                ],
                value: Number(state.autoBackupHours) || 0,
                disabled: !state.writable,
                onChange: props.setAutoBackup,
              }, 'auto-segment'),
            }, 'auto-row'),
            jsx(SettingRow, {
              label: t('backupRetention'),
              description: t('backupRetentionDesc'),
              control: jsx(SegmentedControl, {
                label: t('backupRetention'),
                options: [3, 7, 14, 30].map(n => ({ value: n, label: String(n) })),
                value: Number(state.retention) || 7,
                disabled: !state.writable,
                onChange: props.setRetention,
              }, 'retention-segment'),
            }, 'retention-row'),
            jsx(SettingRow, {
              label: t('backupFolder'),
              description: t('backupFolderDesc'),
              control: jsx(Button, {
                variant: 'ghost', size: 'sm',
                onClick: revealFolder,
                children: t('backupReveal'),
              }, 'reveal'),
            }, 'folder-row'),
            jsx(SettingRow, {
              label: t('backupVersion'),
              description: versions.count > 0
                ? versions.count + t('backupVersionsCount') + ' · ' + t('backupVersionsLatest') + formatBackupTime(versions.latest)
                : t('backupVersionsNone'),
              control: jsx(Button, {
                variant: 'ghost', size: 'sm',
                disabled: backingUp || !state.writable,
                onClick: runBackupNow,
                children: backingUp ? t('backupExporting') : t('backupBackupNow'),
              }, 'backup-now'),
            }, 'version-row'),
            error ? jsx('p', { className: 'dsh-backup-form-note', role: 'alert', style: { ...STYLE.hint, color: '#f87171' }, children: t('backupError') + '：' + error }, 'error') : null,
          ],
        })
      }

      // ---- controller.js ----





      /** 备份配置直写控制器：字段与动作都留在备份包内部。 */
      class BackupCardController {
        /** @param {object} scope - 已收敛到 dsh-backup 段的配置表单。 */
        constructor(scope) {
          this.card = new DirectCardController(scope, {
            enabled: { type: 'boolean', default: true },
            repo: { type: 'string', default: DEFAULT_REPO },
            intervalHours: { type: 'number', default: DEFAULT_INTERVAL_HOURS },
            autoBackupHours: { type: 'number', default: DEFAULT_AUTO_BACKUP_HOURS },
            retention: { type: 'number', default: DEFAULT_RETENTION },
            preset: { type: 'string', default: DEFAULT_PRESET },
          })
        }
        inject() {
          return this.card.inject('backupCard', {
            setBackupRepo: 'repo',
            setBackupInterval: 'intervalHours',
            setAutoBackup: 'autoBackupHours',
            setRetention: 'retention',
            setBackupPreset: 'preset',
          })
        }
        dispose() {
          this.card.dispose()
        }
      }

      /**
       * 创建可复用的备份面板：独立详情页与根包卡片共用同一份组件。
       * @param {object} ctx - 客户端根上下文。
       * @param {object} scope - 已收敛到 dsh-backup 段的配置表单作用域。
       * @returns {object} 面板组件、文案与注入钩子。
       */
      function create(ctx, scope) {
        ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-backup 文案')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = BACKUP_CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-backup 按钮样式')
        const t = ctx.locale.bind(NS)
        const card = new BackupCardController(scope)
        const injected = card.inject()
        return {
          Component: BackupPanel,
          t,
          inject: () => injected,
          dispose: () => card.dispose(),
        }
      }

      // ---- index.jsx ----
      /**
       * dsh-backup 的浏览器半边：apply 只负责独立详情页注册。
       * 配置面板本体拆在 BackupPanel.jsx / controller.js，构建期由 scripts/bundle-client.mjs 内联。
       */


      /** 客户端插件入口：同一份面板也通过 create 供根包卡片嵌入。 */
      function apply(ctx) {
        const panel = create(ctx, ctx.configForms.get(CONFIG_NS))
        ctx.effect(() => () => {
          try { panel.dispose() } catch { /* 宿主回收表单服务后，表单已经自己关掉了 */ }
        }, 'dsh-backup 表单')
        ctx.effect(() => ctx.configForms.whileServed([CONFIG_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PLUGIN_PACKAGE,
          locale: NS,
          inject: () => panel.inject(),
        }, panel.Component))), 'dsh-backup 卡片')
      }

      module.exports.name = PLUGIN_PACKAGE
      module.exports.inject = ['slots', 'locale', 'configForms']
      module.exports.apply = apply
      module.exports.create = create
      __PANEL_MODULES__["@6starlong/dsh-backup"] = Object.assign({
        id: "@6starlong/dsh-backup",
        section: "dsh-backup",
        title: "备份同步",
        description: "按目录勾选与规则打包 ~/.dsh 用户数据，支持命名预设并导出 zip。",
        version: "0.1.0",
      }, module.exports);
    })();

    ;(function () {
      var module = { exports: {} };
      var exports = module.exports;
      const { Switch, SettingsForm, SettingsValueField, SettingsFormModel, settingsNumberField } = require("@deepseek-ai/dsh-client-ui-primitives")
      const { jsx, jsxs } = require("react/jsx-runtime")

      // ---- constants.js ----
      /** npm 包名：plugins.bundle.config 的槽位 key。 */
      const PLUGIN_PACKAGE = '@6starlong/dsh-disk-cleanup'
      /** 配置表单命名空间：bundle id 短名，与 cordis.patch.yml 的 id 一致。 */
      const CONFIG_NS = 'dsh-disk-cleanup'
      /** 本地化命名空间。 */
      const NS = 'settings.diskCleanup'

      /** 保留天数默认值，与 lib/config.js 的 schema 默认值保持一致；输入框留空时置灰显示。 */
      const DEFAULT_MAX_AGE_DAYS = '3'

      // ---- messages.js ----
      /** 文案。宿主界面是中文，随宿主语言只给一份中文。 */
      const MESSAGES = {
        zh: {
          title: '过期清理',
          description: '自动清理过期临时文件、请求图片缓存与无主附件残留，并清掉残留空目录。',
          on: '开启后按保留天数清理临时文件与图片缓存，回收无主原件，并清掉残留空目录。',
          off: '关闭后不再自动清理。',
          maxAge: '保留天数',
          maxAgeHint: '临时文件和图片缓存，超过这个天数没改动就清掉；原始图片只有确认没有引用时才会删。',
          invalid: '请填一个正整数，或留空使用默认值。',
          overridden: '已覆盖',
          reset: '恢复默认',
          save: '保存',
          saving: '保存中…',
          saveFailed: '宿主没有接受这些值，已保留以便重试。',
          readonly: '当前配置为只读，无法修改。',
          unavailable: '该插件当前未加载，暂时无法配置。',
        },
      }

      // ---- styles.js ----
      /** 卡片里最小的必要样式：开关行左右排布、说明文字弱化。 */
      const STYLE = {
        row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
        label: { fontWeight: 600 },
        hint: { margin: '4px 0 12px', opacity: 0.7, fontSize: '12px' },
      }

      // ---- CleanupCard.jsx ----




      /**
       * 表单外框的文案。
       * @param {(key: string) => string} t - 翻译函数。
       * @returns {object} SettingsForm 需要的标签。
       */
      function formLabels(t) {
        return {
          unavailable: t('unavailable'),
          readOnly: t('readonly'),
          saveFailed: t('saveFailed'),
          save: t('save'),
          saving: t('saving'),
        }
      }

      /**
       * 设置卡片。槽位注入 hooks.cleanupCard 与表单动作，形状与 dsh-rewind 的卡片一致。
       * @param {object} props - 槽位注入的属性。
       * @returns {object | null} 卡片元素；摘要视图不出内容。
       */
      function CleanupCard(props) {
        const { t, useCleanupCard } = props
        const state = useCleanupCard(snapshot => snapshot)
        if (props.view === 'summary') return null
        const disabled = !state.writable || state.saving
        const enabled = state.enabled.text === 'true'
        return jsxs(SettingsForm, {
          labels: formLabels(t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
          children: [
            jsxs('div', {
              style: STYLE.row,
              children: [
                jsx('span', { style: STYLE.label, children: t('title') }),
                jsx(Switch, {
                  checked: enabled,
                  label: t('title'),
                  disabled,
                  onChange: next => { props.edit('autoCleanup', String(next)) },
                }),
              ],
            }, 'toggle'),
            jsx('p', { style: STYLE.hint, children: t(enabled ? 'on' : 'off') }, 'hint'),
            jsx(SettingsValueField, {
              id: 'plugin-config-disk-cleanup-maxage',
              label: t('maxAge'),
              hint: t('maxAgeHint'),
              overriddenLabel: t('overridden'),
              resetLabel: t('reset'),
              invalidLabel: t('invalid'),
              numeric: true,
              placeholder: DEFAULT_MAX_AGE_DAYS,
              disabled,
              ...state.maxAgeDays,
              onEdit: text => { props.edit('cleanupMaxAgeDays', text) },
              onReset: () => { props.resetField('cleanupMaxAgeDays') },
            }, 'maxage'),
          ],
        })
      }

      // ---- controller.js ----




      /**
       * 布尔字段：开关写 'true' / 'false' 文本，再由 parse 变成真正的布尔值。
       * @param {string} field - 字段名。
       * @returns {object} 字段转换规则。
       */
      function booleanField(field) {
        return {
          field,
          format: value => String(value !== false),
          parse: text => ({ kind: 'set', value: text === 'true' }),
        }
      }

      /**
       * 表单模型与卡片状态的接线。
       */
      class CleanupCardController {
        /** @param {object} scope - 宿主该条目的配置表单。 */
        constructor(scope) {
          this.form = new SettingsFormModel(scope, [
            booleanField('autoCleanup'),
            settingsNumberField('cleanupMaxAgeDays'),
          ])
          this.store = this.form.bind(() => ({
            ...this.form.shell(),
            enabled: this.form.field('autoCleanup'),
            maxAgeDays: this.form.field('cleanupMaxAgeDays'),
          }))
        }

        /** @returns {object} 槽位注入的 hooks 与动作。 */
        inject() {
          return { hooks: { cleanupCard: this.store }, ...this.form.actions() }
        }

        dispose() {
          this.form.dispose()
        }
      }

      /**
       * 创建可复用的配置面板：同一份组件既服务独立详情页，也供主包卡片原样嵌入。
       * @param {object} ctx - 客户端根上下文。
       * @param {object} scope - 已收敛到 dsh-disk-cleanup 段的配置表单作用域。
       * @returns {object} 面板组件、文案与注入钩子。
       */
      function create(ctx, scope) {
        ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-disk-cleanup 文案')
        const t = ctx.locale.bind(NS)
        const card = new CleanupCardController(scope)
        const injected = card.inject()
        return {
          Component: CleanupCard,
          t,
          inject: () => injected,
          dispose: () => card.dispose(),
        }
      }

      // ---- index.jsx ----
      /**
       * dsh-disk-cleanup 的浏览器半边：apply 只负责独立详情页注册。
       * 配置面板本体拆在 CleanupCard.jsx / controller.js，构建期由 scripts/bundle-client.mjs 内联。
       */


      /**
       * 客户端插件入口。
       * @param {object} ctx - 客户端根上下文。
       */
      function apply(ctx) {
        const panel = create(ctx, ctx.configForms.get(CONFIG_NS))
        ctx.effect(() => () => {
          try {
            panel.dispose()
          } catch { /* 宿主回收表单服务后，表单已经自己关掉了 */ }
        }, 'dsh-disk-cleanup 表单')
        ctx.effect(() => ctx.configForms.whileServed([CONFIG_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PLUGIN_PACKAGE,
          locale: NS,
          inject: () => panel.inject(),
        }, panel.Component))), 'dsh-disk-cleanup 卡片')
      }

      module.exports.name = '@6starlong/dsh-disk-cleanup'
      module.exports.inject = ['slots', 'locale', 'configForms']
      module.exports.apply = apply
      module.exports.create = create
      __PANEL_MODULES__["@6starlong/dsh-disk-cleanup"] = Object.assign({
        id: "@6starlong/dsh-disk-cleanup",
        section: "dsh-disk-cleanup",
        title: "过期清理",
        description: "自动清理过期临时文件、请求图片缓存与无主附件残留，并清掉残留空目录。",
        version: "0.4.5",
      }, module.exports);
    })();

    const { useSyncExternalStore, useState, useEffect, useRef, useLayoutEffect } = require("react")
    const { jsx, jsxs } = require("react/jsx-runtime")
    const { Switch } = require("@deepseek-ai/dsh-client-ui-primitives")

    // ---- shared/constants.js ----
    const PLUGIN_PACKAGE = 'dsh-plugins'
    /** 包名：plugins.bundle.config 的槽位 key，也是配置表单的命名空间。 */
    /** 本地化命名空间。 */
    const NS = 'settings.starlong.diskCleanup'
    /** 套件仓库：设置页头右侧的 GitHub 入口。 */
    const REPO_URL = 'https://github.com/6starlong/dsh-plugins'

    /** 与 lib/config.js 的 schema 默认值一致；输入框留空时置灰显示。 */
    const DEFAULT_IDLE_DAYS = '3'
    const DEFAULT_DELETE_DAYS = '90'

    // ---- shared/styles.js ----
    const STYLE = {
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
    const THEME_ADAPTERS = [
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
    const THEME_CSS = THEME_ADAPTERS.map(adapter => adapter.css).join('\n')

    /**
     * GitHub 入口的悬停动效：底色渐显、图标变亮、
     * 「GitHub」文字从宽度 0 展开。内联样式写不了 :hover，只能注入样式表。
     */
    const REPO_CSS = `
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

    // ---- shared/messages.js ----
    const MESSAGES = {
      zh: {
        title: '磁盘清理',
        sessionTitle: '会话管理',
        sessionOn: '自动归档你一段时间未使用的会话。已置顶的会话永远不会被归档，也不会删除任何内容。',
        sessionOff: '关闭后不再自动归档闲置会话。',
        autoArchive: '自动归档闲置会话',
        idleDays: '自动归档闲置满',
        idleDaysSuffix: '天的会话',
        autoDelete: '自动删除闲置会话',
        deleteOn: '永久删除长期未使用的会话，删除后无法恢复。',
        deleteOff: '关闭后不再自动删除会话。',
        deleteDays: '自动删除闲置满',
        deleteDaysSuffix: '天的会话',
        description: '把临时文件移出工作区，并按保留天数自动清理过期的暂存文件。',
        auto: '自动清理',
        on: '开启后按保留天数清理临时文件与图片缓存，回收无主原件，并清掉残留空目录。',
        off: '关闭后不再自动清理。',
        maxAge: '保留天数',
        maxAgeHint: '临时文件和图片缓存，超过这个天数没改动就清掉；原始图片只有确认没有引用时才会删。',
        invalid: '请填一个正整数，或留空使用默认值。',
        overridden: '已覆盖',
        reset: '恢复默认',
        save: '保存',
        saving: '保存中…',
        saveFailed: '宿主没有接受这些值，已保留以便重试。',
        readonly: '当前配置为只读，无法修改。',
        unavailable: '该插件当前未加载，暂时无法配置。',
        page: 'Starlong',
        repo: '在 GitHub 上打开本插件',
        repoLabel: 'GitHub',
        deleteSession: '删除会话',
        deleteConfirmTitle: '永久删除会话',
        deleteConfirmBody: '该会话及其子会话将被永久删除，且无法恢复。',
        deleteCancel: '取消',
        deleteConfirm: '确认删除',
        deleteDeleting: '删除中…',
        deleteError: '删除失败',
      },
    }

    // ---- shared/form.js ----

    /**
     * 把套件条目的表单作用域收敛到某个模块段。
     * SettingsFormModel 只认扁平字段；mutate 的 path 前面补上段路径即可写回嵌套配置。
     */
    function sectionScope(scope, section) {
      // 设置服务的 value/mutate 根就是插件 config 本体，路径直接从段名开始。
      const prefix = [section]
      const pick = value => value === undefined ? undefined : value?.[section]
      return {
        subscribe: cb => scope.subscribe(cb),
        getSnapshot: () => {
          const snap = scope.getSnapshot()
          return { ...snap, value: pick(snap.value), base: pick(snap.base), user: pick(snap.user) }
        },
        mutate: (ops, revision) => scope.mutate(
          ops.map(op => ({ ...op, path: [...prefix, ...op.path] })),
          revision,
        ),
      }
    }

    /**
     * 直写配置卡片控制器：字段按声明的类型读默认值，乐观写入并带 revision 提交。
     * 快照按值缓存，避免 useSyncExternalStore 因新对象无限重渲染。
     */
    class DirectCardController {
      constructor(scope, fields) {
        this.scope = scope
        this.fields = fields
        this.pending = new Map()
        this.failed = new Map()
        this.listeners = new Set()
        this.cached = undefined
        // 宿主镜像追上乐观值后清掉；任何配置变化都把新状态推给卡片。
        this.unsubscribe = scope.subscribe(() => {
          const value = scope.getSnapshot().value || {}
          for (const [field, next] of this.pending) {
            if (value[field] === next) this.pending.delete(field)
          }
          this.emit()
        })
      }
      emit() {
        for (const cb of this.listeners) cb()
      }
      snapshot() {
        const snap = this.scope.getSnapshot()
        const value = snap.value || {}
        const writable = snap.writable !== false
        const failed = this.failed.size > 0
        const state = { writable, failed }
        let changed = this.cached === undefined
          || this.cached.writable !== writable
          || this.cached.failed !== failed
        for (const [field, spec] of Object.entries(this.fields)) {
          const raw = this.pending.has(field) ? this.pending.get(field) : value[field]
          let current
          if (spec.type === 'boolean') {
            current = raw === undefined ? spec.default : raw !== false
          } else if (spec.type === 'string') {
            current = raw === undefined ? spec.default : String(raw)
          } else {
            const parsed = Number(raw ?? spec.default)
            current = Number.isFinite(parsed) ? parsed : spec.default
          }
          if (this.cached === undefined || this.cached[field] !== current) changed = true
          state[field] = current
        }
        if (changed) this.cached = state
        return this.cached
      }
      commit(field, next) {
        this.pending.set(field, next)
        this.failed.delete(field)
        this.emit()
        const fail = () => {
          this.pending.delete(field)
          this.failed.set(field, true)
          this.emit()
        }
        // 直写必须带上当前 revision，否则宿主按过期写入拒绝，乐观值会回滚成默认值。
        const revision = this.scope.getSnapshot().revision
        this.scope.mutate([{ op: 'set', path: [field], value: next }], revision)
          .then(ok => { if (!ok) fail() })
          .catch(fail)
      }
      inject(hookName, actions) {
        const handlers = Object.fromEntries(
          Object.entries(actions).map(([name, field]) => [name, next => this.commit(field, next)]),
        )
        return {
          hooks: {
            [hookName]: {
              subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
              getSnapshot: () => this.snapshot(),
            },
          },
          ...handlers,
        }
      }
      /** 宿主 hook 形状，供 useStore 包装成 React hook。 */
      hook() {
        return {
          subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
          getSnapshot: () => this.snapshot(),
        }
      }
      asHook() {
        const hook = this.hook()
        return selector => useStore(hook, selector)
      }
      dispose() {
        this.unsubscribe()
        this.listeners.clear()
      }
    }

    /** 把宿主 hook 形状转成 React hook；selector 直接透传，快照由控制器缓存。 */
    function useStore(hook, selector) {
      const read = () => {
        const value = hook.getSnapshot()
        return typeof selector === 'function' ? selector(value) : value
      }
      return useSyncExternalStore(hook.subscribe, read, read)
    }

    // ---- components/icons.jsx ----

    /** GitHub 标记图标（16px 官方轮廓）。 */
    function GitHubIcon({ size = 16 }) {
      return jsx('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true',
        children: jsx('path', {
          d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z',
        }),
      })
    }

    /** 设置导航图标：双星芒。 */
    function SettingsIcon({ size = 16 }) {
      return jsxs('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true',
        children: [
          jsx('path', { d: 'M6.5 1.5c0 3 1 4 4 5-3 1-4 2-4 5 0-3-1-4-4-5 3-1 4-2 4-5Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }, 'main'),
          jsx('path', { d: 'M12 9c0 1.6.5 2.1 2.1 2.9-1.6.8-2.1 1.3-2.1 2.9 0-1.6-.5-2.1-2.1-2.9C11.5 11.1 12 10.6 12 9Z', stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round' }, 'spark'),
        ],
      })
    }

    // ---- components/ModuleCard.jsx ----



    /**
     * 通用模块卡片：根包只负责标题、模块开关和容器，配置内容由组件插槽渲染。
     * npm 子包面板与根包本地面板走同一入口，重复外壳不再按模块实现。
     */
    function ModuleCard(props) {
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

    // ---- components/SettingsPage.jsx ----






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
    function SettingsPage(props) {
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

    // ---- shared/api.js ----
    /** 手动删除端点与同源头：与服务端 session-manager/core.js 对齐。 */
    const DELETE_ROUTE = '/api/starlong/session-manager/delete'
    const DELETE_TOKEN_HEADER = 'x-starlong-delete'
    /** 把根绝对路径端点挂到页面 base 下，兼容带路径前缀的反向代理。 */
    function resolveApiUrl(path) {
      if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return path
      const doc = typeof document === 'undefined' ? undefined : document
      const base = doc?.baseURI
      if (typeof base !== 'string' || base === '') return path
      try {
        const url = new URL(base)
        const lastSlash = url.pathname.lastIndexOf('/')
        const last = url.pathname.slice(lastSlash + 1)
        if (/\.(html?|php|aspx?|jsp)$/i.test(last)) url.pathname = url.pathname.slice(0, lastSlash + 1)
        else if (!url.pathname.endsWith('/')) url.pathname += '/'
        return new URL(path.slice(1), url.href).href
      } catch { return path }
    }

    // ---- components/DeleteOverlay.jsx ----



    /**
     * 删除请求状态：右键菜单只发布目标，确认弹层订阅；模块级单例供两处共用。
     */
    let deleteTarget = null
    const deleteListeners = new Set()
    function publishDeleteTarget(next) {
      deleteTarget = next
      for (const listener of deleteListeners) listener()
    }
    function useDeleteRequest() {
      return useSyncExternalStore(
        cb => { deleteListeners.add(cb); return () => deleteListeners.delete(cb) },
        () => deleteTarget,
        () => deleteTarget,
      )
    }

    /** 永久删除确认卡：贴在目标会话行旁，确认后请求本机删除路由。 */
    function DeleteSessionOverlay({ t }) {
      const request = useDeleteRequest()
      const [deleting, setDeleting] = useState(false)
      const [error, setError] = useState(null)
      const [pos, setPos] = useState(null)
      const cardRef = useRef(null)

      useLayoutEffect(() => {
        if (request == null || typeof document === 'undefined') { setPos(null); return }
        let row = null
        const update = () => {
          const card = cardRef.current
          const w = card?.offsetWidth || 300
          const h = card?.offsetHeight || 180
          if (row === null || !row.isConnected) {
            try { row = document.querySelector('[data-row-key="session:' + (globalThis.CSS?.escape ? CSS.escape(request.sessionId) : request.sessionId) + '"]') } catch { row = null }
          }
          let top, left
          if (row) {
            const rect = row.getBoundingClientRect()
            top = Math.min(Math.max(16, rect.top - 4), Math.max(16, window.innerHeight - 16 - h))
            left = rect.right + 8 + w > window.innerWidth - 16 ? Math.max(16, rect.left - w - 8) : rect.right + 8
          } else {
            top = Math.max(16, (window.innerHeight - h) / 2)
            left = Math.max(16, (window.innerWidth - w) / 2)
          }
          setPos(prev => prev !== null && prev.top === top && prev.left === left ? prev : { top, left })
        }
        update()
        window.addEventListener('scroll', update, true)
        window.addEventListener('resize', update)
        return () => {
          window.removeEventListener('scroll', update, true)
          window.removeEventListener('resize', update)
        }
      }, [request])

      // 点击弹框外部关闭；延后一帧挂载，避免打开菜单的那次 pointerdown 立刻关掉弹框。
      useEffect(() => {
        if (request == null || typeof document === 'undefined') return undefined
        let remove = () => {}
        const frame = requestAnimationFrame(() => {
          const onPointerDown = (event) => {
            if (deleting || cardRef.current?.contains(event.target)) return
            publishDeleteTarget(null)
          }
          document.addEventListener('pointerdown', onPointerDown, true)
          remove = () => document.removeEventListener('pointerdown', onPointerDown, true)
        })
        return () => { cancelAnimationFrame(frame); remove() }
      }, [request, deleting])

      if (request == null) return null
      const cancel = () => { if (!deleting) publishDeleteTarget(null) }
      const confirm = async () => {
        if (deleting) return
        setDeleting(true)
        setError(null)
        try {
          const res = await fetch(resolveApiUrl(DELETE_ROUTE), {
            method: 'POST',
            headers: { 'content-type': 'application/json', [DELETE_TOKEN_HEADER]: '1' },
            body: JSON.stringify({ sessionId: request.sessionId }),
          })
          const data = await res.json().catch(() => ({}))
          if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
          publishDeleteTarget(null)
        } catch (e) {
          setError(t('deleteError') + ': ' + (e?.message || ''))
        } finally {
          setDeleting(false)
        }
      }
      return jsx('div', {
        ref: cardRef,
        role: 'dialog',
        style: {
          position: 'fixed', top: pos?.top ?? 16, left: pos?.left ?? 16, zIndex: 10000,
          width: 300, padding: 16, borderRadius: 8,
          border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
          background: 'var(--dsw-alias-bg-layer-3, rgba(32, 32, 32, 0.98))',
          color: 'inherit', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
        },
        children: jsxs('div', {
          children: [
            jsx('div', { style: { fontWeight: 600, marginBottom: 8 }, children: t('deleteConfirmTitle') }, 'title'),
            jsx('div', { style: { opacity: 0.8, fontSize: 12, marginBottom: 4, wordBreak: 'break-all' }, children: '「' + request.title + '」' }, 'name'),
            jsx('p', { style: { opacity: 0.7, fontSize: 12, margin: '0 0 12px' }, children: t('deleteConfirmBody') }, 'body'),
            error ? jsx('p', { role: 'alert', style: { color: '#f87171', fontSize: 12, margin: '0 0 8px' }, children: error }, 'error') : null,
            jsxs('div', {
              style: { display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
              children: [
                jsx('button', { type: 'button', className: 'dsh-plugins-btn dsh-plugins-btn-cancel', disabled: deleting, onClick: cancel, children: t('deleteCancel') }, 'cancel'),
                jsx('button', { type: 'button', className: 'dsh-plugins-btn dsh-plugins-btn-danger', disabled: deleting, onClick: confirm, children: deleting ? t('deleteDeleting') : t('deleteConfirm') }, 'confirm'),
              ],
            }, 'actions'),
          ],
        }, 'content'),
      }, 'card')
    }

    // ---- components/fields.jsx ----


    /**
     * 天数输入行：标签 + 数字框 + 后缀，整组右对齐。
     * 归档天数与删除天数共用，钳制范围由 max 决定，回车与失焦都提交。
     */
    function DaysInput({ label, suffix, value, max, disabled, onCommit }) {
      return jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' },
        children: [
          jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: label }, 'label'),
          jsx('input', {
            type: 'number',
            min: 1,
            max,
            step: 1,
            defaultValue: String(value),
            disabled,
            'aria-label': label,
            style: {
              width: '56px',
              padding: '4px 8px',
              textAlign: 'center',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              borderRadius: '6px',
              background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
              color: 'inherit',
              fontWeight: 400,
              fontSize: '14px',
            },
            onBlur: event => {
              const parsed = Number.parseInt(event.target.value, 10)
              if (!Number.isFinite(parsed)) {
                event.target.value = String(value)
                return
              }
              const days = Math.min(max, Math.max(1, parsed))
              event.target.value = String(days)
              if (days !== value) onCommit(days)
            },
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
          }, String(value)),
          jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: suffix }, 'suffix'),
        ],
      }, 'days')
    }

    /** 文本输入行：标签 + 文本框，失焦或回车提交。 */
    function TextInput({ label, value, disabled, onCommit }) {
      return jsxs('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '16px' },
        children: [
          jsx('span', { style: { fontWeight: 400, fontSize: '14px' }, children: label }, 'label'),
          jsx('input', {
            type: 'text',
            key: value,
            defaultValue: value,
            disabled,
            'aria-label': label,
            style: {
              width: '220px', padding: '4px 8px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
              color: 'inherit', fontWeight: 400, fontSize: '14px',
            },
            onBlur: event => {
              const next = event.target.value.trim()
              if (next && next !== value) onCommit(next)
              else event.target.value = value
            },
            onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
          }, 'input'),
        ],
      }, 'text')
    }

    /** 多行词表输入：失焦或回车外的点击提交，改动即写配置。 */
    function TextAreaInput({ label, value, disabled, onCommit }) {
      return jsxs('div', {
        style: { marginTop: '12px' },
        children: [
          jsx('div', { style: { ...STYLE.label, fontSize: '13px', marginBottom: '4px' }, children: label }, 'label'),
          jsx('textarea', {
            key: value,
            defaultValue: value,
            disabled,
            rows: 2,
            'aria-label': label,
            style: {
              width: '100%', boxSizing: 'border-box', padding: '6px 8px',
              border: '1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.35))',
              borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.12))',
              color: 'inherit', font: 'inherit', fontSize: '12px', resize: 'vertical',
            },
            onBlur: event => {
              const next = event.target.value.trim()
              if (next !== value) onCommit(next)
              else event.target.value = value
            },
          }, 'input'),
        ],
      })
    }

    // ---- panels/SessionPanel.jsx ----




    /** 会话管理面板：自动归档开关 + 行尾天数输入，外壳由 ModuleCard 提供。 */
    function SessionPanel(props) {
      const { t, useSessionCard } = props
      const state = useSessionCard(snapshot => snapshot)
      const disabled = !state.writable
      return jsxs('div', {
        children: [
          state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
          jsxs('div', {
            style: STYLE.row,
            children: [
              jsxs('div', {
                style: { minWidth: 0 },
                children: [
                  jsx('div', { style: STYLE.label, children: t('autoArchive') }, 'label'),
                  jsx('p', {
                    style: STYLE.cardDesc,
                    children: t(state.autoArchive ? 'sessionOn' : 'sessionOff'),
                  }, 'hint'),
                ],
              }, 'text'),
              jsx(Switch, {
                checked: state.autoArchive,
                label: t('autoArchive'),
                disabled,
                onChange: props.toggleSessionAuto,
              }, 'switch'),
            ],
          }, 'toggle'),
          jsx(DaysInput, {
            label: t('idleDays'),
            suffix: t('idleDaysSuffix'),
            value: state.idleDays,
            max: 365,
            disabled,
            onCommit: props.setSessionIdleDays,
          }, 'idle'),
          jsx('div', { style: STYLE.divider }, 'divider-delete'),
          jsxs('div', {
            style: STYLE.row,
            children: [
              jsxs('div', {
                style: { minWidth: 0 },
                children: [
                  jsx('div', { style: STYLE.label, children: t('autoDelete') }, 'label'),
                  jsx('p', {
                    style: STYLE.cardDesc,
                    children: t(state.autoDelete ? 'deleteOn' : 'deleteOff'),
                  }, 'hint'),
                ],
              }, 'text'),
              jsx(Switch, {
                checked: state.autoDelete,
                label: t('autoDelete'),
                disabled,
                onChange: props.toggleSessionDelete,
              }, 'switch'),
            ],
          }, 'toggle-delete'),
          jsx(DaysInput, {
            label: t('deleteDays'),
            suffix: t('deleteDaysSuffix'),
            value: state.deleteDays,
            max: 999,
            disabled,
            onCommit: props.setSessionDeleteDays,
          }, 'delete'),
        ],
      })
    }

    // ---- index.jsx ----
    /**
     * dsh-plugins 的浏览器半边：apply 只负责注册与模块装配。
     * 渲染组件拆在 components/ 与 panels/，构建期由 scripts/bundle-client.mjs 内联。
     */








    /** 构建期注入：可嵌入的独立 npm 包面板，元数据含 id / titleKey / version / create。 */
    const PANEL_MODULES = __PANEL_MODULES__
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = REPO_CSS + '\n' + THEME_CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dsh-plugins 页头样式')
      ctx.effect(() => ctx.locale.register(NS, MESSAGES), 'dsh-plugins 文案')
      const t = ctx.locale.bind(NS)
      const scope = ctx.configForms.get(PLUGIN_PACKAGE)
      // 原生会话右键 + 确认弹层跟随会话管理开关；服务/HMR 晚于插件就绪时再补注册。
      ctx.effect(() => {
        let disposeMenu
        let disposeOverlay
        let mountedService

        const enabled = () => {
          const value = scope.getSnapshot().value?.['session-manager']?.enabled
          return value === undefined ? true : value !== false
        }
        const dropMenu = () => {
          try { disposeMenu?.() } catch { /* 宿主已回收菜单服务 */ }
          disposeMenu = undefined
          mountedService = undefined
        }
        const dropOverlay = () => {
          try { disposeOverlay?.() } catch { /* 宿主已回收插槽服务 */ }
          disposeOverlay = undefined
        }

        const registerMenu = () => {
          if (!enabled()) { dropMenu(); return }
          let menus
          try { menus = ctx.get?.('contextMenus') ?? ctx.contextMenus } catch { menus = undefined }
          if (!menus || typeof menus.register !== 'function') return
          // 服务实例被替换（HMR/重建）时先释放旧注册，避免菜单项残留或重复。
          if (mountedService !== undefined && mountedService !== menus) dropMenu()
          if (disposeMenu !== undefined) return
          try {
            disposeMenu = menus.register({
              id: 'dsh-plugins.session-delete',
              target: 'session',
              order: 9999,
              observe: () => [ctx.locale, scope],
              resolve: ({ sessionId, displayTitle }) => [{
                id: 'delete-session',
                label: t('deleteSession'),
                icon: { key: 'workspace.delete' },
                danger: true,
                afterContent: true,
                run: () => publishDeleteTarget({ sessionId, title: displayTitle || sessionId }),
              }],
            })
            mountedService = menus
          } catch { disposeMenu = undefined }
        }

        const registerOverlay = () => {
          if (!enabled()) { dropOverlay(); return }
          if (disposeOverlay !== undefined) return
          try {
            disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
              name: 'shell.overlay',
              id: 'dsh-plugins.delete-session',
              locale: NS,
              inject: () => ({ t: ctx.locale.bind(NS) }),
            }, DeleteSessionOverlay))
          } catch { disposeOverlay = undefined }
        }

        const reconcile = () => { registerMenu(); registerOverlay() }
        reconcile()
        void Promise.resolve().then(() => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
        const offConfig = scope.subscribe(() => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
        const off = typeof ctx.on === 'function'
          ? ctx.on('slots/changed', () => { try { reconcile() } catch { /* 宿主尚未就绪 */ } })
          : undefined

        return () => {
          try { off?.() } catch { /* 宿主已回收事件服务 */ }
          try { offConfig() } catch { /* 宿主已回收配置服务 */ }
          dropMenu()
          dropOverlay()
        }
      }, 'dsh-plugins 会话右键删除')

      // 本地模块沿用同一套面板协议；字段与动作只在这里声明一次。
      const makeLocalPanel = (moduleScope, fields, Panel, hookName, actions) => {
        const card = new DirectCardController(moduleScope, fields)
        return {
          Component: Panel,
          t,
          inject: () => card.inject(hookName, actions),
          dispose: () => card.dispose(),
        }
      }

      const makeModule = meta => {
        const moduleScope = sectionScope(scope, meta.section)
        const switchCard = new DirectCardController(moduleScope, { enabled: { type: 'boolean', default: true } })
        const panel = meta.panel(ctx, moduleScope)
        const injected = panel.inject()
        const hookProps = {}
        for (const [name, hook] of Object.entries(injected.hooks || {})) {
          hookProps['use' + name.charAt(0).toUpperCase() + name.slice(1)] = selector => useStore(hook, selector)
        }
        const { hooks, ...panelActions } = injected
        return {
          id: meta.id,
          title: meta.title || null,
          description: meta.description || null,
          titleKey: meta.titleKey,
          descriptionKey: meta.descriptionKey,
          version: meta.version,
          useSwitch: switchCard.asHook(),
          toggleSwitch: next => switchCard.commit('enabled', next),
          Panel: panel.Component,
          panelT: panel.t,
          panelProps: { ...panelActions, ...hookProps },
          dispose: () => {
            try { switchCard.dispose() } catch { /* 宿主已回收表单服务 */ }
            try { panel.dispose() } catch { /* 宿主已回收表单服务 */ }
          },
        }
      }

      const modules = [
        ...Object.values(PANEL_MODULES).map(meta => makeModule({
          id: meta.id,
          section: meta.section,
          title: meta.title || null,
          description: meta.description || null,
          titleKey: meta.titleKey,
          descriptionKey: meta.descriptionKey,
          version: meta.version,
          panel: (c, s) => meta.create(c, s),
        })),
        makeModule({
          id: 'session-manager',
          section: 'session-manager',
          titleKey: 'sessionTitle',
          panel: (c, s) => makeLocalPanel(s, {
            enabled: { type: 'boolean', default: true },
            autoArchive: { type: 'boolean', default: true },
            idleDays: { type: 'number', default: DEFAULT_IDLE_DAYS },
            autoDelete: { type: 'boolean', default: false },
            deleteDays: { type: 'number', default: DEFAULT_DELETE_DAYS },
          }, SessionPanel, 'sessionCard', {
            toggleSessionAuto: 'autoArchive',
            setSessionIdleDays: 'idleDays',
            toggleSessionDelete: 'autoDelete',
            setSessionDeleteDays: 'deleteDays',
          }),
        }),
      ]

      ctx.effect(() => () => {
        for (const module of modules) {
          try { module.dispose() } catch { /* 宿主已回收表单服务 */ }
        }
      }, 'dsh-plugins 表单')

      ctx.effect(() => ctx.configForms.whileServed([PLUGIN_PACKAGE], () => {
        const disposers = [
          ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: PLUGIN_PACKAGE,
            // 导航按 order 升序排；取大值让套件页固定垫底。
            order: 1000,
            label: () => t('page'),
            locale: NS,
            inject: () => ({ modules }),
          }, SettingsPage)),
          ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
            name: 'settings.section.icon',
            id: PLUGIN_PACKAGE,
          }, SettingsIcon)),
        ]
        return () => disposers.reverse().forEach(dispose => dispose?.())
      }), 'dsh-plugins 卡片与设置页')
    }

    module.exports.name = '@6starlong/dsh-plugins'
    module.exports.inject = ['slots', 'locale', 'configForms']
    module.exports.apply = apply
    return module.exports;
  },
});
