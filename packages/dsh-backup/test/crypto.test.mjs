import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { checkVerifier, decryptEntry, encryptEntry } from '../lib/crypto.js'
import { peekAesVerifier, readZip, writeZip } from '../lib/zip.js'

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
  const root = mkdtempSync(join(tmpdir(), 'dsh-backup-crypto-'))
  process.env.DSH_HOME = root
  try { return await fn(root) } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(root, { recursive: true, force: true })
  }
}

describe('WinZip AES AE-2 加解密', () => {
  it('单条目加解密 roundtrip，密文不含明文', () => {
    const data = Buffer.from('{"secret":"token-123"}', 'utf8')
    const payload = encryptEntry(data, 'pw123')
    expect(payload.length).toBe(16 + 2 + data.length + 10)
    expect(payload.includes(data)).toBe(false)
    expect(decryptEntry(payload, 'pw123').equals(data)).toBe(true)
  })
  it('口令错误或损坏数据抛错', () => {
    const payload = encryptEntry(Buffer.from('hello'), 'pw123')
    expect(() => decryptEntry(payload, 'wrong')).toThrow('wrong password')
    const broken = Buffer.from(payload)
    broken[broken.length - 1] ^= 0xFF
    expect(() => decryptEntry(broken, 'pw123')).toThrow('wrong password or corrupted data')
  })
  it('带口令 zip 写 AE-2 标记，无口令读报 password', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-backup-aes-zip-'))
    const file = join(dir, 'a.zip')
    try {
      await writeZip(file, [{ rel: 'a.txt', data: Buffer.from('hello') }], undefined, undefined, 'pw123')
      const buf = readFileSync(file)
      expect(buf.readUInt16LE(6)).toBe(1)
      expect(buf.readUInt16LE(8)).toBe(99)
      expect(buf.readUInt16LE(28)).toBe(11)
      expect(buf.readUInt16LE(35)).toBe(0x9901)
      const entries = readZip(buf, 'pw123')
      expect(entries[0].data.toString()).toBe('hello')
      expect(entries[0].encrypted).toBe(true)
      expect(entries[0].method).toBe(99)
      let missing
      let wrong
      try { readZip(buf) } catch (error) { missing = error }
      try { readZip(buf, 'wrong') } catch (error) { wrong = error }
      expect(missing?.code).toBe('password')
      expect(wrong?.code).toBe('password')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('空口令仍写旧明文包', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-backup-plain-zip-'))
    const file = join(dir, 'a.zip')
    try {
      await writeZip(file, [{ rel: 'a.txt', data: Buffer.from('hello') }])
      const buf = readFileSync(file)
      expect(buf.readUInt16LE(6)).toBe(0)
      expect(buf.readUInt16LE(8)).toBe(0)
      expect(readZip(buf)[0].encrypted).toBe(false)
      expect(readZip(buf, 'pw')[0].data.toString()).toBe('hello')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('轻量验口令只读 AES 头，明文包返回空', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-backup-peek-'))
    const enc = join(dir, 'enc.zip')
    const plain = join(dir, 'plain.zip')
    try {
      await writeZip(enc, [{ rel: 'a.txt', data: Buffer.from('hello') }], undefined, undefined, 'pw123')
      await writeZip(plain, [{ rel: 'a.txt', data: Buffer.from('hello') }])
      const head = await peekAesVerifier(enc)
      expect(Buffer.isBuffer(head)).toBe(true)
      expect(head.length).toBe(18)
      expect(checkVerifier(head, 'pw123')).toBe(true)
      expect(checkVerifier(head, 'wrong')).toBe(false)
      expect(await peekAesVerifier(plain)).toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('预检 passwordOnly 只验口令：明文包放行、加密包错口令报 password', async () => {
    await withHome(async () => {
      writeFileSync(join(process.env.DSH_HOME, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const plain = res()
        await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '' }), plain)
        const plainName = plain.out.payload.name
        const plainCheck = res()
        await handlers[VERIFY](req(VERIFY, { name: plainName, password: 'anything', passwordOnly: true }), plainCheck)
        expect(plainCheck.out.status).toBe(200)
        expect(plainCheck.out.payload).toEqual({ ok: true })

        const exported = res()
        await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '', password: 'secret' }), exported)
        const name = exported.out.payload.name
        const good = res()
        await handlers[VERIFY](req(VERIFY, { name, password: 'secret', passwordOnly: true }), good)
        expect(good.out.status).toBe(200)
        expect(good.out.payload).toEqual({ ok: true })
        const bad = res()
        await handlers[VERIFY](req(VERIFY, { name, password: 'wrong', passwordOnly: true }), bad)
        expect(bad.out.status).toBe(409)
        expect(bad.out.payload.code).toBe('password')
      } finally { cleanup() }
    })
  })
  it('导出带口令后校验必须给正确口令', async () => {
    await withHome(async () => {
      writeFileSync(join(process.env.DSH_HOME, 'settings.yaml'), 'enabled: true')
      const { handlers, cleanup } = setup()
      try {
        const exported = res()
        await handlers[EXPORT](req(EXPORT, { overrides: {}, regex: '', password: 'secret' }), exported)
        expect(exported.out.status).toBe(200)
        const name = exported.out.payload.name
        const good = res()
        await handlers[VERIFY](req(VERIFY, { name, password: 'secret' }), good)
        expect(good.out.status).toBe(200)
        const bad = res()
        await handlers[VERIFY](req(VERIFY, { name, password: 'wrong' }), bad)
        expect(bad.out.status).toBe(409)
        expect(bad.out.payload.code).toBe('password')
        const none = res()
        await handlers[VERIFY](req(VERIFY, { name }), none)
        expect(none.out.status).toBe(409)
        expect(none.out.payload.code).toBe('password')
      } finally { cleanup() }
    })
  })
})
