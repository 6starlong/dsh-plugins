import { useSyncExternalStore } from 'react'

/**
 * 把套件条目的表单作用域收敛到某个模块段。
 * SettingsFormModel 只认扁平字段；mutate 的 path 前面补上段路径即可写回嵌套配置。
 */
export function sectionScope(scope, section) {
  // 设置服务的 value/mutate 根就是插件 config 本体，路径直接从段名开始。
  const prefix = [section]
  const pick = value => value === undefined ? undefined : value?.[section]
  return {
    subscribe: cb => scope.subscribe(cb),
    getSnapshot: () => {
      const snap = scope.getSnapshot()
      return { ...snap, value: pick(snap.value), base: pick(snap.base), user: pick(snap.user) }
    },
    mutate: (ops, revision) => scope.mutate(
      ops.map(op => ({ ...op, path: [...prefix, ...op.path] })),
      revision,
    ),
  }
}

/**
 * 直写配置卡片控制器：字段按声明的类型读默认值，乐观写入并带 revision 提交。
 * 快照按值缓存，避免 useSyncExternalStore 因新对象无限重渲染。
 */
export class DirectCardController {
  constructor(scope, fields) {
    this.scope = scope
    this.fields = fields
    this.pending = new Map()
    this.failed = new Map()
    this.listeners = new Set()
    this.cached = undefined
    // 宿主镜像追上乐观值后清掉；任何配置变化都把新状态推给卡片。
    this.unsubscribe = scope.subscribe(() => {
      const value = scope.getSnapshot().value || {}
      for (const [field, next] of this.pending) {
        if (value[field] === next) this.pending.delete(field)
      }
      this.emit()
    })
  }
  emit() {
    for (const cb of this.listeners) cb()
  }
  snapshot() {
    const snap = this.scope.getSnapshot()
    const value = snap.value || {}
    const writable = snap.writable !== false
    const failed = this.failed.size > 0
    const state = { writable, failed }
    let changed = this.cached === undefined
      || this.cached.writable !== writable
      || this.cached.failed !== failed
    for (const [field, spec] of Object.entries(this.fields)) {
      const raw = this.pending.has(field) ? this.pending.get(field) : value[field]
      let current
      if (spec.type === 'boolean') {
        current = raw === undefined ? spec.default : raw !== false
      } else if (spec.type === 'string') {
        current = raw === undefined ? spec.default : String(raw)
      } else {
        const parsed = Number(raw ?? spec.default)
        current = Number.isFinite(parsed) ? parsed : spec.default
      }
      if (this.cached === undefined || this.cached[field] !== current) changed = true
      state[field] = current
    }
    if (changed) this.cached = state
    return this.cached
  }
  commit(field, next) {
    this.pending.set(field, next)
    this.failed.delete(field)
    this.emit()
    const fail = () => {
      this.pending.delete(field)
      this.failed.set(field, true)
      this.emit()
    }
    // 直写必须带上当前 revision，否则宿主按过期写入拒绝，乐观值会回滚成默认值。
    const revision = this.scope.getSnapshot().revision
    this.scope.mutate([{ op: 'set', path: [field], value: next }], revision)
      .then(ok => { if (!ok) fail() })
      .catch(fail)
  }
  inject(hookName, actions) {
    const handlers = Object.fromEntries(
      Object.entries(actions).map(([name, field]) => [name, next => this.commit(field, next)]),
    )
    return {
      hooks: {
        [hookName]: {
          subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
          getSnapshot: () => this.snapshot(),
        },
      },
      ...handlers,
    }
  }
  /** 宿主 hook 形状，供 useStore 包装成 React hook。 */
  hook() {
    return {
      subscribe: cb => { this.listeners.add(cb); return () => this.listeners.delete(cb) },
      getSnapshot: () => this.snapshot(),
    }
  }
  asHook() {
    const hook = this.hook()
    return selector => useStore(hook, selector)
  }
  dispose() {
    this.unsubscribe()
    this.listeners.clear()
  }
}

/** 把宿主 hook 形状转成 React hook；selector 直接透传，快照由控制器缓存。 */
export function useStore(hook, selector) {
  const read = () => {
    const value = hook.getSnapshot()
    return typeof selector === 'function' ? selector(value) : value
  }
  return useSyncExternalStore(hook.subscribe, read, read)
}