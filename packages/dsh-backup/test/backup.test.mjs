import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildMatcher, buildDecider, DEFAULT_PRESET, describeChildren, dshHome, parseList, parseRegex, scanTree } from '../lib/rules.js'
import { apply } from '../lib/index.js'
import { crc32, writeZip } from '../lib/zip.js'

describe('备份规则', () => {
  it('词表按逗号、中文逗号与换行拆分', () => {
    expect(parseList('a, b，c\nd')).toEqual(['a', 'b', 'c', 'd'])
  })
  it('三层规则各命中一层', () => {
    const match = buildMatcher(DEFAULT_PRESET)
    expect(match('dsh-ops/shells/a.exe', 'a.exe', false)).toBe('extension:.exe')
    expect(match('rewind-snapshots/a.json', 'a.json', false)).toBe('pathSegment:rewind-snapshots')
    expect(match('snapshot-cleanup-last-sweep.json', 'snapshot-cleanup-last-sweep.json', false)).toBe(null)
  })
  it('临时与可再生文件命中文件名模式', () => {
    const match = buildMatcher(DEFAULT_PRESET)
    expect(match('a/server-credentials.json.refresh-lock.holder-12216.tmp', 'server-credentials.json.refresh-lock.holder-12216.tmp', false)).toBe('namePattern:*.tmp')
    expect(match('some-plugin/discovery.journal', 'discovery.journal', false)).toBe('namePattern:*.journal')
    expect(match('gateway.pid', 'gateway.pid', false)).toBe('namePattern:*.pid')
  })
  it('记忆目录不受可再生目录词表误伤', () => {
    const match = buildMatcher(DEFAULT_PRESET)
    expect(match('mnemon/runtime/memories.json', 'memories.json', false)).toBe(null)
    expect(match('mnemon/runtime', 'runtime', true)).toBe(null)
    expect(match('dsh-runtimes', 'dsh-runtimes', true)).toBe('clientDir:dsh-runtimes')
  })
  it('自定义词表覆盖默认', () => {
    const match = buildMatcher({ extensions: '.tmp', pathSegments: 'generated', namePatterns: '*.bak' })
    expect(match('a.exe', 'a.exe', false)).toBe(null)
    expect(match('a.tmp', 'a.tmp', false)).toBe('extension:.tmp')
    expect(match('generated/a.json', 'a.json', false)).toBe('pathSegment:generated')
    expect(match('a.bak', 'a.bak', false)).toBe('namePattern:*.bak')
  })
})

describe('客户端底座目录', () => {
  it('顶层目录命中 clientDirs', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('dsh-runtimes/dsh-primary-runtime/a.mjs', 'a.mjs', false)).toBe('clientDir:dsh-runtimes')
    expect(m('speech-to-text/sensevoice/tokens.txt', 'tokens.txt', false)).toBe('clientDir:speech-to-text')
  })
  it('多级路径命中且不误伤插件内同名目录', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('storages/session_projcache/sessions/a.json', 'a.json', false)).toBe('clientDir:storages/session_projcache')
    expect(m('some-plugin/dsh-runtimes/a.json', 'a.json', false)).toBe(null)
    expect(m('some-plugin/speech-to-text/a.json', 'a.json', false)).toBe(null)
  })
  it('归属层内置不可被预设覆盖', () => {
    const m = buildMatcher({ clientDirs: 'foo', dataRoots: 'foo' })
    expect(m('storages/session_projcache/a.json', 'a.json', false)).toBe('clientDir:storages/session_projcache')
    expect(m('sessions/a.json', 'a.json', false)).toBe(null)
    expect(m('foo/a.json', 'a.json', false)).toBe(null)
  })
  it('dsh 初始文件按归属判定', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('.anonymous-user-id', '.anonymous-user-id', false)).toBe('clientDir:.anonymous-user-id')
    expect(m('some-plugin/.anonymous-user-id', '.anonymous-user-id', false)).toBe(null)
    expect(m('.credentials.yaml', '.credentials.yaml', false)).toBe(null)
    const strict = buildMatcher({ extensions: '.yaml', namePatterns: '*.yaml' })
    expect(strict('.credentials.yaml', '.credentials.yaml', false)).toBe(null)
  })
})

describe('归属优先', () => {
  it('用户数据根整棵保留，形态规则不穿透', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('attachments/voice.mp3', 'voice.mp3', false)).toBe(null)
    expect(m('attachments/settings.yaml.bak', 'settings.yaml.bak', false)).toBe(null)
    expect(m('sessions/some/last-wishes.md', 'last-wishes.md', false)).toBe(null)
    expect(m('mnemon/runtime/cache/a.json', 'a.json', false)).toBe('pathSegment:cache')
  })
  it('依赖目录在数据根内仍排除', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('sessions/node_modules', 'node_modules', true)).toBe('dependency:node_modules')
    expect(m('profiles/desktop/node_modules/a.js', 'a.js', false)).toBe('dependency:node_modules')
  })
  it('数据根内底座目录优先排除', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    expect(m('storages/session_projcache/sessions/a.json', 'a.json', false)).toBe('clientDir:storages/session_projcache')
  })
})

describe('扫描与报告', () => {
  it('排除目录整体计一条且带体积，纳入文件可打包', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-test-'))
    try {
      mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
      mkdirSync(join(root, 'mnemon', 'runtime'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'pkg', 'a.js'), 'x'.repeat(100))
      writeFileSync(join(root, 'mnemon', 'runtime', 'memories.json'), '{"a":1}')
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      writeFileSync(join(root, 'gateway.pid'), '1')
      const scanned = await scanTree(root, buildMatcher(DEFAULT_PRESET))
      expect(scanned.included.map(x => x.rel).sort()).toEqual(['mnemon/runtime/memories.json', 'settings.yaml'])
      const reasons = Object.fromEntries(scanned.excluded.map(x => [x.rel, x.reason]))
      expect(reasons['node_modules']).toBe('dependency:node_modules')
      expect(reasons['gateway.pid']).toBe('namePattern:*.pid')
      const dir = scanned.excluded.find(x => x.rel === 'node_modules')
      expect(dir.size).toBe(100)
      expect(dir.files).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})


describe('勾选穿透排除目录', () => {
  it('被排除目录内的子项勾选后真正进包，父级显示半勾', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-pierce-'))
    try {
      mkdirSync(join(root, 'cache', 'dsh-disk-cleanup'), { recursive: true })
      mkdirSync(join(root, 'cache', 'other'), { recursive: true })
      writeFileSync(join(root, 'cache', 'dsh-disk-cleanup', 'keep.json'), 'x'.repeat(20))
      writeFileSync(join(root, 'cache', 'other', 'drop.json'), 'x'.repeat(30))
      const matcher = buildMatcher(DEFAULT_PRESET)
      const overrides = { 'cache/dsh-disk-cleanup': true }
      const scanned = await scanTree(root, matcher, undefined, overrides)
      expect(scanned.included.map(x => x.rel)).toEqual(['cache/dsh-disk-cleanup/keep.json'])
      const nodes = await describeChildren(root, '', matcher, overrides)
      const byName = Object.fromEntries(nodes.map(n => [n.name, n]))
      expect(byName.cache.included).toBe(false)
      expect(byName.cache.partial).toBe(true)
      const inner = await describeChildren(root, 'cache', matcher, overrides)
      const innerByName = Object.fromEntries(inner.map(n => [n.name, n]))
      expect(innerByName['dsh-disk-cleanup'].included).toBe(true)
      expect(innerByName.other.included).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

describe('用户勾选覆盖与正则', () => {
  it('覆盖按最长路径优先，false 整棵排除、true 整棵纳入', () => {
    const m = buildMatcher(DEFAULT_PRESET)
    const d = buildDecider(m, { cache: false, 'sessions/keep': true })
    expect(d('cache/a.json', 'a.json', false).included).toBe(false)
    expect(d('sessions/keep/a.json', 'a.json', false).included).toBe(true)
    expect(d('sessions/drop/a.json', 'a.json', false).included).toBe(true)
    const nested = buildDecider(m, { sessions: true, 'sessions/drop': false })
    expect(nested('sessions/keep/a.json', 'a.json', false).included).toBe(true)
    expect(nested('sessions/drop/a.json', 'a.json', false).included).toBe(false)
  })
  it('正则匹配相对路径即排除，无效表达式忽略', () => {
    expect(parseRegex('/secret/,[abc').length).toBe(1)
    const m = buildMatcher(DEFAULT_PRESET, 'secret/.*,[abc')
    expect(m('secret/a.json', 'a.json', false)).toBe('regex:' + new RegExp('secret/.*', 'i').source)
    expect(m('normal/a.json', 'a.json', false)).toBe(null)
  })
  it('覆盖优先于正则与内置归属', () => {
    const m = buildMatcher(DEFAULT_PRESET, 'secret')
    const d = buildDecider(m, { 'secret/keep.json': true })
    expect(d('secret/keep.json', 'keep.json', false).included).toBe(true)
    expect(d('secret/other.json', 'other.json', false).included).toBe(false)
  })
})

describe('树枚举', () => {
  it('返回直接子项，固定按物理体积降序，不随勾选变化', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-tree-'))
    try {
      mkdirSync(join(root, 'data'), { recursive: true })
      mkdirSync(join(root, 'cache'), { recursive: true })
      writeFileSync(join(root, 'data', 'a.json'), 'x'.repeat(10))
      writeFileSync(join(root, 'cache', 'b.js'), 'x'.repeat(500))
      const nodes = await describeChildren(root, '', buildMatcher(DEFAULT_PRESET), {})
      const byName = Object.fromEntries(nodes.map(n => [n.name, n]))
      expect(byName.data.included).toBe(true)
      expect(byName.cache.included).toBe(false)
      expect(nodes[0].name).toBe('cache')
      expect(byName.data.files).toBe(1)
      const inner = await describeChildren(root, 'cache', buildMatcher(DEFAULT_PRESET), { cache: true })
      expect(inner[0].included).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('空目录不出现在树里，也不进包', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-empty-'))
    try {
      mkdirSync(join(root, 'empty'), { recursive: true })
      mkdirSync(join(root, 'with-file'), { recursive: true })
      writeFileSync(join(root, 'with-file', 'a.json'), 'x')
      const nodes = await describeChildren(root, '', buildMatcher(DEFAULT_PRESET), {})
      expect(nodes.map(n => n.name)).toEqual(['with-file'])
      const scanned = await scanTree(root, buildMatcher(DEFAULT_PRESET))
      expect(scanned.included.some(x => x.rel.startsWith('empty'))).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('size 是纳入字节，子项有排除时父级标记 partial，排序不随勾选变', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-partial-'))
    try {
      mkdirSync(join(root, 'mixed'), { recursive: true })
      mkdirSync(join(root, 'clean'), { recursive: true })
      writeFileSync(join(root, 'mixed', 'keep.json'), 'x'.repeat(10))
      writeFileSync(join(root, 'mixed', 'drop.exe'), 'x'.repeat(1000))
      writeFileSync(join(root, 'clean', 'only.json'), 'x'.repeat(500))
      const matcher = buildMatcher(DEFAULT_PRESET)
      const nodes = await describeChildren(root, '', matcher, {})
      const byName = Object.fromEntries(nodes.map(n => [n.name, n]))
      expect(byName.mixed.included).toBe(false)
      expect(byName.mixed.partial).toBe(true)
      expect(byName.mixed.size).toBe(1010)
      expect(byName.mixed.physicalSize).toBe(1010)
      expect(byName.clean.partial).toBe(false)
      expect(byName.clean.size).toBe(500)
      expect(nodes.map(n => n.name)).toEqual(['mixed', 'clean'])
      const inner = await describeChildren(root, 'mixed', matcher, {})
      const innerByName = Object.fromEntries(inner.map(n => [n.name, n]))
      expect(innerByName['drop.exe'].included).toBe(false)
      expect(innerByName['drop.exe'].size).toBe(1000)
      const toggled = await describeChildren(root, '', matcher, { mixed: false })
      const after = Object.fromEntries(toggled.map(n => [n.name, n]))
      expect(after.mixed.included).toBe(false)
      expect(after.mixed.size).toBe(1010)
      expect(toggled.map(n => n.name)).toEqual(['mixed', 'clean'])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
describe('ZIP 写入', () => {
  it('CRC32 与 zip 结构可被标准解压识别', async () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xCBF43926)
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-zip-'))
    const out = join(root, 'out.zip')
    try {
      const a = join(root, 'a.txt')
      const b = join(root, 'b.txt')
      writeFileSync(a, 'hello')
      writeFileSync(b, 'world')
      const result = await writeZip(out, [
        { path: a, rel: 'a.txt', size: 5 },
        { path: b, rel: 'mnemon/b.txt', size: 5 },
      ])
      expect(result.count).toBe(2)
      const buf = readFileSync(out)
      expect(buf.readUInt32LE(0)).toBe(0x04034B50)
      const eocd = buf.length - 22
      expect(buf.readUInt32LE(eocd)).toBe(0x06054B50)
      expect(buf.readUInt16LE(eocd + 10)).toBe(2)
      const centralStart = buf.readUInt32LE(eocd + 16)
      expect(buf.readUInt32LE(centralStart)).toBe(0x02014B50)
      expect(buf.includes(Buffer.from('mnemon/b.txt'))).toBe(true)
      expect(buf.includes(Buffer.from('hello'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('DSH_HOME 环境变量优先', () => {
    const prev = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = 'C:/tmp/custom-dsh'
      expect(dshHome()).toBe('C:/tmp/custom-dsh')
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})

describe('导出路由', () => {
  it('注册导出/下载路由并端到端产出 zip', async () => {
    const prev = process.env.DSH_HOME
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-route-'))
    try {
      process.env.DSH_HOME = root
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      writeFileSync(join(root, 'gateway.pid'), '123')
      mkdirSync(join(root, 'cache'), { recursive: true })
      writeFileSync(join(root, 'cache', 'a.js'), 'x'.repeat(50))
      const handlers = {}
      const webServer = { register: ({ path, handler }) => { handlers[path] = handler; return () => {} } }
      const ctx = {
        effect: fn => { const dispose = fn(); return () => dispose?.() },
        get: key => (key === 'webServer' ? webServer : undefined),
        connection: { requestRejection: () => undefined },
        logger: { debug() {}, warn() {} },
      }
      const config = { 'dsh-backup': { enabled: true } }
      apply(ctx, config)
      const exportPath = '/api/starlong/dsh-backup/export'
      const downloadPath = '/api/starlong/dsh-backup/download'
      expect(Object.keys(handlers).sort()).toEqual([downloadPath, exportPath, '/api/starlong/dsh-backup/preset', '/api/starlong/dsh-backup/tree', '/api/starlong/dsh-backup/reveal', '/api/starlong/dsh-backup/versions', '/api/starlong/dsh-backup/verify', '/api/starlong/dsh-backup/restore', '/api/starlong/dsh-backup/upload'].sort())
      const baseReq = {
        headers: { host: '127.0.0.1:51234', 'sec-fetch-site': 'same-origin' },
        socket: { remoteAddress: '127.0.0.1' },
        on: (ev, cb) => { if (ev === 'end') queueMicrotask(() => cb()) },
      }
      let status, payload
      const res = {
        writeHead: s => { status = s },
        end: data => { payload = data ? JSON.parse(data.toString()) : null },
      }
      await handlers[exportPath]({ ...baseReq, headers: { ...baseReq.headers, 'x-starlong-backup': '1' }, url: exportPath }, res)
      expect(status).toBe(200)
      expect(payload.ok).toBe(true)
      expect(payload.includeFiles).toBe(1)
      expect(payload.excludeItems).toBe(2)
      ctx.connection.requestRejection = () => 403
      let officialStatus
      await handlers[exportPath]({ ...baseReq, headers: { ...baseReq.headers, 'x-starlong-backup': '1' }, url: exportPath }, { writeHead: s => { officialStatus = s }, end() {} })
      expect(officialStatus).toBe(403)
      ctx.connection.requestRejection = () => undefined
      const zipPath = join(root, 'backups', payload.name)
      expect(existsSync(zipPath)).toBe(true)
      expect(existsSync(zipPath + '.json')).toBe(false)
      expect(/^dsh-backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/.test(payload.name)).toBe(true)
      let zipBuf
      await handlers[downloadPath](
        { ...baseReq, url: downloadPath + '?name=' + encodeURIComponent(payload.name) },
        { writeHead() {}, end: data => { zipBuf = data } },
      )
      expect(zipBuf).toBeDefined()
      expect(zipBuf.readUInt32LE(0)).toBe(0x04034B50)
      expect(zipBuf.includes(Buffer.from('_manifest.json'))).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(root, { recursive: true, force: true })
    }
  })
})