import crypto from 'node:crypto'

const ALGO = 'aes-256-gcm'

function getKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not set')
  }
  if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }
  return Buffer.from(key, 'hex')
}

export function encrypt(text) {
  if (text === null || text === undefined) return text
  const key = getKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(encrypted) {
  if (encrypted === null || encrypted === undefined) return encrypted
  if (typeof encrypted !== 'string' || encrypted.split(':').length !== 3) {
    // Not encrypted (legacy plaintext value)
    return encrypted
  }
  const key = getKey()
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':')
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8')
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.split(':').length === 3
}
