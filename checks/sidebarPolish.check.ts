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
// The Direct Messages section moved to the user list in launch-polish L30;
// its line is still the header pills' kin.
const dmList = read('src/ui/DmList.tsx')

console.log('== L13 who you are: avatar framed, name to its right, in a panel; pills below')
const me = /<div className="tc-me">[\s\S]*?<\/div>\n\s*<\/div>\n/.exec(app)?.[0] ?? ''
check('the header is found', me.length > 0)
check('the avatar and the name share one card, avatar first',
  /className="tc-me-card"/.test(me) && me.indexOf('tc-me-av') < me.indexOf('<MeName') && me.indexOf('<AvatarDisc') < me.indexOf('<MeName'))
// L24 (operator, 2026-09-30): the Profile panel's button "to the left of the
// settings button under the current user information panel".
check('Profile, Settings, Layout and Log out are pills, in that order',
  (me.match(/className="tc-pill"/g) ?? []).length === 4 &&
  me.indexOf('Profile') < me.indexOf('Settings') &&
  me.indexOf('Settings') < me.indexOf("'Layout'") && me.indexOf("'Layout'") < me.indexOf('Log out'))
check('the card and the avatar each have a border', /\.tc-me-card \{[^}]*border: 1px solid/.test(css) && /\.tc-me-av \{[^}]*border: 1px solid/.test(css))
check('the header sits on the room list\'s 8px gutter', /\.tc-me \{[^}]*padding: \d+px 8px/.test(css))
// They share the LINE. Not the radius since 2026-10-05: the pill radius on a
// box that grows is a stadium that cuts into the faces; the section's own
// fixed radius (checks/dmShape.check.ts) is the same stadium only while shut.
check('the Direct Messages section and .tc-pill share one line',
  /border: '1px solid var\(--tc-pill-line\)'/.test(dmList) &&
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
// ONE tab per list since 2026-10-05 (tabRide.ts): the same element flips edge
// and label with the list, rather than one tab unmounting for another.
check('the room list\'s one tab: Rooms on the left edge while shut, Back on the right edge while it is the screen',
  /pull=\{sidebarAlone \? 'left' : 'right'\}/.test(app) && /label=\{sidebarAlone \? 'Back' : 'Rooms'\}/.test(app) &&
  /onClick=\{sidebarAlone \? closeSidebar : openSidebar\}/.test(app) &&
  /style=\{sidebarAlone \? \{ right: 0, top: ROOMS_TAB_TOP \} : \{ left: 0, top: ROOMS_TAB_TOP \}\}/.test(app))
// Since L30 the tab shows with no room open too: the user list holds the
// Direct Messages section, so it always has something in it.
check('the member list\'s one tab: Members on the right edge while shut, Back on the left while it is the screen',
  /\(\(!space\.leaves\.members\.open && \(!upAlone \|\| sidebarAlone\)\) \|\| membersAlone\)/.test(app) &&
  /label=\{membersAlone \? 'Back' : 'Members'\}/.test(app) &&
  /style=\{membersAlone \? \{ left: 0, top: MEMBERS_TAB_TOP \} : \{ right: 0, top: MEMBERS_TAB_TOP \}\}/.test(app))
{
  // "Room List has the upper position, user list has the lower position, in
  // both states." Tabs are centred on their top (translateY(-50%)), so the
  // two spots clear each other when they are more than a tab length apart.
  const { SIDE_TAB_SPREAD, PULLTAB_W, ROOMS_TAB_TOP, MEMBERS_TAB_TOP } = await import('../src/ui/threadStrip.ts')
  check('the room list rides above the middle, the member list below, a whole tab and a gap apart',
    /50% - /.test(ROOMS_TAB_TOP) && /50% \+ /.test(MEMBERS_TAB_TOP) && SIDE_TAB_SPREAD >= PULLTAB_W + 8, { ROOMS_TAB_TOP, MEMBERS_TAB_TOP })
}
check('a thread filling the phone is closed by its tab, which rides the view\'s left edge -- the screen\'s, there -- and says Back',
  /label=\{openThread \? \(upAlone === 'thread' \? 'Back' : 'Close thread'\) : 'Thread'\}/.test(app) &&
  /threadTabGeometry\(space\.leaves\.members\.open, membersWidth, DIVIDER_PX, threadPanelWidth, threadPanelReveal\.shown\)/.test(app))
check('while a thread or a DM fills the screen, the list tabs stand aside',
  /\(!space\.leaves\.sidebar\.open && \(!upAlone \|\| membersAlone\)\) \|\| sidebarAlone/.test(app) && /!space\.leaves\.members\.open && \(!upAlone \|\| sidebarAlone\)/.test(app))
check('choosing a room (or the booru) on the phone\'s room list puts the list away',
  (app.match(/if \(sidebarAlone\) closeSidebar\(\)/g) ?? []).length === 2)

console.log('== a phone does not rewrite the desktop\'s layout (2026-09-29)')
{
  const state = read('src/ui/spaceState.ts')
  const prov = read('src/ui/SpaceProvider.tsx')
  check('a change that is only this screen\'s view returns before the layout the user chose, or the save',
    /if \(isMomentary\(prev, l\)\) return\s*\n\s*chosen\.current = l\s*\n\s*save\(\)/.test(state))
  check('a stored one-panel layout opens the default on a screen that holds more',
    /if \(stored && damagedByPhone\(stored\)\) return setViewport\(defaultSpace\(\), vp\)/.test(state))
  check('import, preset, reset and revert save the layout picked, not what this screen shows of it',
    (prov.match(/chooseSpace\(/g) ?? []).length >= 4 && !/setSpace\(reflow\(/.test(prov))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nsidebar polish: all checks passed')
