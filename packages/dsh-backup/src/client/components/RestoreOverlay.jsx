import { useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

/** 一键还原：导入行内展开的提示与步骤，校验与恢复由服务端真实执行。 */
const PHASES = ['backupRestorePhaseVerify', 'backupRestorePhaseFiles', 'backupRestorePhaseModules', 'backupRestorePhaseDone']

export function RestoreOverlay({ t, open, phase, result, error, onClose }) {
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
