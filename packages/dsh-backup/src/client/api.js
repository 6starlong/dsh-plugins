/** 本地备份端点与同源头：与服务端包 packages/dsh-backup/lib/index.js 对齐。 */
export const BACKUP_EXPORT_ROUTE = '/api/starlong/dsh-backup/export'
export const BACKUP_TOKEN_HEADER = 'x-starlong-backup'
export const BACKUP_TREE_ROUTE = '/api/starlong/dsh-backup/tree'
export const BACKUP_PRESET_ROUTE = '/api/starlong/dsh-backup/preset'
export const BACKUP_REVEAL_ROUTE = '/api/starlong/dsh-backup/reveal'
export const BACKUP_VERSIONS_ROUTE = '/api/starlong/dsh-backup/versions'

/** 把根绝对路径端点挂到页面 base 下，兼容带路径前缀的反向代理。 */
export function resolveApiUrl(path) {
  if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/') return path
  const doc = typeof document === 'undefined' ? undefined : document
  const base = doc?.baseURI
  if (typeof base !== 'string' || base === '') return path
  try {
    const url = new URL(base)
    const lastSlash = url.pathname.lastIndexOf('/')
    const last = url.pathname.slice(lastSlash + 1)
    if (/\.(html?|php|aspx?|jsp)$/i.test(last)) url.pathname = url.pathname.slice(0, lastSlash + 1)
    else if (!url.pathname.endsWith('/')) url.pathname += '/'
    return new URL(path.slice(1), url.href).href
  } catch { return path }
}