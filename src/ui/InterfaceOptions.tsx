import type { MatrixClient } from 'matrix-js-sdk'
import { useInterfacePrefs } from '../client/interfaceStore'
import {
  DEFAULT_PREFS,
  SPACING_DEFAULT,
  SPACING_MAX,
  SPACING_MIN,
  TONES,
  TONE_DEFAULT_HEX,
  TONE_LABEL,
  clampSpacing,
  normalizeHex,
  samePrefs,
  type ChatMode,
} from '../client/interfacePrefs'

// Settings -> Interface Options (INTERFACE_OPTIONS IO7-IO11): how the
// conversation is drawn. Every control here writes account data at once and
// shows the change at once, so the timeline behind the panel is the preview;
// what is chosen follows the person to every device until they reset it.

const MODES: { id: ChatMode; label: string; detail: string }[] = [
  { id: 'bubbles', label: 'Bubbles', detail: 'Avatars, names and speech bubbles.' },
  { id: 'irc', label: 'IRC style', detail: 'One line per message: <name> and the words. Pictures are links to their booru posts.' },
]

export function InterfaceOptions({ client }: { client: MatrixClient }) {
  const { prefs, update } = useInterfacePrefs(client)
  const bubbles = prefs.mode === 'bubbles'
  const atDefaults = samePrefs(prefs, DEFAULT_PREFS)

  return (
    <div className="tc-io">
      <h3 className="tc-settings-head">Chat style</h3>
      <div className="tc-io-modes" role="radiogroup" aria-label="Chat style">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            className="tc-io-mode"
            aria-checked={prefs.mode === m.id}
            onClick={() => update((p) => ({ ...p, mode: m.id }))}
          >
            <strong>{m.label}</strong>
            <span>{m.detail}</span>
          </button>
        ))}
      </div>

      <fieldset className="tc-io-bubbles" disabled={!bubbles}>
        <legend className="tc-settings-head">Bubbles</legend>
        {!bubbles && (
          <p className="tc-settings-note">
            IRC style draws every message the same way, close together. These apply when the chat style is Bubbles.
          </p>
        )}

        <label className="tc-io-check">
          <input
            id="tc-io-styled"
            type="checkbox"
            checked={prefs.styled}
            onChange={(e) => {
              const styled = e.target.checked
              update((p) => ({ ...p, styled }))
            }}
          />
          <span>
            Styled bubbles
            <span className="tc-settings-note"> -- a shout, a thought and a question each get their own shape.</span>
          </span>
        </label>

        <div className="tc-io-colors">
          {TONES.map((tone) => {
            const picked = prefs.colors[tone]
            const shown = picked ?? TONE_DEFAULT_HEX[tone]
            // Off, every line is the plain bubble, so only Plain's colour is seen.
            const unseen = !prefs.styled && tone !== 'standard'
            return (
              <div key={tone} className="tc-io-color" data-unseen={unseen ? 'true' : undefined}>
                <input
                  id={`tc-io-color-${tone}`}
                  type="color"
                  value={shown}
                  aria-label={`${TONE_LABEL[tone]} bubble colour`}
                  onChange={(e) => {
                    const hex = normalizeHex(e.target.value)
                    if (hex === null) return
                    update((p) => ({ ...p, colors: { ...p.colors, [tone]: hex } }))
                  }}
                />
                <label htmlFor={`tc-io-color-${tone}`}>{TONE_LABEL[tone]}</label>
                <button
                  type="button"
                  className="tc-pill"
                  disabled={!picked}
                  title={picked ? 'Back to the default colour' : 'This is the default colour'}
                  onClick={() =>
                    update((p) => {
                      const colors = { ...p.colors }
                      delete colors[tone]
                      return { ...p, colors }
                    })
                  }
                >
                  Reset
                </button>
              </div>
            )
          })}
        </div>

        <div className="tc-io-spacing">
          <label htmlFor="tc-io-spacing">Space between messages</label>
          <input
            id="tc-io-spacing"
            type="range"
            min={SPACING_MIN}
            max={SPACING_MAX}
            step={1}
            value={prefs.spacing}
            onChange={(e) => {
              const spacing = clampSpacing(Number(e.target.value))
              update((p) => ({ ...p, spacing }))
            }}
          />
          <output htmlFor="tc-io-spacing">
            {prefs.spacing}px{prefs.spacing === SPACING_DEFAULT ? ' (default)' : ''}
          </output>
        </div>
      </fieldset>

      <div className="tc-io-reset">
        <button type="button" className="tc-pill" disabled={atDefaults} onClick={() => update(() => DEFAULT_PREFS)}>
          Reset all to defaults
        </button>
        <p className="tc-settings-note">Saved to your account, so these follow you to every device.</p>
      </div>
    </div>
  )
}
