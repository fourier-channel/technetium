import { useState } from 'react'
import './provenance.css'
import { DWELL_DEFAULT_MS, DWELL_MAX_MS, DWELL_MIN_MS, DWELL_STEP_MS, clampDwell } from '../client/provenanceMode'
import { setProvenanceDwell, setProvenanceOn, setSheenPreview, useProvenance } from './provenancePref'

// Settings -> Interface Options -> Provenance mode (tc.154). Rendered only
// where the mode exists at all: the preview site and dev (P2). Every setting
// here is this browser's (client/provenanceMode.ts says why).
export function ProvenanceSettings() {
  const prov = useProvenance()
  const [note, setNote] = useState('')
  if (!prov.available) return null
  const refused = 'This browser refused to store the setting, so nothing changed.'
  return (
    <fieldset className="tc-prov-settings">
      <legend className="tc-settings-head">Provenance mode</legend>
      <p className="tc-settings-note">
        Rest the pointer on a part of the interface and a box lists the decisions and fixes behind it. Only on the
        preview site, and only in this browser.
      </p>
      <label className="tc-io-check">
        <input
          type="checkbox"
          checked={prov.on}
          onChange={(e) => setNote(setProvenanceOn(e.target.checked) ? '' : refused)}
        />
        <span>Provenance mode</span>
      </label>
      <div className="tc-io-spacing">
        <label htmlFor="tc-prov-dwell">Rest time before the box opens</label>
        <input
          id="tc-prov-dwell"
          type="range"
          min={DWELL_MIN_MS}
          max={DWELL_MAX_MS}
          step={DWELL_STEP_MS}
          value={prov.dwellMs}
          onChange={(e) => setNote(setProvenanceDwell(clampDwell(Number(e.target.value))) ? '' : refused)}
        />
        <output htmlFor="tc-prov-dwell">
          {(prov.dwellMs / 1000).toFixed(1)} s{prov.dwellMs === DWELL_DEFAULT_MS ? ' (default)' : ''}
        </output>
      </div>
      <label className="tc-io-check">
        <input
          type="checkbox"
          checked={prov.sheenPreview}
          onChange={(e) => setNote(setSheenPreview(e.target.checked) ? '' : refused)}
        />
        <span>
          Preview the goal sheen
          <span className="tc-settings-note">
            {' '}-- draws it on every marked part, to see how it looks. Which parts belong to a goal is not decided yet.
          </span>
        </span>
      </label>
      {note && <p className="tc-settings-note tc-tone-warn">{note}</p>}
    </fieldset>
  )
}
