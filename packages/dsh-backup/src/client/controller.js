import { DirectCardController } from './form.js'
import { MESSAGES } from './messages.js'
import { BackupPanel } from './BackupPanel.jsx'
import { BACKUP_CSS } from './styles.js'
import { CONFIG_NS, NS, DEFAULT_REPO, DEFAULT_INTERVAL_HOURS, DEFAULT_AUTO_BACKUP_HOURS, DEFAULT_RETENTION, DEFAULT_PRESET } from './constants.js'

/** 备份配置直写控制器：字段与动作都留在备份包内部。 */
export class BackupCardController {
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
export function create(ctx, scope) {
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
