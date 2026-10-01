import { sameLook, type Look } from '../client/look'
import type { AvatarShape } from './avatarShape'

// ---------------------------------------------------------------------------
// The Profile panel's look draft (L24), as one pure reducer the checks drive.
//
// The panel's rules about a draft used to live in its component state, where
// three of them were wrong and no check could reach them:
//
//   - The old per-browser mask was "carried over once" but read on every open
//     and never cleared, so a published default look could never be kept --
//     the stale shape came back as an unsaved draft each time. It is now a
//     single event ('carry'), and the panel removes the old key when it sends
//     it here.
//   - A Save that resolved threw away whatever had been changed WHILE it was
//     in flight, and said "Saved." The draft that was sent is remembered; a
//     newer one survives the save.
//   - (The panel itself re-reads your look before any of this, so the draft
//     starts from what is published now, not from a cached copy.)
//
// `current` is what the controls and the preview show: the draft, or the
// published look when there is no draft.
// ---------------------------------------------------------------------------

export const HISTORY_MAX = 50

export type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; why: string }

export interface DraftState {
  draft: Look | null
  // Earlier drafts, for Undo; the oldest falls off past HISTORY_MAX.
  history: Look[]
  save: SaveState
  // The draft a Save in flight sent, so its success clears only that one.
  sent: Look | null
  // The draft began as this browser's old mask, carried over.
  carried: boolean
}

export const INITIAL_DRAFT: DraftState = { draft: null, history: [], save: { kind: 'idle' }, sent: null, carried: false }

export type DraftAction =
  | { type: 'change'; saved: Look; next: Partial<Look> }
  | { type: 'undo' }
  | { type: 'discard' }
  | { type: 'saving' }
  | { type: 'saved' }
  | { type: 'failed'; why: string }
  // The old per-browser mask, offered once over a published DEFAULT look.
  | { type: 'carry'; saved: Look; shape: AvatarShape }

export function currentLook(s: DraftState, saved: Look): Look {
  return s.draft ?? saved
}

export function isDirty(s: DraftState, saved: Look): boolean {
  return !sameLook(currentLook(s, saved), saved)
}

export function lookDraft(s: DraftState, a: DraftAction): DraftState {
  switch (a.type) {
    case 'change': {
      const current = currentLook(s, a.saved)
      return {
        ...s,
        history: [...s.history, current].slice(-HISTORY_MAX),
        draft: { ...current, ...a.next },
        save: s.save.kind === 'saving' ? s.save : { kind: 'idle' },
      }
    }
    case 'undo': {
      const prev = s.history[s.history.length - 1]
      if (!prev) return s
      return { ...s, history: s.history.slice(0, -1), draft: prev, save: s.save.kind === 'saving' ? s.save : { kind: 'idle' } }
    }
    case 'discard':
      return { ...s, history: [], draft: null, carried: false, save: s.save.kind === 'saving' ? s.save : { kind: 'idle' } }
    case 'saving':
      return { ...s, save: { kind: 'saving' }, sent: s.draft }
    case 'saved':
      // Only the draft that was sent is now the published look. One changed
      // while the save was in flight is still a draft, with its history.
      return s.draft === s.sent
        ? { ...s, draft: null, history: [], sent: null, carried: false, save: { kind: 'saved' } }
        : { ...s, sent: null, save: { kind: 'idle' } }
    case 'failed':
      return { ...s, sent: null, save: { kind: 'failed', why: a.why } }
    case 'carry':
      // Never over a draft the person has already started, and never when it
      // would change nothing.
      if (s.draft !== null || a.shape === a.saved.mask) return s
      return { ...s, draft: { ...a.saved, mask: a.shape }, history: [a.saved], carried: true }
  }
}
