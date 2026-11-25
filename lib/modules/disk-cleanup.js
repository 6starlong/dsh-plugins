/**
 * dsh-disk-cleanup 模块适配器。
 *
 * 复用独立包导出的 apply，模块挂在独立子 fiber 上：enabled 是 volatile 字段，
 * 设置页改开关或字段时在这里重挂子插件，不必重启整个套件。
 * @module dsh-plugins/modules/disk-cleanup
 */
import * as cleanup from '@6starlong/dsh-disk-cleanup'

/** 配置段在套件 config 下的键。 */
const SECTION = 'dsh-disk-cleanup'

/** 判断是不是 volatile 取值代理（只有一个 get 的普通对象）。 */
function isVolatile(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    && Object.getOwnPropertyNames(value).join() === 'get'
}

/** 读配置段的当前值；volatile 代理解成普通值，非对象段按空配置处理。 */
function readSection(config) {
  const section = config !== null && typeof config === 'object' && !Array.isArray(config)
    ? config[SECTION]
    : undefined
  if (section === null || typeof section !== 'object') return {}
  return Object.fromEntries(Object.entries(section).map(([key, value]) => [
    key,
    isVolatile(value) ? value.get() : value,
  ]))
}

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
    // 解成普通值再交给独立包：它的 schema 把 enabled 定为非 volatile，
    // 直接传 volatile 代理会让子 fiber 启动时 config 校验失败而不加载。
    fiber = ctx.plugin(cleanup, readSection(config))
  }
  mount()
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(path => path[0] === SECTION)) mount()
  })
  ctx.effect(() => () => { fiber?.dispose() }, 'dsh-disk-cleanup 模块')
}
