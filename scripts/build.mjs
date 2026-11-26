/**
 * 构建客户端半边：把 src/client/*.jsx 打成 lib/client.js（lazy-CJS 闭包）。
 * ui-primitives 与 react/jsx-runtime 由宿主共享模块表提供，只标 external。
 *
 * @module scripts/build
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleClient } from './bundle-client.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src', 'client')
const LIB = join(ROOT, 'lib')
const OUTPUT = join(LIB, 'client.js')
const EXTERNAL = ['@deepseek-ai/dsh-client-ui-primitives', 'react/jsx-runtime', 'react']

/**
 * 自动发现 packages/* 里声明 dsh.client 与 ./client 导出的独立包。
 * 每份面板放进独立闭包，避免模块内部的 module.exports 覆盖主包导出。
 * @returns {Promise<string>} 面板模块表与注册语句。
 */
async function readPanels() {
  const parts = ['var __PANEL_MODULES__ = {};']
  const packagesDir = join(ROOT, 'packages')
  const entries = (await readdir(packagesDir, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const pkgPath = join(packagesDir, entry.name)
    const manifest = join(pkgPath, 'package.json')
    if (!(await stat(manifest).catch(() => null))) continue
    const pkg = JSON.parse(await readFile(manifest, 'utf8'))
    const client = pkg.dsh?.client
    if (!client || !pkg.exports?.['./client']) continue
    const srcDir = join(pkgPath, 'src', 'client')
    if (!(await stat(join(srcDir, 'index.jsx')).catch(() => null))) continue
    const code = await bundleClient({ srcDir, external: EXTERNAL })
    parts.push([
      ';(function () {',
      '  var module = { exports: {} };',
      '  var exports = module.exports;',
      ...code.split('\n').map(line => (line === '' ? '' : '  ' + line)),
      '  __PANEL_MODULES__[' + JSON.stringify(pkg.name) + '] = Object.assign({',
      '    id: ' + JSON.stringify(pkg.name) + ',',
      '    section: ' + JSON.stringify(client.section || entry.name) + ',',
      '    title: ' + JSON.stringify(client.title || null) + ',',
      '    description: ' + JSON.stringify(client.description || null) + ',',
      '    version: ' + JSON.stringify(pkg.version) + ',',
      '  }, module.exports);',
      '})();',
    ].join('\n'))
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
const body = (await readPanels()) + '\n\n' + (await bundleClient({ srcDir: SRC, external: EXTERNAL }))
await mkdir(LIB, { recursive: true })
const output = wrap(body, pkg.name)
await writeFile(OUTPUT, output, 'utf8')
const size = (await stat(OUTPUT)).size
console.log('built ' + OUTPUT + ' (' + size + ' bytes, ' + output.split('\n').length + ' lines)')
