import { useState } from 'react'
import { useSpace } from './spaceContext'

// The Edit Mode surface: the layout's number, in and out, and reset. Lives
// as a small floating card so it covers no panel it is editing.
export function LayoutEditor() {
  const { editMode, setEditMode, exportCode, importCode, resetSpace } = useSpace()
  const [pasted, setPasted] = useState('')
  const [note, setNote] = useState<string | null>(null)
  if (!editMode) return null
  const code = exportCode()
  return (
    <div className="tc-layout-editor" role="dialog" aria-label="Edit layout">
      <div className="tc-layout-editor-row">
        <strong>Edit layout</strong>
        <button type="button" onClick={() => setEditMode(false)}>Done</button>
      </div>
      <div className="tc-layout-editor-help">
        Drag a divider and every panel on it accommodates. Lock fixes a panel's size (it moves whole); Pin fixes its center (it warps around it). Together: a fixed object.
      </div>
      <label className="tc-layout-editor-row">
        <span>Your layout number</span>
        <input readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <label className="tc-layout-editor-row">
        <span>Import a number</span>
        <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="paste here" inputMode="numeric" />
        <button
          type="button"
          onClick={() => {
            const ok = importCode(pasted)
            setNote(ok ? 'Imported.' : 'That is not a layout number.')
            if (ok) setPasted('')
          }}
        >
          Import
        </button>
      </label>
      <div className="tc-layout-editor-row">
        <button type="button" onClick={() => { resetSpace(); setNote('Reset to the default.') }}>Reset to default</button>
        {note && <span className="tc-layout-editor-note">{note}</span>}
      </div>
    </div>
  )
}
