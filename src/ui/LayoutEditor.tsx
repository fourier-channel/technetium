import { useState } from 'react'
import { useSpace } from './spaceContext'
import { PANEL_IDS, type PanelId } from './space'
import { domainEnabled } from '../client/domainMode'
import { PanelChrome } from './PanelChrome'

// What each panel is called to a person. The ids are internal.
const PANEL_LABEL: Record<PanelId, string> = {
  sidebar: 'Room list',
  dock: 'DM dock',
  threads: 'Thread list',
  main: 'Chat',
  thread: 'Thread view',
  members: 'Member list',
  domain: 'Domain',
}

// The Edit Mode surface: the layout's number, in and out, and reset. Lives
// as a small floating card so it covers no panel it is editing.
export function LayoutEditor() {
  const { space, editMode, setEditMode, exportCode, importCode, resetSpace, presets, overflow, setOverflow, singleSlot } = useSpace()
  const [pasted, setPasted] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [picked, setPicked] = useState('')
  const [newName, setNewName] = useState('')
  if (!editMode) return null
  const code = exportCode()
  const selected = presets.list.find((p) => p.name === picked) ?? null
  const marks = (name: string) =>
    [presets.defaultName === name ? 'default' : null, presets.mobileName === name ? 'mobile' : null]
      .filter(Boolean).join(', ')
  return (
    <div className="tc-layout-editor" role="dialog" aria-label="Edit layout">
      <div className="tc-layout-editor-row">
        <strong>Edit layout</strong>
        <button type="button" onClick={() => setEditMode(false)}>Done</button>
      </div>
      <div className="tc-layout-editor-help">
        Drag a divider and every panel on it accommodates. Lock fixes a panel's size (it moves whole); Pin fixes its center (it warps around it). Together: a fixed object.
      </div>
      {/* EVERY OPEN PANEL, not just the two that happened to carry their own
          chrome. Lock and Pin have always worked for any panel -- setPanelFlag
          takes any id -- but the buttons were mounted only inside Sidebar and
          DmDock, so the flanking panels had no way to reach them. That is what
          made the chat's left and right dividers look welded together: a LOCKED
          panel propagates a divider push to its opposite edge with the SAME
          delta, which is precisely "both edges move identically", and with no
          control on those panels there was no way to see it or undo it. */}
      <div className="tc-layout-editor-panels">
        {/* A layout saved while domain mode was available can still carry its
            leaf open, so without this the word "Domain" appears here -- with
            working Lock and Pin buttons -- for a user the feature is turned off
            for. It cannot mount the panel; it is still a visible mention of
            something that is supposed to not exist. */}
        {PANEL_IDS.filter((id) => space.leaves[id].open && (id !== 'domain' || domainEnabled())).map((id) => (
          <div className="tc-layout-editor-row" key={id}>
            <span>{PANEL_LABEL[id]}</span>
            <PanelChrome id={id} inline />
          </div>
        ))}
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
        <button type="button" disabled={!presets.canRevert} onClick={() => { presets.revert(); setNote('Reverted.') }}>
          Revert
        </button>
        {note && <span className="tc-layout-editor-note">{note}</span>}
      </div>

      <hr className="tc-layout-editor-rule" />

      <div className="tc-layout-editor-help">
        Save a layout you like, then point a device at it. A phone opens on the
        MOBILE preset; everything else opens on the DEFAULT. Revert undoes the
        last apply, import or reset, once.
      </div>
      <label className="tc-layout-editor-row">
        <span>Presets</span>
        <select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">{presets.list.length ? 'Pick a preset' : 'No presets saved yet'}</option>
          {presets.list.map((p) => (
            <option key={p.name} value={p.name}>{marks(p.name) ? `${p.name} (${marks(p.name)})` : p.name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected}
          onClick={() => setNote(selected && presets.apply(selected.name) ? `Applied ${selected.name}.` : 'That preset could not be applied.')}
        >
          Apply
        </button>
      </label>
      {selected && (
        <div className="tc-layout-editor-row">
          <button type="button" onClick={() => { presets.setDefault(selected.name); setNote(`${selected.name} is the default.`) }}>Set as default</button>
          <button type="button" onClick={() => { presets.setMobile(selected.name); setNote(`${selected.name} is the mobile preset.`) }}>Set as mobile</button>
          <button type="button" onClick={() => { presets.remove(selected.name); setPicked(''); setNote(`Deleted ${selected.name}.`) }}>Delete</button>
        </div>
      )}
      <label className="tc-layout-editor-row">
        <span>Save this layout as</span>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="name it" maxLength={40} />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={() => {
            presets.save(newName)
            setNote(`Saved ${newName.trim()}.`)
            setPicked(newName.trim())
            setNewName('')
          }}
        >
          Save
        </button>
      </label>

      <hr className="tc-layout-editor-rule" />

      <div className="tc-layout-editor-help">
        On a screen too narrow for two panels {singleSlot ? '(this one, right now)' : '(a phone)'}, a tab that
        opens a window either takes the screen or covers what is there.
      </div>
      <label className="tc-layout-editor-row">
        <span>One-slot screens</span>
        <select value={overflow} onChange={(e) => setOverflow(e.target.value === 'layer' ? 'layer' : 'replace')}>
          <option value="replace">Replace what is up</option>
          <option value="layer">Layer over it, close to go back</option>
        </select>
      </label>
    </div>
  )
}
