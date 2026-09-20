// WHO put the tag there -- the second axis.
//
// The bug this closes: technetium coloured pills by CATEGORY while the
// booru's own post page colours them by PROVENANCE, so a general tag was a
// blue pill here and an orange one there. Both were "correct" against their
// own token and the two disagreed, which is exactly the two-axis confusion
// canon warns about.
//
// The parse is checked against chanbooru's REAL bucket names, taken from
// FourierTagSource.buckets_for -- creator/auto/both/meta/pending -- plus the
// `unsourced` key for_viewer merges in.
import { parseProvenance, withProvenance } from '../src/client/booruTags'
import type { MediaTag } from '../src/client/mediaTags'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// The shape for_viewer actually renders.
const REAL = {
  creator: ['pearlyka', 'cosmic_eyes'],
  auto: ['barefoot', 'bed', 'curtains'],
  both: ['1girl'],
  meta: ['ai-generated', 'non-web_source'],
  pending: ['loli'],
  unsourced: ['window'],
}

console.log('== every chanbooru bucket is understood')
{
  const m = parseProvenance(REAL)
  check('creator', m.get('pearlyka') === 'creator')
  check('auto', m.get('barefoot') === 'auto')
  check('both', m.get('1girl') === 'both')
  check('meta', m.get('ai-generated') === 'meta')
  check('pending', m.get('loli') === 'pending')
  check('unsourced', m.get('window') === 'unsourced')
  check('nothing else is invented', m.size === 10, m.size)
}

console.log('== a post with no sidecar rows is an answer, not a crash')
{
  check('empty object', parseProvenance({}).size === 0)
  check('null', parseProvenance(null).size === 0)
  check('a string', parseProvenance('nope').size === 0)
  check('a bucket that is not a list', parseProvenance({ creator: 'x' }).size === 0)
  check('a non-string entry is skipped',
    parseProvenance({ creator: [1, 'ok'] }).get('ok') === 'creator')
}

console.log('== a tag in two buckets takes the first, and does not flicker')
{
  // `both` is its own bucket, so an overlap is a server-side fault. Taking
  // the first keeps one bad row from recolouring a tag differently on every
  // render depending on key order.
  const m = parseProvenance({ creator: ['x'], auto: ['x'] })
  check('first bucket wins', m.get('x') === 'creator')
  check('and only once', m.size === 1)
}

console.log('== provenance attaches without disturbing the category')
{
  const tags: MediaTag[] = [
    { name: 'pearlyka', category: 'character' },
    { name: 'barefoot', category: 'general' },
    { name: 'untouched', category: 'meta' },
  ]
  const out = withProvenance(tags, parseProvenance(REAL))
  check('the creator tag is marked', out[0].provenance === 'creator')
  check('and keeps its CATEGORY', out[0].category === 'character',
    'the two axes must not borrow each other')
  check('the auto tag is marked', out[1].provenance === 'auto')
  check('a tag with no row is left alone', out[2].provenance === undefined)
  check('the input is not mutated', tags[0].provenance === undefined)
}

console.log('== no provenance at all changes nothing')
{
  const tags: MediaTag[] = [{ name: 'a', category: 'general' }]
  const out = withProvenance(tags, new Map())
  check('the same array comes back', out === tags,
    'an empty read must not cost a re-render of every pill')
}

console.log('== the identity-gated endpoint is the one used')
{
  const seen: string[] = []
  const impl = (async (url: unknown) => {
    seen.push(String(url))
    return { ok: true, status: 200, json: async () => REAL } as unknown as Response
  }) as unknown as typeof fetch
  const m = await import('../src/client/booruTags')
  await m.fetchBooruProvenance(7, impl)
  check('it asks for the post it was given', /\/posts\/7\/tag_sources\.json$/.test(seen[0]), seen[0])
  check('and NOT with scope=public -- that is the bot view and it leaks nothing to us',
    !seen[0].includes('scope=public'), seen[0])
}

console.log('== a refused provenance read is a fault, a 404 is not')
{
  const m = await import('../src/client/booruTags')
  const code = (n: number) => (async () => ({
    ok: n < 400, status: n, json: async () => ({}),
  })) as unknown as typeof fetch
  check('404 is an empty answer', (await m.fetchBooruProvenance(7, code(404)))?.size === 0)
  let msg = ''
  try {
    await m.fetchBooruProvenance(7, code(403))
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e)
  }
  check('403 throws', msg !== '')
  check('and names the remedy', /ensureBooruSession/.test(msg), msg)
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
