import type { Context } from '@deepseek-ai/cordis'

/** 插件配置（与 cordis.patch.yml 里的 config 一致，全部可省略）。 */
export interface Config {
  /** 关掉整个模块。默认 true。 */
  enabled?: boolean
  /** GitHub 目标仓库，预留给同步步骤。默认空串。 */
  repo?: string
  /** 同步间隔小时，范围 1–168。默认 6。 */
  intervalHours?: number
}

/** Cordis 插件身份。 */
export declare const name: string
/** 必需服务。 */
export declare const inject: readonly string[]
/** 配置 schema：宿主用它渲染设置页表单。 */
export declare const Config: unknown
/** 插件入口。 */
export declare function apply(ctx: Context, config?: Config): void
