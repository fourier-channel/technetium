// The tag diff: what a panel draws when a retag arrives.
//
// The store's unit of change is the WHOLE tag set, so without a diff a retag
// is a silent swap -- indistinguishable from having missed it. These assert the
// three things that make the animation honest: an arriving tag is marked
// arriving, a departing tag stays on screen long enough to be seen going, and
// it departs from the slot it actually occupied rather than from the end.
import { withGhosts, tagKey, POP_OUT_MS } from '../src/client/useTagDiff'
import type { MediaTag } from '../src/client/mediaTags'
import { readFileSync } from 'node:fs'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const t = (name: string, category: MediaTag['category'] = 'general'): MediaTag => ({ name, category })
const names = (l: { tag: MediaTag; phase: string }[]) => l.map((d) => `${d.tag.name}:${d.phase}`).join(' ')

console.log('== an unchanged set is entirely steady')
{
  const tags = [t('a'), t('b')]
  const out = withGhosts(tags, tags, new Set(), [])
  check('no phase other than steady', out.every((d) => d.phase === 'steady'), names(out))
  check('and the order is untouched', names(out) === 'a:steady b:steady', names(out))
}

console.log('== an arriving tag is marked arriving')
{
  const before = [t('a')]
  const after = [t('a'), t('b')]
  const out = withGhosts(after, before, new Set([tagKey(t('b'))]), [])
  check('the new tag enters', out.find((d) => d.tag.name === 'b')?.phase === 'entering', names(out))
  check('the existing tag does NOT enter', out.find((d) => d.tag.name === 'a')?.phase === 'steady')
}

console.log('== a departing tag is still drawn, in its old slot')
{
  // 'b' was in the MIDDLE. Appending its ghost at the end would make 'c' slide
  // left and then back, which is the shudder this exists to avoid.
  const before = [t('a'), t('b'), t('c')]
  const after = [t('a'), t('c')]
  const out = withGhosts(after, before, new Set(), [t('b')])
  check('the ghost is present', out.some((d) => d.tag.name === 'b' && d.phase === 'leaving'), names(out))
  check('and sits where it used to, between a and c', names(out) === 'a:steady b:leaving c:steady', names(out))
  check('nothing else changed phase',
    out.filter((d) => d.phase === 'steady').map((d) => d.tag.name).join(',') === 'a,c', names(out))
}

console.log('== a tag removed from the end still leaves from the end')
{
  const before = [t('a'), t('b')]
  const after = [t('a')]
  const out = withGhosts(after, before, new Set(), [t('b')])
  check('order holds', names(out) === 'a:steady b:leaving', names(out))
}

console.log('== an add and a remove in one update')
{
  const before = [t('a'), t('b')]
  const after = [t('a'), t('c')]
  const out = withGhosts(after, before, new Set([tagKey(t('c'))]), [t('b')])
  check('both phases appear', /b:leaving/.test(names(out)) && /c:entering/.test(names(out)), names(out))
  check("and the ghost holds b's old index", names(out) === 'a:steady b:leaving c:entering', names(out))
}

console.log('== a tag never appears twice')
{
  // A tag that comes BACK while its ghost is alive must not be drawn as both.
  const before = [t('a'), t('b')]
  const after = [t('a'), t('b')]
  const out = withGhosts(after, before, new Set(), [])
  const seen = new Set(out.map((d) => tagKey(d.tag)))
  check('no duplicate keys', seen.size === out.length, names(out))
}

console.log('== the key distinguishes a recategorisation')
{
  check('same name, different category, different key',
    tagKey(t('miku', 'general')) !== tagKey(t('miku', 'character')))
  const before = [t('miku', 'general')]
  const after = [t('miku', 'character')]
  const out = withGhosts(after, before, new Set([tagKey(t('miku', 'character'))]), [t('miku', 'general')])
  check('a recategorised tag reads as one leaving and one arriving',
    out.length === 2 && out.some((d) => d.phase === 'leaving') && out.some((d) => d.phase === 'entering'),
    names(out))
}

console.log('== the exit duration is shared with the stylesheet')
{
  const css = readFileSync('src/formant-tokens.css', 'utf8')
  const m = /--mod-tag-pop-out-dur:\s*(\d+)ms/.exec(css)
  check('formant declares the exit duration', m !== null)
  check(`and POP_OUT_MS (${POP_OUT_MS}) matches it (${m?.[1]})`,
    m !== null && Number(m[1]) === POP_OUT_MS,
    'if these drift the ghost is unmounted mid-animation or lingers after it')
}

if (failures > 0) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
