import { useEffect, useMemo, useRef, useState } from 'react'
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
import { DIVIDER_PX, ResizeHandle } from './ui/ResizeHandle'
import { dividerTone } from './ui/dividerTone'
import { DmDock } from './ui/DmDock'
import { LayoutEditor } from './ui/LayoutEditor'
import { SettingsDialog } from './ui/SettingsDialog'
import { IncomingVerification } from './ui/IncomingVerification'
import { PullTab } from './ui/PullTab'
import { BooruFrame } from './ui/BooruFrame'
import { useSpace } from './ui/spaceContext'
import { openLeaves } from './ui/space'
import { ThreadPanel } from './ui/ThreadPanel'
import { PersonRouterContext, createPersonRouter } from './ui/personRouter'
import { PersonCard, type PersonCardTarget } from './ui/PersonCard'
import { personGestures } from './ui/personGesture'
import { SiteReset } from './ui/SiteReset'
import { ManageSession } from './ui/ManageSession'
import { DeviceElsewhere } from './ui/DeviceElsewhere'
import { ProfilePanel } from './ui/ProfilePanel'
import { ProfilePanelContext } from './ui/profilePanelContext'
import { LookStoreContext, useLook } from './ui/lookContext'
import { createLookStore, lookIO } from './client/lookStore'
import { nameAttrs } from './client/look'
import { ThreadList } from './ui/ThreadList'
import { useReveal } from './ui/useReveal'
import { TTD_DEFAULT } from './client/useDomainMedia'
import { LightboxProvider } from './ui/Lightbox'
import { RoomListSettingsProvider } from './ui/RoomListSettingsProvider'
import { useReadMarker } from './client/useReadMarker'
import { useMediaTagSync } from './client/useMediaTags'
import { useNavTree } from './client/useNavTree'
import { useRoomNotifications } from './client/useRoomNotifications'
import { NavSharedContext, type NavShared } from './ui/navShared'
import { MembersPullTab } from './ui/DmList'
import { DomainView } from './ui/DomainView'
import { domainEnabled } from './client/domainMode'
import { threadStripCss, dmTabBesideTitle, ROOMS_TAB_TOP, MEMBERS_TAB_TOP, THREAD_TAB_TOP_EDGE } from './ui/threadStrip'
import { dockShareCss, tabAttach, threadTabGeometry } from './ui/tabRide'
import { TabRail } from './ui/TabRail'
import { useBackButton } from './ui/backButton'
import { threadPinsOf, useThreadPinsVersion } from './client/threadPinState'
import { usePinnedFold } from './client/pinnedFold'
import { partitionPinned, stripOpensForPins } from './ui/threadPins'
import { flipIdOf } from './ui/flip'
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
  const { space, editMode, setEditMode, showInDock, openThreadPane, closeThreadPane, openThreadList, closeThreadList, openDomain, closeDomain, dockRoom, closeDock, openSidebar, closeSidebar, openMembers, closeMembers } = useSpace()
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  // The panel filling a one-slot screen, or null when the chat is up (or the
  // screen holds more than one panel).
  const upAlone = openLeaves(space).length === 1 && !space.leaves.main.open ? openLeaves(space)[0].id : null
  const sidebarAlone = upAlone === 'sidebar'
  const membersAlone = upAlone === 'members'
  // DMs live in the dock, rooms in the main pane. Choosing a person opens
  // them across the top; the room being read stays where it is. On a phone
  // the room list is the one panel on screen while it is up (operator,
  // 2026-09-29); choosing where to go puts it away, as picking an item from a
  // phone menu does. Beside the chat it stays where it is.
  const selectRoom = (room: Room) => {
    if (client && directRoomIds(client).has(room.roomId)) showInDock(room)
    else setSelectedRoom(room)
    if (sidebarAlone) closeSidebar()
  }
  const [openThread, setOpenThread] = useState<{ roomId: string; rootId: string } | null>(null)
  // Back walks back through the rooms, threads and phone panels the user has
  // been to, and stays at the first (ui/backButton.ts, operator 2026-09-29).
  // The thread is its own part of the view, so a phone's thread panel is not
  // also counted as a panel.
  const backView = {
    room: selectedRoom?.roomId ?? null,
    panel: upAlone && upAlone !== 'thread' && upAlone !== 'main' ? upAlone : null,
    thread: openThread ? `${openThread.roomId} ${openThread.rootId}` : null,
  }
  useBackButton(!!client, backView, (v) => {
    const room = v.room ? client?.getRoom(v.room) ?? null : null
    if (v.room === null || room) setSelectedRoom(room)
    if (v.thread) {
      const [roomId, rootId] = v.thread.split(' ')
      setOpenThread({ roomId, rootId })
    } else setOpenThread(null)
    if (v.panel !== backView.panel) {
      if (v.panel === 'sidebar') openSidebar()
      else if (v.panel === 'members') openMembers()
      else if (v.panel === 'dock' && dockRoom) showInDock(dockRoom)
      else if (v.panel === 'threads') openThreadList()
      else if (backView.panel === 'sidebar') closeSidebar()
      else if (backView.panel === 'members') closeMembers()
      else if (backView.panel === 'dock') closeDock()
      else if (backView.panel === 'threads') closeThreadList()
      else if (backView.panel === 'domain') closeDomain()
    }
  })

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
  const domainWidth = Math.round((space.leaves.domain.x1 - space.leaves.domain.x0) * vw)
  const dockShareOfMain = space.leaves.dock.open ? (space.leaves.dock.y1 - space.leaves.dock.y0) / colH : 0
  // The strip's bottom edge, as ONE expression. The tile's height and the tab
  // that rides that edge both take it, because it is the same edge. It is the
  // height of what the strip holds, not a share of the layout -- see
  // threadStrip.ts for the dead space a share left around the cards.
  const threadStripH = threadStripCss()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The Profile panel (L24): Settings' sibling, never SHOWN at the same time.
  // Opening Settings hides it rather than unmounting it, so an unsaved look
  // draft and its undo history are still there when Profile is opened again;
  // only the panel's own Done (which asks first) closes it.
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileMounted, setProfileMounted] = useState(false)
  const openProfile = () => {
    setSettingsOpen(false)
    setProfileOpen(true)
    setProfileMounted(true)
  }
  const openSettings = () => {
    setProfileOpen(false)
    setSettingsOpen(true)
  }
  const closeProfile = () => {
    setProfileOpen(false)
    setProfileMounted(false)
  }
  // Your own profile preview, from a right click (or a left one -- there is no
  // chat action to perform on yourself) on your own card (L23).
  const [meCard, setMeCard] = useState<PersonCardTarget | null>(null)
  // Everyone's look, read from their profiles, one store per client (L24).
  const lookStore = useMemo(() => (client ? createLookStore(lookIO(client), client.getUserId()) : null), [client])
  // Which timeline hosts each room's chat actions and profile preview, so the
  // member list and the thread panel open the same ones (L23).
  const [personRouter] = useState(createPersonRouter)
  // Domain mode is not offered unless this build or this browser says so --
  // see client/domainMode.ts. Read ONCE per mount rather than per render: the
  // answer cannot change without a reload (the opt-in is storage, the flag is
  // the build), and re-reading it would mean a render that disagrees with the
  // one before it for no reason anybody could see.
  const [domainAvailable] = useState(domainEnabled)
  const [domainExpanded, setDomainExpanded] = useState(false)
  // The canvas's time-to-die lives here rather than inside DomainView, so the
  // ONE composer can stamp it onto a post while the domain is open. The domain
  // used to carry its own composer purely to reach this value, which is how it
  // ended up bringing a second chat along with it.
  const [domainTtd, setDomainTtd] = useState(TTD_DEFAULT)
  // Both panels arrive and leave the same way, from one mechanism -- the only
  // way two things stay exactly the same is for there to be one of them.
  const domainReveal = useReveal(domainExpanded, 420)
  // The saved layout arrives AFTER this component mounts -- spaceState re-reads
  // it in a microtask and again on every account-data echo -- so a layout
  // carrying the domain leaf open can turn it back on behind the effect below,
  // which would otherwise have run once and never again. Watching the leaf is
  // what makes "closed" stay closed rather than being true only at mount.
  const domainLeafOpen = space.leaves.domain.open
  // The thread list descends from the dock's bottom edge (no sudden jumps):
  // mounted for the whole choreography, its height going 0 -> share -> 0.
  const threadListReveal = useReveal(threadListOpen, 380)
  // The dock slides on its own stylesheet transition (DmDock.tsx); this reveal
  // only times its pull tab -- how long the dock is still on screen after it
  // is told to close, so the tab rides its edge out of sight (tabRide.ts).
  const dockShown = !!(dockRoom && space.leaves.dock.open)
  const dockReveal = useReveal(dockShown, 420)
  // The dock's closed-state tab rides the strip's title bar for as long as the
  // strip is on screen -- its closing animation included, so the tab does not
  // jump back over the title while the strip is still visible.
  const dmTabOnStrip = !!(dockRoom && !space.leaves.dock.open && selectedRoom && threadListReveal.mounted)
  // The domain is a TILE that takes width from the chat column below the
  // dock; opening carves it out of the space, closing hands the width back.
  useEffect(() => {
    // `domainAvailable` is in the condition as well as around the control,
    // because a SAVED LAYOUT can carry the domain panel open (space.ts
    // deserialize restores every panel's open flag) and this effect is what
    // closes it. Gating only the button would leave that layout opening an
    // empty tile nobody asked for and nobody can shut.
    if (domainExpanded && domainAvailable) openDomain(); else closeDomain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainExpanded, domainAvailable, domainLeafOpen])
  // The reading pane arrives the same way the domain does. Same hook, same
  // duration family, so "like the domain" is a fact rather than a resemblance.
  const threadPanelReveal = useReveal(!!openThread, 420)
  // The reading pane needs its thread for the whole choreography, including
  // the way OUT: rendering on `openThread` alone unmounted it the instant the
  // thread was cleared, so it vanished instead of sliding back into the
  // user list. Hold the last one while the reveal is still mounted.
  const [lastThread, setLastThread] = useState<{ roomId: string; rootId: string } | null>(null)
  // Adjusted during render, not in an effect (G-tc01): React re-renders
  // immediately with the new value and nothing paints the stale one.
  if (openThread && openThread !== lastThread) setLastThread(openThread)
  const shownThread = openThread ?? lastThread
  // The thread pane is a tile: carve it out of main when a thread opens, give
  // the space back when it closes.
  useEffect(() => {
    if (openThread) openThreadPane(); else closeThreadPane()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!openThread])
  // Mark the viewed room read so its unread glow/ping clears (base client sent
  // no read receipts). Called before any early return to keep hook order stable.
  useReadMarker(client, selectedRoom)
  // A DM never becomes `selectedRoom`: selectRoom sends direct rooms to the
  // dock instead. So until now a DM was never marked read, its server-side
  // unread count never fell back to zero, and the nav strip's waiting glow
  // stayed lit forever once it came on -- which is exactly how it was reported.
  // Gated on the dock actually being OPEN, keeping useReadMarker's own rule
  // that nothing is cleared while nobody can see it.
  useReadMarker(client, space.leaves.dock.open ? dockRoom : null)
  // Pinned threads start OUT (operator, 2026-09-24: "Pinned threads would
  // start open by default, and hideable behind a Pushpin icon"): entering a
  // room whose pinned threads this person has not folded away pulls the thread
  // strip down, once per entry -- so a newcomer landing in #chat sees the
  // Welcome thread at the front of it. Closing the strip is still theirs;
  // folding the pins behind the strip's pushpin is what stops it opening.
  // Re-run when pins or folds arrive, because both come with sync, a moment
  // after the room does.
  const pinsVersion = useThreadPinsVersion(client)
  const { folded: foldedPins } = usePinnedFold(client)
  const pinsOpenedFor = useRef<string | null>(null)
  const pinsRoomSeen = useRef<string | null>(null)
  const selectedRoomId = selectedRoom?.roomId ?? null
  useEffect(() => {
    if (selectedRoomId !== pinsRoomSeen.current) {
      pinsRoomSeen.current = selectedRoomId
      pinsOpenedFor.current = null
    }
    if (!selectedRoomId) return
    const pinned = threadPinsOf(client, selectedRoomId).map((root) => flipIdOf(selectedRoomId, root))
    const visible = partitionPinned(pinned, foldedPins).visible.length
    if (!stripOpensForPins(selectedRoomId, pinsOpenedFor.current, visible)) return
    pinsOpenedFor.current = selectedRoomId
    if (!space.leaves.threads.open) queueMicrotask(() => openThreadList())
  }, [client, selectedRoomId, pinsVersion, foldedPins, space.leaves.threads.open, openThreadList])
  // Ticker collapse follows the user via account data. Same hook-order rule.
  const [tickerCollapsed, setTickerCollapsed] = useTickerCollapsed(client)
  // Keep the media-tag store fed from room state for every room, so any image
  // anywhere in the tree can resolve its tags without props being threaded.
  useMediaTagSync(client)
  // The room tree and the per-room counts, run ONCE and shared by the room
  // list and the user list's Direct Messages section (navShared.ts, L30):
  // both do network work, and a second copy would double it from every tab.
  const navTree = useNavTree(client)
  const notifs = useRoomNotifications(client)
  const navShared = useMemo<NavShared>(
    () => ({ nav: { tree: navTree.tree, loading: navTree.loading, stale: navTree.stale }, notifs }),
    [navTree.tree, navTree.loading, navTree.stale, notifs],
  )

  if (status === 'awaiting_login') {
    // Both doors begin the OIDC/MAS sign-in; Create account asks MAS to open
    // on its register page. Fourier-chan's guidance lives on those pages.
    return <AuthLanding onProceed={(intent) => login(intent)} />
  }

  if (status === 'error') {
    return (
      <Centered>
        <h1>Technetium</h1>
        <p style={{ color: 'var(--cpd-color-text-critical-primary, #d22)' }}>
          {error ?? 'Something went wrong.'}
        </p>
        <button type="button" onClick={() => login()}>Try again</button>
        {/* Signed out here too, and this is where a purge that could not
            finish says so -- so the way to try it again is on the same
            screen. */}
        <div style={{ width: 128, marginTop: 16 }}>
          <SiteReset />
        </div>
      </Centered>
    )
  }

  // Pre-client beat only: a moving boot screen, never a dead "Loading".
  // Another tab of this browser has the device (client/deviceLock.ts).
  if (status === 'device_busy' || status === 'device_taken') {
    return <DeviceElsewhere which={status === 'device_busy' ? 'busy' : 'taken'} />
  }

  if (status === 'starting' || (status === 'syncing' && !client)) {
    return <BootScreen label={status === 'starting' ? 'Starting' : 'Connecting'} />
  }

  // A client now exists. Mount the real shell for BOTH 'syncing' (room list
  // shows the cached stale shape) and 'ready' -- the user never faces a blank
  // screen. `booting` drives an indeterminate top progress bar.
  const booting = status !== 'ready'

  // status === 'ready' or 'syncing' (with client) -- three-pane layout.
  return (
    <NavSharedContext.Provider value={navShared}>
    <PersonRouterContext.Provider value={personRouter}>
    <LookStoreContext.Provider value={lookStore}>
    <ProfilePanelContext.Provider value={openProfile}>
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
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
      <Sidebar
        selectedRoomId={selectedRoom?.roomId}
        onSelectRoom={selectRoom}
        booruActive={!selectedRoom}
        onSelectBooru={() => {
          setSelectedRoom(null)
          if (sidebarAlone) closeSidebar()
        }}
        header={
          // Who you are, then the three things you do to the client itself
          // (launch-polish L13, operator 2026-09-28): the avatar, framed, with
          // the name to its RIGHT, in a panel of their own; Settings, Layout
          // and Log out as pills in the Direct Messages pill's language. The
          // head pads 8px sideways -- the same gutter the room list's rows and
          // its Direct Messages pill sit on -- and the panel pads its content
          // by the minimum, so nothing floats in its container.
          <div className="tc-me">
            <div
              className="tc-me-card"
              title={userId ?? undefined}
              {...personGestures(userId ?? '', undefined, (u, x, y) => setMeCard({ userId: u, x, y }))}
            >
              <span className="tc-me-av">
                <AvatarDisc
                  userId={userId ?? ''}
                  name={client?.getUser(userId ?? '')?.displayName ?? userId ?? ''}
                  avatarMxc={client?.getUser(userId ?? '')?.avatarUrl ?? null}
                  size={30}
                />
              </span>
              <MeName userId={userId ?? ''} />
            </div>
            {/* Directly under the avatar (operator, 2026-10-05): your tokens'
                lives and encryption, in a dropdown over the page. */}
            <ManageSession />
            <div className="tc-me-actions">
              <button type="button" className="tc-pill" aria-pressed={profileOpen} onClick={openProfile} title="Your picture, name and look">
                Profile
              </button>
              <button type="button" className="tc-pill" onClick={openSettings} title="Settings">
                Settings
              </button>
              <button
                type="button"
                className="tc-pill"
                aria-pressed={editMode}
                onClick={() => setEditMode(!editMode)}
                title="Resize, lock and pin the panels; export your layout as a number"
              >
                {editMode ? 'Done' : 'Layout'}
              </button>
              <button type="button" className="tc-pill" onClick={logout}>
                Log out
              </button>
            </div>
            <SiteReset />
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
        {/* The dock's tab: on the region's top border when a DM is hidden
            (pull it down), on the dock's bottom border when it is out (push
            it up). The dock still opens on its own when a DM arrives. */}
        {/* While the thread strip is on screen this border is the strip's
            title bar, whose label sits on the centre (launch-polish L3), so
            the tab moves onto the strip itself -- see dmTabOnStrip below. */}
        {/* ONE tab, riding the dock's bottom edge (tabRide.ts): closed it
            hangs from the region's top border -- or from the thread strip's
            title bar beside its label, while the strip is on screen -- and
            open it sits inside the dock on its edge, carried there by the
            edge itself. <main> clips, so the moment it changes sides is a
            moment nobody can see. */}
        {dockRoom && (() => {
          const seat = tabAttach(dockShown, dockReveal.mounted)
          return (
            <TabRail axis="y" offset={dockShown ? dockShareCss(dockShareOfMain) : '0px'} durationMs={dockReveal.durationMs} clip={{ inset: 0 }}>
              <PullTab
                pull={dockShown ? 'up' : 'down'}
                open={dockShown}
                attach={seat === 'end' ? 'above' : 'start'}
                target="dock"
                label={dockShown ? 'Hide the direct message' : 'Direct message'}
                onClick={() => (dockShown ? closeDock() : showInDock(dockRoom))}
                style={{ top: 0, left: seat === 'start' && dmTabOnStrip ? dmTabBesideTitle(domainWidth) : 'calc(50% - 40px)' }}
              />
            </TabRail>
          )
        })()}
        {/* Below the dock: the chat column and, to its right, the domain --
            a tile that takes width from the column, so the thread list and
            the chat SHRINK for it rather than being covered. The dock keeps
            its span, so the domain owns its space up past the thread list. */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* position: relative so the domain tab rides THIS column's right edge. */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
            {/* The thread list: attached to the bottom of the DM window, taking
                its height from the chat and never from the dock. */}
            {/* The thread list's tab: on the chat's top border when the list
                is up (pull it down), on the list's bottom border when it is
                down (push it up). */}
            {/* Right of centre: with the dock closed this border is also the
                dock's, and its tab sits left of centre. Two tabs, side by side. */}
            {/* ONE tab, riding the strip's bottom edge on the strip's own
                reveal (tabRide.ts); the column clips, so it is carried in and
                out of sight by the edge. The dock's tab, which sits on the
                strip's title bar while the strip is up, now rides <main>'s
                rail above, in <main>'s coordinates (dmTabBesideTitle). */}
            {selectedRoom && (
              <TabRail axis="y" offset={threadListReveal.shown ? threadStripH : '0px'} durationMs={threadListReveal.durationMs} clip={{ inset: 0 }}>
                <PullTab
                  pull={threadListOpen ? 'up' : 'down'}
                  open={threadListOpen}
                  attach={tabAttach(threadListOpen, threadListReveal.mounted) === 'end' ? 'above' : 'start'}
                  target="threads"
                  label={threadListOpen ? 'Hide threads' : 'Threads'}
                  onClick={() => setThreadListOpen(!threadListOpen)}
                  style={{ top: 0, left: 'calc(50% + 40px)' }}
                />
              </TabRail>
            )}
            {threadListReveal.mounted && selectedRoom && (
              <div
                className="tc-threads-tile"
                style={{
                  height: threadListReveal.shown ? threadStripH : 0,
                  transitionDuration: `${threadListReveal.durationMs}ms`,
                }}
              >
                <ThreadList
                  layout="carousel"
                  onSelect={(roomId, rootId) => setOpenThread({ roomId, rootId })}
                  activeRootId={openThread?.rootId}
                  roomId={selectedRoom?.roomId}
                />
              </div>
            )}
            {selectedRoom ? (
              // One composer-mode scope per composer: the room timeline and its
              // composer share a reply/edit target, and the thread panel keeps
              // its own so replying in a thread cannot hijack the room composer.
              <ComposerModeProvider>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <Timeline room={selectedRoom} onOpenThread={(roomId, rootId) => setOpenThread({ roomId, rootId })} onOpenRoom={openRoomById} threadListOpen={threadListOpen} />
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
                {/* domainAvailable as well as domainExpanded, belt and braces,
                    because this prop is a silent WRITE: Composer stamps
                    net.41chan.domain_ttd onto every image it sends while it is
                    defined, and that field is what makes a post a canvas
                    object. Of everything domain mode touches, this is the one
                    that would leave marks in other people's rooms. */}
                <Composer room={selectedRoom} domainTtd={domainExpanded && domainAvailable ? domainTtd : undefined} />
                {domainAvailable && (
                  <DomainTab
                    room={selectedRoom}
                    open={domainExpanded}
                    shown={domainReveal.shown}
                    onToggle={() => setDomainExpanded((o) => !o)}
                  />
                )}
              </ComposerModeProvider>
            ) : (
              <BooruFrame />
            )}
          </div>
          {/* The domain, coming out of the thread view (or the user list when
              no thread is open): width from the space, animated, never a jump. */}
          {domainAvailable && domainReveal.mounted && selectedRoom && (
            <div
              className="tc-domain-tile"
              style={{ width: domainReveal.shown ? domainWidth : 0, transitionDuration: `${domainReveal.durationMs}ms` }}
            >
              {/* The domain's left wall. It had no grip before this campaign --
                  the panel's width came from the space and nothing let anyone
                  push it -- and it is the wall the tone rule is written around:
                  pull the domain out and this is what turns orange. */}
              <ResizeHandle
                edge={{ id: 'domain', axis: 'x', side: 'lo' }}
                tone={dividerTone(space, 'domain')}
                label="Domain width"
              />
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
      {threadPanelReveal.mounted && shownThread && (
        <div
          className="tc-threadview-tile"
          style={{ width: threadPanelReveal.shown ? threadPanelWidth : 0, transitionDuration: `${threadPanelReveal.durationMs}ms` }}
        >
          <ResizeHandle
            edge={{ id: 'thread', axis: 'x', side: 'lo' }}
            tone={dividerTone(space, 'thread')}
            label="Thread view width"
          />
          {/* The tile holds the divider AND the panel, so the panel gets what
              is left of the tile's width. It used to be handed the whole of it,
              which the tile then clipped by the divider's thickness. */}
          <ThreadPanel
            roomId={shownThread.roomId}
            rootId={shownThread.rootId}
            width={Math.max(120, threadPanelWidth - DIVIDER_PX)}
            onOpenRoom={openRoomById}
          />
        </div>
      )}

      {/* The thread view's ONE tab, riding the view's left edge (tabRide.ts):
          closed, outside the border the view comes out of -- the member
          list's, or the screen's own right edge when the list is not open
          (a phone), a slot below the Members tab there; open, inside the view
          on its edge, which on a phone where the thread fills the screen is
          the screen's left edge. */}
      {lastThread && (() => {
        const g = threadTabGeometry(space.leaves.members.open, membersWidth, DIVIDER_PX, threadPanelWidth, threadPanelReveal.shown)
        const seat = tabAttach(!!openThread, threadPanelReveal.mounted)
        return (
          <TabRail axis="x" offset={g.offset} durationMs={threadPanelReveal.durationMs} clip={{ top: 0, bottom: 0, left: 0, right: g.r0 }}>
            <PullTab
              pull={openThread ? 'right' : 'left'}
              open={!!openThread}
              attach={seat === 'end' ? 'right' : 'start'}
              target="thread"
              label={openThread ? (upAlone === 'thread' ? 'Back' : 'Close thread') : 'Thread'}
              onClick={() => setOpenThread(openThread ? null : lastThread)}
              style={{ right: 0, ...(seat === 'start' && !space.leaves.members.open ? { top: THREAD_TAB_TOP_EDGE } : {}) }}
            />
          </TabRail>
        )
      })()}
      {/* Closed by reflow when the screen cannot hold it (space.ts). The
          handle goes with it: a divider for a panel that is not there is a
          drag that silently does nothing. */}
      {space.leaves.members.open && (
        <>
          <ResizeHandle
            edge={{ id: 'members', axis: 'x', side: 'lo' }}
            tone={dividerTone(space, 'members')}
            label="Member list width"
          />
          <MemberList
            room={selectedRoom}
            onOpenRoom={(roomId) => {
              openRoomById(roomId)
              if (membersAlone) closeMembers()
            }}
            // A conversation chosen from the Direct Messages section (L30):
            // into the dock, and on a phone the list puts itself away, as
            // the room list does when a room is chosen.
            onSelectRoom={(room) => {
              selectRoom(room)
              if (membersAlone) closeMembers()
            }}
            width={membersWidth}
          />
        </>
      )}
      {/* The room list and the member list, when the layout has closed them
          -- a phone, where only one panel fits (operator, 2026-09-29: "user
          list, room list, nothing shows"). Each shows its tab on the edge it
          comes in from; while one is the whole screen, its tab on the far
          edge puts it back. On a desktop both are open and none of these
          draw. The room list's tabs ride above the middle and the member
          list's below it, in both states: at one height a Back covered the
          other list's tab -- Back from the room list landed on Members, and
          round again (operator, 2026-09-29). While a thread or a DM fills the
          screen, only its own Back shows. */}
      {/* ONE tab each, flipping in place. These two lists do not slide --
          they are there or not -- so a tab that changes edge in the same
          frame as its list is tracking it. */}
      {((!space.leaves.sidebar.open && (!upAlone || membersAlone)) || sidebarAlone) && (
        <PullTab
          pull={sidebarAlone ? 'left' : 'right'}
          open={sidebarAlone}
          target="sidebar"
          label={sidebarAlone ? 'Back' : 'Rooms'}
          onClick={sidebarAlone ? closeSidebar : openSidebar}
          style={sidebarAlone ? { right: 0, top: ROOMS_TAB_TOP } : { left: 0, top: ROOMS_TAB_TOP }}
        />
      )}
      {/* Shown with no room selected too: the user list holds the Direct
          Messages section (L30), so it always has something in it -- and its
          tab glows while a conversation is waiting, which is how a message
          reaches someone whose user list is put away. */}
      {((!space.leaves.members.open && (!upAlone || sidebarAlone)) || membersAlone) && (
        <MembersPullTab
          pull={membersAlone ? 'right' : 'left'}
          open={membersAlone}
          target="members"
          label={membersAlone ? 'Back' : 'Members'}
          onClick={membersAlone ? closeMembers : openMembers}
          style={membersAlone ? { left: 0, top: MEMBERS_TAB_TOP } : { right: 0, top: MEMBERS_TAB_TOP }}
        />
      )}
      </div>
    </div>
    <LayoutEditor />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {profileMounted && <ProfilePanel hidden={!profileOpen} onClose={closeProfile} />}
      {meCard && client && (
        <PersonCard
          client={client}
          target={meCard}
          room={selectedRoom}
          onOpenRoom={openRoomById}
          onClose={() => setMeCard(null)}
        />
      )}
      {/* Global: a verification request arrives when the OTHER device sends
          it, not when a panel happens to be open. */}
      <IncomingVerification />
    </RoomListSettingsProvider>
    </LightboxProvider>
    </ProfilePanelContext.Provider>
    </LookStoreContext.Provider>
    </PersonRouterContext.Provider>
    </NavSharedContext.Provider>
  )
}

// Your own name on your card, in your own look (L24). Its own component so a
// look arriving redraws this line and not the whole shell.
function MeName({ userId }: { userId: string }) {
  const look = useLook(userId)
  // Ellipsizes rather than wrapping: the name must fit the width most people
  // leave the room list at.
  return <span className="tc-me-name" {...nameAttrs(look)}>{userId}</span>
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
