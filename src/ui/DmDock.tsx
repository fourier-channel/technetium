import { useMemo } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { Timeline } from './Timeline'
import { Composer } from './Composer'
import { ComposerModeProvider } from './ComposerModeProvider'
import { ResizeHandle } from './ResizeHandle'
import { dividerTone } from './dividerTone'
import { useSpace } from './spaceContext'
import { PanelChrome } from './PanelChrome'

// The DM window. Across the top of the main column, its own space, and by
// default the WINNER: it is locked and pinned in the preset so other panels
// shrink to fit it rather than the other way round. It slides out from the
// left -- from where the DM list is -- and holds one conversation.
//
// A DM lives here, not in the main pane: clicking a person in the strip opens
// them here, the room you were reading stays where it was, and Fourier-chan's
// messages to a new user stay in view whatever that user clicks next.
export function DmDock() {
  const { client } = useClient()
  const { space, dockRoom, pushEdge, editMode } = useSpace()
  const panel = space.leaves.dock
  const shown = panel.open && !!dockRoom
  // Height as a share of the main column's height; the column measures itself.
  const share = shown ? (panel.y1 - panel.y0) / Math.max(1e-6, space.leaves.main.y1 - panel.y0) : 0

  const title = useMemo(() => {
    if (!dockRoom || !client) return ''
    const me = client.getUserId()
    const other = dockRoom.getJoinedMembers().find((m) => m.userId !== me)
      ?? dockRoom.getMembers().find((m) => m.userId !== me)
    return other?.name || dockRoom.name || dockRoom.roomId
  }, [dockRoom, client])

  return (
    <div
      className="tc-dmdock"
      data-shown={shown ? 'true' : 'false'}
      style={{ height: shown ? `${Math.round(share * 1000) / 10}%` : 0 }}
      aria-hidden={!shown}
    >
      {dockRoom && (
        <div className="tc-dmdock-inner">
          {/* ONE title bar (launch-polish L9). The dock used to stack its own
              bar -- the person's name and "Direct message" -- over the room
              header of the timeline inside it, which named the same person a
              second time. What only the dock knows now rides in that header:
              what this panel is, and its edit-mode chrome. The person is named
              by the header's own label, which also carries the shield. */}
          <ComposerModeProvider>
            <div className="tc-dmdock-body">
              <Timeline
                room={dockRoom as Room}
                headLead={<span className="tc-dmdock-hint" title={title}>Direct message</span>}
                headTrail={editMode ? <PanelChrome id="dock" inline /> : undefined}
              />
            </div>
            <Composer room={dockRoom as Room} />
          </ComposerModeProvider>
          {/* Bottom edge: drag to change the dock's height, unless locked. */}
          {/* The divider under the dock. Dragging it pushes dock and main
              alike -- a locked dock refuses, a pinned one warps. */}
          <div className="tc-dmdock-grip">
            <ResizeHandle
              vertical
              onDrag={(d) => pushEdge('dock', 'y', 'hi', d / Math.max(1, window.innerHeight))}
              tone={dividerTone(space, 'dock')}
              label="Direct message height"
            />
          </div>
        </div>
      )}
    </div>
  )
}
