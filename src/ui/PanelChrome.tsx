import { useSpace } from './spaceContext'
import type { PanelId } from './space'

// Edit Mode chrome for one panel: Lock (size immutable) and Pin (center
// immutable). Independent, per the design. Shows the panel's share of the
// space, so the numbers can be seen while the minimums are being tuned.
export function PanelChrome({ id, inline = false }: { id: PanelId; inline?: boolean }) {
  const { space, setPanelFlag, editMode } = useSpace()
  if (!editMode) return null
  const p = space.leaves[id]
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <span className={inline ? 'tc-chrome tc-chrome-inline' : 'tc-chrome'} data-panel={id}>
      <button type="button" className="tc-chrome-btn" data-on={p.locked ? 'true' : 'false'}
        onClick={() => setPanelFlag(id, 'locked', !p.locked)}
        title={p.locked ? 'Locked: width and height cannot change; it moves whole. Click to unlock.' : 'Click to lock its size.'}>
        {p.locked ? 'Locked' : 'Lock'}
      </button>
      <button type="button" className="tc-chrome-btn" data-on={p.pinned ? 'true' : 'false'}
        onClick={() => setPanelFlag(id, 'pinned', !p.pinned)}
        title={p.pinned ? 'Pinned: its center cannot move; it warps around it. Click to unpin.' : 'Click to pin its center.'}>
        {p.pinned ? 'Pinned' : 'Pin'}
      </button>
      <span className="tc-chrome-size" title="share of the space: width x height">{pct(p.x1 - p.x0)} x {pct(p.y1 - p.y0)}</span>
    </span>
  )
}
