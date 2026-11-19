import { apply, name } from '../lib/index.js'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'dsh-starlong-'))
process.env.DSH_HOME = HOME
after(() => rmSync(HOME, { recursive: true, force: true }))

/** 只提供 disk-cleanup 注册路径需要的宿主方法，不碰真实文件系统。 */
function mockHost() {
  const globals = new Map()
  for (const n of ['pwsh', 'bash']) {
    globals.set(n, {
      name: n,
      description: n,
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object' }, render: () => [] },
      async execute() { return {} },
    })
  }
  const agents = []
  const sandboxPolicy = {
    resolve: () => ({ mode: 'workspace-write', workspaceRoot: 'C:\\ws' }),
    registerWritableRoot: () => () => {},
  }
  return {
    tools: { get: (n) => globals.get(n), register: () => () => {} },
    agents: { list: () => agents },
    on: () => () => {},
    inject: (_names, fn) => {
      fn({
        sandboxPolicy,
        agents: { list: () => agents },
        systemPrompt: { getSectionOrder: () => 1200, section: () => () => {} },
      })
      return () => {}
    },
    effect: (fn) => { const dispose = fn(); return () => dispose() },
    interval: () => () => {},
    emit: async () => {},
  }
}

test('导出插件身份', () => {
  assert.equal(name, 'dsh-starlong')
  assert.equal(typeof apply, 'function')
})

test('装配已登记模块', () => {
  assert.doesNotThrow(() => apply(mockHost(), {}))
})

test('模块配置段可关闭 disk-cleanup', () => {
  assert.doesNotThrow(() => apply(mockHost(), { 'dsh-disk-cleanup': { enabled: false } }))
})
