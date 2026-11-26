// 由 scripts/build.mjs 生成，不要手改。
window.__ModuleLoader__.load({
  id: "@6starlong/dsh-backup",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    const { useSyncExternalStore, useState, useEffect } = require("react")
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
        backupList: '备份清单',
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
        backupPresetDesc: '保存多份清单配置，随时切换',
        backupPresetName: '预设名称',
        backupSavePreset: '保存预设',
        backupInclude: '纳入',
        backupExclude: '排除',
        backupRevert: '撤销',
        backupSelectPreset: '选择预设',
        backupRestoreDefault: '恢复默认',
        backupDeletePreset: '删除预设',
        backupExport: '导出',
        backupExportDesc: '立即按清单生成 zip',
        backupExporting: '导出中…',
        backupDownload: '下载',
        backupResult: '已打包',
        backupFiles: '个文件',
        backupExcludedCount: '项排除',
        backupError: '导出失败',
        backupConfigure: '配置',
        backupEdit: '编辑',
        backupCollapse: '收起',
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
    /* 统一设置清单：左侧标题与描述，右侧表单控件；行间用淡顶边，最后一行无线。 */
    .dsh-backup-form{--dsh-backup-radius:8px}
    .dsh-backup-form button:not(.dsh-backup-tree-action):not(.dsh-backup-select-option),
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
    .dsh-backup-preset-name{box-sizing:border-box;flex:1;min-width:0;width:auto;height:28px;font-size:13px}
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
    .dsh-backup-preset-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0}
    .dsh-backup-preset-title{flex:1;min-width:0}
    .dsh-backup-preset-label{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}
    .dsh-backup-preset-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
    .dsh-backup-preset-head-actions{display:flex;flex:none;align-items:center;gap:8px;min-width:0}
    .dsh-backup-preset-save-row{display:flex;align-items:center;gap:8px;min-width:0;padding:12px 0}
    .dsh-backup-disclosure-body{padding:0 0 16px}
    .dsh-backup-sync-body > * + *{border-top:0.5px solid var(--dsw-alias-border-l1)}
    .dsh-backup-combined-body{display:flex;flex-direction:column}
    .dsh-backup-combined-body > * + *{border-top:0.5px solid var(--dsw-alias-border-l1)}
    .dsh-backup-combined-body > .dsh-backup-combined-section + *{border-top:0}
    .dsh-backup-disclosure-toggle{flex:none}
    .dsh-backup-muted{font-size:12px;color:var(--dsw-alias-label-secondary);padding:8px 0}
    .dsh-backup-export-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .dsh-backup-tree-adjusted{margin-top:12px;padding-bottom:12px;border-bottom:0.5px solid var(--dsw-alias-border-l1)}
    .dsh-backup-tree-adjusted-row{display:flex;align-items:center;gap:8px;min-height:32px;font-size:12px}
    .dsh-backup-tree-adjusted-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
    .dsh-backup-tree-adjusted-state{flex:none;font-size:12px}
    .dsh-backup-tree-adjusted-state.is-in{color:var(--dsw-alias-state-success-primary,#10b981)}
    .dsh-backup-tree-adjusted-state.is-out{color:var(--dsw-alias-state-error-primary,#ef4444)}
    .dsh-backup-tree-revert{padding:2px 8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsh-backup-radius);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
    .dsh-backup-tree-revert:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
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
    function SettingRow({ label, description, control }) {
      return jsxs('div', {
        className: 'dsh-backup-setting-row',
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

    // ---- components/DisclosureRow.jsx ----


    /** 折叠行：左侧固定标题与描述，右侧配置区按钮才触发展开。 */
    function DisclosureRow({ label, description, open, onToggle, actionLabel, children }) {
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
    const BACKUP_DOWNLOAD_ROUTE = '/api/starlong/dsh-backup/download'
    const BACKUP_TOKEN_HEADER = 'x-starlong-backup'
    const BACKUP_TREE_ROUTE = '/api/starlong/dsh-backup/tree'
    const BACKUP_PRESET_ROUTE = '/api/starlong/dsh-backup/preset'

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

    /** 把内部规则名翻成人话；完整规则放 title 供排查。 */
    function reasonLabel(reason) {
      const s = String(reason || '')
      const i = s.indexOf(':')
      const key = i < 0 ? s : s.slice(0, i)
      return {
        override: '手动排除', regex: '自定义规则', clientDir: '客户端运行目录',
        dependency: '依赖目录', pathSegment: '可再生目录',
        extension: '可再生文件', namePattern: '临时或锁文件',
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
      const [result, setResult] = useState(null)
      const [error, setError] = useState(null)
      const [sectionOpen, setSectionOpen] = useState({})
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
        if (!res.ok || data?.ok !== true) throw new Error(data?.error || String(res.status))
        return data
      }
      const loadChildren = async (path, ov, rg) => {
        const data = await request(BACKUP_TREE_ROUTE, { path, overrides: ov, regex: rg })
        setTreeData(prev => ({ ...prev, [path]: data.nodes || [] }))
        setPresets(data.presets || [])
      }
      const reloadAll = async (ov, rg) => {
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
        finally { setLoading(false) }
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
        } catch (e) { setError(e?.message || '') }
      }
      const loadPreset = async name => {
        const target = name ?? presetName
        if (!target) {
          setOverrides({}); setRegex(''); setRegexDraft(''); setExpanded({})
          await reloadAll({}, '')
          return
        }
        try {
          const data = await request(BACKUP_PRESET_ROUTE, { action: 'load', name: target })
          const ov = data.overrides || {}
          const rg = data.regex || ''
          setOverrides(ov); setRegex(rg); setRegexDraft(rg); setExpanded({})
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
        } catch (e) { setError(e?.message || '') }
      }
      const runExport = async () => {
        if (exporting) return
        setExporting(true)
        setError(null)
        setResult(null)
        try {
          const data = await request(BACKUP_EXPORT_ROUTE, { overrides, regex })
          setResult(data)
        } catch (e) { setError(e?.message || '') }
        finally { setExporting(false) }
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
      return jsxs('div', {
        className: 'dsh-backup-form',
        children: [
          state.failed ? jsx('p', { className: 'dsh-backup-form-note', style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
          jsx(DisclosureRow, {
            label: t('backupSync'),
            description: t('backupSyncDesc'),
            open: !!sectionOpen.sync,
            onToggle: () => toggleSection('sync'),
            actionLabel: sectionOpen.sync ? t('backupCollapse') : t('backupEdit'),
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
            actionLabel: sectionOpen.tree ? t('backupCollapse') : t('backupConfigure'),
            children: jsxs('div', {
              className: 'dsh-backup-combined-body',
              children: [
                jsxs('div', {
                  className: 'dsh-backup-combined-section',
                  children: [
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
                            jsx(Button, {
                              variant: 'ghost', size: 'sm',
                              onClick: () => { setPresetOpen(false); setPresetName(''); setPresetDraft(''); void loadPreset('') },
                              children: t('backupRestoreDefault'),
                            }, 'restore-default'),
                          ],
                        }, 'tree-actions'),
                        jsx('span', { className: 'dsh-backup-tree-estimate', children: summary ? t('backupEstimate') + ' ' + formatBytes(summary.includeBytes) : t('backupEstimate') + ' …' }, 'estimate'),
                      ],
                    }, 'tree-head'),
                    jsx('div', {
                      className: 'dsh-backup-tree-box',
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
                jsxs('div', {
                  className: 'dsh-backup-preset-head',
                  children: [
                    jsxs('div', {
                      className: 'dsh-backup-preset-title',
                      children: [
                        jsx('div', { className: 'dsh-backup-preset-label', children: t('backupPreset') }, 'preset-label'),
                        jsx('div', { className: 'dsh-backup-preset-desc', children: t('backupPresetDesc') }, 'preset-desc'),
                      ],
                    }, 'preset-title'),
                    jsxs('div', {
                      className: 'dsh-backup-preset-head-actions',
                      children: [
                        jsxs('div', {
                          className: 'dsh-backup-select',
                          onBlur: e => { if (!e.currentTarget.contains(e.relatedTarget)) setPresetOpen(false) },
                          children: [
                            jsxs('button', {
                              type: 'button', className: 'dsh-backup-select-trigger',
                              'aria-haspopup': 'listbox', 'aria-expanded': presetOpen, disabled: !presets.length,
                              onClick: () => setPresetOpen(v => !v),
                              children: [
                                jsx('span', { children: presetName || t('backupSelectPreset') }, 'label'),
                                jsx('span', { className: 'dsh-backup-select-caret', children: '▾' }, 'caret'),
                              ],
                            }, 'trigger'),
                            presetOpen ? jsx('div', {
                              className: 'dsh-backup-select-menu', role: 'listbox',
                              children: presets.map(n => jsx('button', {
                                key: n, type: 'button', role: 'option', 'aria-selected': n === presetName,
                                className: 'dsh-backup-select-option' + (n === presetName ? ' is-selected' : ''),
                                onClick: () => { setPresetOpen(false); setPresetName(n); void loadPreset(n) },
                                children: n,
                              }, 'opt-' + n)),
                            }, 'menu') : null,
                          ],
                        }, 'preset-select'),
                        presetName ? jsx(Button, { variant: 'ghost', size: 'sm', onClick: deletePreset, children: t('backupDeletePreset') }, 'preset-delete') : null,
                      ],
                    }, 'preset-head-actions'),
                  ],
                }, 'preset-head'),
                jsxs('div', {
                  className: 'dsh-backup-preset-save-row',
                  children: [
                    jsx(Input, {
                      type: 'text', value: presetDraft, onChange: e => setPresetDraft(e.target.value),
                      placeholder: t('backupPresetName'), 'aria-label': t('backupPresetName'),
                      className: 'dsh-backup-preset-name',
                    }, 'preset-draft'),
                    jsx(Button, { variant: 'outline', size: 'sm', className: 'dsh-backup-preset-save', onClick: savePreset, children: t('backupSavePreset') }, 'preset-save'),
                  ],
                }, 'preset-save-row'),
              ],
            }, 'combined-body'),
          }, 'tree-disclosure'),
          jsx(SettingRow, {
            label: t('backupExport'),
            description: t('backupExportDesc'),
            control: jsxs('div', {
              className: 'dsh-backup-export-actions',
              children: [
                jsx(Button, {
                  variant: 'primary', size: 'sm',
                  disabled: exporting || !state.writable,
                  onClick: runExport,
                  children: exporting ? t('backupExporting') : t('backupExport'),
                }, 'export'),
                result ? jsx('a', {
                  className: 'dsh-plugins-btn',
                  href: resolveApiUrl(BACKUP_DOWNLOAD_ROUTE + '?name=' + encodeURIComponent(result.name)),
                  download: result.name,
                  children: t('backupDownload'),
                }, 'download') : null,
              ],
            }, 'actions'),
          }, 'export-row'),
          result ? jsx('p', {
            className: 'dsh-backup-form-note',
            style: STYLE.hint,
            children: t('backupResult') + '：' + result.name + ' · ' + result.includeFiles + t('backupFiles') + ' · ' + result.excludeItems + t('backupExcludedCount'),
          }, 'result') : null,
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
        })
      }
      inject() {
        return this.card.inject('backupCard', {
          setBackupRepo: 'repo',
          setBackupInterval: 'intervalHours',
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
    return module.exports;
  },
});
