// See roomdrag-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { useMemo, useRef, useState } from 'react'
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
const names = Array.from({ length: 30 }, (_, i) => `room ${String(i).padStart(2, '0')}`)
const tree = {
  spaces: [space('!41', '41chan', names.map((n) => leaf(`!${n.replace(' ', '')}`, n)))],
  orphanRooms: [],
}
const rooms = new Map<string, unknown>()
const walk = (n: N) => { rooms.set(n.roomId, n.room); n.children.forEach(walk) }
tree.spaces.forEach(walk)
const client = { getUserId: () => '@me:x', getRoom: (id: string) => rooms.get(id) ?? null, getRooms: () => [...rooms.values()], on: () => {}, removeListener: () => {} } as never
const nav = { nav: { tree: tree as never, loading: false, stale: false }, notifs: new Map() }

declare global {
  interface Window { __writes: Array<{ scope: string; ids: string[] }>; __selected: string[] }
}
window.__writes = []
window.__selected = []

export function Harness() {
  const [order, setOrder] = useState<Record<string, string[]>>({})
  const settings = useMemo(() => {
    const known: Record<string, unknown> = {
      animationsEnabled: false, favorites: [], icons: {}, renames: {}, roomOrder: order, mutes: {},
      soundEnabled: false, soundVolume: 0, panelWidth: null, panelLocked: false, dmFilter: 'all',
      getRoomOrder: (scope: string) => order[scope],
      setRoomOrder: (scope: string, ids: string[]) => {
        window.__writes.push({ scope, ids })
        setOrder((o) => ({ ...o, [scope]: ids }))
      },
    }
    return new Proxy(known, { get: (t, k: string) => (k in t ? t[k] : () => undefined) }) as never
  }, [order])
  const scrollRef = useRef<HTMLElement>(null)
  return (
    <ClientContext.Provider value={{ client, status: 'ready', error: null, userId: '@me:x' } as never}>
      <RoomListSettingsContext.Provider value={settings}>
        <NavSharedContext.Provider value={nav as never}>
          <aside
            id="scroller"
            ref={scrollRef}
            className="tc-scroll"
            style={{ width: 260, height: 300, overflowY: 'auto', overflowX: 'hidden', boxSizing: 'border-box', padding: '8px 4px', marginTop: 40 }}
          >
            <NavTree scrollRef={scrollRef} onSelectRoom={(r) => window.__selected.push(r.roomId)} />
          </aside>
        </NavSharedContext.Provider>
      </RoomListSettingsContext.Provider>
    </ClientContext.Provider>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
