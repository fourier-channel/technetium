import { useEffect, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from './client/clientContextValue'
import { Sidebar } from './ui/Sidebar'
import { Timeline } from './ui/Timeline'
import { Composer } from './ui/Composer'
import { Ticker } from './ui/Ticker'
import { placeholderTickerSource } from './ui/tickerSource'
import { useTickerCollapsed } from './ui/tickerCollapse'
import { directRoomIds } from './client/dm'
import { ComposerModeProvider } from './ui/ComposerModeProvider'
import { TypingBar } from './ui/TypingBar'
import { MemberList } from './ui/MemberList'
import { ResizeHandle } from './ui/ResizeHandle'
import { DmDock } from './ui/DmDock'
import { LayoutEditor } from './ui/LayoutEditor'
import { useSpace } from './ui/spaceContext'
import { ThreadPanel } from './ui/ThreadPanel'
import { ThreadList } from './ui/ThreadList'
import { useReveal } from './ui/useReveal'
import { TTD_DEFAULT } from './client/useDomainMedia'
import { LightboxProvider } from './ui/Lightbox'
import { RoomListSettingsProvider } from './ui/RoomListSettingsProvider'
import { useReadMarker } from './client/useReadMarker'
import { useMediaTagSync } from './client/useMediaTags'
import { DomainView } from './ui/DomainView'
import { AuthLanding } from './onboarding/AuthLanding'
import { AlphaBanner } from './ui/AlphaBanner'
import { AvatarDisc } from './ui/AvatarDisc'
import { AuthedImage } from './ui/AuthedImage'
import { BootScreen } from './onboarding/BootScreen'

// Thin shell: render purely by client lifecycle status. All auth/client logic
// lives in ClientProvider; App reflects the current phase and, when ready,
// mounts the three-pane layout (nav tree | timeline+composer | member list).
function App() {
  const { client, status, error, userId, login, logout } = useClient()
  const { space, pushEdge, editMode, setEditMode, showInDock, openThreadPane, closeThreadPane, openThreadList, closeThreadList, openDomain, closeDomain } = useSpace()
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  // DMs live in the dock, rooms in the main pane. Choosing a person opens
  // them across the top; the room being read stays where it is.
  const selectRoom = (room: Room) => {
    if (client && directRoomIds(client).has(room.roomId)) showInDock(room)
    else setSelectedRoom(room)
  }
  const [openThread, setOpenThread] = useState<{ roomId: string; rootId: string } | null>(null)

  // Open a room the caller knows only by id -- the just-created-DM case.
  // createRoom answers before the room reaches the client store via sync, so
  // "create then open" lands in that gap; retry briefly rather than dropping
  // the navigation. Seen live 2026-09-05: "Direct message created." with the
  // pane still saying select-a-room and nothing clickable.
  const openRoomById = (roomId: string) => {
    const attempt = (triesLeft: number) => {
      const room = client?.getRoom(roomId)
      if (room) {
        selectRoom(room)
        return
      }
      if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 500)
    }
    attempt(12)
  }
  // The thread list is a tile in the main column (under the dock, above the
  // chat); its open state IS the space's.
  const threadListOpen = space.leaves.threads.open
  const setThreadListOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(threadListOpen) : v
    if (next) openThreadList(); else closeThreadList()
  }
  // Thread and member widths are their shares of the space, in viewport px.
  const vw = window.innerWidth
  const threadPanelWidth = Math.round((space.leaves.thread.x1 - space.leaves.thread.x0) * vw) || 380
  const membersWidth = Math.round((space.leaves.members.x1 - space.leaves.members.x0) * vw) || 220
  // Column shares, of the column's full height (from the top open tile to
  // the chat's bottom): how the dock, thread list and domain divide it.
  const colTop = Math.min(...(['dock', 'threads', 'main'] as const).filter((k) => space.leaves[k].open).map((k) => space.leaves[k].y0))
  const colH = Math.max(1e-6, space.leaves.main.y1 - colTop)
  const threadsShare = space.leaves.threads.open ? (space.leaves.threads.y1 - space.leaves.threads.y0) / colH : 0
  const domainWidth = Math.round((space.leaves.domain.x1 - space.leaves.domain.x0) * vw)
  const [domainExpanded, setDomainExpanded] = useState(false)
  // The canvas's time-to-die lives here rather than inside DomainView, so the
  // ONE composer can stamp it onto a post while the domain is open. The domain
  // used to carry its own composer purely to reach this value, which is how it
  // ended up bringing a second chat along with it.
  const [domainTtd, setDomainTtd] = useState(TTD_DEFAULT)
  // Both panels arrive and leave the same way, from one mechanism -- the only
  // way two things stay exactly the same is for there to be one of them.
  const domainReveal = useReveal(domainExpanded, 420)
  // The thread list descends from the dock's bottom edge (no sudden jumps):
  // mounted for the whole choreography, its height going 0 -> share -> 0.
  const threadListReveal = useReveal(threadListOpen, 380)
  // The domain is a TILE that takes width from the chat column below the
  // dock; opening carves it out of the space, closing hands the width back.
  useEffect(() => {
    if (domainExpanded) openDomain(); else closeDomain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainExpanded])
  // The reading pane arrives the same way the domain does. Same hook, same
  // duration family, so "like the domain" is a fact rather than a resemblance.
  const threadPanelReveal = useReveal(!!openThread, 420)
  // The thread pane is a tile: carve it out of main when a thread opens, give
  // the space back when it closes.
  useEffect(() => {
    if (openThread) openThreadPane(); else closeThreadPane()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!openThread])
  // Mark the viewed room read so its unread glow/ping clears (base client sent
  // no read receipts). Called before any early return to keep hook order stable.
  useReadMarker(client, selectedRoom)
  // Ticker collapse follows the user via account data. Same hook-order rule.
  const [tickerCollapsed, setTickerCollapsed] = useTickerCollapsed(client)
  // Keep the media-tag store fed from room state for every room, so any image
  // anywhere in the tree can resolve its tags without props being threaded.
  useMediaTagSync(client)

  if (status === 'awaiting_login') {
    // Every door (log in, advanced create, or finishing the guided walkthrough)
    // begins the same OIDC/MAS sign-in; MAS presents login-or-register.
    return <AuthLanding onProceed={() => login()} />
  }

  if (status === 'error') {
    return (
      <Centered>
        <h1>Technetium</h1>
        <p style={{ color: 'var(--cpd-color-text-critical-primary, #d22)' }}>
          {error ?? 'Something went wrong.'}
        </p>
        <button type="button" onClick={() => login()}>Try again</button>
      </Centered>
    )
  }

  // Pre-client beat only: a moving boot screen, never a dead "Loading".
  if (status === 'starting' || (status === 'syncing' && !client)) {
    return <BootScreen label={status === 'starting' ? 'Starting' : 'Connecting'} />
  }

  // A client now exists. Mount the real shell for BOTH 'syncing' (room list
  // shows the cached stale shape) and 'ready' -- the user never faces a blank
  // screen. `booting` drives an indeterminate top progress bar.
  const booting = status !== 'ready'

  // status === 'ready' or 'syncing' (with client) -- three-pane layout.
  return (
    <LightboxProvider>
    <RoomListSettingsProvider>
    {booting && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 2000, overflow: 'hidden' }}>
        <div
          className="tc-boot-sweep"
          style={{ height: '100%', width: '40%', borderRadius: 2, background: 'var(--cpd-color-bg-accent-rest, #3390ff)' }}
        />
        <style>{`
          .tc-boot-sweep { animation: tcBootSweep 1.1s ease-in-out infinite; }
          @keyframes tcBootSweep { 0% { transform: translateX(-110%); } 100% { transform: translateX(360%); } }
          @media (prefers-reduced-motion: reduce) { .tc-boot-sweep { animation: none; width: 100%; } }
        `}</style>
      </div>
    )}
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <AlphaBanner />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar
        selectedRoomId={selectedRoom?.roomId}
        onSelectRoom={selectRoom}
        header={
          <div style={{ padding: '4px 8px 8px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
              }}
            >
              {/* Smaller than the old <strong> default: the name must fit the
                  width most people leave the room list at, and it ellipsizes
                  rather than wrapping the header. */}
              <strong
                style={{
                  fontSize: 12.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={userId ?? undefined}
              >
                {userId}
              </strong>
              <button
                type="button"
                onClick={() => setEditMode(!editMode)}
                style={{ fontSize: 11, flexShrink: 0 }}
                title="Resize, lock and pin the panels; export your layout as a number"
              >
                {editMode ? 'Done' : 'Edit layout'}
              </button>
              <button type="button" onClick={logout} style={{ fontSize: 12, flexShrink: 0 }}>Log out</button>
            </div>
            {/* The user's own avatar, under the name at the panel's top left. */}
            <div style={{ marginTop: 6 }}>
              <AvatarDisc
                userId={userId ?? ''}
                name={client?.getUser(userId ?? '')?.displayName ?? userId ?? ''}
                avatarMxc={client?.getUser(userId ?? '')?.avatarUrl ?? null}
                size={34}
              />
            </div>
          </div>
        }
      />

      {/* position: relative because the domain and the thread strip are panels
          ON this, not replacements for it. The chat stays mounted underneath --
          a panel that slides away to reveal a freshly remounted timeline is not
          a panel, it is a page change wearing an animation. */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* The DM window, across the top, before anything the selected room
            renders: it is its own space and by default it wins. */}
        <DmDock />
        {/* Below the dock: the chat column and, to its right, the domain --
            a tile that takes width from the column, so the thread list and
            the chat SHRINK for it rather than being covered. The dock keeps
            its span, so the domain owns its space up past the thread list. */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* position: relative so the domain tab rides THIS column's right edge. */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
            {/* The thread list: attached to the bottom of the DM window, taking
                its height from the chat and never from the dock. */}
            {threadListReveal.mounted && selectedRoom && (
              <div
                className="tc-threads-tile"
                style={{
                  height: threadListReveal.shown ? `${Math.round(threadsShare * 1000) / 10}%` : 0,
                  transitionDuration: `${threadListReveal.durationMs}ms`,
                }}
              >
                <ThreadList
                  layout="carousel"
                  onSelect={(roomId, rootId) => setOpenThread({ roomId, rootId })}
                  activeRootId={openThread?.rootId}
                  roomId={selectedRoom?.roomId}
                  onClose={() => setThreadListOpen(false)}
                />
              </div>
            )}
            {selectedRoom ? (
              // One composer-mode scope per composer: the room timeline and its
              // composer share a reply/edit target, and the thread panel keeps
              // its own so replying in a thread cannot hijack the room composer.
              <ComposerModeProvider>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <Timeline room={selectedRoom} onOpenThread={(roomId, rootId) => setOpenThread({ roomId, rootId })} onOpenRoom={openRoomById} threadListOpen={threadListOpen} onToggleThreadList={() => setThreadListOpen((o) => !o)} />
                </div>
                <TypingBar client={client} room={selectedRoom} />
                {/* The dedicated strip above the chat box. Absent in DMs
                    entirely (operator ruling 2026-09-05); collapsible
                    elsewhere, the state riding account data. */}
                {!(client && selectedRoom && directRoomIds(client).has(selectedRoom.roomId)) && (
                  <Ticker
                    source={placeholderTickerSource}
                    collapsed={tickerCollapsed}
                    onToggle={() => setTickerCollapsed(!tickerCollapsed)}
                  />
                )}
                {/* Undefined unless the domain is open, so an ordinary message
                    in an ordinary room never acquires a lifetime. */}
                <Composer room={selectedRoom} domainTtd={domainExpanded ? domainTtd : undefined} />
                <DomainTab
                  room={selectedRoom}
                  open={domainExpanded}
                  shown={domainReveal.shown}
                  onToggle={() => setDomainExpanded((o) => !o)}
                />
              </ComposerModeProvider>
            ) : (
              <div style={{ padding: 24, opacity: 0.6 }}>Select a room from the left.</div>
            )}
          </div>
          {/* The domain, coming out of the thread view (or the user list when
              no thread is open): width from the space, animated, never a jump. */}
          {domainReveal.mounted && selectedRoom && (
            <div
              className="tc-domain-tile"
              style={{ width: domainReveal.shown ? domainWidth : 0, transitionDuration: `${domainReveal.durationMs}ms` }}
            >
              <DomainView
                room={selectedRoom}
                onExit={() => setDomainExpanded(false)}
                ttd={domainTtd}
                onTtdChange={setDomainTtd}
              />
            </div>
          )}
        </div>
      </main>

      {/* The thread reading pane: a full-height tile between the region and
          the user list -- it owns its entire vertical space, period. It comes
          out of the user list; the domain comes out of it. */}
      {threadPanelReveal.mounted && openThread && (
        <div
          className="tc-threadview-tile"
          style={{ width: threadPanelReveal.shown ? threadPanelWidth : 0, transitionDuration: `${threadPanelReveal.durationMs}ms` }}
        >
          <ResizeHandle onDrag={(dx) => pushEdge('thread', 'x', 'lo', dx / vw)} />
          <ThreadPanel
            roomId={openThread.roomId}
            rootId={openThread.rootId}
            onClose={() => setOpenThread(null)}
            width={threadPanelWidth}
          />
        </div>
      )}

      <ResizeHandle onDrag={(dx) => pushEdge('members', 'x', 'lo', dx / vw)} />
      <MemberList room={selectedRoom} onOpenRoom={openRoomById} width={membersWidth} />
      </div>
    </div>
    <LayoutEditor />
    </RoomListSettingsProvider>
    </LightboxProvider>
  )
}

// The domain's handle: a tab riding the chatbox's right edge, wearing the
// room's icon and a chevron pointing the way the panel will come. It travels
// with the panel (same 420ms family, driven by the reveal's shown flag so
// tab and panel move on the same frame) and its tooltip says which way the
// next click goes. Custom tooltip rather than title= because the ask is an
// immediate labelled glow, not the UA's delayed grey box.
function DomainTab({
  room,
  open,
  shown,
  onToggle,
}: {
  room: Room
  open: boolean
  shown: boolean
  onToggle: () => void
}) {
  const mxc = room.getMxcAvatarUrl()
  const initial = (room.name || room.roomId).replace(/^[#!@]/, '').slice(0, 1).toUpperCase()
  const label = open ? 'Collapse Domain' : 'Expand Domain'
  return (
    <button
      type="button"
      className="tc-domain-tab"
      data-open={shown ? 'true' : 'false'}
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
    >
      <span className="tc-domain-tab-tip">{label}</span>
      <span aria-hidden="true" style={{ fontSize: 10, lineHeight: 1 }}>{shown ? '>' : '<'}</span>
      <span className="tc-domain-tab-icon">
        {mxc ? (
          <AuthedImage mxc={mxc} width={180} fill transparentLoading alt="" fallback={initial} />
        ) : (
          initial
        )}
      </span>
    </button>
  )
}


function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 360,
        margin: '4rem auto',
        fontFamily: 'sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        alignItems: 'flex-start',
      }}
    >
      {children}
    </div>
  )
}

export default App
