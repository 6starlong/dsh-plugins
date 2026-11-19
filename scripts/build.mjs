/**
 * 构建客户端半边：把 src/client/*.jsx 打成 lib/client.js（lazy-CJS 闭包）。
 * ui-primitives 与 react/jsx-runtime 由宿主共享模块表提供，只标 external。
 *
 * @module scripts/build
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src', 'client')
const LIB = join(ROOT, 'lib')
const OUTPUT = join(LIB, 'client.js')
const EXTERNAL = ['@deepseek-ai/dsh-client-ui-primitives', 'react/jsx-runtime']

function rewrite(code) {
  let out = code
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

async function readSources() {
  const names = (await readdir(SRC)).filter(name => name.endsWith('.js') || name.endsWith('.jsx')).sort()
  const parts = []
  for (const name of names) {
    const code = await readFile(join(SRC, name), 'utf8')
    parts.push('// ---- ' + name + ' ----\n' + rewrite(code).trimEnd())
  }
  return parts.join('\n\n')
}

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
