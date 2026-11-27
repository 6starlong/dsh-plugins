import { useState, useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Button, Input, FileTypeIcon, classifyFileType } from '@deepseek-ai/dsh-client-ui-primitives'
import { STYLE } from './styles.js'
import { DaysInput, TextInput } from './fields.jsx'
import { SettingRow } from './components/SettingRow.jsx'
import { RestoreOverlay } from './components/RestoreOverlay.jsx'
import { DisclosureRow } from './components/DisclosureRow.jsx'
import { BACKUP_EXPORT_ROUTE, BACKUP_TOKEN_HEADER, BACKUP_TREE_ROUTE, BACKUP_PRESET_ROUTE, BACKUP_REVEAL_ROUTE, BACKUP_VERSIONS_ROUTE, BACKUP_VERIFY_ROUTE, BACKUP_RESTORE_STREAM_ROUTE, BACKUP_UPLOAD_ROUTE, resolveApiUrl } from './api.js'
import { SegmentedControl } from './components/SegmentedControl.jsx'

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

/** 最近备份时间：当天只显示时分，跨天显示完整日期时间。 */
export function formatBackupTime(iso) {
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
export function reasonLabel(reason) {
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
export function BackupPanel(props) {
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
