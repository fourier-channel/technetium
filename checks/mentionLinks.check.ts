// Links in a message (launch-polish L25).
//
// Operator, 2026-09-30: "Currently, @ing a user just places a clickable link
// in chat to that user's 'matrix.to/' address--which seems incorrect. have it
// open that user's profile instead."
//
// The mention itself is right -- the spec's anchor, which every client reads
// -- so what changes is what a click on it does. And a formatted body's links
// navigated Technetium itself away, where the plaintext path opened a tab.
import { JSDOM } from 'jsdom'
import { userFromPermalink } from '../src/client/permalink.ts'
import { matrixToUser } from '../src/client/matrixHtml.ts'
import { maskMentions, restoreMentions } from '../src/client/mentions.ts'
import { onMessageBodyAuxClick, onMessageBodyClick as onMessageLinkClick, onMessageBodyContextMenu as onMessageLinkContextMenu, onMessageBodyKey } from '../src/ui/messageLinks.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('== which links are a person')
{
  check('the unencoded form Element sends', userFromPermalink('https://matrix.to/#/@alice:example.org') === '@alice:example.org')
  check('the encoded form Technetium sends', userFromPermalink(matrixToUser('@alice:example.org')) === '@alice:example.org')
  check('with ?via= servers', userFromPermalink('https://matrix.to/#/@alice:example.org?via=example.org') === '@alice:example.org')
  check('the matrix: URI', userFromPermalink('matrix:u/alice:example.org?action=chat') === '@alice:example.org')
  check('a room is not a person', userFromPermalink('https://matrix.to/#/!room:example.org') === null && userFromPermalink('https://matrix.to/#/#general:example.org') === null)
  check('an event is not a person', userFromPermalink('https://matrix.to/#/!room:example.org/$event') === null)
  check('a malformed id is not a person', userFromPermalink('https://matrix.to/#/@nocolon') === null && userFromPermalink('https://matrix.to/#/%E0%A4%A') === null)
  check('a lookalike host is not a person', userFromPermalink('https://matrix.to.evil.example/#/@alice:example.org') === null && userFromPermalink('http://matrix.to/#/@alice:example.org') === null)
  check('an ordinary link is not a person', userFromPermalink('https://41chan.net/') === null)
  // The id handed on is the id validated, byte for byte -- never a trimmed
  // copy's original, never one with a fragment riding on its server name.
  check('a trailing newline or space is not a person', userFromPermalink('https://matrix.to/#/@alice:example.org%0a') === null && userFromPermalink('https://matrix.to/#/@alice:example.org%20') === null)
  check('a fragment on the server name is not a person', userFromPermalink('https://matrix.to/#/@alice:example.org#frag') === null && userFromPermalink('https://matrix.to/#/@alice:example.org%23frag') === null)
  // Round trip through the composer's own mention markup.
  const { masked, used } = maskMentions('hi @alice', [{ text: '@alice', userId: '@alice:example.org' }])
  const html = restoreMentions(masked, used)
  const href = /href="([^"]+)"/.exec(html)?.[1].replace(/&amp;/g, '&') ?? ''
  check('what Technetium sends as a mention is read back as that person', userFromPermalink(href) === '@alice:example.org', href)
}

console.log('== what a click does')
{
  const dom = new JSDOM(`<span id="body">see <a id="m" href="${matrixToUser('@alice:example.org')}">@alice</a> and <a id="w" href="https://41chan.net/x">this</a> <a id="r" href="https://matrix.to/#/!room:example.org">a room</a>
    <a id="pr" href="//evil.example/login">pr</a> <a id="rel" href="/settings">rel</a> <a id="bs" href="\\\\evil.example\\x">bs</a> <a id="nos" href="https:evil.example">nos</a>
    <a id="js" href="javascript:alert(1)">js</a> <a id="data" href="data:text/html,hi">data</a>
    <span id="sp" data-mx-spoiler="">hidden <a id="sm" href="${matrixToUser('@bob:example.org')}">@bob</a> <a id="sw" href="https://x.example/">site</a></span></span>`, { url: 'https://tc.example/room' })
  const doc = dom.window.document
  const body = doc.getElementById('body')!
  const opened: string[] = []
  const tabs: string[] = []
  ;(globalThis as unknown as { window: unknown }).window = { open: (u: string, t: string, f: string) => { tabs.push(`${u} ${t} ${f}`); return null } }
  const openProfile = (u: string, x: number, y: number) => { opened.push(`${u}@${x},${y}`) }
  const fire = (id: string, over: Record<string, unknown> = {}) => {
    let prevented = false
    const e = {
      target: doc.getElementById(id), currentTarget: body, button: 0, clientX: 11, clientY: 22,
      metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
      preventDefault: () => { prevented = true }, ...over,
    }
    return { e: e as never, prevented: () => prevented }
  }

  const m = fire('m')
  onMessageLinkClick(m.e, openProfile)
  check('a mention opens that person\'s profile at the pointer, and the link is not followed', opened[0] === '@alice:example.org@11,22' && m.prevented())
  const w = fire('w')
  onMessageLinkClick(w.e, openProfile)
  check('an ordinary link opens in a new tab, never in place of the client, with no opener and no referrer',
    w.prevented() && tabs[0] === 'https://41chan.net/x _blank noopener,noreferrer', tabs)
  const r = fire('r')
  onMessageLinkClick(r.e, openProfile)
  check('a room link is a link, not a person', opened.length === 1 && tabs.length === 2)
  const ctx = fire('m')
  onMessageLinkContextMenu(ctx.e, openProfile)
  check('right click on a mention is the preview too (a person, L23)', opened[1] === '@alice:example.org@11,22' && ctx.prevented())
  const ctxW = fire('w')
  onMessageLinkContextMenu(ctxW.e, openProfile)
  check('right click on an ordinary link keeps the browser\'s own menu', !ctxW.prevented())
  const ctrl = fire('m', { ctrlKey: true })
  onMessageLinkClick(ctrl.e, openProfile)
  check('a modified click is left to the browser', !ctrl.prevented() && opened.length === 2)
  for (const mod of ['metaKey', 'shiftKey', 'altKey']) {
    const c = fire('w', { [mod]: true })
    onMessageLinkClick(c.e, openProfile)
    check(`so is a ${mod.replace('Key', '')}-click`, !c.prevented() && tabs.length === 2 && opened.length === 2)
  }
  const middle = fire('w', { button: 1 })
  onMessageLinkClick(middle.e, openProfile)
  check('so is a middle click', !middle.prevented() && tabs.length === 2)
  const spoiled = fire('m', { defaultPrevented: true })
  onMessageLinkClick(spoiled.e, openProfile)
  check('a click the spoiler already took is not also a mention click', opened.length === 2)
  // Enter on a focused link reports no pointer position.
  ;(doc.getElementById('m') as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ left: 5, bottom: 9 })
  const key = fire('m', { clientX: 0, clientY: 0 })
  onMessageLinkClick(key.e, openProfile)
  check('from the keyboard, the preview opens at the link', opened[2] === '@alice:example.org@5,9', opened)

  // Every other shape of href the sanitizer keeps. Each one, left to the
  // browser, replaced this tab; each is resolved and opened in a new one.
  const before = tabs.length
  const shapes: [string, string][] = [['pr', 'https://evil.example/login'], ['rel', 'https://tc.example/settings'], ['bs', 'https://evil.example/x'], ['nos', 'https://tc.example/evil.example']]
  for (const [id, want] of shapes) {
    const c = fire(id)
    onMessageLinkClick(c.e, openProfile)
    check(`"${doc.getElementById(id)!.getAttribute('href')}" opens resolved, in a new tab, never in place`, c.prevented() && tabs.at(-1) === `${want} _blank noopener,noreferrer`, tabs.at(-1))
  }
  check('one tab for each of them', tabs.length === before + shapes.length)
  for (const id of ['js', 'data']) {
    const c = fire(id)
    onMessageLinkClick(c.e, openProfile)
    check(`a ${id}: link is neither followed nor opened`, c.prevented() && tabs.length === before + shapes.length, tabs.at(-1))
  }
}

console.log('== a hidden spoiler keeps what it hides')
{
  const dom = new JSDOM(`<span id="body"><span id="sp" data-mx-spoiler="">hidden <a id="sm" href="${matrixToUser('@bob:example.org')}">@bob</a> <a id="sw" href="https://x.example/">site</a></span></span>`, { url: 'https://tc.example/' })
  const doc = dom.window.document
  const body = doc.getElementById('body')!
  const sp = doc.getElementById('sp')!
  const opened: string[] = []
  const tabs: string[] = []
  ;(globalThis as unknown as { window: unknown }).window = { open: (u: string) => { tabs.push(u); return null } }
  const openProfile = (u: string) => { opened.push(u) }
  const fire = (id: string, over: Record<string, unknown> = {}) => {
    let prevented = false
    const e = {
      target: doc.getElementById(id), currentTarget: body, button: 0, clientX: 1, clientY: 1, key: '',
      metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
      preventDefault: () => { prevented = true }, ...over,
    }
    return { e: e as never, prevented: () => prevented }
  }
  const hidden = () => !sp.classList.contains('tc-spoiler-revealed')
  const ctx = fire('sm')
  onMessageLinkContextMenu(ctx.e, openProfile)
  check('right click on a hidden mention does not show who it names', opened.length === 0 && hidden())
  const aux = fire('sw', { button: 1 })
  onMessageBodyAuxClick(aux.e)
  check('a middle click on a hidden link does not open it', aux.prevented() && tabs.length === 0)
  const ctrl = fire('sw', { ctrlKey: true })
  onMessageLinkClick(ctrl.e, openProfile)
  check('a ctrl-click on a hidden link reveals rather than opens', ctrl.prevented() && !hidden() && tabs.length === 0)
  sp.classList.remove('tc-spoiler-revealed')
  const key = fire('sp', { key: 'Enter' })
  onMessageBodyKey(key.e)
  check('Enter on a hidden spoiler reveals it', key.prevented() && !hidden())
  sp.classList.remove('tc-spoiler-revealed')
  const first = fire('sm')
  onMessageLinkClick(first.e, openProfile)
  check('the first click reveals, and does not open the mention', first.prevented() && !hidden() && opened.length === 0)
  const second = fire('sm')
  onMessageLinkClick(second.e, openProfile)
  check('once revealed, the mention is a person again', opened[0] === '@bob:example.org')
  const ctx2 = fire('sm')
  onMessageLinkContextMenu(ctx2.e, openProfile)
  check('and right click previews it too', opened[1] === '@bob:example.org')
}

console.log('== both HTML bodies take the handlers')
{
  const { readFileSync } = await import('node:fs')
  const tl = readFileSync(new URL('../src/ui/Timeline.tsx', import.meta.url), 'utf8')
  const bodies = tl.match(/className="tc-message-html"[\s\S]*?dangerouslySetInnerHTML/g) ?? []
  // ONE set of handlers -- spoiler, link, keyboard -- for both: the caption
  // used to have the links and not the spoilers.
  check('every injected message body, the text and the gallery caption, takes the one set of handlers',
    bodies.length === 2 && bodies.every((b) => /\{\.\.\.messageBodyHandlers\(openProfile\)\}/.test(b) && !/on[A-Z]\w+=\{/.test(b)), bodies)
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nmention links: all checks passed')
