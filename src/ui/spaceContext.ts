import { createContext, useContext } from 'react'
import type { Room } from 'matrix-js-sdk'
import type { Axis, PanelId, Side, Space } from './space'

// The space context and its hook, apart from the provider so that file
// exports only its component.

export interface SpaceApi {
  space: Space
  editMode: boolean
  setEditMode: (on: boolean) => void
  // Push the divider on `axis` at `at` by a fraction of the space.
  pushDivider: (axis: Axis, at: number, deltaFraction: number) => void
  // Push a panel's edge; resolved against the latest space (drag-safe).
  pushEdge: (id: PanelId, axis: Axis, side: Side, deltaFraction: number) => void
  setPanelFlag: (id: PanelId, flag: 'locked' | 'pinned', value: boolean) => void
  setPanelMin: (id: PanelId, min: number) => void
  exportCode: () => string
  // False when the pasted number is not a space. Nothing changes then.
  importCode: (code: string) => boolean
  resetSpace: () => void
  // The dock: which DM it shows, and opening/closing it in the tiling.
  dockRoom: Room | null
  showInDock: (room: Room) => void
  closeDock: () => void
  // Thread pane in the tiling.
  openThreadPane: () => void
  closeThreadPane: () => void
}

export const SpaceCtx = createContext<SpaceApi | null>(null)

export function useSpace(): SpaceApi {
  const v = useContext(SpaceCtx)
  if (!v) throw new Error('useSpace must be used within <SpaceProvider>')
  return v
}
