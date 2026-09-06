import { useLayout } from './layoutContext'
import type { PanelId } from './layout'

// Edit Mode chrome for one panel: the lock and pin toggles. Locked = size
// fixed; pinned = position fixed. Independent, per the design.
export function PanelChrome({ id, inline = false }: { id: PanelId; inline?: boolean }) {
  const { layout, setPanelFlag, editMode } = useLayout()
  if (!editMode) return null
  const p = layout.panels[id]
  return (
    <span className={inline ? 'tc-chrome tc-chrome-inline' : 'tc-chrome'} data-panel={id}>
      <button
        type="button"
        className="tc-chrome-btn"
        data-on={p.locked ? 'true' : 'false'}
        onClick={() => setPanelFlag(id, 'locked', !p.locked)}
        title={p.locked ? 'Locked: size cannot change. Click to unlock.' : 'Unlocked: shares space. Click to lock its size.'}
      >
        {p.locked ? 'Locked' : 'Lock'}
      </button>
      <button
        type="button"
        className="tc-chrome-btn"
        data-on={p.pinned ? 'true' : 'false'}
        onClick={() => setPanelFlag(id, 'pinned', !p.pinned)}
        title={p.pinned ? 'Pinned: position cannot change. Click to unpin.' : 'Unpinned: can be moved. Click to pin its position.'}
      >
        {p.pinned ? 'Pinned' : 'Pin'}
      </button>
    </span>
  )
}
