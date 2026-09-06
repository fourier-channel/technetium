import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RoomEvent, type MatrixEvent, type Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { directRoomIds } from '../client/dm'
import { defaultLayout, move, resize, serialize, deserialize, setFlag } from './layout'
import { useStoredLayout } from './layoutState'
import { LayoutCtx, type LayoutApi } from './layoutContext'

// The real-estate contract for the whole screen, and the DM dock's state.
//
// Edit Mode is the only time sizes and flags change by hand. Outside it the
// panels obey the stored layout, and the one thing that changes on its own is
// the dock OPENING when a direct message arrives -- the default says the DM
// wins, and a new user's first message from Fourier-chan must reach them
// whatever they are clicking on.



export function LayoutProvider({ children }: { children: ReactNode }) {
  const { client } = useClient()
  const [layout, setLayout] = useStoredLayout(client)
  const [editMode, setEditMode] = useState(false)
  const [dockRoom, setDockRoom] = useState<Room | null>(null)

  // A direct message arriving while the dock is closed opens it on that
  // conversation. Only messages from someone else, only in DMs, and only when
  // nothing is showing -- an open dock is not hijacked by a second DM.
  useEffect(() => {
    if (!client) return
    const me = client.getUserId()
    const onTimeline = (ev: MatrixEvent, room: Room | undefined, toStart: boolean | undefined) => {
      if (!room || toStart || ev.getType() !== 'm.room.message' || ev.getSender() === me) return
      if (!directRoomIds(client).has(room.roomId)) return
      // Read the current state at event time; the closure may be stale.
      setDockRoom((cur) => cur ?? room)
      setLayout((prev) => setFlag(prev, 'dmDock', 'open', true))
    }
    client.on(RoomEvent.Timeline, onTimeline)
    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline)
    }
    // setLayout is stable across renders (updater-based); client is the only
    // real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  const api = useMemo<LayoutApi>(() => ({
    layout,
    editMode,
    setEditMode,
    resizePanel: (id, delta) => setLayout((prev) => resize(prev, id, delta)),
    setPanelFlag: (id, flag, value) => setLayout((prev) => setFlag(prev, id, flag, value)),
    movePanel: (id, to) => setLayout((prev) => move(prev, id, to)),
    exportCode: () => serialize(layout),
    importCode: (code) => {
      const l = deserialize(code)
      if (!l) return false
      setLayout(l)
      return true
    },
    resetLayout: () => setLayout(defaultLayout()),
    dockRoom,
    showInDock: (room) => {
      setDockRoom(room)
      setLayout((prev) => setFlag(prev, 'dmDock', 'open', true))
    },
    closeDock: () => setLayout((prev) => setFlag(prev, 'dmDock', 'open', false)),
  }), [layout, editMode, dockRoom, setLayout])

  return <LayoutCtx.Provider value={api}>{children}</LayoutCtx.Provider>
}

