import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { readZip } from '../lib/zip.js'

const EXPORT = '/api/starlong/dsh-backup/export'
const RESTORE = '/api/starlong/dsh-backup/restore'
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
  const root = mkdtempSync(join(tmpdir(), 'dsh-backup-inject-'))
  process.env.DSH_HOME = root
  try { return await fn(root) } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(root, { recursive: true, force: true })
  }
}

async function exportZip(handlers, overrides) {
  const done = res()
  await handlers[EXPORT](req(EXPORT, { overrides, regex: '' }), done)
  expect(done.out.status).toBe(200)
  return done.out.payload
}

function entriesOf(root, name) {
  return readZip(readFileSync(join(root, 'backups', name)))
}

function isBackupZip(rel) {
  return /^dsh-backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/.test(rel.split('/').pop())
}

describe('备份产物硬排除与预设强制注入', () => {
  it('勾选 backups 时旧备份 zip 也不进包', async () => {
    await withHome(async root => {
      mkdirSync(join(root, 'backups'), { recursive: true })
      writeFileSync(join(root, 'backups', 'dsh-backup_2020-01-01_00-00-00.zip'), 'old junk')
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const payload = await exportZip(handlers, { backups: true })
        const rels = entriesOf(root, payload.name).map(entry => entry.rel)
        expect(rels.some(isBackupZip)).toBe(false)
        expect(rels).toContain('settings.yaml')
      } finally { cleanup() }
    })
  })

  it('排除 backups 仍把预设注入包内，校验覆盖且不重复', async () => {
    await withHome(async root => {
      mkdirSync(join(root, 'backups', 'presets'), { recursive: true })
      const presetText = JSON.stringify({ overrides: { cache: false }, regex: '' })
      writeFileSync(join(root, 'backups', 'presets', 'z.json'), presetText)
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const payload = await exportZip(handlers, { backups: false })
        const entries = entriesOf(root, payload.name)
        const presetEntries = entries.filter(entry => entry.rel === 'backups/presets/z.json')
        expect(presetEntries).toHaveLength(1)
        expect(presetEntries[0].data.toString()).toBe(presetText)
        expect(payload.injectedPresets).toBe(1)
        const manifest = JSON.parse(entries.find(entry => entry.rel === '_manifest.json').data.toString())
        expect(manifest.checksums['backups/presets/z.json']).toBeDefined()
        const verified = res()
        await handlers[VERIFY](req(VERIFY, { name: payload.name }), verified)
        expect(verified.out.status).toBe(200)
        expect(verified.out.payload.ok).toBe(true)
      } finally { cleanup() }
    })
  })

  it('勾选 backups 时预设也只入包一次', async () => {
    await withHome(async root => {
      mkdirSync(join(root, 'backups', 'presets'), { recursive: true })
      writeFileSync(join(root, 'backups', 'presets', 'z.json'), '{}')
      const { handlers, cleanup } = setup()
      try {
        const payload = await exportZip(handlers, { backups: true })
        const rels = entriesOf(root, payload.name).map(entry => entry.rel)
        expect(rels.filter(rel => rel === 'backups/presets/z.json')).toHaveLength(1)
      } finally { cleanup() }
    })
  })

  it('还原把预设写回原路径，并保留备份里没有的文件', async () => {
    await withHome(async root => {
      mkdirSync(join(root, 'backups', 'presets'), { recursive: true })
      const presetText = JSON.stringify({ overrides: { cache: false }, regex: '' })
      writeFileSync(join(root, 'backups', 'presets', 'z.json'), presetText)
      writeFileSync(join(root, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const payload = await exportZip(handlers, { backups: false })
        rmSync(join(root, 'backups', 'presets', 'z.json'))
        writeFileSync(join(root, 'settings.yaml'), 'enabled: false')
        writeFileSync(join(root, 'extra.txt'), 'not in backup')
        const restored = res()
        await handlers[RESTORE](req(RESTORE, { name: payload.name }), restored)
        expect(restored.out.status).toBe(200)
        expect(readFileSync(join(root, 'backups', 'presets', 'z.json'), 'utf8')).toBe(presetText)
        expect(readFileSync(join(root, 'settings.yaml'), 'utf8')).toBe('enabled: true')
        expect(readFileSync(join(root, 'extra.txt'), 'utf8')).toBe('not in backup')
      } finally { cleanup() }
    })
  })
})
