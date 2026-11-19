import { apply, name } from '../lib/index.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('导出插件身份', () => {
  assert.equal(name, 'dsh-starlong')
  assert.equal(typeof apply, 'function')
})

test('空模板加载不报错', () => {
  assert.doesNotThrow(() => apply({}, {}))
})
