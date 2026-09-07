// Checks for the DM strip's face geometry.
//
// Three properties, each one a bug the operator reported on 2026-09-07 while
// looking at the strip: faces at different heights, a waiting glow shaped like
// an oval, and no ring around the bare-initial faces. All three came from the
// same place -- the face's box was taken from whatever its content happened to
// measure, and its content measured two different things depending on whether
// the reveal animation was playing.
//
// The one that matters most is the last: the reveal wrapper and the icon it
// wraps MUST be given the same size. They were 20 and 30, written eight hundred
// lines apart, and nothing could see it.
import { dmFaceBox, isCircular, DM_AVATAR, DM_RING, DM_TILE } from '../src/ui/dmStrip.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const box = dmFaceBox()

check('the face is square', box.width === box.height, box)
check('the face can only render as a circle, never an oval', isCircular(box), box)
check(
  'the reveal wrapper and the icon get ONE size (the 20-vs-30 bug)',
  box.contentSize === DM_AVATAR,
  box,
)
check(
  'the ring sits inside the tile, so the tile stays square',
  box.boxSizing === 'border-box' && DM_TILE === DM_AVATAR + DM_RING * 2,
  { DM_TILE, DM_AVATAR, DM_RING },
)
check('every face is ringed (a ring of zero would be no ring)', DM_RING > 0)
check(
  'the tile is bigger than the avatar it holds',
  DM_TILE > DM_AVATAR,
  { DM_TILE, DM_AVATAR },
)

// Guard the derivation itself: someone hard-coding DM_TILE to a literal that
// happens to match today would pass everything above, and then drift the moment
// the avatar size changes. Re-derive from a different avatar size.
const derived = (avatar: number, ring: number) => avatar + ring * 2
check(
  'the tile is DERIVED from the avatar, not written down beside it',
  derived(DM_AVATAR, DM_RING) === DM_TILE && derived(64, DM_RING) !== DM_TILE,
  { DM_TILE },
)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall ok')
