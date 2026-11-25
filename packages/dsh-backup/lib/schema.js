/**
 * 取 schemastery 实例，并给出一条加载不到时的退路。
 *
 * 设置页靠插件导出的 Config schema 渲染表单，而 schema 必须用真的 schemastery
 * 构建出来。包随 DSH 一起分发，插件以 link 或独立 node_modules 安装时解析规则
 * 不保证覆盖到它，所以这里显式兜底：先按普通模块解析，再按 DSH 安装位置找。
 * @module dsh-disk-cleanup/schema
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** schemastery 的包名。 */
const SCHEMA_PACKAGE = '@deepseek-ai/schemastery'

/**
 * 按 DSH 的安装位置解析平台包。
 * @returns {string | undefined} 包内入口的绝对路径；找不到时 undefined。
 */
function fromInstallRoot() {
  const appRoot = join(dirname(process.execPath), 'resources', 'app.asar', 'dsh', 'node_modules')
  try {
    return createRequire(join(appRoot, 'noop.js')).resolve(SCHEMA_PACKAGE)
  } catch {
    return undefined
  }
}

/**
 * 取 schemastery 模块。
 * @returns {Promise<object | undefined>} 模块导出；哪里都找不到时 undefined。
 */
async function load() {
  try {
    return await import(SCHEMA_PACKAGE)
  } catch {
    /* 平台包不在解析路径里，继续按安装位置找 */
  }
  const entry = fromInstallRoot()
  if (entry === undefined) return undefined
  try {
    return await import(pathToFileURL(entry).href)
  } catch {
    return undefined
  }
}

/**
 * 空壳构建器：任何方法都返回它自己，方法链走得通、什么也不产生。
 * 包彻底找不到时就用它，插件的配置因此退回手写默认值，其余机制照常工作。
 * @returns {object} 只支持链式调用的假构建器。
 */
function inertZ() {
  return new Proxy(function z() {}, {
    apply() {
      return inertZ()
    },
    get() {
      return () => inertZ()
    },
  })
}

/** 真的 schemastery；模块求值阶段就要用，所以同步解析一次。 */
let loaded

/**
 * 同步取构建器；ESM 里没有同步 import，所以用 CommonJS 的 require。
 * 插件装在 profile 的 node_modules 下时，宿主与平台包是同级依赖，
 * 用 profile 的 require（即 process.cwd() 那一级）能解析到；插件被单独
 * 装在别处时解析不到，由下面的异步兜底接手。
 * @returns {Function | undefined} 构建器；解析不到时 undefined。
 */
function syncLoad() {
  for (const base of [import.meta.url, join(process.cwd(), 'noop.js')]) {
    try {
      // 这个包是 CommonJS：require 回来的是构建器本身（不是带 default 的命名空间）。
      const mod = createRequire(base)(SCHEMA_PACKAGE)
      if (typeof mod === 'function') return mod
      if (typeof mod?.default === 'function') return mod.default
    } catch {
      /* 这一级解析不到，换下一级 */
    }
  }
  return undefined
}

loaded = syncLoad()

if (typeof loaded !== 'function') {
  load().then((mod) => {
    if (typeof mod?.default === 'function') loaded = mod.default
  })
}

/** 当前生效的构建器；异步兜底加载到真包后也由它跟上。 */
function builder() {
  return typeof loaded === 'function' ? loaded : inertZ()
}

/**
 * 本插件使用的 schemastery 实例。
 * 函数一律补绑到构建器上，取属性时同步转发。
 */
export const z = new Proxy(inertZ(), {
  // 顶层方法要能直接调用：z() 就是构建器本身，z.object(...) 之类也走这里。
  apply(target, thisArg, args) {
    return Reflect.apply(builder(), thisArg, args)
  },
  get(target, key) {
    // Promise 解析会读 then：不挡住的话，任何 await 都会把 z 当成 thenable。
    if (key === 'then') return undefined
    const source = builder()
    const value = source[key]
    return typeof value === 'function' ? value.bind(source) : value
  },
})

/**
 * 判断真的 schemastery 是否已经就位。
 * @returns {boolean} 构建器来自真包时为 true。
 */
export function schemaReady() {
  return typeof loaded === 'function'
}
