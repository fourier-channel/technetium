import { useMemo } from 'react'
import type { Room } from 'matrix-js-sdk'
import { useClient } from '../client/clientContextValue'
import { Timeline } from './Timeline'
import { Composer } from './Composer'
import { ComposerModeProvider } from './ComposerModeProvider'
import { ResizeHandle } from './ResizeHandle'
import { useLayout } from './layoutContext'
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
  const { layout, dockRoom, closeDock, resizePanel, editMode } = useLayout()
  const panel = layout.panels.dmDock
  const shown = panel.open && !!dockRoom

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
      style={{ height: shown ? panel.size : 0 }}
      aria-hidden={!shown}
    >
      {dockRoom && (
        <div className="tc-dmdock-inner">
          <div className="tc-dmdock-head">
            <span className="tc-dmdock-title">{title}</span>
            <span className="tc-dmdock-hint">Direct message</span>
            {editMode && <PanelChrome id="dmDock" inline />}
            <button type="button" className="tc-dmdock-close" onClick={closeDock} title="Hide the DM window">
              Hide
            </button>
          </div>
          <ComposerModeProvider>
            <div className="tc-dmdock-body">
              <Timeline room={dockRoom as Room} />
            </div>
            <Composer room={dockRoom as Room} />
          </ComposerModeProvider>
          {/* Bottom edge: drag to change the dock's height, unless locked. */}
          {!panel.locked && (
            <div className="tc-dmdock-grip">
              <ResizeHandle vertical onDrag={(d) => resizePanel('dmDock', d)} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
