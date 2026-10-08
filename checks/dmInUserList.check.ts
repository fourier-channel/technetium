// Direct messages live in the user list (launch-polish L30).
//
// Operator, 2026-10-08: "move DMs from the room list and put them in the user
// list. You're only going to be having conversations with people in the
// server, so kinda silly for them to be with the rooms." Holds: the section
// left the room list whole and arrived in the user list whole; the room tree
// and the counts are still fetched ONCE; a waiting conversation still reaches
// someone whose user list is put away.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dmStripRooms, dmWaitingRooms, dmTitle } from '../src/ui/dmStrip.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(p, 'utf8')
const nav = read('src/ui/NavTree.tsx')
const dm = read('src/ui/DmList.tsx')
const members = read('src/ui/MemberList.tsx')
const app = read('src/App.tsx')
const css = read('src/index.css')

console.log('\n-- it left the room list --')
{
  check('the room list draws no Direct Messages section', !/Direct Messages/.test(nav.replace(/\/\/.*$/gm, '')))
  check('and keeps no DM state of its own', !/dmOpen|dmRevealKey|dmStripRooms|dmWaitingRooms/.test(nav))
  check('its default width budgets only for names it draws (no orphan rooms)', !/tree\.orphanRooms\) names\.push/.test(nav))
}

console.log('\n-- it arrived in the user list, whole --')
{
  check('the user list renders it, under the button that starts one',
    /<DmList onSelectRoom=\{onSelectRoom\} \/>/.test(members) && members.indexOf('<DmList') > members.indexOf('+ DM'))
  check('App opens a chosen conversation through selectRoom (the dock), and a phone puts the list away',
    /onSelectRoom=\{\(room\) => \{\s*selectRoom\(room\)\s*if \(membersAlone\) closeMembers\(\)/.test(app))
  check('the stadium-to-rectangle shape came with it', /borderRadius: 'var\(--tc-dm-radius\)'/.test(dm))
  check('the Recent / Favorites Only / All filter came with it', /setDmFilter\(nextDmFilter\(dmFilter\)\)/.test(dm))
  check('a closed section still shows what is waiting', /: dmWaitingRooms\(rooms, notifs, isMutedNow\)/.test(dm))
  check('an invite is accepted on click, the DM adopted from the inviter read BEFORE the join',
    dm.indexOf('pendingDmInviter(client, node.roomId)') > 0 &&
    dm.indexOf('pendingDmInviter(client, node.roomId)') < dm.indexOf('client.joinRoom(node.roomId)') &&
    dm.indexOf('adoptDm(client, inviter, node.roomId)') > dm.indexOf('client.joinRoom(node.roomId)'))
  check('right click is the CONVERSATION\'s menu (close, mute, favourite live there)',
    /onContext\(node, e, true\)/.test(dm) && /conversation=\{menu\.conversation\}/.test(dm))
  check('faces are drawn by the one RoomIcon, shared with the room list',
    /from '\.\/RoomIcon'/.test(dm) && /from '\.\/RoomIcon'/.test(nav) && !/function RoomIcon/.test(nav + dm))
}

console.log('\n-- one tree, one poller --')
{
  // Every source file, so a third caller anywhere is caught.
  const files: string[] = []
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(f)) files.push(p)
    }
  }
  walk('src')
  const callers = (re: RegExp) => files.filter((f) => re.test(read(f).replace(/^\s*\/\/.*$/gm, '')))
  const tree = callers(/\buseNavTree\(client\)/)
  const counts = callers(/\buseRoomNotifications\(client\)/)
  check('the room tree is built in exactly one place, App', tree.length === 1 && tree[0].endsWith('App.tsx'), tree)
  check('the counts are polled in exactly one place, App', counts.length === 1 && counts[0].endsWith('App.tsx'), counts)
  check('App shares them', /<NavSharedContext\.Provider value=\{navShared\}>/.test(app))
  check('both lists read the shared copy', /useNavShared\(\)/.test(nav) && /useNavShared\(\)/.test(dm))
}

console.log('\n-- a waiting conversation reaches a put-away list --')
{
  check('the Members tab is the waiting-aware one', /<MembersPullTab\s/.test(app) && !/<PullTab[^>]*target="members"/.test(app))
  check('it shows with no room selected (the list always holds your conversations)',
    !/selectedRoom && !space\.leaves\.members\.open/.test(app))
  check('it glows only while the list is shut', /const waiting = !props\.open && dmWaitingRooms\(/.test(dm))
  check('and the glow is drawn, static', /\.tc-pulltab\[data-waiting='true'\][^{]*\{\s*box-shadow:/.test(css) &&
    !/\.tc-pulltab\[data-waiting='true'\][^{]*\{[^}]*animation/.test(css))
}

console.log('\n-- which conversations, unchanged by the move --')
{
  const node = (roomId: string, membership = 'join', ts = 0): any => ({
    roomId, name: roomId, isSpace: false, membership, joinRule: null, children: [],
    room: { getLastActiveTimestamp: () => ts, getAvatarFallbackMember: () => undefined },
  })
  const rooms = [node('!quiet'), node('!unread'), node('!invited', 'invite'), node('!muted')]
  const notifs = new Map([['!unread', { total: 2, highlight: 0 }], ['!muted', { total: 5, highlight: 1 }]])
  const muted = (id: string) => id === '!muted'
  const waiting = dmWaitingRooms(rooms, notifs as any, muted).map((n) => n.roomId)
  check('waiting: an unread conversation and an invite', waiting.join(',') === '!unread,!invited', waiting)
  check('a muted conversation never waits', !waiting.includes('!muted'))
  const favs = dmStripRooms(rooms, 'favorites', (id) => id === '!quiet', notifs as any, muted).map((n) => n.roomId)
  check('Favorites Only still shows what is waiting', favs.join(',') === '!quiet,!unread,!invited', favs)
  const many = Array.from({ length: 15 }, (_, i) => node('!r' + i, 'join', i))
  const recent = dmStripRooms(many, 'recent', () => false, new Map(), () => false)
  check('Recent is the dozen most recently active', recent.length === 12 && !recent.some((n) => n.roomId === '!r0'))
  check('an invite\'s tooltip says how to answer it', /click to accept/.test(dmTitle(node('!i', 'invite'), true, undefined)))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
