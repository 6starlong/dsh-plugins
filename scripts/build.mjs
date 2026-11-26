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

/** 需要在主包卡片里嵌入配置面板的独立 npm 包；titleKey 指向根包文案键。 */
const PANEL_PACKAGES = [{ dir: 'dsh-disk-cleanup', id: 'dsh-disk-cleanup', titleKey: 'title', descriptionKey: 'description' }]

/**
 * 构建期内联子包面板源码：宿主只加载启动清单里的 bundle，不会自动加载依赖包的 client。
 * 每份面板放进独立闭包，避免模块内部的 module.exports 覆盖主包导出。
 * @returns {Promise<string>} 面板模块表与注册语句。
 */
async function readPanels() {
  const parts = ['var __PANEL_MODULES__ = {};']
  for (const meta of PANEL_PACKAGES) {
    const pkg = JSON.parse(await readFile(join(ROOT, 'packages', meta.dir, 'package.json'), 'utf8'))
    const file = join(ROOT, 'packages', meta.dir, 'src', 'client', 'index.jsx')
    const code = await bundleClient({ srcDir: join(ROOT, 'packages', meta.dir, 'src', 'client'), external: EXTERNAL })
    parts.push([
      ';(function () {',
      '  var module = { exports: {} };',
      '  var exports = module.exports;',
      ...code.split('\n').map(line => '  ' + line),
      '  __PANEL_MODULES__[' + JSON.stringify(meta.id) + '] = Object.assign({',
      '    id: ' + JSON.stringify(meta.id) + ',',
      '    titleKey: ' + JSON.stringify(meta.titleKey) + ',',
      '    descriptionKey: ' + JSON.stringify(meta.descriptionKey) + ',',
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
