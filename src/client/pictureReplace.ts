// Replacing one of your pictures with a new version (operator, 2026-10-19:
// "Creator only. The Matrix image link should just switch to the updated
// file url and a reload should be forced on that post. The creator can then
// decide to keep old copies of those posts, or allow them to expire after x
// period, at which point a collector grabs them to schedule for deletion.").
//
// THE GESTURE IS AN EDIT. The creator's own picture message is edited
// (m.replace) to carry the new file, so the message itself now names the new
// mxc: every client draws the edited content (relations.ts effectiveContent),
// and a new URL is a reload no cache can stand in front of. Neru-chan sees the
// edit and points the booru post at the new file on the creator's behalf
// (fourier-tunnel capabilities/replace.js); the booru keeps the original on
// its replacement record and the creator's choice for the old file rides on
// the edit as net.41chan.replace.old_file.
//
// HELD (CLAUDE.md "Where it is going" 1): the booru does not take creator
// replacements yet, so this is off in production builds, on in dev, and
// opt-in per browser under Settings -> Unfinished features. Only the exact
// string '1' turns the build flag on.
//
// Pure apart from the injected env and store (O-tp9).
import type { IContent } from 'matrix-js-sdk'
import { type OptInStore, readFlag } from './e2eeOptIn'
import { hasCaption } from './mediaCaption'

export const REPLACE_OPT_IN_KEY = 'net.41chan.replace_picture_opt_in'
export const REPLACE_CHOICE_KEY = 'net.41chan.replace'

export type OldFileChoice = 'keep' | 'expire'

// THE CHOICE IS REMEMBERED (operator, 2026-10-19: "'Keep It' can be the
// default, however the next time it asks it will stay on whatever was
// chosen"). Server-side, in account data, so it follows the account to every
// device -- remembered, in the coherence rule's sense.
export const REPLACE_PREFS_TYPE = 'net.41chan.replace_prefs'

/** The choice to start the dialog on: the last one made, else keep. Pure. */
export function startingChoice(prefs: unknown): OldFileChoice {
  const v = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>).old_file : undefined
  return v === 'expire' ? 'expire' : 'keep'
}

export const replaceOptInStore: OptInStore = {
  read: () => (typeof localStorage === 'undefined' ? null : localStorage.getItem(REPLACE_OPT_IN_KEY)),
  write: (v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(REPLACE_OPT_IN_KEY, v) },
  remove: () => { if (typeof localStorage !== 'undefined') localStorage.removeItem(REPLACE_OPT_IN_KEY) },
}

export interface ReplaceEnv {
  /** import.meta.env.VITE_REPLACE_PICTURE */
  flag?: unknown
  /** import.meta.env.DEV */
  dev?: unknown
}

export function replaceEnabledFrom(env: ReplaceEnv, store: OptInStore | null): boolean {
  if (env.flag === '1') return true
  if (env.dev === true) return true
  if (!store) return false
  return readFlag(store)
}

export function replaceEnabled(): boolean {
  return replaceEnabledFrom({ flag: import.meta.env.VITE_REPLACE_PICTURE, dev: import.meta.env.DEV }, replaceOptInStore)
}

/**
 * May this viewer replace this message's picture? Their own, an unencrypted
 * picture (the booru never holds an encrypted one), in an unencrypted room,
 * already on the server (a local echo has no id to edit).
 */
export function canReplacePicture(args: {
  content: IContent
  sender: string | null | undefined
  me: string | null | undefined
  eventId: string | null | undefined
  roomEncrypted: boolean
}): boolean {
  const { content, sender, me, eventId, roomEncrypted } = args
  if (!me || sender !== me) return false
  if (!eventId || eventId.startsWith('~')) return false
  if (roomEncrypted) return false
  if (content.msgtype !== 'm.image' || content.file) return false
  return typeof content.url === 'string' && content.url.startsWith('mxc://')
}

/**
 * The m.replace that makes a picture message carry a new file (MSC2676).
 *
 * `current` is the EFFECTIVE content (earlier edits applied). Its caption is
 * kept: a caption is words the creator wrote, and replacing the file is not
 * a request to drop them. The top level is the "* " fallback with the new
 * url, so a client that does not understand edits still shows the new file.
 */
export function buildPictureEdit(args: {
  originalId: string
  current: IContent
  url: string
  info: Record<string, unknown>
  filename: string
  oldFile: OldFileChoice
}): IContent {
  const { originalId, current, url, info, filename, oldFile } = args
  const caption = hasCaption(current) ? (current.body as string) : null
  const newContent: IContent = {
    msgtype: 'm.image',
    body: caption ?? filename,
    filename,
    url,
    info,
  }
  if (caption && typeof current.formatted_body === 'string') {
    newContent.format = 'org.matrix.custom.html'
    newContent.formatted_body = current.formatted_body
  }
  return {
    msgtype: 'm.image',
    body: `* ${caption ?? filename}`,
    filename,
    url,
    info,
    'm.new_content': newContent,
    'm.relates_to': { rel_type: 'm.replace', event_id: originalId },
    [REPLACE_CHOICE_KEY]: { old_file: oldFile },
  }
}
