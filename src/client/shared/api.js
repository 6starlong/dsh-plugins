/** 手动删除端点与同源头：与服务端 session-manager/core.js 对齐。 */
export const DELETE_ROUTE = '/api/starlong/session-manager/delete'
export const DELETE_TOKEN_HEADER = 'x-starlong-delete'
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