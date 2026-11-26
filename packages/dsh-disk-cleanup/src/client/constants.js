/** npm 包名：plugins.bundle.config 的槽位 key。 */
export const PLUGIN_PACKAGE = '@6starlong/dsh-disk-cleanup'
/** 配置表单命名空间：bundle id 短名，与 cordis.patch.yml 的 id 一致。 */
export const CONFIG_NS = 'dsh-disk-cleanup'
/** 本地化命名空间。 */
export const NS = 'settings.diskCleanup'

/** 保留天数默认值，与 lib/config.js 的 schema 默认值保持一致；输入框留空时置灰显示。 */
export const DEFAULT_MAX_AGE_DAYS = '3'