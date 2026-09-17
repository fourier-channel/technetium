// Links from a tag or a post id to the booru.
//
// ONE PLACE, because the alternative is each surface building its own and them
// disagreeing the first time the host or a path changes. The origin is the same
// one BooruFrame and booruSession already use, read from the same env var, so a
// deployment that repoints the booru repoints every link with it.
//
// The booru is a Danbooru fork: a tag search is /posts?tags=<query> and a
// single post is /posts/<id>. Tags are space-separated in that query, which is
// why the name has to be encoded rather than concatenated -- a tag containing a
// space would silently become two tags and search for the wrong thing.

const BOORU_ORIGIN = (
  (import.meta.env.VITE_BOORU_URL as string | undefined) ?? 'https://booru.41chan.net/'
).replace(/\/+$/, '')

/** Search the booru for one tag. */
export function booruTagUrl(tag: string): string {
  return `${BOORU_ORIGIN}/posts?tags=${encodeURIComponent(tag)}`
}

/** A single post by its booru id. */
export function booruPostUrl(postId: number): string {
  return `${BOORU_ORIGIN}/posts/${postId}`
}

export { BOORU_ORIGIN }
