import { useState, type ComponentProps } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { isDirect } from '../client/roomClass'
import { adoptDm, pendingDmInviter } from '../client/dm'
import { configureRoomEncryptionNow } from '../client/roomEncryptionConfig'
import { reportAlways } from '../client/report'
import { describeInviteError } from '../client/userDirectory'
import type { TreeNode } from '../client/spaces'
import { useRoomListSettings, nextDmFilter } from './roomListSettings'
import { useReducedMotion } from './reducedMotion'
import { useNavShared } from './navShared'
import { DM_AVATAR, dmFaceStyle, dmStripRooms, dmTitle, dmWaitingRooms } from './dmStrip'
import { EpicycleReveal, RoomIcon } from './RoomIcon'
import { RoomContextMenu } from './RoomContextMenu'
import { UserPicker } from './UserPicker'
import { PullTab } from './PullTab'

// ---------------------------------------------------------------------------
// The Direct Messages section, in the USER list (launch-polish L30, operator
// 2026-10-08): "We're also going to take a radical step and move DMs from the
// room list and put them in the user list. You're only going to be having
// conversations with people in the server, so kinda silly for them to be with
// the rooms, even though yes technically they are rooms."
//
// Moved whole from NavTree.tsx, not redrawn: the stadium that opens into a
// rounded rectangle (2026-10-05), the faces and their waiting glow, the
// Recent / Favorites Only / All filter, a closed section still showing every
// conversation with something waiting, an invited face accepting on click, and
// right click opening the CONVERSATION's menu -- the only home of close, mute
// and favourite (L23: these faces stand for a conversation, not a person).
//
// The rows are the tree's orphan rooms -- every joined or invited room in no
// space -- read from the one shared tree (navShared.ts), never a second copy.
// ---------------------------------------------------------------------------

// The Members tab, glowing while a conversation is waiting and the user list
// is put away. The room list's closed section kept a waiting face visible; a
// closed PANEL shows nothing at all, so without this a new message would reach
// nobody who had tucked the list away -- the pulse the section exists for.
export function MembersPullTab(props: Omit<ComponentProps<typeof PullTab>, 'waiting'>) {
  const { nav, notifs } = useNavShared()
  const { isMutedNow } = useRoomListSettings()
  const waiting = !props.open && dmWaitingRooms(nav.tree?.orphanRooms ?? [], notifs, isMutedNow).length > 0
  return <PullTab {...props} waiting={waiting} label={waiting ? `${props.label} -- a message is waiting` : props.label} />
}

// Stable empty set for the no-client case, so the identity does not churn.
const EMPTY_ROOM_IDS: ReadonlySet<string> = new Set()

export function DmList({ onSelectRoom }: { onSelectRoom: (room: Room) => void }) {
  const { client } = useClient()
  const { nav, notifs } = useNavShared()
  const { animationsEnabled, isMutedNow, isFavorite, dmFilter, setDmFilter } = useRoomListSettings()
  const reduced = useReducedMotion()
  const animate = animationsEnabled && !reduced
  const [dmOpen, setDmOpen] = useState(false)
  const [dmRevealKey, setDmRevealKey] = useState(0)
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number; conversation: boolean } | null>(null)
  const [inviteNode, setInviteNode] = useState<TreeNode | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const rooms = nav.tree?.orphanRooms ?? []
  // Which rooms are DMs, asked of the server's own verdict first (isDirect:
  // the create event's stamp, then m.direct). Recomputed each render: a memo
  // keyed on the client would never see a new DM.
  const dmIds = client
    ? new Set(client.getRooms().filter((r) => isDirect(client, r)).map((r) => r.roomId))
    : EMPTY_ROOM_IDS
  // A row right-clicked here is one of the conversation windows whatever the
  // room classifier makes of it -- see RoomContextMenu for the two kinds the
  // classifier correctly refuses to call DMs that still need closing.
  const onContext = (node: TreeNode, e: React.MouseEvent, conversation: boolean) => {
    e.preventDefault()
    setMenu({ node, x: e.clientX, y: e.clientY, conversation })
  }

  return (
    <>
    {/* Direct Messages: a top pill; expanded, DMs are icon-only, wrapping
        horizontally, and pushing the member rows down (intended reflow). */}
    {rooms.length > 0 && (
      <div
        style={{
          margin: '2px 4px 6px',
          // The whole section is ONE container that grows downwards. Its
          // radius is FIXED at half its COLLAPSED height (--tc-dm-radius,
          // index.css): collapsed that is a true stadium, the pill it has
          // always looked like; opened, it is a rounded rectangle whose
          // corners clear the faces. It used to take the pill radius
          // (999px), which a browser clamps to half of WHATEVER height the
          // box has -- so the opened section became a stadium too, and its
          // semicircular ends cut into the faces at the corners (operator,
          // 2026-10-05: "the DM window, shape is wrong").
          // The line is .tc-pill's (index.css), so the header's pills are
          // this section's kin.
          border: '1px solid var(--tc-pill-line)',
          borderRadius: 'var(--tc-dm-radius)',
          // Deliberately NOT overflow:hidden. The waiting glow reaches ~16px
          // past a face, and a face near the pill's edge would have had its
          // glow sliced off by the corner -- clipping the one thing the strip
          // exists to show. Nothing inside paints its own background, so the
          // rounded corners stay clean without it. The body's own collapse
          // clip lives on the grid row below.
          background: dmOpen ? 'var(--cpd-color-bg-subtle-secondary)' : 'transparent',
          transition: animate ? 'background-color 240ms ease' : undefined,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setDmOpen((o) => {
              if (!o) setDmRevealKey((k) => k + 1) // replay icon reveals on open
              return !o
            })
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            // The collapsed face's height, the one the radius is half of
            // (plus the border): fixed, so the two cannot drift apart.
            boxSizing: 'border-box',
            height: 'var(--tc-dm-head-h)',
            padding: '0 10px',
            // The section is the CONTAINER; this is its header face.
            borderRadius: 0,
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
            color: 'var(--cpd-color-text-secondary)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          <span style={{ fontSize: 9, opacity: 0.7 }}>{dmOpen ? '▾' : '▸'}</span>
          Direct Messages
          <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{rooms.length}</span>
        </button>
        {dmOpen && (
          <button
            type="button"
            onClick={() => setDmFilter(nextDmFilter(dmFilter))}
            title={'Cycle which conversations show: Recent -> Favorites Only -> All'}
            style={{
              display: 'block',
              margin: '4px 0 0 10px',
              padding: '2px 9px',
              borderRadius: 999,
              border: '1px solid rgba(128,128,128,0.35)',
              background: 'transparent',
              color: 'var(--cpd-color-text-secondary)',
              fontSize: 10,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {dmFilter === 'recent' ? 'Recent' : dmFilter === 'favorites' ? 'Favorites Only' : 'All'}
          </button>
        )}
        <div
          style={{
            display: 'grid',
            gridTemplateRows: dmOpen || dmWaitingRooms(rooms, notifs, isMutedNow).length > 0 ? '1fr' : '0fr',
            transition: animate ? 'grid-template-rows 240ms ease' : undefined,
          }}
        >
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            {/* gap widened from 7 (operator: too tightly packed). */}
            {/* Padding is set by the GLOW, not the face: it reaches ~16px,
                so a tighter inset would let it touch the pill's border. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 13, padding: '10px 12px 12px' }}>
              {(dmOpen
                ? dmStripRooms(rooms, dmFilter, isFavorite, notifs, isMutedNow)
                : dmWaitingRooms(rooms, notifs, isMutedNow)
              ).map((node) => {
                // A DM is drawn as the PERSON on the other end. Reduced to
                // icons, a DM has nothing else to identify it: DM rooms
                // almost never carry an avatar of their own, so the room
                // avatar path left every one of them as a generic initial.
                const isDm = dmIds.has(node.roomId)
                const counts = isMutedNow(node.roomId) ? undefined : notifs.get(node.roomId)
                const invited = node.membership === 'invite'
                // A DM invite is a personal summons: ping-grade, not merely
                // unread. It carries no server-side count, so membership is
                // the whole signal.
                const unread = invited || (counts?.total ?? 0) > 0
                const ping = invited || (counts?.highlight ?? 0) > 0
                return (
                  <button
                    key={`${node.roomId}:${dmRevealKey}`}
                    type="button"
                    onClick={async () => {
                      // Cache-revived nodes carry room: null until the live
                      // refresh lands; resolve by id at click time so the
                      // click is never a silent no-op (seen live 2026-09-05).
                      // Opening an invited conversation means accepting it:
                      // the invite was personal, and the click is the answer.
                      if (node.membership === 'invite' && client) {
                        // Read the is_direct flag BEFORE the join replaces
                        // our member event, then mirror the inviter's
                        // m.direct entry -- without this the accepted DM is
                        // a DM for one side only (seen live 2026-09-05:
                        // ticker and room-chrome on the acceptor's side).
                        const inviter = pendingDmInviter(client, node.roomId)
                        try {
                          await client.joinRoom(node.roomId)
                        } catch (err) {
                          reportAlways('dm: accept invite', err)
                          return
                        }
                        if (inviter) await adoptDm(client, inviter, node.roomId)
                        // Joining an already-encrypted room does not build
                        // the outbound encryptor on its own; do it so the
                        // first reply does not fail (roomEncryptionConfig.ts).
                        // NOT awaited: opening the conversation must never
                        // wait on key setup, and the SDK re-resolves members
                        // on send anyway.
                        void configureRoomEncryptionNow(client, node.roomId, { waitForUserId: inviter })
                      }
                      const live = client?.getRoom(node.roomId) ?? node.room ?? null
                      if (live) onSelectRoom(live)
                    }}
                    onContextMenu={(e) => onContext(node, e, true)}
                    title={dmTitle(node, isDm, counts)}
                    style={dmFaceStyle({ ping, unread })}
                    className={ping ? 'tc-dm-waiting tc-dm-waiting--ping' : unread ? 'tc-dm-waiting' : undefined}
                  >
                    <EpicycleReveal seed={node.roomId} size={DM_AVATAR} play={animate}>
                      <RoomIcon node={node} size={DM_AVATAR} isDm={isDm} />
                    </EpicycleReveal>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )}
      {menu && (
        <RoomContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          conversation={menu.conversation}
          onClose={() => setMenu(null)}
          onInvite={
            // Offered only where the room itself says this viewer may invite
            // -- the power question answered by room state, not by role.
            menu.node.membership === 'join' && menu.node.room && client && menu.node.room.canInvite(client.getUserId() ?? '')
              ? () => setInviteNode(menu.node)
              : undefined
          }
        />
      )}
      {inviteNode && client && (
        <UserPicker
          client={client}
          title={`Invite to: ${inviteNode.name}`}
          actionLabel="Inviting"
          excludeFromRoom={inviteNode.room}
          onPick={(userId) => {
            const run = async () => {
              try {
                await client.invite(inviteNode.roomId, userId)
                setInviteNotice('Invite sent.')
              } catch (err) {
                setInviteNotice(describeInviteError(err))
              }
              setInviteNode(null)
            }
            void run()
          }}
          onClose={() => setInviteNode(null)}
        />
      )}
      {inviteNotice && (
        <div className="tc-dm-notice" role="status" onClick={() => setInviteNotice(null)}>
          {inviteNotice}
        </div>
      )}
    </>
  )
}
