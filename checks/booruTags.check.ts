// Tags read from and written to the booru.
//
// The parse is checked against a REAL response captured from production, not an
// invented one -- a fixture I made up would only prove I can parse my own
// invention. The edit arithmetic is checked because it is what makes a write a
// delta rather than a replacement, and a replacement is how two people editing
// one post lose each other's work.
import { parsePostTags, applyEdit } from '../src/client/booruTags'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// Captured verbatim from http://127.0.0.1:3000/posts/4.json?only=... on
// 2026-09-17. 157 bytes, which is the whole argument for reading live.
const REAL = {
  id: 4,
  rating: 'q',
  tag_string_artist: '',
  tag_string_character: '',
  tag_string_copyright: '',
  tag_string_general: 'non-web_source tagme',
  tag_string_meta: '',
}

console.log('== a real production response')
{
  const set = parsePostTags(REAL)
  check('it parses', set !== null)
  check('post id survives', set?.postId === 4)
  check('rating survives', set?.rating === 'q')
  check('both general tags found', set?.tags.length === 2, set?.tags)
  check('and they are categorised general',
    set?.tags.every((t) => t.category === 'general') === true, set?.tags)
  check('empty category strings contribute nothing',
    set?.tags.some((t) => t.name === '') === false)
  check('tagString is rebuilt when absent', set?.tagString === 'non-web_source tagme', set?.tagString)
}

console.log('== categories are kept apart')
{
  const set = parsePostTags({
    id: 9,
    tag_string: 'aaa bbb ccc ddd eee',
    tag_string_artist: 'aaa',
    tag_string_character: 'bbb',
    tag_string_copyright: 'ccc',
    tag_string_general: 'ddd',
    tag_string_meta: 'eee',
  })
  const byName = new Map(set?.tags.map((t) => [t.name, t.category]))
  check('artist', byName.get('aaa') === 'artist')
  check('character', byName.get('bbb') === 'character')
  check('copyright', byName.get('ccc') === 'copyright')
  check('general', byName.get('ddd') === 'general')
  check('meta', byName.get('eee') === 'meta')
  check('the server tag_string is preferred over a rebuild',
    set?.tagString === 'aaa bbb ccc ddd eee', set?.tagString)
}

console.log('== a malformed response is refused, not half-parsed')
{
  check('no id -> null', parsePostTags({ rating: 'q' }) === null)
  check('id of the wrong type -> null', parsePostTags({ id: 'four' } as unknown as { id?: number }) === null)
}

console.log('== the edit is a DELTA against what this client saw')
{
  check('adding appends', applyEdit('a b', { add: ['c'] }) === 'a b c', applyEdit('a b', { add: ['c'] }))
  check('removing drops', applyEdit('a b c', { remove: ['b'] }) === 'a c', applyEdit('a b c', { remove: ['b'] }))
  check('add and remove together',
    applyEdit('a b', { add: ['c'], remove: ['a'] }) === 'b c', applyEdit('a b', { add: ['c'], remove: ['a'] }))
  check('adding a tag already present changes nothing',
    applyEdit('a b', { add: ['a'] }) === 'a b', applyEdit('a b', { add: ['a'] }))
  check('removing a tag not present changes nothing',
    applyEdit('a b', { remove: ['z'] }) === 'a b')
  check('no duplicates are ever produced',
    applyEdit('a a b', { add: ['a'] }).split(' ').length === 2, applyEdit('a a b', { add: ['a'] }))
  check('an empty edit is a no-op', applyEdit('a b', {}) === 'a b')
  check('whitespace runs do not create empty tags',
    applyEdit('a   b', { add: ['c'] }) === 'a b c', applyEdit('a   b', { add: ['c'] }))
}

if (failures > 0) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
