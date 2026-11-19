/**
 * 往 pwsh / bash 的命令串前注入环境变量。
 * @module dsh-disk-cleanup/shell-env
 */

/**
 * 单引号包裹并转义，供 pwsh 与 bash 共用。
 * @param {string} value - 原始字符串。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @returns {string} 已加引号的字面量。
 */
export function quote(value, shell) {
  if (shell === 'pwsh') return `'${String(value).replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/**
 * 判断命令串是否自己设置过某个环境变量（用户显式指定时不覆盖）。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @param {string} command - 原始命令串。
 * @param {string} name - 环境变量名。
 * @returns {boolean} 是否已自行设置。
 */
export function alreadySets(shell, command, name) {
  if (typeof command !== 'string' || typeof name !== 'string' || name === '') return false
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = shell === 'pwsh'
    ? new RegExp(`\\$env:${escaped}\\s*=`, 'i')
    : new RegExp(`(?:^|[;&|(\\s])(?:export\\s+)?${escaped}\\s*=`, 'i')
  return pattern.test(command)
}

/**
 * 判断命令串是否自己设置过临时目录。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @param {string} command - 原始命令串。
 * @returns {boolean} 是否已自行设置。
 */
export function alreadySetsTemp(shell, command) {
  return alreadySets(shell, command, 'TMP')
    || alreadySets(shell, command, 'TEMP')
    || (shell === 'bash' && alreadySets(shell, command, 'TMPDIR'))
}

/**
 * 生成环境变量赋值前缀。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @param {Array<[string, string]>} entries - 变量名与值。
 * @returns {string} 可直接拼在命令前的字符串。
 */
export function envPrefix(shell, entries) {
  const parts = entries.map(([name, value]) => (shell === 'pwsh'
    ? `$env:${name}=${quote(value, 'pwsh')}; `
    : `export ${name}=${quote(value, 'bash')}; `))
  return parts.join('')
}

/**
 * 给命令串注入环境变量前缀；命令自己设置过的变量跳过。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @param {string} command - 原始命令串。
 * @param {Array<[string, string]>} entries - 变量名与值。
 * @returns {string} 注入后的命令串（无需注入时原样返回）。
 */
export function injectShellEnv(shell, command, entries) {
  if (typeof command !== 'string' || command === '') return command
  const usable = []
  for (const [name, value] of entries) {
    if (typeof value !== 'string' || value === '') continue
    if (alreadySets(shell, command, name)) continue
    usable.push([name, value])
  }
  if (usable.length === 0) return command
  return envPrefix(shell, usable) + command
}

/**
 * 只注入临时目录（TMP / TEMP，bash 另有 TMPDIR）。
 * @param {'pwsh' | 'bash'} shell - 目标 shell。
 * @param {string} command - 原始命令串。
 * @param {string | undefined} dir - 临时目录；为空表示本次不注入。
 * @returns {string} 注入后的命令串。
 */
export function injectShellTemp(shell, command, dir) {
  if (typeof dir !== 'string' || dir === '') return command
  const entries = shell === 'bash'
    ? [['TMPDIR', dir], ['TMP', dir], ['TEMP', dir]]
    : [['TMP', dir], ['TEMP', dir]]
  return injectShellEnv(shell, command, entries)
}
