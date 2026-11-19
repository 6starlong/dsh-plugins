/** 插件身份（与包名一致）。 */
export const name: string
/** 依赖的宿主服务。 */
export const inject: string[]
/** 插件入口。 */
export function apply(ctx: unknown, config: unknown): void
