import { useRef, useState } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from './client/ClientContext'
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
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
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
        setSelectedRoom(room)
        return
      }
      if (triesLeft > 0) setTimeout(() => attempt(triesLeft - 1), 500)
    }
    attempt(12)
  }
  const [threadListOpen, setThreadListOpen] = useState(false)
  const [threadPanelWidth, setThreadPanelWidth] = useState(380)
  const [domainExpanded, setDomainExpanded] = useState(false)
  // The canvas's time-to-die lives here rather than inside DomainView, so the
  // ONE composer can stamp it onto a post while the domain is open. The domain
  // used to carry its own composer purely to reach this value, which is how it
  // ended up bringing a second chat along with it.
  const [domainTtd, setDomainTtd] = useState(TTD_DEFAULT)
  // Both panels arrive and leave the same way, from one mechanism -- the only
  // way two things stay exactly the same is for there to be one of them.
  const domainReveal = useReveal(domainExpanded, 420)
  const threadReveal = useReveal(threadListOpen, 380)
  // The reading pane arrives the same way the domain does. Same hook, same
  // duration family, so "like the domain" is a fact rather than a resemblance.
  const threadPanelReveal = useReveal(!!openThread, 420)
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
        onSelectRoom={setSelectedRoom}
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
        {selectedRoom ? (
            // One composer-mode scope per composer: the room timeline and its
            // composer share a reply/edit target, and the thread panel keeps
            // its own so replying in a thread cannot hijack the room composer.
            <ComposerModeProvider>
              {/* Expand Domain retired from the header (operator ruling
                  2026-09-05): it is now the tab riding the chatbox's right
                  edge, rendered after the panels below so it travels with
                  the domain. */}
              <div style={{ flex: 1, minHeight: 0 }}>
                <Timeline room={selectedRoom} onOpenThread={(roomId, rootId) => setOpenThread({ roomId, rootId })} onOpenRoom={openRoomById} threadListOpen={threadListOpen} onToggleThreadList={() => setThreadListOpen((o) => !o)} />
              </div>
              <TypingBar client={client} room={selectedRoom} />
              {/* The dedicated strip above the chat box. Placeholder source
                  for the MVP -- point it at real data by swapping the source
                  (see tickerSource.ts). Absent in DMs entirely -- not even a
                  re-expand element (operator ruling 2026-09-05) -- and
                  collapsible everywhere else, with the state riding account
                  data so it follows the user. */}
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

              {/* Across the top, over the oldest messages on screen -- which is
                  the part the reader is least likely to be reading, since the
                  timeline follows the bottom. */}
              {threadReveal.mounted && (
                <div
                  className="tc-panel tc-panel-top"
                  data-shown={threadReveal.shown ? 'true' : 'false'}
                  style={{ transitionDuration: `${threadReveal.durationMs}ms` }}
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

              {/* The thread reading pane, arriving from the right like the
                  domain. It keeps its drag handle, as its own left edge rather
                  than as a separate column -- a panel that floats over the chat
                  has no column to put a handle beside. */}
              {threadPanelReveal.mounted && openThread && (
                <div
                  className="tc-panel tc-panel-thread"
                  data-shown={threadPanelReveal.shown ? 'true' : 'false'}
                  style={{
                    width: threadPanelWidth,
                    transitionDuration: `${threadPanelReveal.durationMs}ms`,
                  }}
                >
                  <ResizeHandle
                    onDrag={(dx) =>
                      setThreadPanelWidth((w) => Math.max(280, Math.min(640, w - dx)))
                    }
                  />
                  <ThreadPanel
                    roomId={openThread.roomId}
                    rootId={openThread.rootId}
                    onClose={() => setOpenThread(null)}
                    width={threadPanelWidth}
                  />
                </div>
              )}

              {/* Rendered last so it covers the strip: opening the domain is a
                  bigger statement than browsing threads. */}
              {domainReveal.mounted && (
                <div
                  className="tc-panel tc-panel-right"
                  data-shown={domainReveal.shown ? 'true' : 'false'}
                  style={{ transitionDuration: `${domainReveal.durationMs}ms` }}
                >
                  <DomainView
                    room={selectedRoom}
                    onExit={() => setDomainExpanded(false)}
                    ttd={domainTtd}
                    onTtdChange={setDomainTtd}
                  />
                </div>
              )}

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
      </main>

      <MemberList room={selectedRoom} onOpenRoom={openRoomById} />
      </div>
    </div>
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

function ResizeHandle({ onDrag }: { onDrag: (dx: number) => void }) {
  const startX = useRef(0)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    startX.current = e.clientX
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - startX.current
    startX.current = e.clientX
    if (dx !== 0) onDrag(dx)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{ width: 5, flexShrink: 0, cursor: 'col-resize', background: 'transparent', alignSelf: 'stretch' }}
      title="Drag to resize"
    />
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
