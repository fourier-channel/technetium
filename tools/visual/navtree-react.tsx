// See navtree-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { RoomListSettingsContext } from '../../src/ui/roomListSettings'
import { NavSharedContext } from '../../src/ui/navShared'
import { NavTree } from '../../src/ui/NavTree'

const room = (roomId: string, name: string) => ({
  roomId, name, getMxcAvatarUrl: () => null, getAvatarFallbackMember: () => null,
  getMyMembership: () => 'join', getLastActiveTimestamp: () => 0, canInvite: () => false,
  currentState: { getStateEvents: () => null },
})
type N = { roomId: string; name: string; isSpace: boolean; membership: string; joinRule: null; children: N[]; room: unknown }
const leaf = (id: string, name: string): N => ({ roomId: id, name, isSpace: false, membership: 'join', joinRule: null, children: [], room: room(id, name) })
const space = (id: string, name: string, children: N[]): N => ({ roomId: id, name, isSpace: true, membership: 'join', joinRule: null, children, room: room(id, name) })
const tree = {
  spaces: [space('!41', '41chan', [
    leaf('!lobby', 'lobby'),
    leaf('!rules', 'rules'),
    space('!art', 'Art', [leaf('!wip', 'wip'), leaf('!finished', 'finished')]),
    space('!games', 'Games', [leaf('!lfg', 'lfg')]),
  ])],
  orphanRooms: [],
}
const rooms = new Map<string, unknown>()
const walk = (n: N) => { rooms.set(n.roomId, n.room); n.children.forEach(walk) }
tree.spaces.forEach(walk)
const client = { getUserId: () => '@me:x', getRoom: (id: string) => rooms.get(id) ?? null, getRooms: () => [...rooms.values()], on: () => {}, removeListener: () => {} } as never
const known: Record<string, unknown> = {
  animationsEnabled: false, favorites: [], icons: {}, renames: {}, roomOrder: {}, mutes: {},
  soundEnabled: false, soundVolume: 0, panelWidth: null, panelLocked: false, dmFilter: 'all',
}
// Every other setting is a function; a no-op answers falsy, which is "not
// favorited, not muted, no icon, no rename" -- the plain tree.
const settings = new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never
const nav = { nav: { tree: tree as never, loading: false, stale: false }, notifs: new Map() }

createRoot(document.getElementById('root')!).render(
  <ClientContext.Provider value={{ client, status: 'ready', error: null, userId: '@me:x' } as never}>
    <RoomListSettingsContext.Provider value={settings}>
      <NavSharedContext.Provider value={nav as never}>
        <NavTree />
      </NavSharedContext.Provider>
    </RoomListSettingsContext.Provider>
  </ClientContext.Provider>,
)
setTimeout(() => {
  const root = document.getElementById('root')!.getBoundingClientRect().left
  const lines: string[] = []
  for (const name of ['41chan', 'lobby', 'Art', 'wip', 'finished', 'Games', 'lfg']) {
    const row = document.querySelector(`[title="${name}"]`) as HTMLElement | null
    if (!row) { lines.push(`${name}: (no row)`); continue }
    // The icon is the first child that is not the chevron.
    const kids = [...row.children] as HTMLElement[]
    const icon = kids.find((k) => !/^[▸▾]$/.test(k.textContent ?? ''))
    lines.push(`${name.padEnd(9)} icon at ${Math.round((icon?.getBoundingClientRect().left ?? NaN) - root)}px`)
  }
  document.getElementById('result')!.textContent = lines.join('\n')
}, 1200)
