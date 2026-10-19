import { domainEnabled } from '../client/domainMode'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { directRoomIds } from '../client/dm'
import { bringBackPanel, clampMemberScale, closeDomain, closeInColumn, closeThreadView, defaultSpace, deserialize, dismiss, dragEdgeTo, moveDivider, openDomain, openInColumn, openThreadView, present, pushEdge, putAwayPanel, reflow, serialize, setFlag, setMin, setViewport, singleSlot, type PanelId, type Space } from './space'
import { currentViewport, deviceIsMobile, readLayoutStore, useStoredSpace } from './spaceState'
import { dropPreset, MAX_PRESETS, putPreset, resetStamp, resetToDefault, setDefaultPreset, setMobilePreset, setOverflow as setStoreOverflow, wantsDefaultReset, withoutResetParam } from './presets'
import { LayoutResetNotice } from './LayoutResetNotice'
import { SpaceCtx, type SpaceApi } from './spaceContext'

// The real-estate contract for the whole screen (see space.ts), and the DM
// dock's state. Outside Edit Mode the one thing that changes on its own is
// the dock OPENING when a direct message arrives: the preset says the DM
// wins, and a new user's first message from Fourier-chan must reach them
// whatever they are clicking on.
export function SpaceProvider({ children }: { children: ReactNode }) {
  const { client, status } = useClient()
  const { space, setSpace, adaptSpace, chooseSpace, store, setStore } = useStoredSpace(client)
  // One step of undo for applying a preset, importing a number, or resetting:
  // the layout as it was immediately before. STATE rather than a ref, because
  // the Revert button's enabled-ness is read during render and a ref would
  // leave it stale. Deliberately one step -- this is "I did not mean that",
  // not a history.
  const [undoCode, setUndoCode] = useState<string | null>(null)
  const oneSlot = singleSlot(space)
  const [editMode, setEditMode] = useState(false)
  const [dockRoom, setDockRoom] = useState<Room | null>(null)

  // `?preset=default` (presets.ts resetToDefault): read once, after the first
  // sync, because before it the account data -- the layout and its presets --
  // has not arrived and there would be nothing to save first. The parameter
  // leaves the address bar either way, so a reload does not reset again.
  const [resetNotice, setResetNotice] = useState<string | null>(null)
  const resetRead = useRef(false)
  useEffect(() => {
    if (status !== 'ready' || !client || resetRead.current) return
    resetRead.current = true
    if (!wantsDefaultReset(window.location.search)) return
    window.history.replaceState(window.history.state, '', withoutResetParam(window.location.href))
    // Deferred a microtask: setState directly in an effect body (G-tc01).
    queueMicrotask(() => {
      const def = setViewport(defaultSpace(), currentViewport())
      const r = resetToDefault(readLayoutStore(client), serialize(defaultSpace()), deviceIsMobile(), resetStamp(new Date()))
      if (r.kind === 'full') {
        // Shown, not saved: nothing the user had is overwritten, and the
        // default puts the Layout controls back on screen to make room.
        adaptSpace(reflow(def))
        setResetNotice(`Showing the default layout in this tab only. All ${MAX_PRESETS} presets are in use, so your current layout could not be saved first, and nothing was changed. Delete a preset under Layout, then open the link again.`)
        return
      }
      chooseSpace(def)
      setStore(r.store)
      setResetNotice(r.kept.length
        ? `Layout reset to Default. What you had is saved as ${r.kept.map((p) => `the preset "${p.name}"`).join(' and ')}, under Layout.`
        : 'Layout reset to Default.')
    })
    // Once per load; the handlers are read when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, client])

  useEffect(() => {
    if (!client) return
    const me = client.getUserId()
    const onTimeline = (ev: MatrixEvent, room: Room | undefined, toStart: boolean | undefined) => {
      if (!room || toStart || ev.getType() !== 'm.room.message' || ev.getSender() === me) return
      if (!directRoomIds(client).has(room.roomId)) return
      setDockRoom((cur) => cur ?? room)
      setSpace((prev) => openInColumn(prev, 'dock', 0.28))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline)
    }
    // setSpace is stable (updater-based); client is the only dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const api = useMemo<SpaceApi>(() => {
  // On a screen that holds one panel, opening a feature window either REPLACES
  // what is up or LAYERS over it (operator ruling 2026-09-06). Off such a
  // screen the ordinary tiling opens apply unchanged.
  const show = (id: PanelId, wide: (s: Space) => Space) =>
    setSpace((prev) => (singleSlot(prev) ? present(prev, id, store.overflow) : wide(prev)))
  const hide = (id: PanelId, wide: (s: Space) => Space) =>
    setSpace((prev) => (singleSlot(prev) ? dismiss(prev, id, store.overflow) : wide(prev)))
  return ({
    space,
    editMode,
    setEditMode,
    pushDivider: (axis, at, d) => setSpace((prev) => moveDivider(prev, axis, at, d)),
    pushEdge: (id, axis, side, d) => setSpace((prev) => pushEdge(prev, id, axis, side, d)),
    dragEdgeTo: (id, axis, side, target) => setSpace((prev) => dragEdgeTo(prev, id, axis, side, target)),
    setPanelFlag: (id, flag, value) => setSpace((prev) => setFlag(prev, id, flag, value)),
    setMemberScale: (v) => setSpace((prev) => ({ ...prev, memberScale: clampMemberScale(v) })),
    setPanelMin: (id, min) => setSpace((prev) => setMin(prev, id, min)),
    exportCode: () => serialize(space),
    importCode: (code) => {
      // Imported against THIS screen, then reflowed: a number pasted from a
      // desktop must not arrive as a layout this screen cannot show.
      const s = deserialize(code, currentViewport())
      if (!s) return false
      setUndoCode(serialize(space))
      chooseSpace(s)
      return true
    },
    resetSpace: () => {
      setUndoCode(serialize(space))
      chooseSpace(setViewport(defaultSpace(), currentViewport()))
    },
    dockRoom,
    showInDock: (room) => {
      setDockRoom(room)
      show('dock', (prev) => openInColumn(prev, 'dock', 0.28))
    },
    closeDock: () => hide('dock', (prev) => closeInColumn(prev, 'dock')),
    openThreadList: () => show('threads', (prev) => openInColumn(prev, 'threads', 0.22)),
    closeThreadList: () => hide('threads', (prev) => closeInColumn(prev, 'threads')),
    openThreadPane: () => show('thread', (prev) => openThreadView(prev, 0.38)),
    closeThreadPane: () => hide('thread', (prev) => closeThreadView(prev)),
    // A no-op when domain mode is off. Nothing but App calls this today, but
    // it is public API on the space context, and on a one-slot screen `show`
    // routes to present() -- which would make the domain the SOLE OCCUPANT of
    // a phone. Insurance against a future caller, not a fix for a live bug.
    openDomain: () => { if (domainEnabled()) show('domain', (prev) => openDomain(prev, 0.45)) },
    closeDomain: () => hide('domain', (prev) => closeDomain(prev)),
    // Operator, 2026-09-29: "When loading tc on mobile, only chanbooru shows up.
    // there is no way to get to the other pages ... user list, room list,
    // nothing shows." Reflow sheds both on a phone, and nothing could bring
    // them back. On a one-slot screen these present() them as the one panel
    // up; on a wider screen that shed them, they carve their old place back
    // out of the chat (a no-op if it would not fit, which reflow allows).
    openSidebar: () => setSpace((prev) => bringBackPanel(prev, 'sidebar', store.overflow)),
    closeSidebar: () => setSpace((prev) => putAwayPanel(prev, 'sidebar', store.overflow)),
    openMembers: () => setSpace((prev) => bringBackPanel(prev, 'members', store.overflow)),
    closeMembers: () => setSpace((prev) => putAwayPanel(prev, 'members', store.overflow)),
    presets: {
      list: store.presets,
      defaultName: store.defaultPreset,
      mobileName: store.mobilePreset,
      apply: (name) => {
        const p = store.presets.find((x) => x.name === name)
        if (!p) return false
        const s = deserialize(p.code, currentViewport())
        if (!s) return false
        setUndoCode(serialize(space))
        chooseSpace(s)
        return true
      },
      save: (name) => setStore(putPreset(store, name, serialize(space))),
      remove: (name) => setStore(dropPreset(store, name)),
      setDefault: (name) => setStore(setDefaultPreset(store, name)),
      setMobile: (name) => setStore(setMobilePreset(store, name)),
      canRevert: undoCode !== null,
      revert: () => {
        if (!undoCode) return
        const s = deserialize(undoCode, currentViewport())
        setUndoCode(null)
        if (s) chooseSpace(s)
      },
    },
    overflow: store.overflow,
    setOverflow: (mode) => setStore(setStoreOverflow(store, mode)),
    singleSlot: oneSlot,
  })
  }, [space, editMode, dockRoom, setSpace, chooseSpace, store, setStore, oneSlot, undoCode])

  return (
    <SpaceCtx.Provider value={api}>
      {children}
      {resetNotice && <LayoutResetNotice text={resetNotice} onDismiss={() => setResetNotice(null)} />}
    </SpaceCtx.Provider>
  )
}

