// A Matrix image follows its booru post, in its rooms too (operator,
// 2026-11-11): "a sensitive image showing up for a moment and then visibly
// popping out of existence with an animation ... Technetium users get the
// room cleaned up altogether."
//
// Holds: only a 404 that says `withheld` pops a picture (a fresh Matrix post
// is closed to every room until its own are known, and a plain 404 for it
// must not pop it for the people it was posted to); the pop runs its course
// before the message leaves; a gone picture leaves no row and its gallery
// closes up with no hole.
import { readFileSync } from 'node:fs'
const { fetchBooruPool, WITHHELD } = await import('../src/client/booruTags.ts')
const { withhold, popPhase, goneMedia, onWithheld, POP_MS } = await import('../src/client/withheldMedia.ts')
const { toItems } = await import('../src/client/useTimeline.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

console.log('\n-- only a withheld 404 pops --')
{
  const answer = (status: number, json: () => Promise<unknown>) =>
    (async () => ({ ok: status < 400, status, json })) as unknown as typeof fetch
  check('a 404 saying withheld is WITHHELD',
    (await fetchBooruPool(7, answer(404, async () => ({ success: false, withheld: true })))) === WITHHELD)
  check('a plain 404 is no post, not a pop',
    (await fetchBooruPool(7, answer(404, async () => ({ success: false, message: 'not found' })))) === null)
  check('withheld must be true, not truthy',
    (await fetchBooruPool(7, answer(404, async () => ({ withheld: 'yes' })))) === null)
  check('an HTML 404 is no post, not a fault',
    (await fetchBooruPool(7, answer(404, async () => { throw new SyntaxError('Unexpected token <') }))) === null)
  let msg = ''
  try {
    await fetchBooruPool(7, answer(403, async () => ({ withheld: true })))
  } catch (e) {
    msg = e instanceof Error ? e.message : String(e)
  }
  check('withheld on any other status is still a fault', msg !== '', msg)
}

console.log('\n-- the pop runs its course, then the picture is gone --')
{
  const timers: { run: () => void; ms: number }[] = []
  const schedule = (run: () => void, ms: number) => timers.push({ run, ms })
  let heard = 0
  const off = onWithheld(() => heard++)
  const before = goneMedia()

  withhold('pic1', schedule)
  check('popping at once', popPhase('pic1') === 'popping', popPhase('pic1'))
  check('not gone while it pops', !goneMedia().has('pic1'))
  check('one timer, for the length of the animation', timers.length === 1 && timers[0].ms === POP_MS, timers)
  withhold('pic1', schedule)
  check('a second answer for the same picture starts nothing', timers.length === 1)
  timers[0].run()
  check('gone after the timer', popPhase('pic1') === 'gone' && goneMedia().has('pic1'))
  check('the gone set is a new object, so it can be a snapshot', goneMedia() !== before && !before.has('pic1'))
  check('listeners heard both changes', heard === 2, heard)
  off()
  withhold('pic2', schedule)
  check('an unsubscribed listener hears nothing', heard === 2, heard)
  check('no phase for a picture never withheld', popPhase('other') === undefined && popPhase(undefined) === undefined)

  const css = readFileSync('src/index.css', 'utf8')
  const ms = [...css.matchAll(/\.tc-pop[^{]*\{[^}]*animation:\s*tc-pop-\w+\s+(\d+)ms/g)].map((m) => Number(m[1]))
  check('every pop animation in index.css lasts POP_MS', ms.length >= 2 && ms.every((n) => n === POP_MS), ms)
  check('the pop is finite (no infinite animation)', !/tc-pop[^}]*infinite/.test(css))
}

console.log('\n-- a gone picture leaves the room --')
{
  const ev = (id: string, content: any): any => ({
    getId: () => id,
    getSender: () => '@a:x.net',
    getTs: () => 1,
    getType: () => 'm.room.message',
    isRedacted: () => false,
    isDecryptionFailure: () => false,
    isBeingDecrypted: () => false,
    isEncrypted: () => false,
    getContent: () => content,
    getOriginalContent: () => content,
  })
  const text = (id: string) => ev(id, { msgtype: 'm.text', body: 'hi' })
  const image = (id: string, gallery?: { index: number; count: number }) => ev(id, {
    msgtype: 'm.image',
    url: `mxc://x.net/${id.slice(1)}`,
    body: `${id}.png`,
    ...(gallery ? { 'net.41chan.gallery': { id: 'g1', ...gallery, layout: 'grid' } } : {}),
  })

  const single = [text('$t1'), image('$p1'), text('$t2')]
  check('shown before it is withheld', toItems(single).map((i) => i.id).join(',') === '$t1,$p1,$t2')
  const gone = toItems(single, { withheld: new Set(['p1']) })
  check('no row once gone', gone.map((i) => i.id).join(',') === '$t1,$t2', gone.map((i) => i.id))
  check('another picture is untouched',
    toItems(single, { withheld: new Set(['zzz']) }).map((i) => i.id).join(',') === '$t1,$p1,$t2')

  const batch = [image('$g0', { index: 0, count: 4 }), image('$g1', { index: 1, count: 4 }),
    image('$g2', { index: 2, count: 4 }), image('$g3', { index: 3, count: 4 })]
  const cellIds = (items: any[]) => (items[0]?.cells ?? []).map((c: any) => c?.getId() ?? '-').join(',')
  check('the whole gallery first', cellIds(toItems(batch)) === '$g0,$g1,$g2,$g3', cellIds(toItems(batch)))
  const mid = toItems(batch, { withheld: new Set(['g1']) })
  check('a middle picture leaves no hole: the gallery closes up',
    mid.length === 1 && mid[0].kind === 'gallery' && cellIds(mid) === '$g0,$g2,$g3', cellIds(mid))
  const first = toItems(batch, { withheld: new Set(['g0']) })
  check('the first picture gone: the rest still one gallery',
    first.length === 1 && first[0].kind === 'gallery' && cellIds(first) === '$g1,$g2,$g3', cellIds(first))
  const two = toItems(batch, { withheld: new Set(['g0', 'g2']) })
  check('two gone: two left, side by side', cellIds(two) === '$g1,$g3', cellIds(two))
  const one = toItems(batch, { withheld: new Set(['g0', 'g1', 'g2']) })
  check('one left: a plain picture, not a gallery of one',
    one.length === 1 && one[0].kind !== 'gallery' && one[0].id === '$g3', one.map((i) => [i.id, i.kind]))
  check('all gone: nothing', toItems(batch, { withheld: new Set(['g0', 'g1', 'g2', 'g3']) }).length === 0)

  // A gallery still arriving keeps its holes for the pictures not yet here.
  const arriving = toItems([image('$g0', { index: 0, count: 4 }), image('$g3', { index: 3, count: 4 })],
    { withheld: new Set(['g0']) })
  check('a picture not yet here is still a hole, after the withheld one closes up',
    cellIds(arriving) === '-,-,$g3', cellIds(arriving))
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
