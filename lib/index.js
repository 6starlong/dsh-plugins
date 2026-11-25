/**
 * dsh-plugins —— Starlong 的 DSH 插件套件。
 *
 * 一个插件，多个模块。模块各自读自己的配置段与开关，入口只负责遍历装配；
 * 模块之间互不读取对方状态。复用独立包导出的 apply，不复制功能代码。
 * @module dsh-plugins
 */
import { apply as applyDiskCleanup } from './modules/disk-cleanup.js'
import { apply as applyMnemonPatch } from './modules/mnemon-patch.js'
import { apply as applySessionManager } from './modules/session-manager/index.js'
import { apply as applyDshBackup } from './modules/backup.js'
import { Config } from './config.js'

/** 套件 Config schema：宿主设置服务按它登记命名空间，缺了它设置页不会出现。 */
export { Config }

/** Cordis 插件身份（与包名一致）。 */
export const name = '@6starlong/dsh-plugins'
/** 必需服务：取所有模块的并集，保证装配时宿主服务已就绪。 */
export const inject = ['tools', 'agents', 'webServer']

/**
 * 待装配的模块。加模块时在 modules/ 下建适配器，并在这里登记。
 * @type {Array<{id: string, apply: (ctx: object, config: unknown) => void}>}
 */
const MODULES = [
  { id: 'dsh-disk-cleanup', apply: applyDiskCleanup },
  { id: 'session-manager', apply: applySessionManager },
  { id: 'mnemon-patch', apply: applyMnemonPatch },
  { id: 'dsh-backup', apply: applyDshBackup },
]

/**
 * 插件入口：把整个 config 交给各模块，模块自己取自己的配置段。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - cordis.patch.yml 里的 config。
 */
export function apply(ctx, config) {
  for (const mod of MODULES) mod.apply(ctx, config)
}
