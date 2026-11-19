/**
 * 系统提示里那一段说明（软约束，配合硬机制用）。
 * @module dsh-disk-cleanup/prompt
 */

/**
 * 生成提示文本。
 *
 * 只说「写哪里」和「为什么别放工作区」，不解释保留天数、定时器这类内部策略：
 * 模型既改不了也用不上，写进提示只是噪音。
 * @param {object} options - 生成输入。
 * @param {string} [options.scratchDir] - 当前会话的 scratch 目录。
 * @returns {string} 一段提示。
 */
export function scratchPromptText({ scratchDir } = {}) {
  const lines = [
    'Write temporary files (probe scripts, one-off checks, scratch drafts) to the scratch directory'
      + (scratchDir === undefined ? '' : ` (${scratchDir})`)
      + ': the shell\'s TMP/TEMP point there, and these files may be cleaned up later.',
    'Files the user asked for stay in the workspace: give them a real relative path (for example src/main.ts or report.md) and they are written exactly where you say.',
  ]
  return lines.join(' ')
}
