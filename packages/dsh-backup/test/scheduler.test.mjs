import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'

const VERSIONS = '/api/starlong/dsh-backup/versions'
const EXPORT = '/api/starlong/dsh-backup/export'

function pad(n) { return String(n).padStart(2, '0') }
function stamp(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '_' + pad(date.getHours()) + '-' + pad(date.getMinutes()) + '-' + pad(date.getSeconds())
}

function setup(config = {}) {
  const handlers = {}
  const webServer = { register: ({ path, handler }) => { handlers[path] = handler; return () => {} } }
  let dispose
  const ctx = {
    effect: fn => { dispose = fn(); return () => dispose?.() },
    get: key => (key === 'webServer' ? webServer : undefined),
    connection: { requestRejection: () => undefined },
    logger: { debug() {}, warn() {}, info() {} },
  }
  apply(ctx, { 'dsh-backup': { enabled: true, ...config } })
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
  const root = mkdtempSync(join(tmpdir(), 'dsh-backup-sched-'))
  process.env.DSH_HOME = root
  try { return await fn(root) } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(root, { recursive: true, force: true })
  }
}

function zips(dir) {
  try { return readdirSync(dir).filter(name => name.endsWith('.zip')) } catch { return [] }
}

describe('备份版本与自动调度', () => {
  it('版本路由只读返回份数与最近备份时刻', async () => {
    await withHome(async root => {
      const { handlers, cleanup } = setup()
      try {
        const empty = res()
        await handlers[VERSIONS](req(VERSIONS), empty)
        expect(empty.out.status).toBe(200)
        expect(empty.out.payload).toEqual({ ok: true, count: 0, latest: null })

        const dir = join(root, 'backups')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'dsh-backup_2020-01-01_00-00-00.zip'), '')
        writeFileSync(join(dir, 'dsh-backup_2026-11-25_10-30-00.zip'), '')
        writeFileSync(join(dir, 'not-a-backup.txt'), '')
        const filled = res()
        await handlers[VERSIONS](req(VERSIONS), filled)
        expect(filled.out.payload.count).toBe(2)
        expect(filled.out.payload.latest).toBe(new Date(2026, 10, 25, 10, 30, 0).toISOString())
      } finally { cleanup() }
    })
  })

  it('启动时最近备份未超时不补，超时则立即补一份', async () => {
    await withHome(async root => {
      const dir = join(root, 'backups')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(root, 'note.txt'), 'hello')
      writeFileSync(join(dir, 'dsh-backup_' + stamp(new Date()) + '.zip'), '')
      const fresh = setup({ autoBackupHours: 24, retention: 7 })
      try {
        await Bun.sleep(150)
        expect(zips(dir).length).toBe(1)
      } finally { fresh.cleanup() }

      writeFileSync(join(dir, 'dsh-backup_2020-01-01_00-00-00.zip'), '')
      const stale = setup({ autoBackupHours: 24, retention: 7 })
      try {
        await Bun.sleep(150)
        const names = zips(dir)
        expect(names.length).toBe(2)
        expect(names.some(name => name.startsWith('dsh-backup_2026'))).toBe(true)
      } finally { stale.cleanup() }
    })
  })

  it('导出后按保留份数清理最旧的备份', async () => {
    await withHome(async root => {
      const dir = join(root, 'backups')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(root, 'note.txt'), 'hello')
      for (let year = 2020; year <= 2024; year++) {
        writeFileSync(join(dir, 'dsh-backup_' + year + '-01-01_00-00-00.zip'), '')
      }
      const { handlers, cleanup } = setup({ retention: 3 })
      try {
        const done = res()
        await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '' }), done)
        expect(done.out.status).toBe(200)
        const names = zips(dir)
        expect(names.length).toBe(3)
        expect(names.some(name => name.startsWith('dsh-backup_2020'))).toBe(false)
      } finally { cleanup() }
    })
  })

  it('导出到自选目录时不清理该目录里的旧文件', async () => {
    await withHome(async root => {
      const chosen = join(root, 'chosen')
      mkdirSync(chosen, { recursive: true })
      writeFileSync(join(root, 'note.txt'), 'hello')
      writeFileSync(join(chosen, 'keep-me.zip'), '')
      const { handlers, cleanup } = setup()
      try {
        const done = res()
        await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '', dir: chosen }), done)
        expect(done.out.status).toBe(200)
        const names = readdirSync(chosen)
        expect(names.includes('keep-me.zip')).toBe(true)
        expect(names.filter(name => name.startsWith('dsh-backup')).length).toBe(1)
      } finally { cleanup() }
    })
  })
})
