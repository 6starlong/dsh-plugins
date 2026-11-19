/**
 * 构建客户端半边：把 src/client/index.jsx 打成 lib/client.js。
 *
 * 产物是宿主 ModuleLoader 要求的 lazy-CJS 闭包：一个脚本注册包名，交给宿主一个
 * factory(require)；其中 ui-primitives 与 react 由宿主运行时按共享模块表提供，
 * 所以只标记成 external，不打进产物。
 *
 * 不引 esbuild 之类的依赖：本机没有 node_modules，构建只用 Node 自带能力。
 * JSX 在源码里只用了 jsx / jsxs 两个工厂，构建时做一次文本等价替换即可。
 *
 * @module scripts/build
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录。 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** 客户端源码目录。 */
const SRC = join(ROOT, 'src', 'client')
/** 产物目录。 */
const LIB = join(ROOT, 'lib')
/** 产物文件名。 */
const OUTPUT = join(LIB, 'client.js')

/** 由宿主共享模块表提供的依赖，不打包。 */
const EXTERNAL = ['@deepseek-ai/dsh-client-ui-primitives', 'react/jsx-runtime']

/**
 * 把源码里的 ESM 导入改写成闭包里按名字取依赖。
 * @param {string} code - 源码。
 * @returns {string} 正文。
 */
function rewrite(code) {
  let out = code
  // import { a, b as c } from 'x'  →  const { a, b: c } = require('x')
  out = out.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*$/gm, (_all, names, from) => {
    if (!EXTERNAL.includes(from)) throw new Error('未声明的外部依赖：' + from)
    const bindings = names.split(',').map(part => part.trim()).filter(Boolean)
      .map(part => part.replace(/\s+as\s+/, ': '))
    return 'const { ' + bindings.join(', ') + ' } = require(' + JSON.stringify(from) + ')'
  })
  if (/^import\s/m.test(out)) throw new Error('还有没改写的 import 语句，先支持它再发布')
  if (/^export\s/m.test(out)) throw new Error('闭包产物里不能有 export，客户端入口只注册自己')
  return out
}

/**
 * 读出源码目录下所有 .js / .jsx 并拼成一段正文（按文件名排序，入口最后调用）。
 * @returns {Promise<string>} 正文。
 */
async function readSources() {
  const names = (await readdir(SRC)).filter(name => name.endsWith('.js') || name.endsWith('.jsx')).sort()
  const parts = []
  for (const name of names) {
    const code = await readFile(join(SRC, name), 'utf8')
    parts.push('// ---- ' + name + ' ----\n' + rewrite(code).trimEnd())
  }
  return parts.join('\n\n')
}

/**
 * 生成 ModuleLoader 闭包。
 * @param {string} body - 正文。
 * @param {string} packageName - 注册给宿主的包名。
 * @returns {string} 完整脚本。
 */
function wrap(body, packageName) {
  return [
    '// 由 scripts/build.mjs 生成，不要手改。',
    'window.__ModuleLoader__.load({',
    '  id: ' + JSON.stringify(packageName) + ',',
    '  factory: function (require) {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
    ...body.split('\n').map(line => (line === '' ? '' : '    ' + line)),
    '    return module.exports;',
    '  },',
    '});',
    '',
  ].join('\n')
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const body = await readSources()
await mkdir(LIB, { recursive: true })
const output = wrap(body, pkg.name)
await writeFile(OUTPUT, output, 'utf8')
const size = (await stat(OUTPUT)).size
console.log('built ' + OUTPUT + ' (' + size + ' bytes, ' + output.split('\n').length + ' lines)')
