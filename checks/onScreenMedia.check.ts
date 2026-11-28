// A picture that never leaves the screen is asked about again (operator,
// 2026-11-22: post 2246210 jailed in the booru view stayed in its thread).
//
// Holds: a tag line counts itself on screen while it is, and only while it
// is; the same picture on screen twice (the room and its thread) stays
// counted until both have left, and a leave called twice does not take the
// other one with it. And the wiring: the tag line registers exactly while it
// is on screen; leaving the booru view, and coming back to the window, ask
// the booru again about every picture on screen, past the TTL, and so does a
// visible tab once a minute (operator, 2026-11-22: misc tag changes on the
// 60 s timer, jails and sensitive tags pushed).
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
  check('a visible tab asks again every minute, and the timer stops on sign-out',
    /export const ON_SCREEN_REREAD_MS = 60_000/.test(tags)
      && /const rereadPictures = setInterval\(\(\) => \{\s*if \(document\.visibilityState === 'visible'\) rereadOnScreen\(\)\s*\}, ON_SCREEN_REREAD_MS\)/.test(tags)
      && /clearInterval\(rereadPictures\)/.test(tags))
  check('leaving the booru view asks again (its unmount)',
    /useEffect\(\(\) => \(\) => \{[^}]*rereadOnScreen\(\)[^}]*\}, \[\]\)/.test(frame))
}

// A jailed picture is drawn as JAILED_TEXT and mounts no tag line, so it
// counts itself through usePopPhase (Developer, 2026-11-28: a release from
// troll jail must reach the open page with no refresh). Rendered for real in
// jsdom: the hook every placeholder reads its phase through.
console.log('\n-- a jailed placeholder is asked about again --')
{
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><div id="r"></div>')
  const g = globalThis as Record<string, unknown>
  g.window = dom.window
  g.document = dom.window.document
  g.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { jail, release, usePopPhase } = await import('../src/client/withheldMedia.ts')
  const Placeholder = ({ id }: { id: string }) => {
    usePopPhase(id)
    return null
  }
  const root = createRoot(dom.window.document.getElementById('r')!)
  const show = (ids: string[]) =>
    React.act(() => root.render(React.createElement(React.Fragment, null,
      ...ids.map((id, i) => React.createElement(Placeholder, { id, key: id + i })))))
  const before = listed()
  await show(['j1', 'free'])
  check('a picture that is not jailed is not counted by its phase', listed() === before, listed())
  await React.act(() => { jail('j1') })
  check('a jailed picture on the page is counted on screen', mediaOnScreen().includes('j1'), listed())
  check('a picture that is not jailed is still not counted', !mediaOnScreen().includes('free'), listed())
  await show(['j1', 'j1'])
  await show(['j1'])
  check('the same jailed picture twice, one leaving, stays counted', mediaOnScreen().includes('j1'), listed())
  await React.act(() => { release('j1', () => 0 as unknown as ReturnType<typeof setTimeout>) })
  check('released, it is no longer counted by its phase', !mediaOnScreen().includes('j1'), listed())
  await React.act(() => { jail('j1') })
  await show([])
  check('unmounted while jailed, it leaves the count', !mediaOnScreen().includes('j1'), listed())
  // Released, so withheldMedia's recheck ticker (armed because jsdom gave it
  // a document) finds nothing left and stops, and the check can exit.
  release('j1', () => 0 as unknown as ReturnType<typeof setTimeout>)
  await React.act(() => root.unmount())
  dom.window.close()
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall on-screen re-read checks passed')
