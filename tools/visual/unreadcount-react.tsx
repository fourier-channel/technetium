// See unreadcount-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { RoomListSettingsContext } from '../../src/ui/roomListSettings'
import { NavSharedContext } from '../../src/ui/navShared'
import { NavTree } from '../../src/ui/NavTree'
import { DmList } from '../../src/ui/DmList'

const LONG = 'a-room-with-a-name-far-too-long-for-a-phone-to-show-whole'
const room = (roomId: string, name: string) => ({
  roomId, name, getMxcAvatarUrl: () => null, getAvatarFallbackMember: () => null,
  getMyMembership: () => 'join', getLastActiveTimestamp: () => 0, canInvite: () => false,
  isSpaceRoom: () => false, getJoinedMemberCount: () => 2,
  currentState: { getStateEvents: () => null },
})
type N = { roomId: string; name: string; isSpace: boolean; membership: string; joinRule: null; children: N[]; room: unknown }
const leaf = (id: string, name: string): N => ({ roomId: id, name, isSpace: false, membership: 'join', joinRule: null, children: [], room: room(id, name) })
const space = (id: string, name: string, children: N[]): N => ({ roomId: id, name, isSpace: true, membership: 'join', joinRule: null, children, room: room(id, name) })
const tree = {
  spaces: [space('!41', '41chan', [
    leaf('!long', LONG),
    leaf('!ping', LONG + '-pinged'),
    leaf('!short', 'lobby'),
  ])],
  orphanRooms: [leaf('!lost', 'lost-parent'), leaf('!dm1', 'Fourier-chan'), leaf('!dm2', 'quiet')],
}
const rooms = new Map<string, unknown>()
const walk = (n: N) => { rooms.set(n.roomId, n.room); n.children.forEach(walk) }
tree.spaces.forEach(walk)
tree.orphanRooms.forEach(walk)
const client = {
  getUserId: () => '@me:x', getRoom: (id: string) => rooms.get(id) ?? null, getRooms: () => [...rooms.values()],
  getAccountData: () => undefined, on: () => {}, removeListener: () => {}, off: () => {},
} as never
const known: Record<string, unknown> = {
  animationsEnabled: false, favorites: [], icons: {}, renames: {}, roomOrder: {}, mutes: {},
  soundEnabled: false, soundVolume: 0, panelWidth: null, panelLocked: false, dmFilter: 'all',
}
const settings = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never
const notifs = new Map([
  ['!long', { total: 12345, highlight: 0 }],
  ['!ping', { total: 7, highlight: 2 }],
  ['!lost', { total: 3, highlight: 0 }],
  ['!dm1', { total: 150, highlight: 1 }],
])
const nav = { nav: { tree: tree as never, loading: false, stale: false }, notifs }

createRoot(document.getElementById('root')!).render(
  <ClientContext.Provider value={{ client, status: 'ready', error: null, userId: '@me:x' } as never}>
    <RoomListSettingsContext.Provider value={settings}>
      <NavSharedContext.Provider value={nav as never}>
        <NavTree />
        <DmList onSelectRoom={() => {}} />
      </NavSharedContext.Provider>
    </RoomListSettingsContext.Provider>
  </ClientContext.Provider>,
)
setTimeout(() => {
  const lines: string[] = []
  const visible = (el: Element) => {
    // A count is shown only if no ancestor up to its row clips it.
    const r = el.getBoundingClientRect()
    for (let p = el.parentElement; p && p.id !== 'root'; p = p.parentElement) {
      const cs = getComputedStyle(p)
      if (cs.overflow !== 'visible' || cs.overflowX !== 'visible') {
        const q = p.getBoundingClientRect()
        if (r.left < q.left - 0.5 || r.right > q.right + 0.5) return false
      }
    }
    return r.width > 0
  }
  for (const id of ['!long', '!ping', '!short']) {
    const name = id === '!short' ? 'lobby' : id === '!long' ? LONG : LONG + '-pinged'
    const row = document.querySelector(`[title="${name}"]`)
    const count = row?.querySelector('.tc-room-count')
    const rr = row?.getBoundingClientRect()
    const cr = count?.getBoundingClientRect()
    lines.push(`${id.padEnd(7)} row ${rr ? Math.round(rr.width) : '-'}px  count ${count ? JSON.stringify(count.textContent) : 'none'}` +
      (cr && rr ? `  right ${Math.round(cr.right - rr.left)}px  shown=${visible(count!)}` : ''))
  }
  for (const b of document.querySelectorAll('.tc-dm-badge')) {
    const face = b.parentElement!.getBoundingClientRect()
    const r = b.getBoundingClientRect()
    lines.push(`face ${b.parentElement!.getAttribute('title')} badge ${JSON.stringify(b.textContent)}  dx ${Math.round(r.right - face.right)} dy ${Math.round(r.top - face.top)}  shown=${visible(b)}`)
  }
  lines.push(`faces ${document.querySelectorAll('button.tc-dm-waiting').length} waiting, badges ${document.querySelectorAll('.tc-dm-badge').length}`)
  document.getElementById('result')!.textContent = lines.join('\n')
}, 1500)
