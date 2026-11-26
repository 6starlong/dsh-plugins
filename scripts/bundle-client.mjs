import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

/**
 * 轻量前端打包：按相对 import 递归收集源码，剥掉 ESM 语法，拼成单个闭包正文。
 * 宿主 ModuleLoader 只认单文件 lazy-CJS，所以不引入真实模块运行时。
 */
function relativeDeps(code) {
  return [...code.matchAll(/^import\s+(?:[^'"]*?from\s*)?['"](\.[^'"]+)['"]\s*;?\s*$/gm)].map(match => match[1])
}

function resolveDep(fromFile, spec) {
  const target = resolve(dirname(fromFile), spec)
  return target.endsWith('.js') || target.endsWith('.jsx') ? target : target + '.js'
}

async function collect(file, visited, visiting) {
  if (visited.has(file)) return []
  if (visiting.has(file)) throw new Error('前端源码存在循环依赖：' + file)
  visiting.add(file)
  const code = await readFile(file, 'utf8')
  const parts = []
  for (const dep of relativeDeps(code).map(spec => resolveDep(file, spec))) {
    parts.push(...await collect(dep, visited, visiting))
  }
  visiting.delete(file)
  visited.add(file)
  parts.push({ file, code })
  return parts
}

function externalDeps(code) {
  return [...code.matchAll(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm)]
    .map(match => ({ names: match[1], from: match[2] }))
    .filter(item => !item.from.startsWith('.'))
}

function bindingNames(names) {
  return names.split(',').map(part => part.trim()).filter(Boolean)
    .map(part => part.replace(/\s+as\s+/, ': '))
}

function rewrite(code) {
  let out = code.replace(/^import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
  out = out.replace(/^import\s+(?:[^'"]*?from\s*)?['"](\.[^'"]+)['"]\s*;?\s*$/gm, '')
  out = out.replace(/^export\s+(?=(?:const|let|var|function|class)\b)/gm, '')
  out = out.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
  if (/^import\s/m.test(out)) throw new Error('还有没改写的 import 语句，先支持它再发布')
  if (/^export\s/m.test(out)) throw new Error('闭包产物里不能有 export，客户端入口只注册自己')
  return out
}

/** @returns {Promise<string>} 依赖顺序排列后的闭包正文。 */
export async function bundleClient({ srcDir, rootFile = 'index.jsx', external = [] }) {
  const root = resolve(srcDir, rootFile)
  const parts = await collect(root, new Set(), new Set())
  const externals = new Map()
  for (const { code } of parts) {
    for (const { names, from } of externalDeps(code)) {
      if (!external.includes(from)) throw new Error('未声明的外部依赖：' + from)
      if (!externals.has(from)) externals.set(from, new Set())
      for (const name of bindingNames(names)) externals.get(from).add(name)
    }
  }
  const header = [...externals].map(([from, bindings]) => (
    'const { ' + [...bindings].join(', ') + ' } = require(' + JSON.stringify(from) + ')'
  )).join('\n')
  const body = parts.map(({ file, code }) => (
    '// ---- ' + relative(srcDir, file).replace(/\\/g, '/') + ' ----\n' + rewrite(code).trimEnd()
  )).join('\n\n')
  return (header ? header + '\n\n' : '') + body
}