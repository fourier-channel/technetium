// Checks for encrypted attachments -- the real round trip, not a description
// of one. Node has WebCrypto, so this exercises the shipped code path.
import {
  AttachmentError,
  decryptAttachment,
  encryptAttachment,
  encryptedFileOf,
  type EncryptedFileInfo,
} from '../src/client/encryptedFile.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const bytes = (n: number, seed = 7) => {
  const a = new Uint8Array(n)
  for (let i = 0; i < n; i++) a[i] = (i * 31 + seed) & 0xff
  return a
}
const same = (a: ArrayBuffer, b: ArrayBuffer) => {
  const x = new Uint8Array(a), y = new Uint8Array(b)
  if (x.length !== y.length) return false
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}
const b64 = (s: string) => {
  const p = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(p + '='.repeat((4 - (p.length % 4)) % 4))
  const o = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
  return o
}
const withUrl = (info: Omit<EncryptedFileInfo, 'url'>): EncryptedFileInfo =>
  ({ ...info, url: 'mxc://example.org/abc' })

console.log('== the round trip')
{
  const plain = bytes(4096)
  const { ciphertext, info } = await encryptAttachment(plain.buffer as ArrayBuffer)
  const back = await decryptAttachment(ciphertext, withUrl(info))
  check('what goes in comes back out', same(plain.buffer as ArrayBuffer, back))
  check('the ciphertext is not the plaintext', !same(plain.buffer as ArrayBuffer, ciphertext))
  check('the ciphertext is the same length (CTR is a stream)', ciphertext.byteLength === plain.length)
}
{
  const empty = new Uint8Array(0)
  const { ciphertext, info } = await encryptAttachment(empty.buffer as ArrayBuffer)
  const back = await decryptAttachment(ciphertext, withUrl(info))
  check('an empty file round trips', back.byteLength === 0)
}
{
  // Longer than one AES block by a wide margin, which is where a counter that
  // starts in the wrong place goes wrong.
  const big = bytes(200_000, 3)
  const { ciphertext, info } = await encryptAttachment(big.buffer as ArrayBuffer)
  check('200 KB round trips', same(big.buffer as ArrayBuffer, await decryptAttachment(ciphertext, withUrl(info))))
}

console.log('\n== the shape other clients will read')
{
  const { info } = await encryptAttachment(bytes(64).buffer as ArrayBuffer)
  check('v is v2', info.v === 'v2')
  check('alg is A256CTR', info.key.alg === 'A256CTR')
  check('kty is oct', info.key.kty === 'oct')
  check('key_ops carries encrypt and decrypt',
    info.key.key_ops.includes('encrypt') && info.key.key_ops.includes('decrypt'))
  check('the key is 256 bits', b64(info.key.k).length === 32)
  check('the key is base64URL and unpadded',
    !/[+/=]/.test(info.key.k), { k: info.key.k })
  check('the iv is 16 bytes', b64(info.iv).length === 16)
  check('the sha256 is 32 bytes', b64(info.hashes.sha256).length === 32)
  // THE TRAP. AES-CTR treats the block as nonce||counter. Sixteen random bytes
  // encrypt and decrypt perfectly until a file long enough to overflow the low
  // half starts incrementing into the nonce and reuses keystream.
  const iv = b64(info.iv)
  check('the low eight IV bytes are ZERO -- they are the block counter',
    iv.slice(8).every((b) => b === 0), { iv: Array.from(iv) })
}

console.log('\n== tampering is refused')
{
  const plain = bytes(1024)
  const { ciphertext, info } = await encryptAttachment(plain.buffer as ArrayBuffer)
  const flipped = new Uint8Array(ciphertext.slice(0))
  flipped[10] ^= 0x01 // ONE bit
  let reason: string | null = null
  try { await decryptAttachment(flipped.buffer as ArrayBuffer, withUrl(info)) }
  catch (e) { reason = e instanceof AttachmentError ? e.reason : 'threw-other' }
  // Without the hash comparison this would have succeeded and flipped exactly
  // that bit of the image. CTR is malleable; the hash is the only guard.
  check('a single flipped bit is refused', reason === 'bad-hash', { reason })

  const truncated = ciphertext.slice(0, 512)
  let r2: string | null = null
  try { await decryptAttachment(truncated, withUrl(info)) }
  catch (e) { r2 = e instanceof AttachmentError ? e.reason : 'threw-other' }
  check('a truncated file is refused', r2 === 'bad-hash', { r2 })
}

console.log('\n== malformed metadata')
{
  const { ciphertext, info } = await encryptAttachment(bytes(64).buffer as ArrayBuffer)
  const reasonOf = async (bad: EncryptedFileInfo) => {
    try { await decryptAttachment(ciphertext, bad); return 'accepted' }
    catch (e) { return e instanceof AttachmentError ? e.reason : 'threw-other' }
  }
  check('an unknown version is refused',
    await reasonOf({ ...withUrl(info), v: 'v1' as unknown as 'v2' }) === 'unsupported')
  check('a non-A256CTR key is refused',
    await reasonOf({ ...withUrl(info), key: { ...info.key, alg: 'A128CTR' as unknown as 'A256CTR' } }) === 'bad-key')
  check('a short key is refused',
    await reasonOf({ ...withUrl(info), key: { ...info.key, k: 'AAAA' } }) === 'bad-key')
}

console.log('\n== no dedup, and it must not be claimed (H3)')
{
  const plain = bytes(2048, 11)
  const a = await encryptAttachment(plain.buffer as ArrayBuffer)
  const b = await encryptAttachment(plain.buffer as ArrayBuffer)
  check('the same bytes encrypt differently every time',
    !same(a.ciphertext, b.ciphertext) && a.info.hashes.sha256 !== b.info.hashes.sha256)
  check('and the keys differ too', a.info.key.k !== b.info.key.k)
}

console.log('\n== recognising an encrypted attachment')
{
  const { info } = await encryptAttachment(bytes(16).buffer as ArrayBuffer)
  check('a proper file object is recognised', !!encryptedFileOf({ file: withUrl(info) }))
  check('a plaintext m.image is not', encryptedFileOf({ url: 'mxc://example.org/x' }) === null)
  check('a file with no url is not yet usable', encryptedFileOf({ file: info }) === null)
  check('junk is not', encryptedFileOf(null) === null && encryptedFileOf({ file: 3 }) === null)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
