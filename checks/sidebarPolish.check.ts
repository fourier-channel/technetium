// Launch-polish L13, L14, L16 and L17 (operator, 2026-09-28). L15, the pull
// tabs, lives in checks/threadStrip, beside the geometry it shares.
//
// These read the source, so they prove the text and not the rendering; the
// rendering is looked at in tools/visual/sidebar.html. What they catch is the
// shape drifting back.
import { readFileSync, existsSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const app = read('src/App.tsx')
const css = read('src/index.css')
const nav = read('src/ui/NavTree.tsx')

console.log('== L13 who you are: avatar framed, name to its right, in a panel; pills below')
const me = /<div className="tc-me">[\s\S]*?<\/div>\n\s*<\/div>\n/.exec(app)?.[0] ?? ''
check('the header is found', me.length > 0)
check('the avatar and the name share one card, avatar first',
  /className="tc-me-card"/.test(me) && me.indexOf('tc-me-av') < me.indexOf('tc-me-name') && me.indexOf('<AvatarDisc') < me.indexOf('tc-me-name'))
check('Settings, Layout and Log out are pills, in that order',
  (me.match(/className="tc-pill"/g) ?? []).length === 3 &&
  me.indexOf('Settings') < me.indexOf("'Layout'") && me.indexOf("'Layout'") < me.indexOf('Log out'))
check('the card and the avatar each have a border', /\.tc-me-card \{[^}]*border: 1px solid/.test(css) && /\.tc-me-av \{[^}]*border: 1px solid/.test(css))
check('the header sits on the room list\'s 8px gutter', /\.tc-me \{[^}]*padding: \d+px 8px/.test(css))
check('the Direct Messages pill and .tc-pill share one line and one radius',
  /border: '1px solid var\(--tc-pill-line\)'/.test(nav) && /borderRadius: 'var\(--tc-pill-radius\)'/.test(nav) &&
  /\.tc-pill \{[^}]*border: 1px solid var\(--tc-pill-line\);[^}]*border-radius: var\(--tc-pill-radius\);/.test(css))

console.log('== L14 the room list\'s left edge')
check('only a space draws the chevron slot', /\{node\.isSpace && \(\s*<span style=\{\{ width: NAV_CHEVRON_W/.test(nav))
check('a level of indent is exactly that slot, so a child\'s icon sits under its parent\'s',
  /const indent = NAV_PAD_X \+ depth \* NAV_CHEVRON_SLOT/.test(nav) && /const NAV_CHEVRON_SLOT = NAV_CHEVRON_W \+ 6/.test(nav) && /gap: 6,\s*\n\s*paddingLeft: indent/.test(nav))
check('the default width no longer budgets for the old indent', /const BASE = 86/.test(nav))

console.log('== L16 the chat log\'s scrollbar')
check('the room timeline and the thread panel both use it',
  /className="tc-log-scroll"/.test(read('src/ui/Timeline.tsx')) && /className="tc-log-scroll"/.test(read('src/ui/ThreadPanel.tsx')))
check('thin, trackless, in formant ink, green under the pointer',
  /\.tc-log-scroll \{\s*scrollbar-width: thin;\s*scrollbar-color: var\(--mod-ink-faint\) transparent;/.test(css) &&
  /\.tc-log-scroll:hover \{\s*scrollbar-color: var\(--mod-accent\) transparent;/.test(css))

console.log('== L17 the tab says Technetium, with 41chan\'s icon')
const html = read('index.html')
check('the title', /<title>Technetium - tc\.41chan\.net<\/title>/.test(html))
check('the icon is 41chan\'s, and the Vite bolt is gone',
  /<link rel="icon" type="image\/png" href="\/41chan\.png" \/>/.test(html) &&
  existsSync(new URL('../public/41chan.png', import.meta.url)) && !existsSync(new URL('../public/favicon.svg', import.meta.url)))

console.log('== L18 on a phone, the room list and the member list can be reached')
// Operator, 2026-09-29: "When loading tc on mobile, only chanbooru shows up
// ... user list, room list, nothing shows". The routes are proven in
// checks/spaceOverflow; these hold that the tabs exist and use them.
check('a closed room list shows a Rooms tab on the left edge, and it opens the room list',
  /<PullTab pull="right" open=\{false\} target="sidebar" label="Rooms" onClick=\{openSidebar\} style=\{\{ left: 0, top: ROOMS_TAB_TOP \}\} \/>/.test(app))
check('a closed member list shows a Members tab on the right edge, while a room is open',
  /\{selectedRoom && !space\.leaves\.members\.open && [^\n]*\(\s*<PullTab pull="left" open=\{false\} target="members" label="Members" onClick=\{openMembers\} style=\{\{ right: 0, top: MEMBERS_TAB_TOP \}\}/.test(app))
check('each has a way back when it is the whole screen, at its own list\'s height',
  /\{sidebarAlone && \(\s*<PullTab pull="left" open target="sidebar" label="Back" onClick=\{closeSidebar\} style=\{\{ right: 0, top: ROOMS_TAB_TOP \}\}/.test(app) &&
  /\{membersAlone && \(\s*<PullTab pull="right" open target="members" label="Back" onClick=\{closeMembers\} style=\{\{ left: 0, top: MEMBERS_TAB_TOP \}\}/.test(app))
{
  // "Room List has the upper position, user list has the lower position, in
  // both states." Tabs are centred on their top (translateY(-50%)), so the
  // two spots clear each other when they are more than a tab length apart.
  const { SIDE_TAB_SPREAD, PULLTAB_W, ROOMS_TAB_TOP, MEMBERS_TAB_TOP } = await import('../src/ui/threadStrip.ts')
  check('the room list rides above the middle, the member list below, a whole tab and a gap apart',
    /50% - /.test(ROOMS_TAB_TOP) && /50% \+ /.test(MEMBERS_TAB_TOP) && SIDE_TAB_SPREAD >= PULLTAB_W + 8, { ROOMS_TAB_TOP, MEMBERS_TAB_TOP })
}
check('a thread filling the phone has its own Back on the left edge (its panel-edge tab was off screen)',
  /\{openThread && upAlone === 'thread' && \(\s*<PullTab pull="right" open target="thread" label="Back" onClick=\{\(\) => setOpenThread\(null\)\} style=\{\{ left: 0 \}\}/.test(app) &&
  /\{openThread && upAlone !== 'thread' && \(/.test(app))
check('while a thread or a DM fills the screen, the list tabs stand aside',
  /!space\.leaves\.sidebar\.open && \(!upAlone \|\| membersAlone\)/.test(app) && /!space\.leaves\.members\.open && \(!upAlone \|\| sidebarAlone\)/.test(app))
check('choosing a room (or the booru) on the phone\'s room list puts the list away',
  (app.match(/if \(sidebarAlone\) closeSidebar\(\)/g) ?? []).length === 2)

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsidebar polish: all checks passed')
