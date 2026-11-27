/**
 * WinZip AES AE-2 兼容加解密（256 位密钥）。
 * 备份 zip 每个条目独立加密，7-Zip / WinZip 可直接输口令解开。
 * @module dsh-plugins/dsh-backup/crypto
 */
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'

const SALT_BYTES = 16
const KEY_BYTES = 32
const ITERATIONS = 1000
const AUTH_BYTES = 10

/** 派生加密密钥、认证密钥、口令校验值；与 WinZip AE-2 规范一致。 */
function deriveKeys(password, salt) {
  const material = pbkdf2Sync(password, salt, ITERATIONS, KEY_BYTES * 2 + 2, 'sha1')
  return {
    encKey: material.subarray(0, KEY_BYTES),
    authKey: material.subarray(KEY_BYTES, KEY_BYTES * 2),
    verifier: material.subarray(KEY_BYTES * 2),
  }
}

/** 只比对 salt+校验值，不解密数据：导入前快速验口令，同一包各条目共用口令。 */
export function checkVerifier(head, password) {
  if (!Buffer.isBuffer(head) || head.length < SALT_BYTES + 2) return false
  const salt = head.subarray(0, SALT_BYTES)
  const verifier = head.subarray(SALT_BYTES, SALT_BYTES + 2)
  return timingSafeEqual(verifier, deriveKeys(password, salt).verifier)
}

/** 小端 CTR：Node 内置 ctr 是大端计数器，与 WinZip AES 不兼容，故用 ecb 自建流。 */
function ctrTransform(key, data) {
  const cipher = createCipheriv('aes-256-ecb', key, null)
  cipher.setAutoPadding(false)
  const out = Buffer.allocUnsafe(data.length)
  const counter = Buffer.alloc(16)
  for (let offset = 0, n = 1; offset < data.length; offset += 16, n++) {
    counter.fill(0)
    counter.writeUInt32LE(n, 0)
    const stream = cipher.update(counter)
    for (let i = 0; i < 16 && offset + i < data.length; i++) out[offset + i] = data[offset + i] ^ stream[i]
  }
  return out
}

/** 加密单个文件条目：salt(16) + 校验值(2) + 密文 + HMAC-SHA1 前 10 字节。 */
export function encryptEntry(data, password) {
  const salt = randomBytes(SALT_BYTES)
  const { encKey, authKey, verifier } = deriveKeys(password, salt)
  const ciphertext = ctrTransform(encKey, data)
  const auth = createHmac('sha1', authKey).update(ciphertext).digest().subarray(0, AUTH_BYTES)
  return Buffer.concat([salt, verifier, ciphertext, auth])
}

/** 解密单个文件条目；口令错误或数据损坏均抛错，由调用方转成明确错误码。 */
export function decryptEntry(payload, password) {
  if (payload.length < SALT_BYTES + 2 + AUTH_BYTES) throw new Error('bad encrypted data')
  const salt = payload.subarray(0, SALT_BYTES)
  const verifier = payload.subarray(SALT_BYTES, SALT_BYTES + 2)
  const ciphertext = payload.subarray(SALT_BYTES + 2, payload.length - AUTH_BYTES)
  const auth = payload.subarray(payload.length - AUTH_BYTES)
  const { encKey, authKey, verifier: expected } = deriveKeys(password, salt)
  if (!timingSafeEqual(verifier, expected)) throw new Error('wrong password')
  const actual = createHmac('sha1', authKey).update(ciphertext).digest().subarray(0, AUTH_BYTES)
  if (!timingSafeEqual(auth, actual)) throw new Error('wrong password or corrupted data')
  return ctrTransform(encKey, ciphertext)
}
