/**
 * 会话管理模块适配器。
 *
 * 核心插件挂在独立子 fiber 上：三个配置字段都是 volatile，设置页改值后
 * 在这里重挂子插件，不必重启整个套件。
 * @module dsh-plugins/session-manager
 */
import * as sessionManager from './core.js'

const { readSection } = sessionManager

/**
 * 装配模块。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - 套件 config（cordis 传入的 effectiveConfig，volatile 字段是取值代理）。
 */
export function apply(ctx, config) {
  let fiber
  const mount = () => {
    fiber?.dispose()
    fiber = undefined
    if (readSection(config).enabled === false) return
    // core.resolveConfig 自己取段并解代理；传已解包的值会让它拿不到 autoArchive。
    fiber = ctx.plugin(sessionManager, config)
  }
  mount()
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(path => path[0] === 'session-manager')) mount()
  })
  ctx.effect(() => () => { fiber?.dispose() }, 'dsh-plugins 会话管理模块')
}
