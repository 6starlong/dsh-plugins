// 客户端卡片链路验证：不加载 ui-primitives 真包（它依赖 react 与 css 文件，只能在宿主
// 浏览器里跑），改用最小的假实现，核对 lib/client.js 的注册与保存行为。
// ui-primitives 各组件的确切签名已按发布包类型声明逐个核对过。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 记录最后一次写入的假配置表单。 */
function fakeScope(initial) {
  let baseValue = { ...initial }
  let user = {}
  const listeners = new Set()
  return {
    get user() { return { ...user } },
    getSnapshot: () => ({
      status: 'ready',
      value: { ...baseValue, ...user },
      base: baseValue,
      user: { ...user },
      writable: true,
      revision: 1,
    }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    mutate: async (ops) => {
      for (const op of ops) {
        if (op.op === 'set') user = { ...user, [op.path[0]]: op.value }
        else if (op.op === 'unset') { const next = { ...user }; delete next[op.path[0]]; user = next }
      }
      for (const listener of listeners) listener()
      return true
    },
  }
}

/** 假的 ui-primitives：只保留本插件用到的五个导出。 */
class FakeFormModel {
  constructor(scope, specs) { this.scope = scope; this.specs = new Map(specs.map(s => [s.field, s])); this.staged = new Map() }
  bind(project) { return { get: () => project(), set() {} } }
  shell() { return { available: true, writable: true, dirty: this.staged.size > 0, invalid: false, saving: false, failed: false } }
  field(field) {
    const spec = this.specs.get(field)
    const staged = this.staged.get(field)
    const value = this.scope.getSnapshot().value[field]
    return { text: staged ?? spec.format(value), overridden: false, invalid: false }
  }
  actions() {
    return {
      edit: (field, text) => { this.staged.set(field, text) },
      resetField: field => { this.staged.set(field, this.specs.get(field).format(this.scope.getSnapshot().base[field])) },
      save: () => { void this.save() },
      discard: () => { this.staged.clear() },
    }
  }
  async save() {
    const ops = []
    for (const [field, text] of this.staged) {
      const spec = this.specs.get(field)
      const write = spec.parse(text)
      // 与真模型一致：草稿等于当前有效值时不写。
      if (write.kind === 'clear' || text === spec.format(this.scope.getSnapshot().value[field])) {
        ops.push({ op: 'unset', path: [field] })
      } else {
        ops.push({ op: 'set', path: [field], value: write.value })
      }
    }
    this.staged.clear()
    await this.scope.mutate(ops)
  }
}
const primitives = {
  Switch: function Switch() {},
  SettingsForm: function SettingsForm() {},
  SettingsValueField: function SettingsValueField() {},
  SettingsFormModel: FakeFormModel,
  settingsNumberField: field => ({
    field,
    format: value => (typeof value === 'number' ? String(value) : ''),
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
    },
  }),
}
const jsxRuntime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }

const source = readFileSync(join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
let registered
globalThis.window = { __ModuleLoader__: { load: spec => { registered = spec } } }
new Function(source)()
console.log('bundle id:', registered.id)

const mod = registered.factory(name => name === 'react/jsx-runtime' ? jsxRuntime : primitives)
console.log('exports:', Object.keys(mod).join(','), '| name:', mod.name, '| inject:', mod.inject.join(','))

const scope = fakeScope({ autoCleanup: true, cleanupMaxAgeDays: 7 })
let registration
let disposed = 0
const cleanups = []
const ctx = {
  effect: (fn) => { const result = fn(); if (typeof result === 'function') cleanups.push(result); return result },
  locale: { register: (ns, messages) => ({ ns, messages }), bind: () => key => key },
  configForms: { get: id => { console.log('configForms.get:', id); return scope }, whileServed: (_ids, fn) => fn() },
  slots: { inject: (_name, fn) => fn(), register: (spec, Component) => { registration = { spec, Component } } },
}
mod.apply(ctx)
console.log('slot:', registration.spec.name, '| key:', registration.spec.key, '| locale:', registration.spec.locale)
const injected = registration.spec.inject()
console.log('injected keys:', Object.keys(injected).join(','))

const store = injected.hooks.cleanupCard
const useCleanupCard = selector => selector(store.get())
console.log('summary view is null:', registration.Component({ view: 'summary', t: k => k, useCleanupCard, ...injected }) === null)
const hidden = registration.Component({ view: 'page', t: k => k, useCleanupCard, ...injected })
console.log('page children (cleanup on):', hidden.props.children.filter(Boolean).map(c => typeof c.type === 'string' ? c.type : c.type.name).join(','))

injected.edit('cleanupMaxAgeDays', '3')
console.log('after edit:', JSON.stringify({ dirty: store.get().dirty, text: store.get().maxAgeDays.text }))
await injected.save()
console.log('after save user layer:', JSON.stringify(scope.user))

injected.edit('autoCleanup', 'false')
await injected.save()
console.log('after toggle save user layer:', JSON.stringify(scope.user))
const off = registration.Component({ view: 'page', t: k => k, useCleanupCard, ...injected })
console.log('page children (cleanup off):', off.props.children.filter(Boolean).map(c => typeof c.type === 'string' ? c.type : c.type.name).join(','))

injected.resetField('autoCleanup')
await injected.save()
console.log('after reset user layer:', JSON.stringify(scope.user))
console.log('disposers registered:', cleanups.length)
