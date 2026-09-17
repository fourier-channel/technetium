// The layout number is a USER-FACING, WRITTEN-DOWN value.
//
// People paste these to each other and keep them in notes. Adding the member
// scale bumped the format from v3 to v4, and a v4 decoder that could not read a
// v3 code would silently reject every number anyone had saved -- importCode
// returns null, the UI says "that is not a layout number", and the layout the
// person actually had is unrecoverable. There is no migration path for a string
// in someone's notes, so the old format has to keep working forever.
//
// This builds a v3 code with the ORIGINAL bit layout, byte for byte, and
// asserts the current decoder accepts it. It deliberately does not call
// serialize() to make one, because serialize now emits v4 and a test that
// generated its input from the code under test would prove nothing.
import { defaultSpace, deserialize, serialize, PANEL_IDS, MEMBER_SCALE_MIN, MEMBER_SCALE_MAX } from '../src/ui/space'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// --- the v3 encoder, preserved here exactly as it was --------------------
const Q = 1023n
const LEAF_BITS = 40n + 3n + 6n + 3n
const q = (v: number) => BigInt(Math.max(0, Math.min(1023, Math.round(v * 1023))))
function checksum(x: bigint): bigint {
  let s = 0n, v = x
  while (v > 0n) { s = (s + (v & 0xffn)) & 0xffn; v >>= 8n }
  return s
}
function serializeV3(space: ReturnType<typeof defaultSpace>): string {
  let acc = 3n
  for (const id of PANEL_IDS) {
    const l = space.leaves[id]
    const last = l.last ? BigInt((l.last.axis === 'x' ? 1 : 3) + (l.last.dir === 1 ? 1 : 0)) : 0n
    const flags = (l.open ? 4n : 0n) | (l.pinned ? 2n : 0n) | (l.locked ? 1n : 0n)
    const min = BigInt(Math.floor(Math.max(0, Math.min(0.5, l.min)) * 126))
    let chunk = (((q(l.x0) << 10n) | q(l.y0)) << 20n) | (q(l.x1) << 10n) | q(l.y1)
    chunk = (chunk << 3n) | flags
    chunk = (chunk << 6n) | min
    chunk = (chunk << 3n) | last
    acc = (acc << LEAF_BITS) | chunk
  }
  acc = (acc << 8n) | checksum(acc)
  return acc.toString(10)
}

console.log('== a v3 code still loads')
const base = defaultSpace()
const v3 = serializeV3(base)
const fromV3 = deserialize(v3)
check('a v3 code is accepted', fromV3 !== null, { v3 })
check('and its geometry survives',
  fromV3 !== null && Math.abs(fromV3.leaves.sidebar.x1 - base.leaves.sidebar.x1) < 0.01)
check('a v3 code has no scale, so it reads as 1 rather than 0 or NaN',
  fromV3 !== null && fromV3.memberScale === 1, fromV3?.memberScale)

console.log('== a v4 code carries the scale')
const scaled = defaultSpace()
scaled.memberScale = 1.45
const round = deserialize(serialize(scaled))
check('a v4 code is accepted', round !== null)
check('the scale survives the trip within a quantisation step',
  round !== null && Math.abs(round.memberScale - 1.45) < 0.03, round?.memberScale)
check('the default scale round-trips exactly',
  deserialize(serialize(defaultSpace()))?.memberScale === 1)

console.log('== the scale is bounded')
for (const [given, why] of [[99, 'far above'], [-5, 'negative'], [Number.NaN, 'not a number']] as const) {
  const s = defaultSpace()
  s.memberScale = given
  const out = deserialize(serialize(s))
  check(`a ${why} scale comes back inside the range`,
    out !== null && out.memberScale >= MEMBER_SCALE_MIN && out.memberScale <= MEMBER_SCALE_MAX,
    out?.memberScale)
}

console.log('== garbage is still refused')
check('a non-numeric code is refused', deserialize('not-a-number') === null)
check('a corrupted checksum is refused', deserialize(String(BigInt(serialize(defaultSpace())) + 1n)) === null)

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
