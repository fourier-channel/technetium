import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { directRoomIds } from '../client/dm'
import { closeDomain, closeInColumn, closeThreadView, defaultSpace, deserialize, moveDivider, openDomain, openInColumn, openThreadView, pushEdge, reflow, serialize, setFlag, setMin, setViewport } from './space'
import { currentViewport, useStoredSpace } from './spaceState'
import { SpaceCtx, type SpaceApi } from './spaceContext'

// The real-estate contract for the whole screen (see space.ts), and the DM
// dock's state. Outside Edit Mode the one thing that changes on its own is
// the dock OPENING when a direct message arrives: the preset says the DM
// wins, and a new user's first message from Fourier-chan must reach them
// whatever they are clicking on.
export function SpaceProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const [space, setSpace] = useStoredSpace(client)
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

  const api = useMemo<SpaceApi>(() => ({
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
      setSpace(reflow(s))
      return true
    },
    resetSpace: () => setSpace(reflow(setViewport(defaultSpace(), currentViewport()))),
    dockRoom,
    showInDock: (room) => {
      setDockRoom(room)
      setSpace((prev) => openInColumn(prev, 'dock', 0.28))
    },
    closeDock: () => setSpace((prev) => closeInColumn(prev, 'dock')),
    openThreadList: () => setSpace((prev) => openInColumn(prev, 'threads', 0.22)),
    closeThreadList: () => setSpace((prev) => closeInColumn(prev, 'threads')),
    openThreadPane: () => setSpace((prev) => openThreadView(prev, 0.38)),
    closeThreadPane: () => setSpace((prev) => closeThreadView(prev)),
    openDomain: () => setSpace((prev) => openDomain(prev, 0.45)),
    closeDomain: () => setSpace((prev) => closeDomain(prev)),
  }), [space, editMode, dockRoom, setSpace])

  return <SpaceCtx.Provider value={api}>{children}</SpaceCtx.Provider>
}
