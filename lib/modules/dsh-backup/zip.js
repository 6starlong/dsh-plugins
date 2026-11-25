/**
 * 零依赖 ZIP writer：store 模式（不压缩），备份内容多已压缩，deflate 收益极低。
 * 单文件走 Buffer，避免流式 CRC 的复杂度；ZIP64 不实现，单包上限 4 GiB。
 * @module dsh-plugins/dsh-backup/zip
 */
import { open, readFile } from 'node:fs/promises'

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c >>> 0
}

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
 * 写入 zip。entries 为 [{ path?, rel, data? }]，rel 是包内相对路径；data 为内存条目（如清单）。
 * @returns {{bytes:number, count:number}}
 */
export async function writeZip(outputPath, entries, onProgress) {
  const handle = await open(outputPath, 'w')
  const encoder = new TextEncoder()
  const { time, date } = dosNow()
  const central = []
  let offset = 0
  let done = 0
  try {
    for (const entry of entries) {
      const name = Buffer.from(encoder.encode(entry.rel.replace(/\\/g, '/')))
      const data = entry.data ?? await readFile(entry.path)
      const crc = crc32(data)
      const local = Buffer.alloc(30 + name.length)
      local.writeUInt32LE(0x04034B50, 0)
      local.writeUInt16LE(20, 4)
      local.writeUInt16LE(0, 6)
      local.writeUInt16LE(0, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(data.length, 18)
      local.writeUInt32LE(data.length, 22)
      local.writeUInt16LE(name.length, 26)
      local.writeUInt16LE(0, 28)
      name.copy(local, 30)
      const localOffset = offset
      await handle.write(local, 0, local.length, offset)
      offset += local.length
      await handle.write(data, 0, data.length, offset)
      const header = Buffer.alloc(46 + name.length)
      header.writeUInt32LE(0x02014B50, 0)
      header.writeUInt16LE(20, 4)
      header.writeUInt16LE(20, 6)
      header.writeUInt16LE(0, 8)
      header.writeUInt16LE(0, 10)
      header.writeUInt16LE(time, 12)
      header.writeUInt16LE(date, 14)
      header.writeUInt32LE(crc, 16)
      header.writeUInt32LE(data.length, 20)
      header.writeUInt32LE(data.length, 24)
      header.writeUInt16LE(name.length, 28)
      header.writeUInt16LE(0, 30)
      header.writeUInt16LE(0, 32)
      header.writeUInt16LE(0, 34)
      header.writeUInt16LE(0, 36)
      header.writeUInt32LE(0, 38)
      header.writeUInt32LE(localOffset, 42)
      name.copy(header, 46)
      central.push(header)
      offset += data.length
      done++
      if (done % 50 === 0) onProgress?.(done, entries.length)
    }
    const centralStart = offset
    for (const header of central) {
      await handle.write(header, 0, header.length, offset)
      offset += header.length
    }
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