// Left click and right click on a person (launch-polish L23).
//
// Operator, 2026-09-30: "Standardize Left vs Right click user avatars across
// the various panels. Left Click -> Perform Chat Action (where appropriate)
// Right Click -> Profile preview."
//
// Two halves. The rule itself is driven with stand-in events. Then the source
// of every surface that draws a person is read, to hold that each one takes
// its handlers from the rule and wires no click of its own -- a surface that
// kept the old convention (left looked, right acted) would pass any check of
// the rule alone.
import { readFileSync } from 'node:fs'
import { personGestures } from '../src/ui/personGesture.ts'
import { createPersonRouter } from '../src/ui/personRouter.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

type Call = [string, string, number, number]
function recorder() {
  const calls: Call[] = []
  return {
    calls,
    act: (u: string, x: number, y: number) => { calls.push(['act', u, x, y]) },
    look: (u: string, x: number, y: number) => { calls.push(['look', u, x, y]) },
  }
}
const el = { getBoundingClientRect: () => ({ left: 10, bottom: 40 }) }
const mouse = (x: number, y: number) => {
  let prevented = false
  return { e: { clientX: x, clientY: y, currentTarget: el, preventDefault: () => { prevented = true } } as never, prevented: () => prevented }
}
const key = (k: string) => {
  let prevented = false
  return { e: { key: k, currentTarget: el, preventDefault: () => { prevented = true } } as never, prevented: () => prevented }
}

console.log('== the rule')
{
  const r = recorder()
  const g = personGestures('@a:x', r.act, r.look)
  g.onClick!(mouse(5, 6).e)
  const ctx = mouse(7, 8)
  g.onContextMenu!(ctx.e)
  check('left click performs the chat action', JSON.stringify(r.calls[0]) === JSON.stringify(['act', '@a:x', 5, 6]), r.calls)
  check('right click opens the profile preview, and the browser menu does not open',
    JSON.stringify(r.calls[1]) === JSON.stringify(['look', '@a:x', 7, 8]) && ctx.prevented())
  const enter = key('Enter')
  g.onKeyDown!(enter.e)
  g.onKeyDown!(key(' ').e)
  g.onKeyDown!(key('a').e)
  check('Enter and Space do what a left click does, at the element', r.calls.length === 4 && r.calls[2][0] === 'act' && r.calls[3][0] === 'act' && r.calls[2][2] === 10 && r.calls[2][3] === 40 && enter.prevented())
  const kbMenu = mouse(0, 0)
  g.onContextMenu!(kbMenu.e)
  check('a context menu raised from the keyboard opens at the element, not the page corner', JSON.stringify(r.calls[4]) === JSON.stringify(['look', '@a:x', 10, 40]))
  check('it is a button that says it opens a menu', g.role === 'button' && g.tabIndex === 0 && g['aria-haspopup'] === 'menu')
}
{
  // Where no chat action applies, left click is never dead: it looks.
  const r = recorder()
  const g = personGestures('@a:x', undefined, r.look)
  g.onClick!(mouse(1, 2).e)
  check('no chat action here: left click opens the preview instead', r.calls[0]?.[0] === 'look')
  check('and says it opens a dialog, not a menu', g['aria-haspopup'] === 'dialog')
  check('nothing to open at all: no role, no handlers', Object.keys(personGestures('@a:x', undefined, undefined)).length === 0)
  const quiet = personGestures('@a:x', r.act, r.look, { focusable: false })
  check('a face drawn many times answers the pointer but is not a tab stop',
    quiet.onClick !== undefined && quiet.onContextMenu !== undefined && quiet.tabIndex === undefined && quiet.role === undefined && quiet.onKeyDown === undefined)
}

console.log('== the router: one menu and one card per room')
{
  const router = createPersonRouter()
  let heard = 0
  router.subscribe(() => heard++)
  const a = { act: () => {}, look: () => {} }
  const b = { act: () => {}, look: () => {} }
  const offA = router.register('!r', a)
  check('a registered room is found', router.get('!r') === a && heard === 1)
  const offB = router.register('!r', b)
  offA()
  check('an older registration leaving does not take the newer with it', router.get('!r') === b)
  offB()
  check('and the last one leaving empties the room', router.get('!r') === undefined && heard === 3)
}

console.log('== every surface that draws a person takes the rule')
{
  // file -> the call that must be there. Each of these used to wire its own
  // onClick/onContextMenu with left = profile.
  const SITES: [string, RegExp][] = [
    ['src/ui/SenderIdentity.tsx', /personGestures\(userId, onOpenInteractions, onOpenProfile\)/],
    ['src/ui/Timeline.tsx', /personGestures\(senderId, openInteractions, openProfile\)/],
    ['src/ui/Timeline.tsx', /personGestures\(userId, onOpenInteractions, onOpenProfile\)/],
    ['src/ui/AvatarPill.tsx', /personGestures\(userId, onAct, onLook\)/],
    ['src/ui/MemberList.tsx', /personGestures\(member\.id, presentHere \? onAct : undefined, onLook\)/],
    ['src/ui/ReceiptCluster.tsx', /personGestures\(userId, act, look, \{ focusable: false \}\)/],
  ]
  for (const [f, re] of SITES) check(`${f}: ${re.source.slice(0, 60)}`, re.test(read(f)))
  // And none of them keeps a click of its own on a person.
  for (const f of ['src/ui/SenderIdentity.tsx', 'src/ui/AvatarPill.tsx', 'src/ui/ReceiptCluster.tsx']) {
    const src = read(f)
    check(`${f}: no hand-wired onClick or onContextMenu`, !/onClick=\{|onContextMenu=\{/.test(src))
  }
  const ml = read('src/ui/MemberList.tsx')
  const row = ml.slice(ml.indexOf('function MemberRow'))
  check('the member list row wires no click of its own', !/onClick=\{|onContextMenu=\{/.test(row.slice(0, row.indexOf('<UserLine'))))
  check('the membership line hands the pill both openers', /onAct=\{openActions\}\s*\n\s*onLook=\{openProfile\}/.test(read('src/ui/MemberEvent.tsx')))
  const tp = read('src/ui/ThreadPanel.tsx')
  check('the thread panel provides both: its own preview, the room timeline\'s actions',
    /<ProfileOpenerContext\.Provider value=\{\(userId, x, y\) => setProfile\(\{ userId, x, y \}\)\}>/.test(tp) &&
    /<InteractionTargetContext\.Provider value=\{roomOpeners\?\.act\}>/.test(tp) && /<PersonCard/.test(tp))
  const tl = read('src/ui/Timeline.tsx')
  check('each timeline offers its menu and card to the other panels, under its room',
    /personRouter\.register\(room\.roomId, \{\s*act: \(userId, x, y\) => setIxMenu\(\{ userId, x, y \}\),\s*look: \(userId, x, y\) => setProfile\(\{ userId, x, y \}\),/.test(tl))
  check('one host for the preview, everywhere it is hosted',
    ['src/ui/Timeline.tsx', 'src/ui/MemberList.tsx', 'src/ui/ThreadPanel.tsx'].every((f) => /<PersonCard\b/.test(read(f)) && !/<ProfileCard\b/.test(read(f))))
}

console.log('== what a person opens: on the page, inside the window, with focus')
{
  const { JSDOM } = await import('jsdom')
  const { menuStep, placeAt, takeFocus } = await import('../src/ui/popupFocus.ts')
  const { presentIn } = await import('../src/ui/memberListDisplay.ts')
  check('arrow keys walk the items and wrap', menuStep('ArrowDown', 2, 3) === 0 && menuStep('ArrowUp', 0, 3) === 2 && menuStep('ArrowDown', 0, 3) === 1)
  check('from the box itself, down is the first item and up the last', menuStep('ArrowDown', -1, 4) === 0 && menuStep('ArrowUp', -1, 4) === 3)
  check('Home and End, and nothing else is a menu key', menuStep('Home', 2, 4) === 0 && menuStep('End', 0, 4) === 3 && menuStep('a', 0, 4) === null && menuStep('ArrowDown', 0, 0) === null)

  const dom = new JSDOM('<button id="name">kestrel</button><div id="menu" tabindex="-1"><button role="menuitem" disabled>slap</button><button role="menuitem" id="poke">poke</button></div><p id="else" tabindex="0">x</p>')
  const doc = dom.window.document
  const menu = doc.getElementById('menu') as unknown as HTMLElement
  ;(menu as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ width: 170, height: 330 })
  // Opened from the member list at the right edge, near the bottom.
  placeAt(menu, 1260, 700, { w: 1280, h: 800 })
  check('a menu opened at the right edge slides left to stay whole', menu.style.left === `${1280 - 8 - 170}px`, menu.style.left)
  check('one opened near the bottom slides up to stay whole', menu.style.top === `${800 - 8 - 330}px`, menu.style.top)
  check('and is capped to the window, so it can scroll', menu.style.maxHeight === `${800 - 16}px`)
  ;(doc.getElementById('name') as unknown as HTMLElement).focus()
  const restore = takeFocus(menu)
  check('opening moves focus to the first live item (Enter on a name reaches the menu)', doc.activeElement?.id === 'poke', doc.activeElement?.id)
  restore()
  check('closing puts focus back on the name that opened it', doc.activeElement?.id === 'name', doc.activeElement?.id)
  const restore2 = takeFocus(menu)
  ;(doc.getElementById('else') as unknown as HTMLElement).focus()
  restore2()
  check('but not when focus has already gone somewhere else', doc.activeElement?.id === 'else')

  const menuSrc = read('src/ui/InteractionMenu.tsx')
  check('the chat-actions menu is portalled to the page (a transformed dock cannot displace or clip it)',
    /return createPortal\(/.test(menuSrc) && /document\.body,\s*\)/.test(menuSrc))
  check('and placed and focused by the shared helpers', /usePopupAt\(ref, x, y\)/.test(menuSrc) && /usePopupFocus\(ref\)/.test(menuSrc))
  check('its items -- every interaction, and the profile -- are menu items', (menuSrc.match(/type="button"\s+role="menuitem"/g) ?? []).length === 2)
  // The preview's own gesture is a right click, which iOS never sends for a
  // long press; the menu a tap opens must lead to it.
  check('its first entry is the profile preview', menuSrc.indexOf('onProfile && (') > 0 && menuSrc.indexOf('onProfile && (') < menuSrc.indexOf('targeted.length > 0 && ('))
  check('and the timeline wires it to the card', /onProfile=\{\(\) => setProfile\(\{ userId: ixMenu\.userId, x: ixMenu\.x, y: ixMenu\.y \}\)\}/.test(read('src/ui/Timeline.tsx')))
  const card = read('src/ui/ProfileCard.tsx')
  check('the profile card is placed by its measured size and focused the same way',
    /usePopupAt\(ref, x, y\)/.test(card) && /usePopupFocus\(ref\)/.test(card) && !/innerHeight - 190/.test(card) && /role="dialog"/.test(card))

  const member = (m: string | null) => ({ getMember: (id: string) => (id === '@k:x' && m ? { membership: m } : null) })
  check('present means joined to the room being viewed', presentIn(member('join'), '@k:x') && !presentIn(member('leave'), '@k:x') && !presentIn(member('invite'), '@k:x'))
  check('nobody is present in no room, and a stranger is not present', !presentIn(null, '@k:x') && !presentIn(member('join'), '@other:x'))
  const ml = read('src/ui/MemberList.tsx')
  check('the member list asks the room, not the power-level record (rooms outside a space have none)',
    /const presentHere = presentIn\(room, member\.id\)/.test(ml) && !/room\.roomId in member\.powerByRoom/.test(ml))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nperson gestures: all checks passed')
