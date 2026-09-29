// Back walks back through the client and never leaves it (operator,
// 2026-09-29): "someone hitting 'back' on their phone will go back to
// auth.41chan.net and error out"; "Back should not leave"; "Back should
// function as 'back' does in any other application." The decisions are pure
// (src/ui/backButton.ts); these walk them.
import { navigate, landOn, sameView, type Nav, type View } from '../src/ui/backButton.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const v = (room: string | null, panel: string | null = null, thread: string | null = null): View => ({ room, panel, thread })
const go = (nav: Nav, to: View) => {
  const s = navigate(nav, to)
  return { s, nav: s.kind === 'none' ? nav : s.nav }
}

console.log('== moving around pushes, and Back walks it back')
let nav: Nav = { stack: [v(null)], i: 0 } // armed on the first tap: the booru
let r = go(nav, v('!a')); check('choosing a room is a new entry', r.s.kind === 'push' && r.nav.i === 1); nav = r.nav
r = go(nav, v('!b')); check('and another', r.s.kind === 'push' && r.nav.i === 2); nav = r.nav
let l = landOn(nav, 1)
check('Back lands on the room before, and shows it', sameView(l.show!, v('!a')) && l.nav.i === 1 && !l.rearm); nav = l.nav
l = landOn(nav, 0)
check('and then the booru, where the user started', sameView(l.show!, v(null)) && l.nav.i === 0); nav = l.nav

console.log('== at the first place Back stays')
l = landOn(nav, null)
check('landing below the first entry shows nothing new and puts the entry back', l.show === null && l.rearm && l.nav.i === 0)
check('an entry that is not ours (a stale index) is treated the same', landOn(nav, 9).rearm && landOn(nav, 9).show === null)
check('before the first tap there is nothing to put back', !landOn({ stack: [], i: -1 }, null).rearm)

console.log('== a panel put away by its own tab is a step back, not a new entry')
nav = { stack: [v('!a')], i: 0 }
r = go(nav, v('!a', 'sidebar')); check('the room list filling the phone is an entry', r.s.kind === 'push'); nav = r.nav
r = go(nav, v('!a')); check('closing it by its tab steps back instead of pushing', r.s.kind === 'back' && r.nav.i === 0)
check('so the next Back does not reopen it: the stack still ends at the room list, behind us', r.nav.stack.length === 2)
nav = r.nav
r = go(nav, v('!c')); check('moving on from there drops what was ahead', r.s.kind === 'push' && r.nav.stack.length === 2 && sameView(r.nav.stack[1], v('!c')))

console.log('== a thread is a place too')
nav = { stack: [v('!a')], i: 0 }
r = go(nav, v('!a', null, '!a $root')); check('opening a thread is an entry', r.s.kind === 'push'); nav = r.nav
r = go(nav, v('!a')); check('closing it is a step back', r.s.kind === 'back')

console.log('== no entry for a view that did not change, or before the first tap')
check('same view: nothing', navigate({ stack: [v('!a')], i: 0 }, v('!a')).kind === 'none')
check('not armed yet: nothing', navigate({ stack: [], i: -1 }, v('!a')).kind === 'none')

const src = (await import('node:fs')).readFileSync(new URL('../src/ui/backButton.ts', import.meta.url), 'utf8')
check('nothing in it navigates away: no location assignment or replace', !/location\.(replace|assign|href\s*=)/.test(src))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nback button: all checks passed')
