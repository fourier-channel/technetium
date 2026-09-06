import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { directRoomIds } from '../client/dm'
import { closeDomain, closeInColumn, closeThreadView, defaultSpace, deserialize, dismiss, moveDivider, openDomain, openInColumn, openThreadView, present, pushEdge, reflow, serialize, setFlag, setMin, setViewport, singleSlot, type PanelId, type Space } from './space'
import { currentViewport, useStoredSpace } from './spaceState'
import { dropPreset, putPreset, setDefaultPreset, setMobilePreset, setOverflow as setStoreOverflow } from './presets'
import { SpaceCtx, type SpaceApi } from './spaceContext'

// The real-estate contract for the whole screen (see space.ts), and the DM
// dock's state. Outside Edit Mode the one thing that changes on its own is
// the dock OPENING when a direct message arrives: the preset says the DM
// wins, and a new user's first message from Fourier-chan must reach them
// whatever they are clicking on.
export function SpaceProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const { space, setSpace, store, setStore } = useStoredSpace(client)
  // One step of undo for applying a preset, importing a number, or resetting:
  // the layout as it was immediately before. STATE rather than a ref, because
  // the Revert button's enabled-ness is read during render and a ref would
  // leave it stale. Deliberately one step -- this is "I did not mean that",
  // not a history.
  const [undoCode, setUndoCode] = useState<string | null>(null)
  const oneSlot = singleSlot(space)
  const [editMode, setEditMode] = useState(false)
  const [dockRoom, setDockRoom] = useState<Room | null>(null)

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
    setPanelFlag: (id, flag, value) => setSpace((prev) => setFlag(prev, id, flag, value)),
    setPanelMin: (id, min) => setSpace((prev) => setMin(prev, id, min)),
    exportCode: () => serialize(space),
    importCode: (code) => {
      // Imported against THIS screen, then reflowed: a number pasted from a
      // desktop must not arrive as a layout this screen cannot show.
      const s = deserialize(code, currentViewport())
      if (!s) return false
      setUndoCode(serialize(space))
      setSpace(reflow(s))
      return true
    },
    resetSpace: () => {
      setUndoCode(serialize(space))
      setSpace(reflow(setViewport(defaultSpace(), currentViewport())))
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
    openDomain: () => show('domain', (prev) => openDomain(prev, 0.45)),
    closeDomain: () => hide('domain', (prev) => closeDomain(prev)),
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
        setSpace(reflow(s))
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
        if (s) setSpace(reflow(s))
      },
    },
    overflow: store.overflow,
    setOverflow: (mode) => setStore(setStoreOverflow(store, mode)),
    singleSlot: oneSlot,
  })
  }, [space, editMode, dockRoom, setSpace, store, setStore, oneSlot, undoCode])

  return <SpaceCtx.Provider value={api}>{children}</SpaceCtx.Provider>
}
