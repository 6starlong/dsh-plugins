/**
 * 套件 Config schema：设置服务只认导出的 Config，且字段必须标 volatile
 * 才会进入 settings.describe 的命名空间列表；没有它，客户端的
 * configForms.whileServed 永远不会触发，设置页与卡片都不出现。
 *
 * 模块段直接复用独立包导出的 schema，不另抄字段，避免两处默认值走样。
 * @module dsh-plugins/config
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Config as DiskCleanupConfig } from '@6starlong/dsh-disk-cleanup'
import { Config as BackupConfig } from '@6starlong/dsh-backup'

const SCHEMA_PACKAGE = '@deepseek-ai/schemastery'

/**
 * 同步取 schemastery 构建器。link 安装时包不在本仓库的解析链上，
 * 依次试：本模块位置、宿主进程工作目录（profile 一级）、DSH 安装位置。
 * @returns {Function | undefined} 构建器；哪里都解析不到时 undefined。
 */
function loadBuilder() {
  const bases = [import.meta.url, join(process.cwd(), 'noop.js')]
  const appRoot = join(dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules')
  bases.push(join(appRoot, 'noop.js'))
  for (const base of bases) {
    try {
      const mod = createRequire(base)(SCHEMA_PACKAGE)
      if (typeof mod === 'function') return mod
      if (typeof mod?.default === 'function') return mod.default
    } catch { /* 这一级解析不到，换下一级 */ }
  }
  return undefined
}

const z = loadBuilder()

/**
 * 套件 schema。解析不到 schemastery 时导出 undefined：
 * 宿主会跳过本条目的设置表单，插件其余机制照常工作。
 */
export const Config = z === undefined ? undefined : z.object({
  // 独立包的 enabled 不是 volatile，设置页写不进；这里复用其余字段，
  // 只把启停开关覆盖成 volatile，改完即时生效。
  'dsh-disk-cleanup': z.object({
    ...DiskCleanupConfig.dict,
    enabled: z.boolean().default(true).volatile().description('启用过期清理模块'),
  }),
  // 会话管理：只存触发参数，归档写入由 DSH 内置 API 完成。字段全部 volatile 供设置页直写。
  'session-manager': z.object({
    enabled: z.boolean().default(true).volatile().description('启用会话管理模块'),
    autoArchive: z.boolean().default(true).volatile().description('自动归档闲置会话'),
    idleDays: z.number().step(1).min(1).max(365).default(3).volatile().description('归档前无活动天数'),
    autoDelete: z.boolean().default(false).volatile().description('自动删除闲置会话'),
    deleteDays: z.number().step(1).min(1).max(999).default(90).volatile().description('删除前无活动天数'),
  }),
  // DSH 备份：字段复用独立包 schema，三项都是 volatile，设置页可直写。
  'dsh-backup': z.object({
    ...BackupConfig.dict,
  }),
})
