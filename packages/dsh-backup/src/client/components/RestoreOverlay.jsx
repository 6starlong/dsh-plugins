import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** 一键还原确认与进度浮层；锚定导入按钮的小卡片，校验与恢复由服务端真实执行。 */
const PHASES = ['backupRestorePhaseVerify', 'backupRestorePhaseFiles', 'backupRestorePhaseModules', 'backupRestorePhaseDone']
const WIDTH = 300

export function RestoreOverlay({ t, open, phase, anchor, result, error, onConfirm, onClose }) {
  const cardRef = useRef(null)
  const [pos, setPos] = useState(null)
  const done = phase >= PHASES.length - 1
  const failed = phase === -2
  const busy = phase >= 0 && !done && !failed

  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return }
    const update = () => {
      const rect = anchor.getBoundingClientRect()
      const h = cardRef.current?.offsetHeight || 200
      let left = rect.right + 8
      if (left + WIDTH > window.innerWidth - 16) left = Math.max(16, rect.left - WIDTH - 8)
      const top = Math.min(Math.max(16, rect.top), Math.max(16, window.innerHeight - 16 - h))
      setPos(prev => prev && prev.top === top && prev.left === left ? prev : { top, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchor, phase])

  // 点击外部关闭；延后一帧挂载，避免打开浮层的那次 pointerdown 立刻关掉。
  useEffect(() => {
    if (!open || pos === null) return undefined
    let remove = () => {}
    const frame = requestAnimationFrame(() => {
      const onPointerDown = event => {
        if (busy || cardRef.current?.contains(event.target) || anchor?.contains(event.target)) return
        onClose()
      }
      document.addEventListener('pointerdown', onPointerDown, true)
      remove = () => document.removeEventListener('pointerdown', onPointerDown, true)
    })
    return () => { cancelAnimationFrame(frame); remove() }
  }, [open, pos, busy, anchor, onClose])

  if (!open || pos === null) return null
  const confirming = phase < 0
  const summary = result
    ? t('backupRestoreSummary')
        .replace('{added}', String(result.written ?? 0))
        .replace('{overwritten}', String(result.overwritten ?? 0))
    : t('backupRestoreDone')
  return jsx('div', {
    ref: cardRef,
    role: 'dialog',
    'aria-label': t('backupRestoreTitle'),
    className: 'dsh-backup-restore-card',
    style: { position: 'fixed', top: pos.top, left: pos.left, zIndex: 10000, width: WIDTH, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35))' },
    children: [
      jsx('div', { className: 'dsh-backup-modal-title', children: t('backupRestoreTitle') }, 'title'),
      jsx('p', { className: 'dsh-backup-modal-desc', children: t('backupRestoreBody') }, 'desc'),
      failed
        ? jsxs('div', {
            className: 'dsh-backup-modal-actions',
            children: [
              jsx('span', { className: 'dsh-backup-modal-done', style: { color: '#f87171' }, children: t('backupRestoreFailed') + '：' + (error || '') }, 'failed-note'),
              jsx('button', { type: 'button', className: 'dsh-plugins-btn', onClick: onClose, children: t('backupRestoreClose') }, 'close'),
            ],
          }, 'failed-actions')
        : confirming
          ? jsxs('div', {
              className: 'dsh-backup-modal-actions',
              children: [
                jsx('button', { type: 'button', className: 'dsh-plugins-btn dsh-plugins-btn-cancel', onClick: onClose, children: t('backupRestoreCancel') }, 'cancel'),
                jsx('button', { type: 'button', className: 'dsh-plugins-btn', onClick: onConfirm, children: t('backupRestoreConfirm') }, 'confirm'),
              ],
            }, 'actions')
          : jsxs('div', {
              className: 'dsh-backup-modal-body',
              children: [
                jsxs('ul', {
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
                done
                  ? jsxs('div', {
                      className: 'dsh-backup-modal-actions',
                      children: [
                        jsx('span', { className: 'dsh-backup-modal-done', children: summary }, 'done-note'),
                        jsx('button', { type: 'button', className: 'dsh-plugins-btn', onClick: onClose, children: t('backupRestoreClose') }, 'close'),
                      ],
                    }, 'done-actions')
                  : null,
              ],
            }, 'body'),
    ],
  }, 'card')
}
