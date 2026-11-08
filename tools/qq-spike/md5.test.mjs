// node tools/qq-spike/md5.test.mjs -- qqMd5 must equal node:crypto's MD5.
// Sabotage control: a one-bit flip of the input must change the digest, and
// a broken copy of the function must fail, so a pass is not a test that
// cannot fail.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync(new URL('./md5.js', import.meta.url), 'utf8')
function load(code) {
  const ctx = {}
  vm.runInNewContext(code, { globalThis: ctx })
  return ctx.qqMd5
}
const md5 = load(src)
const ref = (b) => createHash('md5').update(b).digest('hex')

let fails = 0
const sizes = [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65536, 3 * 1024 * 1024 + 7]
for (const n of sizes) {
  const b = new Uint8Array(randomBytes(n))
  if (md5(b) !== ref(b)) { console.log(`FAIL size ${n}: ${md5(b)} != ${ref(b)}`); fails++ }
}
if (md5(new TextEncoder().encode('abc')) !== '900150983cd24fb0d6963f7d28e17f72') { console.log('FAIL abc vector'); fails++ }

const b = new Uint8Array(randomBytes(4096)); const before = md5(b); b[100] ^= 1
if (md5(b) === before) { console.log('FAIL: a flipped bit did not change the digest'); fails++ }

const broken = load(src.replace('(5 * i + 1) & 15', '(5 * i + 2) & 15'))
const probe = new Uint8Array(randomBytes(256))
if (typeof broken !== 'function') { console.log('FAIL: sabotage copy did not load, so it proves nothing'); fails++ }
else if (broken(probe) === ref(probe)) { console.log('FAIL: sabotaged md5 still matched; the comparison is not checking'); fails++ }

console.log(fails ? `md5 test FAIL (${fails})` : `md5 test PASS (${sizes.length} sizes, vector, bit flip, sabotage)`)
process.exit(fails ? 1 : 0)
