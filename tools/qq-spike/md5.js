// MD5 over a Uint8Array, for the QuickQueue M0 spike (tc.150).
// WebCrypto has no MD5, and a queue item's identity is the MD5 the upload
// path already dedups on (tc.50). Checked against node:crypto by md5.test.mjs.
(function (root) {
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Int32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0

  function md5(bytes) {
    const n = bytes.length
    const padded = new Uint8Array(((n + 8) >>> 6 << 6) + 64)
    padded.set(bytes)
    padded[n] = 0x80
    const dv = new DataView(padded.buffer)
    dv.setUint32(padded.length - 8, (n * 8) >>> 0, true)
    dv.setUint32(padded.length - 4, Math.floor(n / 0x20000000), true)
    let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0
    const M = new Int32Array(16)
    for (let off = 0; off < padded.length; off += 64) {
      for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true)
      let a = a0, b = b0, c = c0, d = d0
      for (let i = 0; i < 64; i++) {
        let f, g
        if (i < 16) { f = (b & c) | (~b & d); g = i }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15 }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15 }
        else { f = c ^ (b | ~d); g = (7 * i) & 15 }
        const t = d
        d = c
        c = b
        const x = (a + f + K[i] + M[g]) | 0
        b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0
        a = t
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
    }
    const out = new DataView(new ArrayBuffer(16))
    out.setInt32(0, a0, true); out.setInt32(4, b0, true); out.setInt32(8, c0, true); out.setInt32(12, d0, true)
    let hex = ''
    for (let i = 0; i < 16; i++) hex += out.getUint8(i).toString(16).padStart(2, '0')
    return hex
  }
  root.qqMd5 = md5
})(typeof window !== 'undefined' ? window : globalThis)
