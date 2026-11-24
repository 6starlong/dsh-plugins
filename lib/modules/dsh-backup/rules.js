/**
 * DSH 备份规则：内置默认规则 + 用户覆盖，按归属优先、形态兜底判定。
 * 判定优先序：用户覆盖（最长路径优先）→ 自定义正则 → 归属层 → 形态层。
 * @module dsh-starlong/modules/dsh-backup/rules
 */
import { lstat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { homedir } from 'node:os'

/** 形态层默认词表：作为初始勾选与排除依据；归属层是内置常量，不在此配置。 */
export const DEFAULT_PRESET = {
  // 大体积二进制可再生产物与 SQLite sidecar；用户数据格式（mp3/mp4/zip/png）不在此，靠归属判断。
  extensions: '.exe,.dll,.pyd,.so,.dylib,.node,.o,.obj,.a,.lib,.wasm,.pyc,.pyo,.db-wal,.db-shm,.db-journal',
  // 跨平台通用可再生目录名；依赖层更强的四个不再重复列入。
  pathSegments: '.pnpm-store,dist,build,out,target,.next,.nuxt,.output,coverage,.cache,cache,tmp,temp,logs,log,backups,snapshots,rewind-snapshots,state-snapshots,checkpoints,voice-cache,.tox,.nox,.pytest_cache,.mypy_cache,.ruff_cache,.eslintcache,.parcel-cache,.nyc_output,.idea,.vscode,.gradle,venv,site-packages',
  // 临时/锁/备份/日志与系统文件，与 extensions 不重叠。
  namePatterns: '*.pid,*.lock,*-lock,*.tmp,*.temp,*.swp,*.bak,*.log,*.journal,.DS_Store,Thumbs.db,desktop.ini',
}

/** 逗号、中文逗号或换行分隔，转小写去空。 */
export function parseList(text) {
  return String(text ?? '').split(/[,，\n\r]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
}

/** 归属层（内置，不随预设变化）：依赖目录任意层级命中即排除。 */
const DEPENDENCY_DIRS = parseList('node_modules,.git,__pycache__,.venv')
/** 归属层：可确认的 DSH 客户端产物（目录或初始文件），从根匹配整棵排除，先于数据根判定。 */
const CLIENT_PATHS = parseList('dsh-runtimes,speech-to-text,storages/session_projcache,.anonymous-user-id').map(s => s.replace(/^\/+|\/+$/g, ''))
/** 归属层：可确认的必要用户数据（目录或初始文件），从根匹配整棵保留，形态规则不穿透。 */
const DATA_PATHS = parseList('sessions,attachments,profiles,storages,skills,.credentials.yaml').map(s => s.replace(/^\/+|\/+$/g, ''))

/** glob 风格匹配：只支持 * 通配，避免正则注入。 */
function globMatch(name, pattern) {
  if (!pattern.includes('*')) return name === pattern
  const parts = pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp('^' + parts.join('.*') + '$', 'i').test(name)
}

/**
 * 构造匹配器：归属优先、形态兜底，返回排除原因字符串，命中即排除。
 * @param {{extensions?:string,pathSegments?:string,namePatterns?:string}} preset - 形态层词表覆盖；归属层内置不可改。
 */
export function buildMatcher(preset, regexText) {
  const regexRules = parseRegex(regexText)
  const exts = new Set(parseList(preset?.extensions ?? DEFAULT_PRESET.extensions))
  const segs = new Set(parseList(preset?.pathSegments ?? DEFAULT_PRESET.pathSegments))
  const pats = parseList(preset?.namePatterns ?? DEFAULT_PRESET.namePatterns)
  const dependencyDirs = DEPENDENCY_DIRS
  const clientPaths = CLIENT_PATHS
  const dataPaths = DATA_PATHS
  // 底座与数据根从根精确匹配，不扫描插件内同名目录；底座先判以压过 storages 数据根。
  const normPath = relPath => String(relPath).replace(/\\/g, '/').toLowerCase()
  const fromRoot = (norm, list) => list.find(d => norm === d || norm.startsWith(d + '/')) || null
  const match = (relPath, name, isDirectory, skipParentSegs) => {
    const lower = String(name).toLowerCase()
    const norm = normPath(relPath)
    const parentSegs = norm.split('/').slice(0, -1)

    // L0 自定义正则：gitignore 风格匹配相对路径即排除，优先于内置规则。
    for (const rule of regexRules) if (rule.test(norm)) return 'regex:' + rule.source

    // L1 归属层：底座目录整棵排除。
    const clientDir = fromRoot(norm, clientPaths)
    if (clientDir) return 'clientDir:' + clientDir

    // L1 归属层：依赖目录，任意层级命中即排除。
    if (isDirectory && dependencyDirs.includes(lower)) return 'dependency:' + lower
    if (!skipParentSegs) {
      const dep = parentSegs.find(seg => dependencyDirs.includes(seg))
      if (dep) return 'dependency:' + dep
    }

    // L2 归属层：用户数据根整棵保留，形态规则不穿透。
    if (fromRoot(norm, dataPaths)) return null

    // L3 形态层：只对未归类路径生效。
    if (isDirectory && segs.has(lower)) return 'pathSegment:' + lower
    if (!isDirectory && exts.has(extname(lower))) return 'extension:' + extname(lower)
    if (!skipParentSegs) {
      for (const seg of parentSegs) if (segs.has(seg)) return 'pathSegment:' + seg
    }
    for (const pat of pats) if (globMatch(lower, pat)) return 'namePattern:' + pat
    return null
  }
  return match
}

/** gitignore 风格正则：逗号/中文逗号/换行分隔，匹配相对路径即排除；无效表达式忽略，最多 64 条。 */
export function parseRegex(text) {
  const lines = String(text ?? '').split(/[\n\r,，]+/).map(s => s.trim()).filter(Boolean).slice(0, 64)
  const rules = []
  for (const line of lines) {
    try {
      const source = line.startsWith('/') ? line.slice(1) : line
      if (source !== '') rules.push(new RegExp(source, 'i'))
    } catch { /* 无效正则忽略，不影响其余规则 */ }
  }
  return rules
}

/**
 * 勾选决策器：用户覆盖按最长路径优先；未覆盖回落到 matcher 默认规则。
 * overrides[rel]=false 整棵排除；=true 整棵纳入（子树仍可被更精确覆盖）。
 */
export function buildDecider(matcher, overrides) {
  const list = overrides !== null && typeof overrides === 'object'
    ? Object.entries(overrides).filter(([key, value]) => typeof key === 'string' && key !== '' && typeof value === 'boolean')
      .map(([key, value]) => [key.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase(), value])
    : []
  const decide = (rel, name, isDirectory, skipParentSegs = true) => {
    const norm = String(rel).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
    let hit = null
    let best = -1
    for (const [key, value] of list) {
      if ((norm === key || norm.startsWith(key + '/')) && key.length > best) { best = key.length; hit = value }
    }
    if (hit !== null) return { included: hit, reason: 'override:' + hit }
    const reason = matcher(rel, name, isDirectory, skipParentSegs)
    return { included: reason === null, reason }
  }
  decide.hasIncludedDescendant = rel => {
    const norm = String(rel).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
    const prefix = norm + '/'
    return list.some(([key, value]) => value === true && key.startsWith(prefix))
  }
  return decide
}

/** 递归统计目录大小，用于排除报告。 */
async function dirSize(dir) {
  let size = 0
  let count = 0
  async function walk(current) {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        try { size += (await lstat(full)).size; count++ } catch { /* 扫描期间消失 */ }
      }
    }
  }
  await walk(dir)
  return { size, count }
}

/**
 * 扫描目录，返回纳入/排除两份清单。排除目录整体计一条，附体积与命中规则。
 * @param {string} home - 被扫描的根目录。
 * @param {(rel:string,name:string,isDir:boolean,skipParentSegs?:boolean)=>string|null} matcher - buildMatcher 产物。
 * @param {(scanned:number)=>void} [onProgress] - 每 200 项回调一次。
 */
export async function scanTree(home, matcher, onProgress, overrides) {
  const decide = buildDecider(matcher, overrides)
  const included = []
  const excluded = []
  let scanned = 0
  async function walk(dir, prefix, parentExcluded = false) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name
      const full = join(dir, entry.name)
      scanned++
      if (scanned % 200 === 0) onProgress?.(scanned)
      if (entry.isSymbolicLink()) {
        excluded.push({ rel, kind: 'symlink', size: 0, reason: 'symbolicLink' })
        continue
      }
      const decision = decide(rel, entry.name, entry.isDirectory(), !parentExcluded)
      if (!decision.included) {
        // 被排除目录含显式纳入的后代时下钻，让勾选的子项真正进包。
        if (entry.isDirectory() && decide.hasIncludedDescendant(rel)) {
          await walk(full, rel, true)
          continue
        }
        const measured = entry.isDirectory() ? await dirSize(full) : { size: 0, count: 0 }
        excluded.push({ rel, kind: entry.isDirectory() ? 'directory' : 'file', size: measured.size, files: measured.count, reason: decision.reason })
        continue
      }
      if (entry.isDirectory()) await walk(full, rel, false)
      else {
        try {
          const st = await lstat(full)
          included.push({ path: full, rel, size: st.size })
        } catch { /* 扫描期间消失 */ }
      }
    }
  }
  await walk(home, '')
  return {
    included,
    excluded,
    stats: {
      includeFiles: included.length,
      includeBytes: included.reduce((sum, item) => sum + item.size, 0),
      excludeItems: excluded.length,
      excludeBytes: excluded.reduce((sum, item) => sum + item.size, 0),
    },
  }
}

/** DSH 根目录：DSH_HOME 优先，否则用户目录下的 .dsh。 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(homedir(), '.dsh')
}

/**
 * 统计一条分支的实际纳入情况：纳入字节、纳入文件数、物理总量，以及是否含排除项。
 * 与 scanTree 判定一致：目录被排除则整棵不再判定纳入，只累加物理量用于稳定排序。
 */
async function measureBranch(decide, dir, prefix, ancestorExcluded = false) {
  const acc = { physicalBytes: 0, physicalFiles: 0, includedBytes: 0, includedFiles: 0, excludedItems: 0, excludedBytes: 0, hasExcluded: false }
  async function walk(current, relPrefix, parentExcluded = false) {
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const rel = relPrefix ? relPrefix + '/' + entry.name : entry.name
      const full = join(current, entry.name)
      const isDirectory = entry.isDirectory()
      const decision = decide(rel, entry.name, isDirectory, !parentExcluded)
      if (!decision.included) {
        acc.hasExcluded = true
        if (isDirectory && decide.hasIncludedDescendant(rel)) {
          await walk(full, rel, true)
          continue
        }
        acc.excludedItems++
        if (isDirectory) {
          const measured = await dirSize(full)
          acc.physicalBytes += measured.size
          acc.physicalFiles += measured.count
          acc.excludedBytes += measured.size
        } else {
          try {
            const sz = (await lstat(full)).size
            acc.physicalBytes += sz
            acc.physicalFiles++
            acc.excludedBytes += sz
          } catch { /* 扫描期间消失 */ }
        }
        continue
      }
      if (isDirectory) {
        await walk(full, rel, false)
      } else {
        try {
          const sz = (await lstat(full)).size
          acc.physicalBytes += sz
          acc.physicalFiles++
          acc.includedBytes += sz
          acc.includedFiles++
        } catch { /* 扫描期间消失 */ }
      }
    }
  }
  await walk(dir, prefix, ancestorExcluded)
  return acc
}

/**
 * 列出指定目录的直接子项，供设置页树按需展开。
 * size 是物理占用字节（不随勾选变化）；partial 表示子项有未勾选；排序固定按 size 降序。
 */
export async function describeChildren(home, relPath, matcher, overrides, withStats = false) {
  const decide = buildDecider(matcher, overrides)
  const norm = String(relPath ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const target = norm === '' ? home : join(home, norm)
  const prefix = norm === '' ? '' : norm + '/'
  const nodes = []
  const stats = { includeFiles: 0, includeBytes: 0, excludeItems: 0, excludeBytes: 0 }
  let entries
  try { entries = await readdir(target, { withFileTypes: true }) } catch { return withStats ? { nodes, stats } : nodes }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const rel = prefix + entry.name
    const full = join(target, entry.name)
    const isDirectory = entry.isDirectory()
    const decision = decide(rel, entry.name, isDirectory, false)
    let size = 0
    let physical = 0
    let files = 0
    let included = decision.included
    let partial = false
    if (isDirectory) {
      const measured = await measureBranch(decide, full, rel, !decision.included)
      size = measured.physicalBytes
      physical = measured.physicalBytes
      files = measured.physicalFiles
      stats.includeFiles += measured.includedFiles
      stats.includeBytes += measured.includedBytes
      stats.excludeItems += measured.excludedItems
      stats.excludeBytes += measured.excludedBytes
      if (measured.physicalFiles === 0) continue
      included = measured.includedFiles === measured.physicalFiles
      partial = measured.includedFiles > 0 && measured.includedFiles < measured.physicalFiles
    } else {
      try {
        physical = (await lstat(full)).size
        size = physical
        if (decision.included) { files = 1; stats.includeFiles++; stats.includeBytes += physical }
        else { stats.excludeItems++; stats.excludeBytes += physical }
      } catch { /* 扫描期间消失 */ }
    }
    nodes.push({
      rel, name: entry.name, kind: isDirectory ? 'directory' : 'file',
      size, physicalSize: physical, files,
      included, partial, reason: decision.reason,
    })
  }
  nodes.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
  return withStats ? { nodes, stats } : nodes
}
