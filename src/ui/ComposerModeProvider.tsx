import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { IContent, MatrixEvent } from 'matrix-js-sdk'
import { ComposerModeContext, NORMAL_MODE, type ComposerMode } from './composerMode'

// S3 -- owns the reply/edit target for ONE composer scope. Wrap the timeline
// and its composer together; the thread panel wraps its own pair separately so
// the two never share a mode.
export function ComposerModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ComposerMode>(NORMAL_MODE)

  const reply = useCallback((target: MatrixEvent) => setMode({ kind: 'reply', target }), [])
  const edit = useCallback(
    (target: MatrixEvent, content: IContent) => setMode({ kind: 'edit', target, content }),
    [],
  )
  const clear = useCallback(() => setMode(NORMAL_MODE), [])

  const api = useMemo(() => ({ mode, reply, edit, clear }), [mode, reply, edit, clear])

  return <ComposerModeContext.Provider value={api}>{children}</ComposerModeContext.Provider>
}
