import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { apply } from '../lib/index.js'
import { readZip, writeZip } from '../lib/zip.js'

const EXPORT = '/api/starlong/dsh-backup/export'
const RESTORE = '/api/starlong/dsh-backup/restore'
const UPLOAD = '/api/starlong/dsh-backup/upload'

function setup() {
  const handlers = {}
  const webServer = { register: ({ path, handler }) => { handlers[path] = handler; return () => {} } }
  let dispose
  const ctx = {
    effect: fn => { dispose = fn(); return () => dispose?.() },
    get: key => (key === 'webServer' ? webServer : undefined),
    connection: { requestRejection: () => undefined },
    logger: { debug() {}, warn() {}, info() {} },
  }
  apply(ctx, { 'dsh-backup': { enabled: true } })
  return { handlers, cleanup: () => dispose?.() }
}

function req(route, body = {}) {
  const listeners = {}
  return {
    headers: { host: '127.0.0.1:51234', 'sec-fetch-site': 'same-origin', 'x-starlong-backup': '1' },
    socket: { remoteAddress: '127.0.0.1' },
    url: route,
    on: (ev, cb) => {
      ;(listeners[ev] ||= []).push(cb)
      if (ev === 'end') queueMicrotask(() => {
        const payload = JSON.stringify(body)
        for (const data of listeners.data || []) data(payload)
        for (const end of listeners.end || []) end()
      })
    },
  }
}

function reqBinary(route, chunks) {
  return {
    headers: { host: '127.0.0.1:51234', 'sec-fetch-site': 'same-origin', 'x-starlong-backup': '1' },
    socket: { remoteAddress: '127.0.0.1' },
    url: route,
    on() {},
    [Symbol.asyncIterator]: async function* () { yield* chunks },
  }
}

function res() {
  const out = { status: null, payload: null }
  return { out, writeHead: status => { out.status = status }, end: data => { out.payload = data ? JSON.parse(data.toString()) : null } }
}

async function withHome(fn) {
  const prev = process.env.DSH_HOME
  const root = mkdtempSync(join(tmpdir(), 'dsh-backup-restore-'))
  process.env.DSH_HOME = root
  try { return await fn(root) } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(root, { recursive: true, force: true })
  }
}

async function exportOnce(handlers) {
  const done = res()
  await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '' }), done)
  expect(done.out.status).toBe(200)
  return done.out.payload.name
}

function sha(text) {
  return createHash('sha256').update(text).digest('hex')
}

describe('备份增量还原', () => {
  it('同名覆盖、原有文件保留、备份里没有的文件不删除', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      writeFileSync(join(root, 'keep.txt'), 'keep me')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        writeFileSync(join(root, 'settings.yaml'), 'enabled: false')
        writeFileSync(join(root, 'new.txt'), 'new file')
        const done = res()
        await handlers[RESTORE](req(RESTORE, { name }), done)
        expect(done.out.status).toBe(200)
        expect(done.out.payload.ok).toBe(true)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(readFileSync(join(root, 'keep.txt'), 'utf8')).toBe('keep me')
        expect(readFileSync(join(root, 'new.txt'), 'utf8')).toBe('new file')
        expect(done.out.payload.overwritten).toBeGreaterThanOrEqual(1)
      } finally { cleanup() }
    })
  })

  it('不传文件名时选最新备份', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        await exportOnce(handlers)
        writeFileSync(join(root, 'backups', 'dsh-backup_2020-01-01_00-00-00.zip'),
          readFileSync(join(root, 'backups', readdirSync(join(root, 'backups'))[0])))
        rmSync(join(root, 'settings.yaml'), { force: true })
        const done = res()
        await handlers[RESTORE](req(RESTORE, {}), done)
        expect(done.out.status).toBe(200)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
      } finally { cleanup() }
    })
  })

  it('校验不通过时一个文件都不写', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const zipPath = join(root, 'backups', name)
        const entries = readZip(readFileSync(zipPath))
        const tampered = entries.map(e => e.rel === 'settings.yaml'
          ? { rel: e.rel, data: Buffer.from('enabled: false') }
          : { rel: e.rel, data: e.data })
        await writeZip(zipPath, tampered)
        rmSync(join(root, 'settings.yaml'), { force: true })
        const done = res()
        await handlers[RESTORE](req(RESTORE, { name }), done)
        expect(done.out.status).toBe(409)
        expect(done.out.payload.ok).toBe(false)
        expect(done.out.payload.code).toBe('integrity')
        expect(existsSync(join(root, 'settings.yaml'))).toBe(false)
      } finally { cleanup() }
    })
  })

  it('依赖目录整棵跳过，dry-run 只列不写', async () => {
    await withHome(async root => {
      const { handlers, cleanup } = setup()
      try {
        const name = 'dsh-backup_2026-11-27_04-00-00.zip'
        mkdirSync(join(root, 'backups'), { recursive: true })
        const files = [
          { rel: 'settings.yaml', data: Buffer.from('enabled: true') },
          { rel: 'node_modules/pkg/index.js', data: Buffer.from('module.exports = 1') },
        ]
        const checksums = {}
        for (const f of files) checksums[f.rel] = sha(f.data.toString('utf8'))
        const entries = [...files, { rel: '_manifest.json', data: Buffer.from(JSON.stringify({ checksums })) }]
        await writeZip(join(root, 'backups', name), entries)
        const dry = res()
        await handlers[RESTORE](req(RESTORE, { name, dryRun: true }), dry)
        expect(dry.out.status).toBe(200)
        expect(dry.out.payload.dryRun).toBe(true)
        expect(dry.out.payload.skippedDependencies).toBe(1)
        expect(existsSync(join(root, 'settings.yaml'))).toBe(false)
        const real = res()
        await handlers[RESTORE](req(RESTORE, { name }), real)
        expect(real.out.status).toBe(200)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(existsSync(join(root, 'node_modules', 'pkg', 'index.js'))).toBe(false)
      } finally { cleanup() }
    })
  })

  it('从 backups 外的任意本地路径还原', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const outside = join(root, 'downloads', name)
        mkdirSync(dirname(outside), { recursive: true })
        copyFileSync(join(root, 'backups', name), outside)
        rmSync(join(root, 'settings.yaml'), { force: true })
        const done = res()
        await handlers[RESTORE](req(RESTORE, { path: outside }), done)
        expect(done.out.status).toBe(200)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
      } finally { cleanup() }
    })
  })

  it('非法路径被拒且不写盘', async () => {
    await withHome(async root => {
      const { handlers, cleanup } = setup()
      try {
        const missing = res()
        await handlers[RESTORE](req(RESTORE, { path: join(root, 'missing.zip') }), missing)
        expect(missing.out.status).toBe(400)
        const relative = res()
        await handlers[RESTORE](req(RESTORE, { path: 'backups/foo.zip' }), relative)
        expect(relative.out.status).toBe(400)
        const fake = join(root, 'note.txt')
        writeFileSync(fake, 'not a zip')
        const notZip = res()
        await handlers[RESTORE](req(RESTORE, { path: fake }), notZip)
        expect(notZip.out.status).toBe(400)
        expect(existsSync(join(root, 'settings.yaml'))).toBe(false)
      } finally { cleanup() }
    })
  })

  it('只读且内容一致的文件跳过写入，不报 EPERM', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      chmodSync(join(root, 'settings.yaml'), 0o444)
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const done = res()
        await handlers[RESTORE](req(RESTORE, { name }), done)
        expect(done.out.status).toBe(200)
        expect(done.out.payload.ok).toBe(true)
        expect(done.out.payload.skippedIdentical).toBeGreaterThanOrEqual(1)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(statSync(join(root, 'settings.yaml')).mode & 0o200).toBe(0)
      } finally { cleanup() }
    })
  })

  it('只读且内容不同的文件解锁写回后恢复只读属性', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        chmodSync(join(root, 'settings.yaml'), 0o644)
        writeFileSync(join(root, 'settings.yaml'), 'enabled: false')
        chmodSync(join(root, 'settings.yaml'), 0o444)
        const done = res()
        await handlers[RESTORE](req(RESTORE, { name }), done)
        expect(done.out.status).toBe(200)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(statSync(join(root, 'settings.yaml')).mode & 0o200).toBe(0)
      } finally { cleanup() }
    })
  })

  it('上传字节后用临时路径还原，结束删除临时文件', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const bytes = readFileSync(join(root, 'backups', name))
        const uploaded = res()
        await handlers[UPLOAD](reqBinary(UPLOAD, [bytes.subarray(0, 1000), bytes.subarray(1000)]), uploaded)
        expect(uploaded.out.status).toBe(200)
        expect(uploaded.out.payload.ok).toBe(true)
        const tmpPath = uploaded.out.payload.path
        expect(existsSync(tmpPath)).toBe(true)
        rmSync(join(root, 'settings.yaml'), { force: true })
        const done = res()
        await handlers[RESTORE](req(RESTORE, { path: tmpPath }), done)
        expect(done.out.status).toBe(200)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(existsSync(tmpPath)).toBe(false)
      } finally { cleanup() }
    })
  })

  it('上传非 zip 字节被拒且不留下临时文件', async () => {
    await withHome(async () => {
      const { handlers, cleanup } = setup()
      try {
        const before = readdirSync(tmpdir()).filter(n => n.startsWith('dsh-backup-upload-'))
        const uploaded = res()
        await handlers[UPLOAD](reqBinary(UPLOAD, [Buffer.from('not a zip')]), uploaded)
        expect(uploaded.out.status).toBe(400)
        expect(uploaded.out.payload.error).toBe('not a zip')
        const after = readdirSync(tmpdir()).filter(n => n.startsWith('dsh-backup-upload-'))
        expect(after.length).toBe(before.length)
      } finally { cleanup() }
    })
  })
})
