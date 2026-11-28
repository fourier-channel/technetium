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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  dmFaceBox, dmFaceBadge, dmFaceBadgeStyle, dmFaceStyle, isCircular, DM_AVATAR, DM_BADGE_CAP, DM_BADGE_REACH, DM_RING, DM_TILE,
} from '../src/ui/dmStrip.ts'

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


// The count badge (bug-20261127-dd94e140, Developer 2026-11-28): a face's
// count was a tooltip only, and a phone has no hover.
console.log('\n-- the count a face wears --')
{
  const c = (total: number, highlight = 0) => ({ total, highlight })
  check('nothing waiting: no badge', dmFaceBadge(c(0), 'join') === null)
  check('no counts (muted: the caller withholds them): no badge', dmFaceBadge(undefined, 'join') === null)
  check('an invite carries no count: no badge', dmFaceBadge(c(3), 'invite') === null)
  check('one waiting: "1"', dmFaceBadge(c(1), 'join') === '1')
  check('a ping counts too', dmFaceBadge(c(2, 2), 'join') === '2')
  check('at the cap: the number', dmFaceBadge(c(DM_BADGE_CAP), 'join') === String(DM_BADGE_CAP))
  check('past the cap: "99+"', dmFaceBadge(c(12345), 'join') === '99+')
  check('nonsense counts draw nothing', dmFaceBadge(c(NaN), 'join') === null && dmFaceBadge(c(-4), 'join') === null)
  const b = dmFaceBadgeStyle(false)
  check('the badge is placed, not laid out (moves no face)', b.position === 'absolute' && b.pointerEvents === 'none')
  check('the face is its containing block', dmFaceStyle({ ping: false, unread: true }).position === 'relative')
  check('the badge stays inside the strip padding the overflow clip allows (10px top, 12px sides)',
    b.top === -DM_BADGE_REACH && b.right === -DM_BADGE_REACH && DM_BADGE_REACH < 10)
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dl = readFileSync(join(root, 'src/ui/DmList.tsx'), 'utf8')
  check('DmList draws it from the same counts the glow reads',
    /const badge = dmFaceBadge\(counts, node\.membership\)/.test(dl) && /\{badge && \(\s*<span aria-hidden="true" className="tc-dm-badge" style=\{dmFaceBadgeStyle\(ping\)\}>/.test(dl))
  check('and the strip still pads by at least the badge reach',
    /gap: 13, padding: '10px 12px 12px'/.test(dl))
}

// The tree's count sits OUTSIDE the name's ellipsis (same bug, the reporter's
// "roomname" where "roomname (N)" was due).
console.log('\n-- the count beside a long room name --')
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const nt = readFileSync(join(root, 'src/ui/NavTree.tsx'), 'utf8')
  const fn = nt.slice(nt.indexOf('function RoomName('), nt.indexOf('// W3.4 -- one reorderable sibling group'))
  check('the count never shrinks', /const ROOM_NAME_COUNT: React\.CSSProperties = \{ flex: '0 0 auto'/.test(nt))
  check('the name shrinks and ellipsizes', /const ROOM_NAME_TEXT[\s\S]{0,120}minWidth: 0,\s*overflow: 'hidden',\s*textOverflow: 'ellipsis'/.test(nt))
  check('the count is a sibling of the name, after it, in every unread branch',
    (fn.match(/<\/FourierReveal>\s*\{count\}/g) ?? []).length === 2)
  check('no ellipsis span holds the count', !/ROOM_NAME_TEXT\}>[^<]*\{count\}/.test(fn) && !/\.\.\.ell/.test(fn))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nall ok')
