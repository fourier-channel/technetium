import { createContext, useContext } from 'react'
import type { Room } from 'matrix-js-sdk'
import type { Axis, OverflowMode, PanelId, Side, Space } from './space'
import type { Preset } from './presets'

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
  // Thread pane (the reading view) in the row; thread LIST in the column.
  openThreadPane: () => void
  closeThreadPane: () => void
  openThreadList: () => void
  closeThreadList: () => void
  openDomain: () => void
  closeDomain: () => void
  // Named layouts. `apply` swaps the live layout to one of them and can be
  // undone once with `revert`; `save` stores the CURRENT layout under a name.
  presets: {
    list: Preset[]
    defaultName: string | null
    mobileName: string | null
    apply: (name: string) => boolean
    save: (name: string) => void
    remove: (name: string) => void
    setDefault: (name: string | null) => void
    setMobile: (name: string | null) => void
    canRevert: boolean
    revert: () => void
  }
  // What a tab does when the screen holds only one panel.
  overflow: OverflowMode
  setOverflow: (mode: OverflowMode) => void
  singleSlot: boolean
}

export const SpaceCtx = createContext<SpaceApi | null>(null)

export function useSpace(): SpaceApi {
  const v = useContext(SpaceCtx)
  if (!v) throw new Error('useSpace must be used within <SpaceProvider>')
  return v
}
