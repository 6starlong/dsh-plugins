import { useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { DELETE_ROUTE, DELETE_TOKEN_HEADER, resolveApiUrl } from '../shared/api.js'

/**
 * 删除请求状态：右键菜单只发布目标，确认弹层订阅；模块级单例供两处共用。
 */
let deleteTarget = null
const deleteListeners = new Set()
export function publishDeleteTarget(next) {
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
export function DeleteSessionOverlay({ t }) {
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