import { createContext, useContext } from 'react'
import type { Room } from 'matrix-js-sdk'
import type { Layout, PanelId } from './layout'

// The layout context and its hook, apart from the provider so that file
// exports only its component (react-refresh cannot hot-reload a mixed module).

export interface LayoutApi {
  layout: Layout
  editMode: boolean
  setEditMode: (on: boolean) => void
  resizePanel: (id: PanelId, delta: number) => void
  setPanelFlag: (id: PanelId, flag: 'locked' | 'pinned' | 'open', value: boolean) => void
  movePanel: (id: PanelId, toIndex: number) => void
  exportCode: () => string
  // False when the pasted number is not a layout. Nothing changes then.
  importCode: (code: string) => boolean
  resetLayout: () => void
  // The dock: which DM it shows, and whether it is out.
  dockRoom: Room | null
  showInDock: (room: Room) => void
  closeDock: () => void
}

export const LayoutCtx = createContext<LayoutApi | null>(null)

export function useLayout(): LayoutApi {
  const v = useContext(LayoutCtx)
  if (!v) throw new Error('useLayout must be used within <LayoutProvider>')
  return v
}
