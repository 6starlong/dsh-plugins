import { SettingsFormModel, settingsNumberField } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './constants.js'
import { MESSAGES } from './messages.js'
import { CleanupCard } from './CleanupCard.jsx'

/**
 * 布尔字段：开关写 'true' / 'false' 文本，再由 parse 变成真正的布尔值。
 * @param {string} field - 字段名。
 * @returns {object} 字段转换规则。
 */
export function booleanField(field) {
  return {
    field,
    format: value => String(value !== false),
    parse: text => ({ kind: 'set', value: text === 'true' }),
  }
}

/**
 * 表单模型与卡片状态的接线。
 */
export class CleanupCardController {
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
export function create(ctx, scope) {
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