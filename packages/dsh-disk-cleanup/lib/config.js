/**
 * 配置字段、默认值与归一化。
 *
 * 默认值手写一份，schema 只负责设置页表单：包解析不到时 schema 是空壳，
 * 配置就全靠这份手写默认值，两处不一致会让人以为改坏了。
 * @module dsh-disk-cleanup/config
 */
import { z } from './schema.js'

/** 保留天数下限。 */
export const MAX_AGE_MIN = 1
/** 保留天数上限。 */
export const MAX_AGE_MAX = 365

/**
 * 配置 schema，宿主用它渲染设置页表单。
 * 标了 volatile 的字段改完立即生效，不必重载插件。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).description('启用插件：注入临时目录、补齐写权限、注入系统提示'),
  scratchDir: z.string().default('').description('scratch 目录；留空用 <DSH_HOME>/cache/scratch'),
  injectShellTemp: z.boolean().default(true).description('把 pwsh / bash 的 TMP / TEMP / TMPDIR 指向 scratch'),
  grantProcessWrite: z.boolean().default(true).description('Windows 上给 scratch 补访问控制项，让受限子进程也能写'),
  promptSection: z.boolean().default(true).description('往系统提示里加一段临时文件落点说明'),
  autoCleanup: z.boolean().default(true).volatile().description('加载时与之后定期清掉过期临时文件、请求图片缓存、零引用原件与残留空目录'),
  cleanupMaxAgeDays: z.number().step(1).min(MAX_AGE_MIN).max(MAX_AGE_MAX).default(3).volatile()
    .description('保留天数：临时文件和图片缓存，超过这个天数没改动就清掉；原始图片只有确认没有引用时才会删。'),
})

/**
 * 默认配置。
 *
 * 从 schema 推出来，不另抄一份：两处各写一遍迟早会走样。
 * 标了 volatile 的字段被 schema 包成取值代理，这里统一解成普通值。
 */
export const DEFAULT_CONFIG = fallbackDefaults()

/**
 * 默认值。
 *
 * 拿得到 schema 就从 schema 取，取不到（插件被单独安装、找不到平台包）就用这份
 * 手写值兜底，两边的取值必须一致，测试会盯着。
 * @returns {Readonly<object>} 默认配置。
 */
function fallbackDefaults() {
  const fromSchema = Config({})
  const schemaReady = fromSchema !== null && typeof fromSchema === 'object'
    && Object.keys(fromSchema).length > 0
  return Object.freeze(schemaReady ? normalize(fromSchema) : {
    enabled: true,
    scratchDir: '',
    injectShellTemp: true,
    grantProcessWrite: true,
    promptSection: true,
    autoCleanup: true,
    cleanupMaxAgeDays: 3,
  })
}

/**
 * 把 schema 解析结果里的 volatile 代理解成普通值。
 * @param {object} input - Schema 解析结果。
 * @returns {object} 全为普通值的配置。
 */
function normalize(input) {
  const plain = (value) => {
    if (!isVolatile(value)) return value
    try {
      return Reflect.apply(value.get, value, [])
    } catch {
      return undefined
    }
  }
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, plain(value)]))
}

/**
 * 判断是不是 volatile 代理。
 * @param {unknown} value - 待判断的值。
 * @returns {boolean} 是代理时为 true。
 */
function isVolatile(value) {
  // volatile 值的形状是「只有一个 get 的普通对象」，没有 set / watch。
  return value !== null && typeof value === 'object' && typeof value.get === 'function'
    && Object.getOwnPropertyNames(value).join() === 'get'
}

/**
 * 把用户配置合并到默认值上，并做最小校验。
 *
 * 这里再归一一次而不只依赖 schema：cordis.patch.yml 里的 config 是手写的，
 * 类型写错时应当退化到默认值，而不是整条插件启动失败。
 * @param {unknown} raw - cordis.patch.yml 或设置页给出的 config。
 * @returns {typeof DEFAULT_CONFIG} 归一化后的配置。
 */
export function resolveConfig(raw) {
  // cordis 把 volatile 字段以取值代理传入，先解成普通值再校验。
  const input = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? normalize(raw) : {}
  const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
  const text = (value, fallback) => (typeof value === 'string' ? value : fallback)
  // 数字与数字字符串都收：设置页写回的是数字，手写 YAML 里写成 "7" 也很常见。
  const requested = typeof input.cleanupMaxAgeDays === 'string' && input.cleanupMaxAgeDays.trim() !== ''
    ? Number(input.cleanupMaxAgeDays.trim())
    : input.cleanupMaxAgeDays
  const days = Number.isFinite(requested)
    ? Math.min(MAX_AGE_MAX, Math.max(MAX_AGE_MIN, Math.round(requested)))
    : DEFAULT_CONFIG.cleanupMaxAgeDays
  return {
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled),
    scratchDir: text(input.scratchDir, DEFAULT_CONFIG.scratchDir).trim(),
    injectShellTemp: bool(input.injectShellTemp, DEFAULT_CONFIG.injectShellTemp),
    grantProcessWrite: bool(input.grantProcessWrite, DEFAULT_CONFIG.grantProcessWrite),
    promptSection: bool(input.promptSection, DEFAULT_CONFIG.promptSection),
    autoCleanup: bool(input.autoCleanup, DEFAULT_CONFIG.autoCleanup),
    cleanupMaxAgeDays: days,
  }
}
