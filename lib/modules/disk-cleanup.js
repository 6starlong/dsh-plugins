/**
 * dsh-disk-cleanup 模块适配器。
 *
 * 直接复用独立包导出的 apply，不在套件里复制功能代码。
 * 配置从套件的 config['dsh-disk-cleanup'] 段读；没写时用独立包自己的默认值。
 * @module dsh-starlong/modules/disk-cleanup
 */
import { apply as applyCleanup } from 'dsh-disk-cleanup'

/** 配置段在套件 config 下的键。 */
const SECTION = 'dsh-disk-cleanup'

/**
 * 装配模块。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {unknown} config - 套件 config。
 */
export function apply(ctx, config) {
  const section = config !== null && typeof config === 'object' && !Array.isArray(config)
    ? config[SECTION]
    : undefined
  return applyCleanup(ctx, section ?? {})
}
