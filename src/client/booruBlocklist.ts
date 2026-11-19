import { BOORU_ORIGIN } from './booruUrl'

// ---------------------------------------------------------------------------
// The person's booru blocklist, applied to the pictures Technetium shows.
//
// ONE LIST EVERYWHERE (operator, 2026-10-13, blocklist-is-the-only-filter):
// the list lives on the person's booru account, and every app reads it.
// Blocking a tag on the booru hides it here too. This module is the reading
// half; the booru owns the editing.
//
// WHERE IT COMES FROM. chanbooru's `GET /profile.json` answers the signed-in
// person's own record, with `blocklist: [{rule, locked}]` already parsed and
// normalised (lowercase, `rating:explicit` -> `rating:e`). The raw
// `blacklisted_tags` text is NOT read: chanbooru says no other app may parse
// it, because the lock marker lives in it. A request with no booru session is
// anonymous and gets [].
//
// HOW A RULE MATCHES, exactly as chanbooru's own `Rule`
// (app/javascript/src/javascripts/blacklists.js) does it:
//   - words separated by whitespace;
//   - `-tag` excludes, `~tag` is one of an "any of" set, `score:<N` caps the
//     score; every other word is required;
//   - a post matches when it has every required word, the score is under the
//     cap (when there is one), at least one "any of" word (when there are
//     any), and no excluded word.
// The post's words are its tags plus `rating:<letter>`, and on the booru also
// `status:<flag>` and `uploaderid:<id>`.
//
// WHAT TECHNETIUM CANNOT SEE. The live read (booruTags.ts fetchBooruPool)
// carries tags and the rating, but no score, status or uploader. A rule that
// names one of those is NOT applied here, and it is said so once, rather than
// half-applied: a `-status:deleted` evaluated against a post that has no
// status words would hide MORE than the person's own list hides on the
// booru, and a `score:<5` with no score would hide nothing or everything.
// Withholding never rests on this list -- the booru withholds on the server
// (withheldMedia.ts) -- so a rule left out costs a picture the person would
// rather not see, never a leak.
//
// Pure apart from the store at the bottom, so the check harness can load it.
// ---------------------------------------------------------------------------

export interface Block {
  rule: string
  locked: boolean
}

export interface CompiledRule {
  rule: string
  require: string[]
  exclude: string[]
  optional: string[]
  /** The words in this rule Technetium cannot evaluate. Empty when it applies. */
  unseen: string[]
}

/** `blocklist` from a /profile.json body. Anything that is not {rule: string} is dropped. */
export function parseProfileBlocklist(json: unknown): Block[] {
  if (!json || typeof json !== 'object') return []
  const list = (json as Record<string, unknown>).blocklist
  if (!Array.isArray(list)) return []
  const out: Block[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const { rule, locked } = item as Record<string, unknown>
    if (typeof rule !== 'string' || !rule.trim()) continue
    out.push({ rule, locked: locked === true })
  }
  return out
}

// Words naming a part of the post the live read does not carry.
function isUnseen(word: string): boolean {
  return /^score:</.test(word) || word.startsWith('status:') || word.startsWith('uploaderid:')
}

export function compileRule(rule: string): CompiledRule {
  const out: CompiledRule = { rule, require: [], exclude: [], optional: [], unseen: [] }
  // Lowercased again although the booru already did: a rule that reached here
  // some other way must not silently stop matching because of its case.
  for (const word of rule.toLowerCase().split(/\s+/).filter(Boolean)) {
    const bare = word.startsWith('-') || word.startsWith('~') ? word.slice(1) : word
    if (isUnseen(bare)) out.unseen.push(word)
    if (word.startsWith('-')) out.exclude.push(bare)
    else if (word.startsWith('~')) out.optional.push(bare)
    else if (!/^score:</.test(word)) out.require.push(word)
  }
  return out
}

/** The words a post is matched on: its tag names, and `rating:<letter>` when known. */
export function postWords(tagNames: Iterable<string>, rating?: string): Set<string> {
  const words = new Set<string>()
  for (const name of tagNames) if (name) words.add(name.toLowerCase())
  if (rating) words.add(`rating:${rating.toLowerCase()}`)
  return words
}

/** Does this rule hide a post with these words? Never, for a rule Technetium cannot evaluate. */
export function ruleMatches(rule: CompiledRule, words: ReadonlySet<string>): boolean {
  if (rule.unseen.length > 0) return false
  // A rule of nothing but `~` words still needs one of them; a rule with no
  // words at all is not a rule (parseProfileBlocklist drops blanks).
  if (rule.require.length === 0 && rule.optional.length === 0) return false
  return (
    rule.require.every((w) => words.has(w)) &&
    (rule.optional.length === 0 || rule.optional.some((w) => words.has(w))) &&
    !rule.exclude.some((w) => words.has(w))
  )
}

/** The first rule that hides this post, or undefined. */
export function blockedBy(rules: readonly CompiledRule[], words: ReadonlySet<string>): CompiledRule | undefined {
  return rules.find((r) => ruleMatches(r, words))
}

export const BLOCKLIST_URL = `${BOORU_ORIGIN}/profile.json`

/**
 * Read the person's list. Credentialed: the booru answers for whoever its
 * session cookie names, and an anonymous request gets [] -- which is also the
 * right answer for this client, since there is then no list to apply.
 *
 * A refusal is a FAULT, not an empty list. Returning [] for a 403 would show
 * every blocked picture with nothing anywhere saying why (the same shape as
 * the CORS breakage fetchBooruPool records).
 */
export async function fetchBlocklist(fetchImpl: typeof fetch = fetch): Promise<Block[]> {
  const res = await fetchImpl(BLOCKLIST_URL, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(
      `the booru refused to read this account's blocklist (HTTP ${res.status}). ` +
        'Fix: a 403 is usually the Cloudflare challenge or a missing booru session ' +
        '(ensureBooruSession); until it is read, no picture is hidden by the ' +
        "person's blocklist in Technetium.",
    )
  }
  return parseProfileBlocklist(await res.json())
}

// ---------------------------------------------------------------------------
// The store: the compiled list, and which pictures it hides.
//
// A separate set from withheldMedia's, on purpose. A withheld picture is
// re-asked on a schedule and brought back when the booru lets it out; a
// blocked one is the person's own choice and comes back only when their list
// or the picture's tags change. Sharing the set would have the recheck bring
// back what the person blocked.
// ---------------------------------------------------------------------------

let rules: CompiledRule[] = []
let blocked: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()
const ruleListeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

/** Replace the list. Returns the rules Technetium cannot evaluate, for the caller to report. */
export function setBlocklist(blocks: readonly Block[]): CompiledRule[] {
  rules = blocks.map((b) => compileRule(b.rule))
  for (const cb of ruleListeners) cb()
  return rules.filter((r) => r.unseen.length > 0)
}

export function currentRules(): readonly CompiledRule[] {
  return rules
}

/** Record whether one picture is hidden. A no-op when nothing changes. */
export function setBlocked(mediaId: string, yes: boolean): void {
  if (blocked.has(mediaId) === yes) return
  const next = new Set(blocked)
  if (yes) next.add(mediaId)
  else next.delete(mediaId)
  blocked = next
  emit()
}

/** Media ids of the pictures the person's blocklist hides. A new Set on every change. */
export function blockedMedia(): ReadonlySet<string> {
  return blocked
}

export function onBlocked(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Called when the list itself changes, so every known picture is judged again. */
export function onBlocklistChanged(cb: () => void): () => void {
  ruleListeners.add(cb)
  return () => ruleListeners.delete(cb)
}

/** Test seam. */
export function resetBlocklistForTest(): void {
  rules = []
  blocked = new Set()
  listeners.clear()
  ruleListeners.clear()
}
