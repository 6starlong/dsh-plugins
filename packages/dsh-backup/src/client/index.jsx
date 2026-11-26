/**
 * dsh-backup 的浏览器半边：apply 只负责独立详情页注册。
 * 配置面板本体拆在 BackupPanel.jsx / controller.js，构建期由 scripts/bundle-client.mjs 内联。
 */
import { PLUGIN_PACKAGE, CONFIG_NS, NS } from './constants.js'
import { create } from './controller.js'

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
