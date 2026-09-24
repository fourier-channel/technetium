// Checks for which tags ride in the line under an image (launch-polish L5).
//
// Operator, 2026-09-24: "ALWAYS show the creator tag and show character tag
// whenever it's present. The rest of the tags should be hidden with the
// 'expose tags' button." The creator tag is the ARTIST-category tag; the
// provenance bucket called 'creator' means private prompt tags and must never
// be what decides this.
import { splitForBubble, BUBBLE_CATEGORIES } from '../src/client/tagBubble.ts'
import { sortTags, type MediaTag, type TagCategory } from '../src/client/mediaTags.ts'
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const t = (name: string, category: TagCategory, provenance?: MediaTag['provenance']): MediaTag =>
  ({ name, category, ...(provenance ? { provenance } : {}) }) as MediaTag
const names = (xs: MediaTag[]) => xs.map((x) => x.name).join(',')
const split = (xs: MediaTag[]) => splitForBubble(xs, (x) => x.category)

console.log('\n-- the creator (artist) tag always rides in the line --')
{
  const tags = sortTags([t('solo', 'general'), t('saber', 'artist'), t('1girl', 'general')])
  const s = split(tags)
  check('artist is in the line', names(s.always) === 'saber', names(s.always))
  check('everything else is folded', names(s.folded) === '1girl,solo', names(s.folded))
}

console.log('\n-- character rides whenever it is present, after the creator --')
{
  const tags = sortTags([t('rin', 'character'), t('saber', 'artist'), t('sky', 'general'), t('aoi', 'character')])
  const s = split(tags)
  check('creator first, then every character', names(s.always) === 'saber,aoi,rin', names(s.always))
  const noChar = split(sortTags([t('saber', 'artist'), t('sky', 'general')]))
  check('no character, no character slot', names(noChar.always) === 'saber', names(noChar.always))
  // Whatever order they arrive in, the creator leads.
  const shuffled = split([t('rin', 'character'), t('saber', 'artist')])
  check('the creator leads even from an unsorted list', names(shuffled.always) === 'saber,rin', names(shuffled.always))
}

console.log('\n-- copyright, meta and general are folded (the operator named two) --')
{
  const s = split(sortTags([t('fate', 'copyright'), t('highres', 'meta'), t('sky', 'general')]))
  check('nothing in the line', s.always.length === 0, names(s.always))
  check('all three behind the control', s.folded.length === 3, names(s.folded))
  check('the categories in the line are exactly artist and character',
    BUBBLE_CATEGORIES.join() === 'artist,character', BUBBLE_CATEGORIES)
}

console.log('\n-- provenance never decides it --')
{
  // A private prompt tag (provenance 'creator') is not the creator tag.
  const s = split([t('masterpiece', 'general', 'creator'), t('saber', 'artist', 'auto')])
  check('a provenance-creator general tag stays folded', names(s.folded) === 'masterpiece', names(s.folded))
  check('an auto-sourced artist tag is still the creator tag', names(s.always) === 'saber', names(s.always))
}

console.log('\n-- before the live read: Matrix copy only, everything general --')
{
  const s = split(sortTags([t('a', 'general'), t('b', 'general')]))
  check('the line holds only the control', s.always.length === 0 && s.folded.length === 2)
  const e = split([])
  check('an empty set splits into nothing', e.always.length === 0 && e.folded.length === 0)
}

console.log('\n-- nothing is lost or doubled --')
{
  const all = sortTags([t('saber', 'artist'), t('rin', 'character'), t('fate', 'copyright'), t('sky', 'general'), t('hi', 'meta')])
  const s = split(all)
  const back = [...s.always, ...s.folded].map((x) => x.name).sort().join()
  check('always + folded is the whole set, once each', back === all.map((x) => x.name).sort().join(), back)
}

console.log('\n-- the component wires it the way the rule says --')
{
  const src = readFileSync('src/ui/MediaTags.tsx', 'utf8')
  check('the line splits the DIFFED list once (a recategorised tag moves as one change)',
    /const diffed = useTagDiff\(tags\)\s*\n\s*const \{ always, folded \} = splitForBubble\(diffed/.test(src))
  check('the live read is triggered from the line when it comes on screen',
    /if \(onScreen && mediaId\) refreshBooruTags\(mediaId\)/.test(src))
  check('a chip reads live tags when its popup opens',
    /if \(open && mediaId\) refreshBooruTags\(mediaId\)/.test(src))
  check('the full list is a portal popup, not a panel inside the row', /<AnchoredPopup/.test(src))
  check('no layout effect writes a margin to reserve room any more',
    !/style\.marginRight/.test(src) && !/scrollWidth/.test(src))
  check('the control is labelled as the operator named it', /expose tags/.test(src))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
