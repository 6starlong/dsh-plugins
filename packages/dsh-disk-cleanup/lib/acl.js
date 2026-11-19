/**
 * 给受限子进程补写权限（仅 Windows）。
 *
 * workspace-write 模式下，子进程拿的是受限令牌，能写的只有工作区根和它自己的
 * 私有临时目录。要让子进程也能写 scratch，必须把同一个工作区写标识加到该目录的
 * 访问控制列表上——令牌里已经有这个标识，加上就能通过。
 * @module dsh-disk-cleanup/acl
 */
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 内部包名。它只随 DSH 安装提供，不在 profile 的依赖里。 */
const ACL_PACKAGE = '@deepseek-ai/dsh-sandbox-windows-acl'

/**
 * 按 DSH 的安装位置解析内部包。
 * @returns {string | undefined} 包内入口的绝对路径；找不到时 undefined。
 */
function resolveAclPackage() {
  const installRoot = dirname(process.execPath)
  const appRoot = join(installRoot, 'resources', 'app.asar', 'dsh', 'node_modules')
  try {
    const require = createRequire(join(appRoot, 'noop.js'))
    return require.resolve(ACL_PACKAGE)
  } catch {
    return undefined
  }
}

/** 已加载的包导出；null 表示确认不可用。 */
let aclModule

/**
 * 加载 ACL 包（按需，只尝试一次）。
 * @returns {Promise<object | undefined>} 包导出；不可用时 undefined。
 */
async function loadAcl() {
  if (aclModule !== undefined) return aclModule ?? undefined
  if (process.platform !== 'win32') {
    aclModule = null
    return undefined
  }
  const entry = resolveAclPackage()
  if (entry === undefined) {
    aclModule = null
    return undefined
  }
  try {
    const mod = await import(pathToFileURL(entry).href)
    const usable = typeof mod.AclWriteGrant?.create === 'function' && typeof mod.workspaceWriteSid === 'function'
    aclModule = usable ? mod : null
  } catch {
    aclModule = null
  }
  return aclModule ?? undefined
}

/**
 * 解析成符号链接展开后的物理路径（访问控制列表比较的就是它）。
 * @param {string} target - 原始路径。
 * @returns {string} 物理路径；解析失败时原样返回。
 */
export function physicalPath(target) {
  try {
    return realpathSync.native(target)
  } catch {
    return target
  }
}

/**
 * 已经授权过的目录。键是工作区与目录的物理路径，同一工作区的多个会话共用一份授权。
 * @type {Map<string, {grant: object}>}
 */
const grants = new Map()

/**
 * 给一个目录加上工作区写权限，让受限子进程能写进去。
 *
 * 幂等：同一组工作区与目录只建一次授权。
 * 访问控制项按 standing 建，和 DSH 自己对可写目录的处理一致——撤销后下一个会话
 * 就会被挡住，而这层授权本就是为了复用而存在，所以卸载时不撤销。revokeAll 只
 * 释放授权对象持有的标识，不动目录上的访问控制项。
 * @param {string} workspaceRoot - 会话工作区根。
 * @param {string} directory - 需要可写的目录。
 * @returns {Promise<boolean>} 是否可用（Windows 之外或内部包不可用时为 false）。
 */
export async function grantProcessWrite(workspaceRoot, directory) {
  const acl = await loadAcl()
  if (acl === undefined) return false
  const root = physicalPath(workspaceRoot)
  const dir = physicalPath(directory)
  const key = JSON.stringify([root, dir])
  if (grants.has(key)) return true
  try {
    const grant = acl.AclWriteGrant.create(acl.workspaceWriteSid(root))
    grant.add(dir, true)
    grants.set(key, { grant })
    return true
  } catch {
    return false
  }
}

/**
 * 释放全部授权对象。插件卸载时调用；单个失败不影响其余。
 * 目录上的访问控制项是 standing 的，dispose 不会撤销它们（见 AclWriteGrant 的约定），
 * 所以这里只是释放资源，不会让之后的会话失去写 scratch 的能力。
 * @returns {void}
 */
export function revokeAll() {
  for (const [key, entry] of grants) {
    try {
      entry.grant.dispose()
    } catch {
      /* 单个撤销失败不阻塞其余 */
    }
    grants.delete(key)
  }
}
