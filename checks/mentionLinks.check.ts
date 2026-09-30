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
import { onMessageLinkClick, onMessageLinkContextMenu } from '../src/ui/messageLinks.ts'

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
  // Round trip through the composer's own mention markup.
  const { masked, used } = maskMentions('hi @alice', [{ text: '@alice', userId: '@alice:example.org' }])
  const html = restoreMentions(masked, used)
  const href = /href="([^"]+)"/.exec(html)?.[1].replace(/&amp;/g, '&') ?? ''
  check('what Technetium sends as a mention is read back as that person', userFromPermalink(href) === '@alice:example.org', href)
}

console.log('== what a click does')
{
  const dom = new JSDOM(`<span id="body">see <a id="m" href="${matrixToUser('@alice:example.org')}">@alice</a> and <a id="w" href="https://41chan.net/x">this</a> <a id="r" href="https://matrix.to/#/!room:example.org">a room</a></span>`)
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
  check('an ordinary link opens in a new tab, never in place of the client',
    w.prevented() && tabs[0]?.startsWith('https://41chan.net/x _blank') && /noopener/.test(tabs[0]), tabs)
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
}

console.log('== both HTML bodies take the handlers')
{
  const { readFileSync } = await import('node:fs')
  const tl = readFileSync(new URL('../src/ui/Timeline.tsx', import.meta.url), 'utf8')
  const bodies = tl.match(/className="tc-message-html"[\s\S]*?dangerouslySetInnerHTML/g) ?? []
  check('every injected message body, the text and the gallery caption, handles its links',
    bodies.length === 2 && bodies.every((b) => /onMessageLinkClick\(e, openProfile\)/.test(b) && /onMessageLinkContextMenu\(e, openProfile\)/.test(b)), bodies.length)
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nmention links: all checks passed')
