// The live-read policy, and the merge that lets the booru win.
//
// These two are the whole cost model of reading tags live, which is why they
// are pure functions with a clock passed in rather than an effect. The failure
// this guards is not visual: it is a request storm. A refresh rule that reacted
// to every state event would have turned one measured bridge backfill -- 718
// tag events in a single batch -- into 718 booru reads, and nothing on screen
// would have looked wrong while it happened.
import {
  BOORU_TTL_MS,
  asRating,
  mayRead,
  mergeBooruIntoSet,
  newBooruReadState,
  normaliseTagName,
  optimisticSet,
  parseTagInput,
} from '../src/client/booruLive'
import type { BooruTagSet } from '../src/client/booruTags'
import type { MediaTagSet } from '../src/client/mediaTags'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const T0 = 1_700_000_000_000

console.log('== the rating narrows, it is not trusted')
check('a real rating passes', asRating('q') === 'q')
check('every letter the booru uses passes',
  ['g', 's', 'q', 'e'].every((r) => asRating(r) === r))
check('a word is not a rating', asRating('explicit') === undefined)
check('empty is not a rating', asRating('') === undefined)
check('absent stays absent', asRating(undefined) === undefined)

console.log('== a post is not read twice at once')
{
  const s = newBooruReadState()
  check('a post never read may be read', mayRead(s, 12, T0))
  s.inFlight.add(12)
  check('the same post may not be read again while in flight', !mayRead(s, 12, T0))
  check('a DIFFERENT post still may', mayRead(s, 13, T0))
  check('force does not override in-flight -- that would be two reads at once',
    !mayRead(s, 12, T0, true))
  s.inFlight.delete(12)
  check('and it is readable once the read lands', mayRead(s, 12, T0))
}

console.log('== a post is not re-read inside the TTL')
{
  const s = newBooruReadState()
  s.askedAt.set(7, T0)
  check('immediately after: refused', !mayRead(s, 7, T0))
  check('one ms before the TTL: refused', !mayRead(s, 7, T0 + BOORU_TTL_MS - 1))
  check('exactly at the TTL: allowed', mayRead(s, 7, T0 + BOORU_TTL_MS))
  check('long after: allowed', mayRead(s, 7, T0 + BOORU_TTL_MS * 100))
  check('force ignores the clock, because a state push means it really changed',
    mayRead(s, 7, T0, true))
}

console.log('== scrolling past forty pictures is forty reads, not more')
{
  // The shape that matters: one panel per image, each re-rendering repeatedly
  // as the timeline settles. Only the FIRST render of each may reach the booru.
  const s = newBooruReadState()
  let reads = 0
  for (let render = 0; render < 8; render += 1) {
    for (let postId = 1; postId <= 40; postId += 1) {
      if (mayRead(s, postId, T0 + render)) {
        reads += 1
        s.askedAt.set(postId, T0 + render)
      }
    }
  }
  check('320 renders of 40 images cost 40 reads', reads === 40, reads)
}

console.log('== a bridge backfill does not become a request storm')
{
  // Every event forces, because a push means the tags really changed -- so the
  // ONLY thing holding the count down is the caller refusing to react for an
  // image nothing is rendering. That bound is asserted here as arithmetic; the
  // store applies it as `listeners.has(mediaId)`.
  const mounted = new Set([3, 9])
  const s = newBooruReadState()
  let reads = 0
  for (let i = 0; i < 718; i += 1) {
    const postId = (i % 200) + 1
    if (!mounted.has(postId)) continue
    if (mayRead(s, postId, T0 + i, true)) {
      reads += 1
      s.inFlight.add(postId)
    }
  }
  check('718 pushed events reach the booru only for what is on screen',
    reads === mounted.size, reads)
}

console.log('== the merge keeps the pointer and replaces the copy')
const prev: MediaTagSet = {
  mediaId: 'auARXabc',
  tags: [
    { name: 'stale_tag', category: 'general' },
    { name: 'also_stale', category: 'general' },
  ],
  source: 'https://example.invalid/post/1',
  postId: 4,
  rating: 'e',
  updatedBy: '@tunnel:41chan.net',
  ts: T0,
}
const live: BooruTagSet = {
  postId: 4,
  tags: [
    { name: 'fresh_tag', category: 'general' },
    { name: 'someone', category: 'character' },
  ],
  rating: 'q',
  tagString: 'fresh_tag someone',
}
{
  const merged = mergeBooruIntoSet(prev, live, T0 + 5000)
  check('the media id survives', merged.mediaId === 'auARXabc')
  check('the post id survives -- it is the pointer', merged.postId === 4)
  check('the source survives', merged.source === prev.source)
  check('updatedBy survives', merged.updatedBy === '@tunnel:41chan.net')
  check('the tags are the booru\'s', merged.tags.map((t) => t.name).join(' ') === 'fresh_tag someone',
    merged.tags)
  check('categories come through', merged.tags[1]?.category === 'character')
  check('the rating is the booru\'s', merged.rating === 'q')
  check('the tag string is recorded, so an edit can be a delta',
    merged.tagString === 'fresh_tag someone')
  check('the clock is the caller\'s', merged.ts === T0 + 5000)
  check('the input is not mutated', prev.tags[0].name === 'stale_tag')
}

console.log('== a detagging is a real result, not a missing one')
{
  // The one that is easy to get wrong: treating an empty live set as "no
  // answer" and keeping the old tags means removing a tag on the booru never
  // shows here, and the panel disagrees with the booru permanently.
  const merged = mergeBooruIntoSet(prev, { postId: 4, tags: [], tagString: '' }, T0 + 1)
  check('every tag removed on the booru is every tag removed here',
    merged.tags.length === 0, merged.tags)
  check('and the empty tag string is recorded', merged.tagString === '')
  check('the pointer still survives', merged.postId === 4)
}

console.log('== a missing rating does not erase the one we had')
{
  const merged = mergeBooruIntoSet(prev, { postId: 4, tags: [], tagString: '' }, T0 + 1)
  check('rating falls back to what Matrix reported', merged.rating === 'e')
  const bogus = mergeBooruIntoSet(prev, { postId: 4, tags: [], rating: 'banana', tagString: '' }, T0 + 1)
  check('a rating the booru does not use falls back too', bogus.rating === 'e')
}

console.log('== the merged set wins in the store, which settles on ts')
{
  // ingestSet refuses a write older than the one it holds. A live read stamped
  // with the current time must therefore beat the state event it corrects --
  // otherwise the correction is silently dropped and the panel never updates.
  const merged = mergeBooruIntoSet(prev, live, T0 + 1)
  check('the live read is newer than the state event it replaces', merged.ts > prev.ts)
}

console.log('== a typed tag is normalised to what the booru will store')
check('a plain tag is unchanged', normaliseTagName('outdoors') === 'outdoors')
check('capitals are lowered', normaliseTagName('Blue Sky') === 'blue_sky')
check('spaces become underscores', normaliseTagName('long hair') === 'long_hair')
check('runs of whitespace collapse', normaliseTagName('a   b') === 'a_b')
check('surrounding space is dropped', normaliseTagName('  tagme  ') === 'tagme')
check('leading and trailing underscores go', normaliseTagName('__x__') === 'x')
check('nothing typed is nothing', normaliseTagName('   ') === '')
check('punctuation the booru uses survives', normaliseTagName('re:zero') === 're:zero')

console.log('== a typed LINE is a list, because people paste lists')
check('one tag', parseTagInput('outdoors').join('|') === 'outdoors')
check('spaces separate', parseTagInput('a b c').join('|') === 'a|b|c')
check('commas separate too', parseTagInput('a, b,c').join('|') === 'a|b|c')
check('and the parts are still normalised',
  parseTagInput('Blue Sky').join('|') === 'blue|sky')
check('a repeat is sent once', parseTagInput('a b a').join('|') === 'a|b')
check('an empty line is no tags', parseTagInput('   ').length === 0)

console.log('== the optimistic set moves before the request does')
{
  const now = T0 + 9
  const added = optimisticSet(prev, { add: ['fresh'] }, now)
  check('the tag is there at once', added.tags.some((t) => t.name === 'fresh'))
  check('guessed general until the booru says otherwise',
    added.tags.find((t) => t.name === 'fresh')?.category === 'general')
  check('the old tags are still there', added.tags.length === prev.tags.length + 1)
  check('the clock moves, so the store accepts it', added.ts === now)
  check('the input is not mutated', prev.tags.length === 2)

  const removed = optimisticSet(prev, { remove: ['stale_tag'] }, now)
  check('a removed tag is gone at once',
    !removed.tags.some((t) => t.name === 'stale_tag'))
  check('and its neighbour stays', removed.tags.some((t) => t.name === 'also_stale'))

  const both = optimisticSet(prev, { add: ['fresh'], remove: ['stale_tag'] }, now)
  check('add and remove in one edit',
    both.tags.map((t) => t.name).join('|') === 'also_stale|fresh', both.tags)

  const dupe = optimisticSet(prev, { add: ['stale_tag'] }, now)
  check('adding a tag already there changes nothing',
    dupe.tags.length === prev.tags.length, dupe.tags)

  check('the pointer survives an optimistic edit', added.postId === 4)
}

console.log('== the optimistic guess never becomes what we claim the server said')
{
  // tagString is the ONLY input to old_tag_string. If a guess were written into
  // it, a second edit made before the first reply landed would compute its delta
  // against a string the server never agreed to, and the two edits would fight.
  const seen = mergeBooruIntoSet(prev, live, T0 + 1)
  check('a live read sets it', seen.tagString === 'fresh_tag someone')
  const guessed = optimisticSet(seen, { add: ['not_yet'] }, T0 + 2)
  check('an optimistic edit leaves it exactly as the server left it',
    guessed.tagString === 'fresh_tag someone', guessed.tagString)
  check('even though the drawn tags already include the guess',
    guessed.tags.some((t) => t.name === 'not_yet'))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
