/**
 * 构建备份包客户端：把 src/client/index.jsx 打成 lib/client.js。
 * 宿主 ModuleLoader 只认单文件 lazy-CJS，相对依赖由 bundle-client 内联。
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleClient } from '../../../scripts/bundle-client.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src', 'client')
const OUTPUT = join(ROOT, 'lib', 'client.js')
const EXTERNAL = ['@deepseek-ai/dsh-client-ui-primitives', 'react/jsx-runtime', 'react']

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const body = await bundleClient({ srcDir: SRC, external: EXTERNAL })
const output = [
  '// 由 scripts/build.mjs 生成，不要手改。',
  'window.__ModuleLoader__.load({',
  '  id: ' + JSON.stringify(pkg.name) + ',',
  '  factory: function (require) {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  ...body.split('\n').map(line => (line === '' ? '' : '    ' + line)),
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')
await mkdir(join(ROOT, 'lib'), { recursive: true })
await writeFile(OUTPUT, output, 'utf8')
console.log('built ' + OUTPUT + ' (' + (await stat(OUTPUT)).size + ' bytes, ' + output.split('\n').length + ' lines)')
