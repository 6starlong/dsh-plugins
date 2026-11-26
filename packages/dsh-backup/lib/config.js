/**
 * 备份模块配置 schema：字段全部标 volatile，设置页写回后立即生效。
 * 默认值由 schemastery 提供，找不到平台包时空壳兜底。
 * @module dsh-backup/config
 */
import { z } from './schema.js'

/** 宿主用来渲染设置页表单的 schema。 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('启用 DSH 备份模块'),
  repo: z.string().default('').volatile().description('GitHub 目标仓库'),
  intervalHours: z.number().step(1).min(1).max(168).default(6).volatile().description('同步间隔小时'),
  autoBackupHours: z.number().step(1).min(0).max(168).default(0).volatile().description('自动备份间隔小时，0 为关闭'),
  retention: z.number().step(1).min(3).max(30).default(7).volatile().description('保留备份份数'),
  preset: z.string().default('').volatile().description('当前选中的命名预设，空串为内置默认规则'),
})
