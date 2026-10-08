// See l30-react.html. Harness only -- never shipped.
import '../../src/index.css'
import '../../src/formant-tokens.css'
import '../../src/formant-bridge.css'
import '@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css'
import { createRoot } from 'react-dom/client'
import { ClientContext } from '../../src/client/clientContextValue'
import { RoomListSettingsContext } from '../../src/ui/roomListSettings'
import { NavSharedContext } from '../../src/ui/navShared'
import { DmList, MembersPullTab } from '../../src/ui/DmList'
import { MentionPicker } from '../../src/ui/MentionPicker'

const member = (userId: string, name: string) => ({ userId, name, getMxcAvatarUrl: () => null })
const room = (roomId: string, other: ReturnType<typeof member>, ts: number) => ({
  roomId,
  name: other.name,
  getAvatarFallbackMember: () => other,
  getMxcAvatarUrl: () => null,
  getLastActiveTimestamp: () => ts,
  getMyMembership: () => 'join',
  canInvite: () => false,
  currentState: { getStateEvents: () => null },
})
const people = [member('@ann:x', 'Ann'), member('@bo:x', 'Bo'), member('@cy:x', 'Cy')]
const rooms = [room('!a', people[0], 3), room('!b', people[1], 2), room('!c', people[2], 1)]
const client = {
  getUserId: () => '@me:x',
  getRooms: () => rooms,
  getRoom: (id: string) => rooms.find((r) => r.roomId === id) ?? null,
  getAccountData: () => ({ getContent: () => ({ '@ann:x': ['!a'], '@bo:x': ['!b'], '@cy:x': ['!c'] }) }),
} as never
const node = (r: ReturnType<typeof room>, membership: string) => ({ roomId: r.roomId, name: r.name, isSpace: false, membership, joinRule: null, children: [], room: r })
const nav = { tree: { spaces: [], orphanRooms: [node(rooms[0], 'join'), node(rooms[1], 'invite'), node(rooms[2], 'join')] } as never, loading: false, stale: false }
const notifs = new Map([['!a', { total: 3, highlight: 1 }]])
const settings = {
  animationsEnabled: false, isMutedNow: () => false, isFavorite: () => false,
  dmFilter: 'all', setDmFilter: () => {}, getIcon: () => null,
} as never
const clientCtx = { client, status: 'ready', error: null, userId: '@me:x' } as never

export function Harness() {
  return (
    <ClientContext.Provider value={clientCtx}>
      <RoomListSettingsContext.Provider value={settings}>
        <NavSharedContext.Provider value={{ nav, notifs }}>
          <div style={{ display: 'flex', gap: 24, padding: 16, alignItems: 'flex-start' }}>
            <div id="memberlist" style={{ width: 220, border: '1px solid #444', minHeight: 200, position: 'relative' }}>
              <DmList onSelectRoom={(r) => { document.getElementById('result')!.textContent = 'opened ' + r.roomId }} />
            </div>
            <div style={{ position: 'relative', width: 320, height: 200 }}>
              <div id="picker" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10 }}>
                <MentionPicker
                  matches={[{ kind: 'member', member: people[0] as never }, { kind: 'room' }]}
                  activeIndex={1}
                  onPick={() => {}}
                />
              </div>
            </div>
            <div style={{ position: 'relative', width: 320, height: 200 }}>
              <div id="refused" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 10 }}>
                <MentionPicker matches={[]} activeIndex={0} onPick={() => {}} note="Notifying everyone here needs level 50; yours is 0." />
              </div>
            </div>
            <div style={{ position: 'relative', width: 80, height: 200 }}>
              <MembersPullTab pull="left" open={false} target="members" label="Members" onClick={() => {}} style={{ right: 0, top: 80 }} />
            </div>
          </div>
        </NavSharedContext.Provider>
      </RoomListSettingsContext.Provider>
    </ClientContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
setTimeout(() => {
  const ml = document.getElementById('memberlist')!
  const faces = ml.querySelectorAll('button[title]')
  const tab = document.querySelector('.tc-pulltab') as HTMLElement
  const lines = [
    'DM section header: ' + (ml.querySelector('button')?.textContent ?? '(none)'),
    'faces shown while CLOSED (waiting only): ' + [...faces].map((f) => f.getAttribute('title')).join(' | '),
    'mention picker entries: ' + [...document.querySelectorAll('#picker .tc-mention-item')].map((b) => b.textContent).join(' | '),
    'refusal note: ' + (document.querySelector('#refused .tc-mention-note')?.textContent ?? '(none)'),
    'Members tab: waiting=' + tab?.dataset.waiting + ' label=' + tab?.getAttribute('aria-label') + ' shadow=' + getComputedStyle(tab).boxShadow,
  ]
  document.getElementById('result')!.textContent = lines.join('\n')
}, 1500)
