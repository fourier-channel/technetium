// A picture that never leaves the screen is asked about again (operator,
// 2026-11-22: post 2246210 jailed in the booru view stayed in its thread).
//
// Holds: a tag line counts itself on screen while it is, and only while it
// is; the same picture on screen twice (the room and its thread) stays
// counted until both have left, and a leave called twice does not take the
// other one with it. And the wiring: the tag line registers exactly while it
// is on screen; leaving the booru view, and coming back to the window, ask
// the booru again about every picture on screen, past the TTL.
import { readFileSync } from 'node:fs'
const { lineOnScreen, mediaOnScreen } = await import('../src/client/onScreenMedia.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const listed = () => mediaOnScreen().sort().join(',')

console.log('\n-- the register --')
{
  check('nothing on screen at first', listed() === '', listed())
  const leaveA = lineOnScreen('a')
  const leaveB = lineOnScreen('b')
  check('two lines on screen are both listed', listed() === 'a,b', listed())
  const leaveA2 = lineOnScreen('a')
  check('the same picture twice is listed once', listed() === 'a,b', listed())
  leaveA()
  check('one of two copies leaving keeps the picture listed', listed() === 'a,b', listed())
  leaveA()
  check('a leave called twice does not take the other copy with it', listed() === 'a,b', listed())
  leaveA2()
  check('the last copy leaving unlists it', listed() === 'b', listed())
  leaveB()
  check('and the register is empty again', listed() === '', listed())
}

console.log('\n-- the wiring --')
{
  const src = (p: string) => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
  const tags = src('client/useMediaTags.ts')
  const line = src('ui/MediaTags.tsx')
  const frame = src('ui/BooruFrame.tsx')

  check('the tag line counts itself only while on screen, and leaves on cleanup',
    /if \(!onScreen \|\| !mediaId\) return\s+refreshBooruTags\(mediaId\)\s+return lineOnScreen\(mediaId\)/.test(line))
  const reread = tags.slice(tags.indexOf('export function rereadOnScreen'))
  check('rereadOnScreen asks about every picture on screen, forced past the TTL',
    /for \(const mediaId of mediaOnScreen\(\)\) refreshBooruTags\(mediaId, true\)/.test(reread.slice(0, 200)))
  check('coming back to the window asks again, and stops on sign-out',
    /const stopReread = renewOnReturn\(async \(\) => rereadOnScreen\(\)\)/.test(tags) && /stopReread\(\)/.test(tags))
  check('leaving the booru view asks again (its unmount)',
    /useEffect\(\(\) => \(\) => \{[^}]*rereadOnScreen\(\)[^}]*\}, \[\]\)/.test(frame))
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall on-screen re-read checks passed')
