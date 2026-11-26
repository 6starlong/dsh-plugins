import { describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spawnCalls = []
mock.module('node:child_process', () => ({
  spawn: (command, args, options) => {
    spawnCalls.push({ command, args, options })
    return { on() {}, unref() {} }
  },
}))

const { apply } = await import('../lib/index.js')

const REVEAL = '/api/starlong/dsh-backup/reveal'

function setup(overrides = {}) {
  const handlers = {}
  const webServer = { register: ({ path, handler }) => { handlers[path] = handler; return () => {} } }
  const ctx = {
    effect: fn => { const dispose = fn(); return () => dispose?.() },
    get: key => (key === 'webServer' ? webServer : undefined),
    connection: { requestRejection: overrides.reject ?? (() => undefined) },
    logger: { debug() {}, warn() {} },
  }
  apply(ctx, { 'dsh-backup': { enabled: true } })
  return handlers
}

function request(headers = {}) {
  return {
    headers: { host: '127.0.0.1:51234', 'sec-fetch-site': 'same-origin', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    on: (ev, cb) => { if (ev === 'end') queueMicrotask(() => cb()) },
    url: REVEAL,
  }
}

function response() {
  const out = { status: null, payload: null }
  return {
    out,
    writeHead: status => { out.status = status },
    end: data => { out.payload = data ? JSON.parse(data.toString()) : null },
  }
}

describe('打开备份目录路由', () => {
  it('鉴权通过时建目录并调起系统文件管理器，拒绝时不调起', async () => {
    const prev = process.env.DSH_HOME
    const root = mkdtempSync(join(tmpdir(), 'dsh-backup-reveal-'))
    try {
      process.env.DSH_HOME = root
      spawnCalls.length = 0
      const handlers = setup()
      expect(typeof handlers[REVEAL]).toBe('function')

      const ok = response()
      await handlers[REVEAL](request({ 'x-starlong-backup': '1' }), ok)
      const expected = join(root, 'backups')
      expect(ok.out.status).toBe(200)
      expect(ok.out.payload).toEqual({ ok: true, path: expected })
      expect(existsSync(expected)).toBe(true)
      expect(spawnCalls.length).toBe(1)
      expect(spawnCalls[0].args).toEqual([expected])
      expect(spawnCalls[0].options.detached).toBe(true)

      const denied = response()
      await handlers[REVEAL](request(), denied)
      expect(denied.out.status).toBe(403)
      expect(spawnCalls.length).toBe(1)

      const official = response()
      const officialHandlers = setup({ reject: () => 403 })
      await officialHandlers[REVEAL](request({ 'x-starlong-backup': '1' }), official)
      expect(official.out.status).toBe(403)
      expect(spawnCalls.length).toBe(1)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
      rmSync(root, { recursive: true, force: true })
    }
  })
})
