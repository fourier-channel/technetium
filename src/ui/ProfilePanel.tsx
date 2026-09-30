import { useEffect, useRef, useState } from 'react'
import { useClient } from '../client/clientContextValue'
import {
  ANIM_MS,
  LOOK_ANIMS,
  LOOK_COLORS,
  LOOK_FONTS,
  LOOK_MASKS,
  LOOK_RINGS,
  isDefaultLook,
  nameAttrs,
  sameLook,
  type Look,
  type LookAnim,
  type LookColor,
} from '../client/look'
import { clearAvatar, setDisplayName, uploadAndSetAvatar } from '../client/profile'
import { detail } from '../client/report'
import { AvatarDisc } from './AvatarDisc'
import { clipPathFor, legacyAvatarShape } from './avatarShape'
import { useLook, useLookStore, useLookSupport } from './lookContext'
import { useReducedMotion } from './reducedMotion'

// ---------------------------------------------------------------------------
// The Profile panel (launch-polish L24).
//
// Operator, 2026-09-30: "Begin work on an actual profile panel, with its
// button to the left of the settings button under the current user
// information panel. Profile: Set avatar options. change avatar. mask shape.
// border/glow effect. occasional animation ... Set name font, name color."
//
// Two kinds of thing, said apart on the panel because they save differently:
//
//   PICTURE AND NAME  the standard Matrix profile, every client shows them.
//                     Each change is sent the moment it is made, as before.
//   LOOK              mask, edge, animation, the name's face and colour --
//                     one field in the same profile (client/look.ts). Edited
//                     as a DRAFT with a live preview, undoable, and published
//                     only by Save (SETTINGS_PREVIEW_LAW sec 3-4: changes apply
//                     to a copy; nothing reaches viewers until it is saved).
//
// The same box as Settings -- a sibling, opened from the pill beside it.
// ---------------------------------------------------------------------------

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; why: string }

const HISTORY_MAX = 50

export function ProfilePanel({ onClose }: { onClose: () => void }) {
  const { client } = useClient()
  const store = useLookStore()
  const support = useLookSupport()
  const reduced = useReducedMotion()
  const me = client?.getUserId() ?? ''
  const saved = useLook(me)

  // The shape this browser chose before a look could be published, carried
  // over ONCE: while nothing is published, the draft starts from it and the
  // panel says so; saving publishes it.
  const [legacyShape] = useState(() => legacyAvatarShape())
  const carried = isDefaultLook(saved) && legacyShape !== null && legacyShape !== saved.mask
  const base: Look = carried ? { ...saved, mask: legacyShape } : saved

  const [draft, setDraft] = useState<Look | null>(null)
  const [history, setHistory] = useState<Look[]>([])
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [closeArmed, setCloseArmed] = useState(false)
  const current = draft ?? base
  const dirty = !sameLook(current, saved)

  const change = (next: Partial<Look>) => {
    setHistory((h) => [...h, current].slice(-HISTORY_MAX))
    setDraft({ ...current, ...next })
    setSave({ kind: 'idle' })
    setCloseArmed(false)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setDraft(prev)
    setSave({ kind: 'idle' })
  }
  const discard = () => {
    setHistory([])
    setDraft(null)
    setSave({ kind: 'idle' })
  }
  const publish = async () => {
    if (!store) return
    setSave({ kind: 'saving' })
    try {
      await store.publish(current)
      setHistory([])
      setDraft(null)
      setSave({ kind: 'saved' })
    } catch (err) {
      setSave({ kind: 'failed', why: detail(err) })
    }
  }

  // The preview's own play button.
  const [previewPlay, setPreviewPlay] = useState<LookAnim | null>(null)
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (playTimer.current) clearTimeout(playTimer.current)
  }, [])
  const playPreview = () => {
    const anim = current.anim
    if (anim === 'none') return
    if (playTimer.current) clearTimeout(playTimer.current)
    setPreviewPlay(null)
    // Next frame, so a second press restarts the run rather than continuing it.
    requestAnimationFrame(() => {
      setPreviewPlay(anim)
      playTimer.current = setTimeout(() => setPreviewPlay(null), ANIM_MS[anim])
    })
  }

  // --- picture and name: sent as they are made ---------------------------
  const user = client?.getUser(me) ?? null
  const [nameDraft, setNameDraft] = useState(() => user?.displayName ?? '')
  const [avatarMxc, setAvatarMxc] = useState<string | null>(() => user?.avatarUrl ?? null)
  const [idBusy, setIdBusy] = useState(false)
  const [idNote, setIdNote] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const shownName = nameDraft.trim() || user?.displayName || me

  const saveName = async () => {
    if (!client) return
    setIdBusy(true)
    setIdNote(null)
    try {
      await setDisplayName(client, nameDraft)
      setIdNote({ text: 'Display name saved.', tone: 'ok' })
    } catch (err) {
      setIdNote({ text: `The name was not saved: ${detail(err)}`, tone: 'bad' })
    } finally {
      setIdBusy(false)
    }
  }
  const pickPicture = async (file: File) => {
    if (!client) return
    setIdBusy(true)
    setIdNote(null)
    try {
      // D-bf01: chrome media goes to the homeserver, not the content gateway.
      setAvatarMxc(await uploadAndSetAvatar(client, file))
      setIdNote({ text: 'Picture saved.', tone: 'ok' })
    } catch (err) {
      setIdNote({ text: `The picture was not saved: ${detail(err)}`, tone: 'bad' })
    } finally {
      setIdBusy(false)
    }
  }
  const removePicture = async () => {
    if (!client) return
    setIdBusy(true)
    setIdNote(null)
    try {
      await clearAvatar(client)
      setAvatarMxc(null)
      setIdNote({ text: 'Picture removed.', tone: 'ok' })
    } catch (err) {
      setIdNote({ text: `The picture was not removed: ${detail(err)}`, tone: 'bad' })
    } finally {
      setIdBusy(false)
    }
  }

  const close = () => {
    if (dirty && !closeArmed) {
      setCloseArmed(true)
      return
    }
    onClose()
  }

  const canSave = dirty && support !== 'no' && save.kind !== 'saving' && !!store

  return (
    <div
      className="tc-settings tc-profile"
      role="dialog"
      aria-label="Profile"
      aria-modal="true"
      onKeyDown={(e) => {
        // Undo the last look change, unless the key is for a text field.
        const inField = (e.target as HTMLElement).closest('input, textarea')
        if (!inField && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          undo()
        }
      }}
    >
      <div className="tc-settings-row tc-panel-head" data-inset="true">
        <strong>Profile</strong>
        <button type="button" className="tc-pill" data-tone={closeArmed ? 'go' : undefined} onClick={close}>
          {closeArmed ? 'Close without saving' : 'Done'}
        </button>
      </div>

      <div className="tc-settings-body">
        <div className="tc-prof-grid">
          <div className="tc-prof-controls">
            <h3 className="tc-settings-head">Picture and name</h3>
            <p className="tc-settings-note">Your Matrix profile: every client shows these, and each change is sent as soon as you make it.</p>
            <div className="tc-prof-field">
              <span className="tc-prof-label">Picture</span>
              <span className="tc-prof-choices">
                <button type="button" className="tc-pill" disabled={idBusy} onClick={() => fileRef.current?.click()}>
                  {idBusy ? 'Working...' : 'Change picture'}
                </button>
                <button type="button" className="tc-pill" disabled={idBusy || !avatarMxc} onClick={() => void removePicture()}>
                  Remove picture
                </button>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="tc-prof-file"
                aria-label="Choose a picture"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void pickPicture(file)
                }}
              />
            </div>
            <div className="tc-prof-field">
              <label className="tc-prof-label" htmlFor="tc-prof-name">Display name</label>
              <span className="tc-prof-choices">
                <input
                  id="tc-prof-name"
                  type="text"
                  className="tc-input"
                  value={nameDraft}
                  placeholder={me}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName()
                  }}
                />
                <button
                  type="button"
                  className="tc-pill"
                  disabled={idBusy || nameDraft.trim() === (user?.displayName ?? '')}
                  onClick={() => void saveName()}
                >
                  Save name
                </button>
              </span>
            </div>
            {idNote && (
              <p className={`tc-settings-note tc-tone-${idNote.tone}`} role="status">{idNote.text}</p>
            )}

            <h3 className="tc-settings-head">Look</h3>
            <p className="tc-settings-note">
              How your avatar and name are drawn in Technetium. A draft until you press Save; the preview shows it now.
            </p>

            <Choices label="Avatar shape">
              {LOOK_MASKS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  className="tc-prof-swatch"
                  aria-checked={current.mask === m.id}
                  aria-label={m.label}
                  title={m.label}
                  onClick={() => change({ mask: m.id })}
                >
                  <span aria-hidden="true" style={{ clipPath: clipPathFor(m.id) }} />
                </button>
              ))}
            </Choices>

            <Choices label="Edge">
              {LOOK_RINGS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  className="tc-pill"
                  aria-checked={current.ring === r.id}
                  onClick={() => change({ ring: r.id })}
                >
                  {r.label}
                </button>
              ))}
            </Choices>

            <Choices label="Edge colour">
              <ColorSwatches
                value={current.ringColor}
                disabled={current.ring === 'none'}
                onPick={(c) => change({ ringColor: c })}
              />
            </Choices>

            <Choices label="Animation">
              {LOOK_ANIMS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  className="tc-pill"
                  aria-checked={current.anim === a.id}
                  onClick={() => change({ anim: a.id })}
                >
                  {a.label}
                </button>
              ))}
            </Choices>
            <p className="tc-settings-note">
              Plays when you post a line, then a couple more times over the next few minutes, then stops. It never plays
              for anyone who has reduced motion or animations turned off.
            </p>

            <Choices label="Name font">
              <button
                type="button"
                role="radio"
                className="tc-pill"
                aria-checked={current.nameFont === null}
                onClick={() => change({ nameFont: null })}
              >
                Standard
              </button>
              {LOOK_FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  className="tc-pill tc-prof-font"
                  data-name-font={f.id}
                  aria-checked={current.nameFont === f.id}
                  onClick={() => change({ nameFont: f.id })}
                >
                  {f.label}
                </button>
              ))}
            </Choices>

            <Choices label="Name colour">
              <button
                type="button"
                role="radio"
                className="tc-pill"
                aria-checked={current.nameColor === null}
                onClick={() => change({ nameColor: null })}
              >
                Standard
              </button>
              <ColorSwatches value={current.nameColor} onPick={(c) => change({ nameColor: c })} />
            </Choices>
          </div>

          <aside className="tc-prof-preview" aria-label="Preview">
            <span className="tc-prof-label">Preview</span>
            <div className="tc-prof-hero">
              <AvatarDisc userId={me} name={shownName} avatarMxc={avatarMxc} size={56} look={current} playing={previewPlay} />
              <div className="tc-prof-hero-name" {...nameAttrs(current)}>{shownName}</div>
              <div className="tc-prof-hero-id">{me}</div>
            </div>
            <div className="tc-prof-sample" aria-hidden="true">
              <AvatarDisc userId={me} name={shownName} avatarMxc={avatarMxc} size={34} look={current} playing={previewPlay} />
              <div className="tc-prof-sample-col">
                <span className="tc-ident-name tc-prof-sample-name" {...nameAttrs(current)}>{shownName}</span>
                <span className="tc-prof-bubble">This is how you look in a chat.</span>
              </div>
            </div>
            <button
              type="button"
              className="tc-pill"
              disabled={current.anim === 'none' || reduced}
              onClick={playPreview}
            >
              {reduced ? 'Animations are off (reduced motion)' : 'Play the animation'}
            </button>
            {carried && !draft && (
              <p className="tc-settings-note">
                Your avatar shape was carried over from this browser. Save to show it to everyone.
              </p>
            )}
          </aside>
        </div>

      </div>

      {/* Outside the scrolling body, like the header: Save is always in reach
          and nothing scrolls underneath it. */}
        <div className="tc-prof-foot" role="status">
        <span className="tc-prof-foot-say">
          {support === 'no' ? (
            <span className="tc-tone-warn">
              This server does not share profile fields, so a look saved here would be seen by nobody. Nothing is
              saved.
            </span>
          ) : save.kind === 'saving' ? (
            <span className="tc-tone-active">Saving...</span>
          ) : save.kind === 'failed' ? (
            <span className="tc-tone-bad">Not saved: {save.why}</span>
          ) : dirty ? (
            <span className="tc-tone-warn">Unsaved changes.</span>
          ) : save.kind === 'saved' ? (
            <span className="tc-tone-ok">Saved. Everyone in Technetium sees it.</span>
          ) : support === 'unknown' ? (
            <span className="tc-perm-dim">Checking whether this server shares profile fields...</span>
          ) : (
            <span className="tc-perm-dim">Everyone in Technetium sees your look.</span>
          )}
        </span>
        <button type="button" className="tc-pill" disabled={history.length === 0} onClick={undo}>
          Undo
        </button>
        <button type="button" className="tc-pill" disabled={!dirty} onClick={discard}>
          Discard
        </button>
        <button type="button" className="tc-pill" data-tone="go" disabled={!canSave} onClick={() => void publish()}>
          Save
        </button>
      </div>
    </div>
  )
}

function Choices({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tc-prof-field">
      <span className="tc-prof-label">{label}</span>
      <span className="tc-prof-choices" role="radiogroup" aria-label={label}>
        {children}
      </span>
    </div>
  )
}

function ColorSwatches({
  value,
  disabled = false,
  onPick,
}: {
  value: LookColor | null
  disabled?: boolean
  onPick: (c: LookColor) => void
}) {
  return (
    <>
      {LOOK_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          className="tc-prof-color"
          data-color={c.id}
          aria-checked={value === c.id}
          aria-label={c.label}
          title={c.label}
          disabled={disabled}
          onClick={() => onPick(c.id)}
        />
      ))}
    </>
  )
}
