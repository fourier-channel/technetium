// ---------------------------------------------------------------------------
// Encrypted attachments: the EncryptedFile object of the Matrix spec, on
// WebCrypto, with NO new dependency (D1's recommendation, taken).
//
// The shape is not ours to invent. An encrypted m.image carries `content.file`
// instead of `content.url`, and that object is read by every other Matrix
// client in existence:
//
//   { url, key: {kty,key_ops,alg:"A256CTR",k,ext}, iv, hashes:{sha256}, v:"v2" }
//
// AES-CTR with a 256-bit key. The IV is 16 bytes of which the LAST EIGHT MUST
// BE ZERO: AES-CTR treats the whole block as a counter, so the low half is the
// block counter and only the high half is the nonce. Filling all sixteen with
// random bytes is a real bug that appears to work -- it encrypts and decrypts
// fine -- until a file long enough to overflow the low half starts
// incrementing into the nonce and silently reuses keystream.
//
// THE HASH IS CHECKED ON THE WAY IN, AND A MISMATCH REFUSES. AES-CTR is
// malleable: flipping a bit of ciphertext flips exactly that bit of plaintext,
// with no error anywhere. The sha256 of the ciphertext is the only thing
// standing between a tampered image and a decoded one, so decryption without
// that comparison is worse than no encryption -- it looks authenticated.
//
// Dedup does not apply here and must not be claimed (H3): a fresh key and IV
// per upload means the same image encrypts to different bytes every time.
//
// Pure and dependency-free, so the harness runs the real round trip rather
// than a description of one -- node has WebCrypto too (O-tp9).
// ---------------------------------------------------------------------------

export interface EncryptedFileKey {
  kty: 'oct'
  key_ops: string[]
  alg: 'A256CTR'
  k: string
  ext: true
}

export interface EncryptedFileInfo {
  // Set once the ciphertext has been uploaded and has an address.
  url?: string
  key: EncryptedFileKey
  iv: string
  hashes: { sha256: string }
  v: 'v2'
}

const IV_BYTES = 16
// The nonce half. The other eight bytes are the block counter and start at zero.
const IV_NONCE_BYTES = 8

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  // Unpadded is what the spec emits and what other clients send; atob wants the
  // padding, so put it back rather than rejecting a valid file.
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const full = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const bin = atob(full)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const unpadded = (s: string) => s.replace(/=+$/, '')
const toBase64Url = (bytes: Uint8Array) =>
  unpadded(toBase64(bytes)).replace(/\+/g, '-').replace(/\//g, '_')

async function sha256Base64(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return unpadded(toBase64(new Uint8Array(digest)))
}

// Encrypt bytes for upload. Returns the ciphertext to upload and the file info
// to put in the event, minus the url, which only exists after the upload.
export async function encryptAttachment(
  data: ArrayBuffer,
): Promise<{ ciphertext: ArrayBuffer; info: Omit<EncryptedFileInfo, 'url'> }> {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = new Uint8Array(IV_BYTES)
  iv.set(crypto.getRandomValues(new Uint8Array(IV_NONCE_BYTES)), 0)
  // Bytes 8..15 stay zero. See the header: this is the block counter.

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, true, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: iv, length: 64 }, key, data,
  )
  return {
    ciphertext,
    info: {
      key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: toBase64Url(keyBytes), ext: true },
      iv: unpadded(toBase64(iv)),
      hashes: { sha256: await sha256Base64(ciphertext) },
      v: 'v2',
    },
  }
}

export type DecryptFailure = 'bad-hash' | 'bad-key' | 'unsupported' | 'failed'

export class AttachmentError extends Error {
  // Declared rather than a constructor parameter property: this project builds
  // with erasableSyntaxOnly, which forbids the shorthand.
  readonly reason: DecryptFailure
  constructor(reason: DecryptFailure, message: string) {
    super(message)
    this.reason = reason
    this.name = 'AttachmentError'
  }
}

// Decrypt downloaded ciphertext. THROWS rather than returning something
// plausible: a caller that renders a half-decrypted image is worse than one
// that shows the error, and every failure here is a reason not to trust bytes.
export async function decryptAttachment(
  ciphertext: ArrayBuffer,
  info: EncryptedFileInfo,
): Promise<ArrayBuffer> {
  if (info.v !== 'v2') {
    throw new AttachmentError('unsupported', `unsupported encrypted file version ${String(info.v)}`)
  }
  if (info.key?.alg !== 'A256CTR' || typeof info.key.k !== 'string') {
    throw new AttachmentError('bad-key', 'the file key is missing or not A256CTR')
  }
  // BEFORE decrypting, not after. See the header: AES-CTR is malleable, so this
  // comparison is the whole of the integrity guarantee.
  const actual = await sha256Base64(ciphertext)
  if (actual !== unpadded(info.hashes?.sha256 ?? '')) {
    throw new AttachmentError('bad-hash',
      'the downloaded file does not match its hash; it was altered or truncated in transit')
  }
  let keyBytes: Uint8Array<ArrayBuffer>
  let iv: Uint8Array<ArrayBuffer>
  try {
    keyBytes = fromBase64(info.key.k)
    iv = fromBase64(info.iv)
  } catch {
    throw new AttachmentError('bad-key', 'the file key or IV is not valid base64')
  }
  if (keyBytes.length !== 32 || iv.length !== IV_BYTES) {
    throw new AttachmentError('bad-key',
      `expected a 32-byte key and a 16-byte IV, got ${keyBytes.length} and ${iv.length}`)
  }
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR' }, true, ['decrypt'])
    return await crypto.subtle.decrypt({ name: 'AES-CTR', counter: iv, length: 64 }, key, ciphertext)
  } catch (err) {
    throw new AttachmentError('failed', `decryption failed: ${String(err)}`)
  }
}

// Does this event content carry an encrypted attachment? Narrow, because the
// answer decides whether the media path reads `file` or `url`.
export function encryptedFileOf(content: unknown): EncryptedFileInfo | null {
  if (!content || typeof content !== 'object') return null
  const file = (content as { file?: unknown }).file
  if (!file || typeof file !== 'object') return null
  const f = file as Partial<EncryptedFileInfo>
  if (typeof f.url !== 'string' || !f.key || !f.iv || !f.hashes) return null
  return f as EncryptedFileInfo
}

// The encrypted THUMBNAIL, when the sender made one -- `info.thumbnail_file`,
// a separate attachment with its own key. Preferring it is the whole point of
// sending it: the full picture is megabytes and this is kilobytes.
export function encryptedThumbnailOf(content: unknown): { file: EncryptedFileInfo; mimetype?: string } | null {
  if (!content || typeof content !== 'object') return null
  const info = (content as { info?: unknown }).info
  if (!info || typeof info !== 'object') return null
  const f = (info as { thumbnail_file?: unknown }).thumbnail_file
  if (!f || typeof f !== 'object') return null
  const file = f as Partial<EncryptedFileInfo>
  if (typeof file.url !== 'string' || !file.key || !file.iv || !file.hashes) return null
  const ti = (info as { thumbnail_info?: { mimetype?: unknown } }).thumbnail_info
  const mimetype = typeof ti?.mimetype === 'string' ? ti.mimetype : undefined
  return { file: file as EncryptedFileInfo, mimetype }
}
