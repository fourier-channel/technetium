// Tags read from, and written to, the booru itself.
//
// THE BOORU IS THE SINGLE SOURCE OF TRUTH for tags (fourier-tag-hub). What
// Matrix holds is a POINTER: net.41chan.media.tags carries post_id, and because
// an image's md5 fixes its mxc, that pointer is stable forever and never needs
// rewriting. Tags are then read live for the images actually on screen.
//
// WHY THIS IS CHEAPER THAN WHAT IT REPLACES. Today the bridge copies an image's
// whole tag list into a state event -- measured at 1,715 bytes for one image,
// 1,342 events for 363 images because every retag rewrites it, and one 718-event
// batch was enough to break scrollback pagination. Reading live costs one
// request per visible image, and `only=` keeps that to about 160 bytes:
//
//   {"id":4,"rating":"q","tag_string_artist":"","tag_string_character":"",
//    "tag_string_copyright":"","tag_string_general":"non-web_source tagme",...}
//
// measured against production. Nothing is rewritten, so nothing accumulates.
//
// CATEGORY, NOT PROVENANCE. This uses Danbooru's own per-category tag strings,
// which is the axis the panel colours by (artist/character/copyright/general/
// meta). The booru's fourier tag_sources endpoint answers a DIFFERENT question
// -- who put a tag there, creator/auto/both -- and the two must not be
// conflated; the formant tokens keep separate names for exactly this reason.
//
// THE WRITE IS CONFLICT-SAFE AND NOT MINE. PostEdit on the booru computes
// `current_tags + added - removed`, where added/removed come from comparing the
// caller's old_tag_string against its new one. So two people editing the same
// post at once do not clobber each other, and a client that is slightly stale
// still applies only its own delta. That is why old_tag_string is sent and why
// no Ruby needed writing.
import { BOORU_ORIGIN } from './booruUrl'
import { booruCsrfToken, resetBooruCsrf } from './booruCsrf'
import type { MediaTag, TagCategory, TagLamp, TagProvenance } from './mediaTags'

// Only the fields the panel draws. The whole point is that this stays small.
const FIELDS = [
  'id',
  'rating',
  'tag_string',
  'tag_string_artist',
  'tag_string_character',
  'tag_string_copyright',
  'tag_string_general',
  'tag_string_meta',
].join(',')

interface PostTagJson {
  id?: number
  rating?: string
  tag_string?: string
  tag_string_artist?: string
  tag_string_character?: string
  tag_string_copyright?: string
  tag_string_general?: string
  tag_string_meta?: string
}

const CATEGORY_FIELD: ReadonlyArray<[TagCategory, keyof PostTagJson]> = [
  ['artist', 'tag_string_artist'],
  ['character', 'tag_string_character'],
  ['copyright', 'tag_string_copyright'],
  ['general', 'tag_string_general'],
  ['meta', 'tag_string_meta'],
]

export interface BooruTagSet {
  postId: number
  tags: MediaTag[]
  rating?: string
  /**
   * The post's tag_string exactly as the server reported it. Sent back as
   * old_tag_string on a later edit, which is what makes the edit a delta
   * against what this client actually saw rather than a blind replacement.
   */
  tagString: string
}

function split(s: unknown): string[] {
  return typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : []
}

/** Parse the booru's per-category strings into the panel's tag shape. */
export function parsePostTags(json: PostTagJson): BooruTagSet | null {
  if (typeof json.id !== 'number') return null
  const tags: MediaTag[] = []
  for (const [category, field] of CATEGORY_FIELD) {
    for (const name of split(json[field])) tags.push({ name, category })
  }
  return {
    postId: json.id,
    tags,
    rating: typeof json.rating === 'string' ? json.rating : undefined,
    // Prefer the server's own tag_string; fall back to rebuilding it from the
    // categories, which is the same set in a different order. Order does not
    // matter to PostEdit -- it splits on whitespace.
    tagString: typeof json.tag_string === 'string' ? json.tag_string : tags.map((t) => t.name).join(' '),
  }
}

/**
 * Current tags for one post, live.
 *
 * Credentialed, so the viewer's own identity-gated view applies -- the booru
 * decides what this user may see rather than the client filtering after the
 * fact. ensureBooruSession must have run; it has, wherever the booru frame or a
 * tagged image is on screen.
 */
export async function fetchBooruTags(postId: number, fetchImpl: typeof fetch = fetch): Promise<BooruTagSet | null> {
  const res = await fetchImpl(`${BOORU_ORIGIN}/posts/${postId}.json?only=${FIELDS}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  // A 404 is an ANSWER: the booru has no such post, and the caller should
  // treat that as "no tags" and stop asking.
  if (res.status === 404) return null
  // Anything else is a FAULT and must not be returned as absence. Returning
  // null for a 403 is what made the CORS breakage invisible for days -- a
  // refused read and an untagged image looked identical to every caller, so
  // the panel drew the stale copy and nothing anywhere said why.
  if (!res.ok) {
    throw new Error(
      `the booru refused to read post ${postId} (HTTP ${res.status}). ` +
        'Fix: a 403 is usually the Cloudflare challenge or a missing booru ' +
        'session (ensureBooruSession); check that the booru echoes this ' +
        'origin with Access-Control-Allow-Credentials, because a credentialed ' +
        'fetch discards a wildcard.',
    )
  }
  return parsePostTags((await res.json()) as PostTagJson)
}

export interface TagEdit {
  /** Tag names to add. */
  add?: readonly string[]
  /** Tag names to remove. */
  remove?: readonly string[]
}

/** The tag_string a delta implies, given what this client last saw. */
export function applyEdit(seen: string, edit: TagEdit): string {
  const names = new Set(seen.split(/\s+/).filter(Boolean))
  for (const t of edit.remove ?? []) names.delete(t)
  for (const t of edit.add ?? []) names.add(t)
  return [...names].join(' ')
}

/**
 * Add or remove tags on a post.
 *
 * Sends BOTH strings: old_tag_string is what this client saw, tag_string is
 * that plus the delta. The booru then applies only the difference to whatever
 * the post says right now, so a concurrent edit by someone else survives and a
 * stale client cannot revert it.
 *
 * A POST CARRYING _method=put, NOT A PUT, and that is not cosmetic. A real PUT
 * is not a CORS-simple method, so the browser sends an OPTIONS preflight
 * first -- and a preflight carries no cookies by specification, so the booru's
 * Caddy rule (which refuses anything without a session or a Cloudflare
 * clearance cookie) answers it 403 with no CORS headers at all. Measured:
 * OPTIONS to a post returns 403 and the real request is never sent. Rails'
 * Rack::MethodOverride reads _method from the body, so a plain POST reaches
 * the same update action with no preflight to refuse.
 *
 * Everything else here is shaped by the same constraint. Only CORS-safelisted
 * headers (Accept, and a form-urlencoded Content-Type); the CSRF token rides
 * in the BODY rather than X-CSRF-Token, because one custom header would put
 * the preflight straight back.
 *
 * @returns the post's tags as the server left them, so the caller can settle
 *          its optimistic state on the truth rather than on its own guess.
 */
export async function writeBooruTags(
  postId: number,
  seenTagString: string,
  edit: TagEdit,
  fetchImpl: typeof fetch = fetch,
): Promise<BooruTagSet | null> {
  const seen = new Set(seenTagString.split(/\s+/).filter(Boolean))
  const next = applyEdit(seenTagString, edit)

  // A REMOVAL THAT REMOVES NOTHING WAS SILENT, and that is why removals
  // "did not work" while additions did. An add always introduces a token the
  // server string lacks, so `next` always differs and the request always went
  // out. A remove whose tag is absent from old_tag_string produces an
  // IDENTICAL string, hit the early return, and sent nothing -- while the
  // optimistic update had already taken the pill off screen. It came back on
  // the next live read, with no error anywhere.
  //
  // The mismatch is the thing worth reporting, because it means the panel is
  // drawing a tag the booru does not have under that name: an alias applied
  // since the last read, a rename, or a stale set. Naming the tag and what
  // the server actually holds is what makes that diagnosable in one look.
  const absent = (edit.remove ?? []).filter((t) => !seen.has(t))
  if (absent.length > 0) {
    throw new Error(
      `the booru's copy of post ${postId} does not contain ` +
        `${absent.map((t) => `"${t}"`).join(', ')}, so there is nothing to remove. ` +
        `It currently holds: ${[...seen].join(' ') || '(no tags)'}. ` +
        'Fix: the panel is showing a tag the booru knows by another name -- ' +
        'usually an alias applied after this client last read the post. ' +
        'Scroll it out of view and back to force a fresh read.',
    )
  }
  if (next === seenTagString) {
    throw new Error(
      `that edit would change nothing on post ${postId}. ` +
        'Fix: the tag is already in the state you asked for; nothing was sent.',
    )
  }

  const send = async (csrf: string | null): Promise<Response> => {
    const body = new URLSearchParams()
    body.set('_method', 'put')
    if (csrf) body.set('authenticity_token', csrf)
    body.set('post[old_tag_string]', seenTagString)
    body.set('post[tag_string]', next)
    return fetchImpl(`${BOORU_ORIGIN}/posts/${postId}.json?only=${FIELDS}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
  }

  // No token, no point sending: Rails will refuse it, every time. Fail here
  // with the reason instead of letting it come back as an opaque 422 from a
  // request that never had a chance.
  const csrf = await booruCsrfToken(fetchImpl)
  if (!csrf) {
    throw new Error(
      'could not read a CSRF token from the booru, so the edit would be refused. ' +
        'Fix: this usually means there is no booru session in this browser -- open ' +
        'the booru panel once to run the sign-in exchange, then try again.',
    )
  }

  let res = await send(csrf)
  // A 422 here is nearly always the token: Rails masks it per call but every
  // mask validates against ONE session, so a session replaced since the fetch
  // (a re-login, an expiry, another tab) invalidates the cached copy and would
  // otherwise refuse every edit for the life of the page. Drop it and ask
  // once more. Only once -- a second 422 is the booru rejecting the TAGS, and
  // retrying that forever is how a client hammers a server over its own bug.
  if (res.status === 422) {
    resetBooruCsrf()
    const fresh = await booruCsrfToken(fetchImpl)
    if (fresh && fresh !== csrf) res = await send(fresh)
  }

  if (!res.ok) {
    throw new Error(
      `the booru refused the tag edit on post ${postId} (HTTP ${res.status}). ` +
        'Fix: a 403 is usually the Cloudflare challenge or a missing booru session ' +
        '(ensureBooruSession); a 422 after a retry is the booru rejecting the tags ' +
        'themselves, or an account without permission to edit them.',
    )
  }
  return parsePostTags((await res.json()) as PostTagJson)
}


// ---------------------------------------------------------------------------
// PROVENANCE: who put each tag there.
//
// A SECOND ENDPOINT, deliberately, because it is a second question. The
// category strings come off the post itself; provenance lives in chanbooru's
// fourier_tag_sources sidecar and is IDENTITY-GATED -- a creator's private
// tags are visible to the creator and to moderators and to nobody else. The
// default (no ?scope) is that gated view, so the booru decides what this
// viewer may see rather than the client filtering afterwards. `?scope=public`
// exists for bots and must not be used here.
//
// The buckets are chanbooru's own: creator / auto / both / meta / pending,
// plus `unsourced` for tags the post carries with no sidecar row.
// ---------------------------------------------------------------------------

const BUCKETS: readonly TagProvenance[] = ['creator', 'auto', 'both', 'meta', 'pending', 'unsourced']
// `both` first: a tag in both lists is the swirl, and first-bucket-wins below.
const LAMPS: readonly TagLamp[] = ['both', 'hydra', 'spectrum', 'manual']

export interface Provenance {
  /** tag name -> who put it there */
  who: Map<string, TagProvenance>
  /** tag name -> which model saw it (the lamp) */
  lamp: Map<string, TagLamp>
}

/** tag name -> which model. From the payload's `lamp` buckets. */
export function parseLamps(json: unknown): Map<string, TagLamp> {
  const out = new Map<string, TagLamp>()
  if (!json || typeof json !== 'object') return out
  const lamp = (json as Record<string, unknown>).lamp
  if (!lamp || typeof lamp !== 'object') return out
  const o = lamp as Record<string, unknown>
  for (const l of LAMPS) {
    const list = o[l]
    if (!Array.isArray(list)) continue
    for (const name of list) {
      if (typeof name === 'string' && name && !out.has(name)) out.set(name, l)
    }
  }
  return out
}

/** tag name -> who put it there. Empty when the post has no sidecar rows. */
export function parseProvenance(json: unknown): Map<string, TagProvenance> {
  const out = new Map<string, TagProvenance>()
  if (!json || typeof json !== 'object') return out
  const o = json as Record<string, unknown>
  for (const bucket of BUCKETS) {
    const list = o[bucket]
    if (!Array.isArray(list)) continue
    for (const name of list) {
      // FIRST BUCKET WINS. chanbooru's `both` is its own bucket rather than a
      // tag appearing in two, so an overlap here would be a server-side bug;
      // taking the first keeps one wrong row from silently recolouring a tag
      // on every render depending on object key order.
      if (typeof name === 'string' && name && !out.has(name)) out.set(name, bucket)
    }
  }
  return out
}

export async function fetchBooruProvenance(
  postId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Provenance | null> {
  const res = await fetchImpl(`${BOORU_ORIGIN}/posts/${postId}/tag_sources.json`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  // 404 means the post has no sidecar rows at all -- an answer, and a common
  // one for anything posted before the sidecar existed.
  if (res.status === 404) return { who: new Map(), lamp: new Map() }
  if (!res.ok) {
    throw new Error(
      `the booru refused the provenance read for post ${postId} (HTTP ${res.status}). ` +
        'Fix: same causes as the tag read -- the Cloudflare challenge, or a ' +
        'missing booru session (ensureBooruSession).',
    )
  }
  const json = await res.json()
  return { who: parseProvenance(json), lamp: parseLamps(json) }
}

/** Attach provenance to a tag list, leaving the category axis untouched. */
export function withProvenance(tags: MediaTag[], prov: Provenance): MediaTag[] {
  if (prov.who.size === 0 && prov.lamp.size === 0) return tags
  return tags.map((t) => {
    const p = prov.who.get(t.name)
    const l = prov.lamp.get(t.name)
    return p || l ? { ...t, ...(p ? { provenance: p } : {}), ...(l ? { lamp: l } : {}) } : t
  })
}
