/**
 * dsh-starlong —— Starlong 的 DSH 套件插件。
 *
 * 一个插件，多个模块。模块各自导出配置段与装配函数，入口只负责遍历装配；
 * 模块自己读自己的开关，互不读取对方状态。当前是空模板，modules/ 下还没有模块。
 * @module dsh-starlong
 */

/** Cordis 插件身份（与包名一致）。 */
export const name = 'dsh-starlong'
/** 必需服务：模板阶段不依赖任何宿主服务。 */
export const inject = []

/**
 * 待装配的模块。加模块时在 modules/ 下建文件，并在这里登记。
 * @type {Array<{id: string, apply: (ctx: object, config: unknown) => void}>}
 */
const MODULES = []

/**
 * 插件入口。当前没有模块，装配点先留着。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - cordis.patch.yml 里的 config。
 */
export function apply(ctx, config) {
  // 模块自己读 config[id] 决定是否启用；当前 MODULES 为空，装配点先留着。
  for (const mod of MODULES) mod.apply(ctx, config)
}
