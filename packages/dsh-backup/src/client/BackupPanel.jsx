import { useState, useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { FileTypeIcon, classifyFileType } from '@deepseek-ai/dsh-client-ui-primitives'
import { STYLE } from './styles.js'
import { DaysInput, TextInput } from './fields.jsx'
import { SettingRow } from './components/SettingRow.jsx'
import { DisclosureRow } from './components/DisclosureRow.jsx'
import { BACKUP_EXPORT_ROUTE, BACKUP_DOWNLOAD_ROUTE, BACKUP_TOKEN_HEADER, BACKUP_TREE_ROUTE, BACKUP_PRESET_ROUTE, resolveApiUrl } from './api.js'

/** 体积显示：保留一位小数，避免长数字撑破布局。 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return n + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return value.toFixed(1) + ' ' + units[i]
}

/** 把内部规则名翻成人话；完整规则放 title 供排查。 */
export function reasonLabel(reason) {
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
export function BackupPanel(props) {
  const { t, useBackupCard } = props
  const state = useBackupCard(snapshot => snapshot)
  const [treeData, setTreeData] = useState({})
  const [expanded, setExpanded] = useState({})
  const [overrides, setOverrides] = useState({})
  const [regex, setRegex] = useState('')
  const [regexDraft, setRegexDraft] = useState('')
  const [presets, setPresets] = useState([])
  const [presetName, setPresetName] = useState('')
  const [presetDraft, setPresetDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [summary, setSummary] = useState(null)
  const [sectionOpen, setSectionOpen] = useState({})
  const toggleSection = key => setSectionOpen(prev => ({ ...prev, [key]: !prev[key] }))

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
                jsx(FileTypeIcon, { kind: 'folder', size: 16, className: 'dsh-backup-tree-icon' }, 'folder'),
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
                jsx(FileTypeIcon, { kind: classifyFileType(node.name), size: 16, className: 'dsh-backup-tree-file-icon' }, 'file-icon'),
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
    children: [
      state.failed ? jsx('p', { style: STYLE.hint, children: t('saveFailed') }, 'hint') : null,
      jsx('p', { style: STYLE.cardDesc, children: t('backupOn') }, 'hint'),
      jsx(SettingRow, {
        label: t('backupRepo'),
        control: jsx(TextInput, { label: t('backupRepo'), value: state.repo, disabled: !state.writable, onCommit: props.setBackupRepo, bare: true }, 'repo-input'),
      }, 'repo-row'),
      jsx(SettingRow, {
        label: t('backupInterval'),
        control: jsx(DaysInput, { label: t('backupInterval'), suffix: t('backupIntervalSuffix'), value: state.intervalHours, max: 168, disabled: !state.writable, onCommit: props.setBackupInterval, bare: true }, 'interval-input'),
      }, 'interval-row'),
      jsx(DisclosureRow, {
        label: t('backupTitle') + ' · ~/.dsh',
        summary: loading
          ? t('backupRefreshing')
          : summary
            ? t('backupSelected') + ' ' + formatBytes(summary.includeBytes)
            : t('backupEmpty'),
        open: !!sectionOpen.tree,
        onToggle: () => toggleSection('tree'),
        children: jsxs('div', {
          className: 'dsh-backup-tree-section',
          children: [
            jsxs('div', {
              className: 'dsh-backup-tree-head',
              children: [
                summary ? jsx('span', {
                  className: 'dsh-backup-tree-summary',
                  children: t('backupSelected') + ' ' + formatBytes(summary.includeBytes) + ' · ' + t('backupPhysical') + ' ' + formatBytes(summary.includeBytes + summary.excludeBytes),
                }, 'summary') : null,
                jsx('span', { className: 'dsh-backup-tree-head-spacer' }, 'spacer'),
                loading ? jsxs('span', { className: 'dsh-backup-tree-status', children: [jsx('span', { className: 'dsh-backup-tree-status-dot' }, 'dot'), t('backupRefreshing')] }, 'status') : null,
                jsx('button', {
                  type: 'button', className: 'dsh-plugins-btn', disabled: loading,
                  onClick: () => reloadAll(overrides, regex),
                  children: t('backupRefresh'),
                }, 'refresh'),
              ],
            }, 'tree-head'),
            jsx('div', {
              className: 'dsh-backup-tree-box',
              children: (treeData[''] || []).length
                ? renderTree(treeData[''], 0)
                : loading
                  ? jsxs('div', { className: 'dsh-backup-tree-skeleton', 'aria-hidden': true, children: [70, 54, 76, 48, 62].map((w, i) => jsxs('div', { className: 'dsh-backup-tree-skeleton-row', children: [jsx('span', { className: 'dsh-backup-tree-skeleton-icon' }, 'icon'), jsx('span', { className: 'dsh-backup-tree-skeleton-line', style: { width: w + '%' } }, 'line')] }, 'sk-' + i)) }, 'skeleton')
                  : jsxs('div', { className: 'dsh-backup-tree-empty', children: [jsx(FileTypeIcon, { kind: 'folder', size: 28, className: 'dsh-backup-tree-empty-icon' }, 'empty-icon'), jsx('span', { children: t('backupEmpty') }, 'empty-title'), jsx('span', { className: 'dsh-backup-tree-empty-hint', children: t('backupEmptyHint') }, 'empty-hint')] }, 'tree-empty'),
            }, 'tree'),
          ],
        }, 'tree-inner'),
      }, 'tree-disclosure'),
      jsx(DisclosureRow, {
        label: t('backupAdjusted'),
        summary: Object.keys(overrides).length + ' ' + t('backupItemUnit'),
        open: !!sectionOpen.adjusted,
        onToggle: () => toggleSection('adjusted'),
        children: jsx('div', {
          className: 'dsh-backup-adjusted-list',
          children: Object.entries(overrides).length
            ? Object.entries(overrides).map(([rel, inc]) => jsxs('div', {
              key: rel,
              style: { ...STYLE.row, gap: '8px', alignItems: 'center', fontSize: '12px' },
              children: [
                jsx('span', {
                  title: rel,
                  style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                  children: rel,
                }, 'adjusted-rel-' + rel),
                jsx('span', {
                  style: { color: inc ? '#10b981' : '#ef4444' },
                  children: inc ? t('backupInclude') : t('backupExclude'),
                }, 'adjusted-state-' + rel),
                jsx('button', {
                  type: 'button', className: 'dsh-plugins-btn',
                  disabled: loading,
                  onClick: () => removeOverride(rel),
                  children: t('backupRevert'),
                }, 'adjusted-revert-' + rel),
              ],
            }, 'adjusted-' + rel))
            : jsx('div', { className: 'dsh-backup-muted', children: t('backupEmpty') }, 'adjusted-empty'),
        }, 'adjusted-list'),
      }, 'adjusted-disclosure'),
      jsx(DisclosureRow, {
        label: t('backupRegex'),
        summary: regex ? t('backupRegexApplied') : t('backupRegexNone'),
        open: !!sectionOpen.regex,
        onToggle: () => toggleSection('regex'),
        children: jsxs('div', {
          className: 'dsh-backup-regex-body',
          children: [
            jsxs('div', {
              className: 'dsh-backup-regex-head',
              children: [
                jsx('span', { style: STYLE.label, children: t('backupRegex') }, 'regex-label'),
                regexDraft !== regex ? jsx('span', {
                  className: 'dsh-backup-regex-pending',
                  children: t('backupRegexPending'),
                }, 'regex-pending') : null,
              ],
            }, 'regex-head'),
            jsxs('div', {
              className: 'dsh-backup-regex-row',
              children: [
                jsx('textarea', {
                  value: regexDraft, rows: 2,
                  'aria-label': t('backupRegex'), placeholder: t('backupRegex'),
                  className: 'dsh-backup-regex-input',
                  onChange: e => setRegexDraft(e.target.value),
                }, 'regex'),
                jsx('button', {
                  type: 'button', className: 'dsh-plugins-btn',
                  disabled: loading || regexDraft === regex,
                  onClick: applyRegex,
                  children: t('backupRegexApply'),
                }, 'regex-apply'),
              ],
            }, 'regex-row'),
          ],
        }, 'regex-body'),
      }, 'regex-disclosure'),
      jsx(DisclosureRow, {
        label: t('backupPreset'),
        summary: presetName || t('backupDefaultPreset'),
        open: !!sectionOpen.preset,
        onToggle: () => toggleSection('preset'),
        children: jsxs('div', {
          className: 'dsh-backup-preset-row',
          children: [
            jsx('select', {
              value: presetName, onChange: e => { setPresetName(e.target.value); void loadPreset(e.target.value) },
              className: 'dsh-backup-select-input',
              children: [jsx('option', { value: '', children: t('backupDefaultPreset') }, 'default')].concat(
                presets.map(n => jsx('option', { value: n, children: n }, n))
              ),
            }, 'preset-select'),
            jsx('input', {
              type: 'text', value: presetDraft, onChange: e => setPresetDraft(e.target.value),
              placeholder: t('backupPresetName'),
              className: 'dsh-backup-text-input dsh-backup-preset-name',
            }, 'preset-draft'),
            jsx('button', { type: 'button', className: 'dsh-plugins-btn', onClick: savePreset, children: t('backupSavePreset') }, 'preset-save'),
            presetName ? jsx('button', { type: 'button', className: 'dsh-plugins-btn dsh-plugins-btn-danger', onClick: deletePreset, children: t('backupDeletePreset') }, 'preset-delete') : null,
          ],
        }, 'preset-row'),
      }, 'preset-disclosure'),
      jsx(SettingRow, {
        label: t('backupExport'),
        control: jsxs('div', {
          className: 'dsh-backup-export-actions',
          children: [
            jsx('button', {
              type: 'button', className: 'dsh-plugins-btn',
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
        style: STYLE.hint,
        children: t('backupResult') + '：' + result.name + ' · ' + result.includeFiles + t('backupFiles') + ' · ' + result.excludeItems + t('backupExcludedCount'),
      }, 'result') : null,
      error ? jsx('p', { role: 'alert', style: { ...STYLE.hint, color: '#f87171' }, children: t('backupError') + '：' + error }, 'error') : null,
    ],
  })
}