/**
 * 零依赖 ZIP writer：store 模式（不压缩），备份内容多已压缩，deflate 收益极低。
 * 单文件走 Buffer，避免流式 CRC 的复杂度；ZIP64 不实现，单包上限 4 GiB。
 * 口令非空时每个条目按 WinZip AES AE-2 加密，7-Zip / WinZip 可直接输口令解开；空口令保持旧明文包格式。
 * @module dsh-plugins/dsh-backup/zip
 */
import { open, readFile } from 'node:fs/promises'
import { decryptEntry, encryptEntry } from './crypto.js'

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c >>> 0
}

/** AE-2 固定 11 字节：头 0x9901、长度 7、版本 2、'AE'、AES-256(3)、实际压缩方式 store(0)。 */
const AES_EXTRA = (() => {
  const extra = Buffer.alloc(11)
  extra.writeUInt16LE(0x9901, 0)
  extra.writeUInt16LE(7, 2)
  extra.writeUInt16LE(2, 4)
  extra.write('AE', 6, 'ascii')
  extra[8] = 3
  extra.writeUInt16LE(0, 9)
  return extra
})()

export function crc32(buffer) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** DOS 时间：zip 格式要求，取当前时间即可，恢复不依赖它。 */
function dosNow() {
  const d = new Date()
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/**
 * 写入 zip。entries 为 [{ path?, rel, data? }]，rel 是包内相对路径；data 可为 Buffer 或惰性函数（清单在写入时才生成）。
 * onEntry 在每条 data 就绪后回调，供调用方顺带算指纹，避免二次读盘；回调拿到的始终是明文。
 * password 非空时写 AE-2 条目（method 99、flags bit0=1、CRC=0），空口令写旧明文条目。
 * @returns {{bytes:number, count:number}}
 */
export async function writeZip(outputPath, entries, onProgress, onEntry, password = '') {
  const handle = await open(outputPath, 'w')
  const encoder = new TextEncoder()
  const { time, date } = dosNow()
  const encrypt = Boolean(password)
  const central = []
  let offset = 0
  let done = 0
  // 逐条 await write 在万条目级 zip 上会被 Windows 的系统调用开销拖到分钟级；按 8 MiB 攒批后一次落盘。
  const BATCH_LIMIT = 8 * 1024 * 1024
  let batch = []
  let batchBytes = 0
  const flush = async () => {
    if (batch.length === 0) return
    const buf = batch.length === 1 ? batch[0] : Buffer.concat(batch, batchBytes)
    await handle.write(buf, 0, buf.length, offset - batchBytes)
    batch = []
    batchBytes = 0
  }
  try {
    for (const entry of entries) {
      const name = Buffer.from(encoder.encode(entry.rel.replace(/\\/g, '/')))
      const data = typeof entry.data === 'function' ? entry.data() : (entry.data ?? await readFile(entry.path))
      onEntry?.(entry.rel, data)
      const payload = encrypt ? encryptEntry(data, password) : data
      const crc = encrypt ? 0 : crc32(data)
      const flags = encrypt ? 1 : 0
      const method = encrypt ? 99 : 0
      const extraLen = encrypt ? AES_EXTRA.length : 0
      const local = Buffer.alloc(30 + name.length + extraLen)
      local.writeUInt32LE(0x04034B50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(flags, 6)
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(payload.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(extraLen, 28)
      name.copy(local, 30)
      if (encrypt) AES_EXTRA.copy(local, 30 + name.length)
      const localOffset = offset
      batch.push(local, payload)
      batchBytes += local.length + payload.length
      offset += local.length + payload.length
      if (batchBytes >= BATCH_LIMIT) await flush()
      const header = Buffer.alloc(46 + name.length + extraLen)
      header.writeUInt32LE(0x02014B50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(flags, 8)
      header.writeUInt16LE(method, 10)
      header.writeUInt16LE(time, 12)
      header.writeUInt16LE(date, 14)
      header.writeUInt32LE(crc, 16)
      header.writeUInt32LE(payload.length, 20)
      header.writeUInt32LE(data.length, 24)
      header.writeUInt16LE(name.length, 28)
      header.writeUInt16LE(extraLen, 30)
      header.writeUInt16LE(0, 32)
      header.writeUInt16LE(0, 34)
      header.writeUInt16LE(0, 36)
      header.writeUInt32LE(0, 38)
      header.writeUInt32LE(localOffset, 42)
      name.copy(header, 46)
      if (encrypt) AES_EXTRA.copy(header, 46 + name.length)
      central.push(header)
      done++
      if (done % 50 === 0) onProgress?.(done, entries.length)
    }
    await flush()
    const centralStart = offset
    const centralBuf = Buffer.concat(central)
    await handle.write(centralBuf, 0, centralBuf.length, offset)
    offset += centralBuf.length
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054B50, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(central.length, 8)
    eocd.writeUInt16LE(central.length, 10)
    eocd.writeUInt32LE(offset - centralStart, 12)
    eocd.writeUInt32LE(centralStart, 16)
    eocd.writeUInt16LE(0, 20)
    await handle.write(eocd, 0, eocd.length, offset)
    return { bytes: offset + eocd.length, count: central.length }
  } finally {
    await handle.close()
  }
}

/** 在 central extra field 中找 AE-2 标记；不是 AES 条目返回 null。 */
function findAesExtra(buf, at, len) {
  for (let i = at; i + 4 <= at + len; ) {
    const id = buf.readUInt16LE(i)
    const size = buf.readUInt16LE(i + 2)
    if (i + 4 + size > at + len) return null
    if (id === 0x9901 && size >= 7) return { version: buf.readUInt16LE(i + 4), vendor: buf.toString('ascii', i + 6, i + 8), strength: buf[i + 8] }
    i += 4 + size
  }
  return null
}

/**
 * 解析 zip，返回 [{ rel, data, method, encrypted }]；data 恒为明文（AES 条目用 password 解密）。
 * password 为空但遇到 AES 条目时抛带 code='password' 的错误，供上层转成明确错误码；结构损坏时抛普通错误。
 */
export function readZip(buffer, password = '') {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  let eocd = -1
  const floor = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054B50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('invalid zip: missing eocd')
  const count = buf.readUInt16LE(eocd + 10)
  let cursor = buf.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014B50) throw new Error('invalid zip: bad central header')
    const method = buf.readUInt16LE(cursor + 10)
    const size = buf.readUInt32LE(cursor + 20)
    const nameLen = buf.readUInt16LE(cursor + 28)
    const extraLen = buf.readUInt16LE(cursor + 30)
    const commentLen = buf.readUInt16LE(cursor + 32)
    const local = buf.readUInt32LE(cursor + 42)
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    const aes = method === 99 ? findAesExtra(buf, cursor + 46 + nameLen, extraLen) : null
    if (method === 99 && !aes) throw new Error('invalid zip: aes entry missing extra field')
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034B50) throw new Error('invalid zip: bad local header')
    const localNameLen = buf.readUInt16LE(local + 26)
    const localExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + localNameLen + localExtraLen
    if (start + size > buf.length) throw new Error('invalid zip: truncated data')
    const raw = buf.subarray(start, start + size)
    let data = raw
    if (aes) {
      if (!password) {
        const err = new Error('encrypted backup requires password')
        err.code = 'password'
        throw err
      }
      try {
        data = decryptEntry(raw, password)
      } catch {
        const err = new Error('wrong password or corrupted data')
        err.code = 'password'
        throw err
      }
    }
    entries.push({ rel: name.replace(/\\/g, '/'), data, method, encrypted: Boolean(aes) })
    cursor += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/**
 * 只读首个 AES 条目的 salt+校验值（18 字节），不解密、不算哈希，供导入前验口令。
 * 明文包返回 null；结构损坏抛普通错误，由上层转成 read 错误码。
 */
export async function peekAesVerifier(filePath) {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 22) throw new Error('invalid zip: too small')
    const tailSize = Math.min(size, 22 + 65535)
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, size - tailSize)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054B50) { eocd = i; break }
    }
    if (eocd < 0) throw new Error('invalid zip: missing eocd')
    const central = tail.readUInt32LE(eocd + 16)
    const header = Buffer.alloc(46)
    await handle.read(header, 0, 46, central)
    if (header.readUInt32LE(0) !== 0x02014B50) throw new Error('invalid zip: bad central header')
    if (header.readUInt16LE(10) !== 99) return null
    const local = header.readUInt32LE(42)
    const localHeader = Buffer.alloc(30)
    await handle.read(localHeader, 0, 30, local)
    if (localHeader.readUInt32LE(0) !== 0x04034B50) throw new Error('invalid zip: bad local header')
    const start = local + 30 + localHeader.readUInt16LE(26) + localHeader.readUInt16LE(28)
    const head = Buffer.alloc(18)
    await handle.read(head, 0, 18, start)
    return head
  } finally {
    await handle.close()
  }
}
