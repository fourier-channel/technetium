// formant: the tag-edit grammar. Canon, hydrated -- do not edit a delivered copy.
//
// ONE DEFINITION OF WHAT AN EDIT MEANS, for every surface that edits booru
// tags. Technetium's media panel and the booru's own Modulation page are two
// chromes over one behaviour, and the operator's requirement is that the
// experience be identical across them (2026-09-20: "a pool of objects instead
// of a rendered page, so the tag-editing experience is identical across
// surfaces").
//
// WHAT LIVES HERE: the pure parts. How a typed line becomes tag names, what an
// edit does to a tag string, which edits must be refused and in what words,
// and what fields a write puts on the wire. No DOM, no fetch, no framework --
// so a check can drive all of it, and so neither surface has to learn the
// other's build.
//
// WHAT DOES NOT: rendering, requests, and session handling. Those are each
// surface's own, in its own idiom. The behaviour is identical because both
// call the same endpoint with the same semantics, not because they share a
// widget -- one widget would mean a build artifact inside the booru's inline
// script and a React wrapper on the other side, paid for chrome that formant
// tokens already make pixel-identical.
//
// THE DRIFT THIS PREVENTS is not cosmetic. "Remove a tag that is not there"
// and "an edit that changes nothing" are the two cases that already cost a
// day: both were silent, and removals appeared to work on one surface while
// doing nothing on the booru. A second copy of that logic is where they would
// start disagreeing again.

/**
 * A tag name as the booru stores it: lowercase, underscores, no edge runs.
 *
 * Danbooru downcases and turns whitespace into underscores, so "Blue Sky" and
 * "blue_sky" are ONE tag there. Doing it on this side rather than letting the
 * server do it silently is what makes an optimistic pill match the one that
 * comes back: otherwise "Blue Sky" pops in, the server answers "blue_sky", and
 * the next diff reads that as one tag leaving and a different one arriving --
 * a visible flicker on every edit that used a capital letter.
 *
 * Returns '' for anything that is not a tag once normalised; the caller must
 * treat that as "nothing was typed" rather than sending it.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseTagName(raw) {
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/^[_]+|[_]+$/g, '')
}

/**
 * Split a typed line into tag names. People paste space- and comma-separated
 * lists, and they paste the same tag twice.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parseTagInput(raw) {
  /** @type {string[]} */
  const out = []
  for (const part of String(raw).split(/[\s,]+/)) {
    const name = normaliseTagName(part)
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/**
 * The names in a tag string, in the order the server gave them.
 *
 * @param {string} tagString
 * @returns {string[]}
 */
export function tagNames(tagString) {
  return String(tagString || '').split(/\s+/).filter(Boolean)
}

/**
 * @typedef {{ add?: readonly string[], remove?: readonly string[] }} TagEdit
 */

/**
 * The tag string this edit produces. Removals first, then additions, so
 * removing and re-adding the same name in one edit keeps it.
 *
 * @param {string} tagString what the server last said
 * @param {TagEdit} edit
 * @returns {string}
 */
export function applyEdit(tagString, edit) {
  const names = new Set(tagNames(tagString))
  for (const t of edit.remove || []) names.delete(t)
  for (const t of edit.add || []) names.add(t)
  return [...names].join(' ')
}

/**
 * The names a surface should show AT ONCE, before the server has answered, so
 * a pill moves under the finger rather than after a round trip. Name-level
 * only: each surface maps this back onto its own objects, and an added name
 * has no category until the server names one.
 *
 * @param {readonly string[]} names
 * @param {TagEdit} edit
 * @returns {string[]}
 */
export function nextNames(names, edit) {
  const removed = new Set(edit.remove || [])
  const out = names.filter((n) => !removed.has(n))
  const have = new Set(out)
  for (const name of edit.add || []) {
    if (!have.has(name)) {
      out.push(name)
      have.add(name)
    }
  }
  return out
}

/**
 * Why this edit must not be sent, in words that name the fix -- or null when
 * it may go.
 *
 * BOTH REFUSALS WERE SILENT FAILURES FIRST, which is why they are refusals and
 * not filters. An add always introduces a token the server string lacks, so it
 * always produced a different string and always went out; a remove whose tag
 * is absent produced an IDENTICAL string, sent nothing, and left the optimistic
 * update showing a pill already taken off screen. It came back on the next read
 * with no error anywhere, and "removals do not reach the booru" is what that
 * looked like from outside.
 *
 * The mismatch itself is the thing worth reporting: it means the surface is
 * drawing a tag the booru does not have under that name -- an alias applied
 * since the last read, a rename, or a stale set.
 *
 * @param {number} postId
 * @param {string} tagString what the server last said
 * @param {TagEdit} edit
 * @returns {string | null}
 */
export function refuseEdit(postId, tagString, edit) {
  const seen = new Set(tagNames(tagString))
  const absent = (edit.remove || []).filter((t) => !seen.has(t))
  if (absent.length > 0) {
    return (
      'the booru\'s copy of post ' + postId + ' does not contain ' +
      absent.map((t) => '"' + t + '"').join(', ') +
      ', so there is nothing to remove. It currently holds: ' +
      ([...seen].join(' ') || '(no tags)') + '. ' +
      'Fix: the panel is showing a tag the booru knows by another name -- ' +
      'usually an alias applied after this client last read the post. ' +
      'Force a fresh read and try again.'
    )
  }
  if (applyEdit(tagString, edit) === tagString) {
    return (
      'that edit would change nothing on post ' + postId + '. ' +
      'Fix: the tag is already in the state you asked for; nothing was sent.'
    )
  }
  return null
}

/**
 * The form fields a tag write puts on the wire.
 *
 * KEPT A CORS-SIMPLE REQUEST ON PURPOSE. POST with _method=put and a urlencoded
 * body uses only safelisted headers, so it never triggers a preflight -- and a
 * preflight carries no cookies, which the booru's anti-crawl backstop answers
 * with a 403. The CSRF token rides in the BODY for the same reason: a header
 * would make the request non-simple.
 *
 * BOTH STRINGS GO. old_tag_string is what this client saw; tag_string is that
 * plus the delta. The booru applies only the difference to whatever the post
 * holds right now, so a concurrent edit by someone else survives.
 *
 * @param {string} tagString what the server last said
 * @param {TagEdit} edit
 * @param {string | null} csrf
 * @returns {Record<string, string>}
 */
export function editFields(tagString, edit, csrf) {
  /** @type {Record<string, string>} */
  const fields = { _method: 'put' }
  if (csrf) fields.authenticity_token = csrf
  fields['post[old_tag_string]'] = tagString
  fields['post[tag_string]'] = applyEdit(tagString, edit)
  return fields
}
