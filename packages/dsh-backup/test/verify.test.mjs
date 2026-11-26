import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { readZip, writeZip } from '../lib/zip.js'

const EXPORT = '/api/starlong/dsh-backup/export'
const VERIFY = '/api/starlong/dsh-backup/verify'

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

function res() {
  const out = { status: null, payload: null }
  return { out, writeHead: status => { out.status = status }, end: data => { out.payload = data ? JSON.parse(data.toString()) : null } }
}

async function withHome(fn) {
  const prev = process.env.DSH_HOME
  const root = mkdtempSync(join(tmpdir(), 'dsh-backup-verify-'))
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

describe('备份完整性校验', () => {
  it('导出包内清单含每个文件的 SHA256，与实际内容一致', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const entries = readZip(readFileSync(join(root, 'backups', name)))
        const meta = entries.find(e => e.rel === '_manifest.json')
        expect(meta).toBeDefined()
        const manifest = JSON.parse(meta.data.toString('utf8'))
        expect(manifest.checksums['settings.yaml']).toBe(createHash('sha256').update('enabled: true').digest('hex'))
        expect(Object.keys(manifest.checksums)).toEqual(['settings.yaml'])
      } finally { cleanup() }
    })
  })

  it('校验一致返回 ok，篡改包内文件后返回不符清单', async () => {
    await withHome(async root => {
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const name = await exportOnce(handlers)
        const good = res()
        await handlers[VERIFY](req(VERIFY + '?name=' + encodeURIComponent(name)), good)
        expect(good.out.status).toBe(200)
        expect(good.out.payload).toEqual({ ok: true, count: 1, missing: [], mismatch: [] })

        const zipPath = join(root, 'backups', name)
        const entries = readZip(readFileSync(zipPath))
        const tampered = entries.map(e => e.rel === 'settings.yaml'
          ? { rel: e.rel, data: Buffer.from('enabled: false') }
          : { rel: e.rel, data: e.data })
        await writeZip(zipPath, tampered)
        const bad = res()
        await handlers[VERIFY](req(VERIFY + '?name=' + encodeURIComponent(name)), bad)
        expect(bad.out.status).toBe(409)
        expect(bad.out.payload.ok).toBe(false)
        expect(bad.out.payload.mismatch).toEqual(['settings.yaml'])
      } finally { cleanup() }
    })
  })

  it('文件名非法时拒绝校验', async () => {
    await withHome(async root => {
      const { handlers, cleanup } = setup()
      try {
        const bad = res()
        await handlers[VERIFY](req(VERIFY + '?name=' + encodeURIComponent('../../evil.zip')), bad)
        expect(bad.out.status).toBe(400)
      } finally { cleanup() }
    })
  })
})
