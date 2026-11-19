import type { Context } from '@deepseek-ai/cordis'


/** 插件配置（与 `cordis.patch.yml` 里的 config 一致，全部可省略）。 */
export interface Config {
  /** 关掉整个插件。默认 true。 */
  enabled?: boolean
  /** 自定义 scratch 目录；空串表示用 `<DSH_HOME>/cache/scratch`。 */
  scratchDir?: string
  /** 让 pwsh / bash 的 TMP / TEMP / TMPDIR 指向 scratch。默认 true。 */
  injectShellTemp?: boolean
  /** Windows 上给 scratch 补访问控制项，让受限子进程也能写。默认 true。 */
  grantProcessWrite?: boolean
  /** 往系统提示里加一段说明。默认 true。 */
  promptSection?: boolean
  /** 加载时与之后定期清掉过期临时文件、请求图片缓存、零引用原件与残留空目录。默认 true。 */
  autoCleanup?: boolean
  /** 保留天数，范围 1–365。临时文件和图片缓存，超过这个天数没改动就清掉；原始图片只有确认没有引用时才会删。默认 3。 */
  cleanupMaxAgeDays?: number
}

/** Cordis 插件身份。 */
export declare const name: string
/** 必需服务。 */
export declare const inject: readonly string[]
/** 配置 schema：宿主用它渲染设置页表单。 */
export declare const Config: unknown
/**
 * 插件入口。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 */
export declare function apply(ctx: Context, config?: Config): void
