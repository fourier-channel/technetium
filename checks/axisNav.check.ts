// Checks for the formant axis-navigation grammar.
//
// The rule the estate agreed on: horizontal moves along the sequence you are
// browsing, vertical addresses the other dimension of the thing under the
// cursor. Four implementations existed before it was written down and all four
// disagreed about the SAME two details -- whether a key pressed while typing
// belongs to the field, and which axis is allowed to swallow the browser's
// default. Those two are what axisFromKey exists to settle, so they are what
// this checks; the rest guards the vertical walk's arithmetic at the stop
// boundaries, which is the part a human tester scrolls straight past.
import { axisFromKey, isTypingTarget, HORIZONTAL, BOTH } from '../src/ui/axisKeys.ts'
import {
  buildMediaSequence,
  flatIndex,
  stepImage,
  totalImages,
} from '../src/ui/mediaSequence.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// A key event with just the surface axisFromKey reads, plus a record of whether
// the default was suppressed.
function key(k: string, target: { tag?: string } = {}): any {
  let defaulted = true
  return {
    key: k,
    target: {
      // Stands in for Element.closest: the guard's real question is "is this
      // inside something a person types into".
      closest: (sel: string) =>
        target.tag && sel.includes(target.tag) ? { tag: target.tag } : null,
    },
    preventDefault: () => { defaulted = false },
    get defaultAllowed() { return defaulted },
  }
}

console.log('\n-- a key pressed while typing belongs to the field --')
{
  for (const tag of ['input', 'textarea', 'select', '[contenteditable]']) {
    const e = key('ArrowRight', { tag })
    check(`${tag}: no axis move`, axisFromKey(e, BOTH) === null)
    check(`${tag}: the default survives`, e.defaultAllowed)
  }
  check('a plain target is not a typing target', !isTypingTarget(key('ArrowRight').target))
  // The vertical is the dangerous one: it is the axis that calls
  // preventDefault, so a missing guard steals the cursor keys inside a composer.
  const inField = key('ArrowDown', { tag: 'textarea' })
  check('typing keeps the vertical default too', axisFromKey(inField, BOTH) === null && inField.defaultAllowed)
}

console.log('\n-- vertical suppresses the default, horizontal does not --')
{
  const right = key('ArrowRight')
  check('right maps to next', axisFromKey(right, BOTH) === 'next')
  check('right leaves the default alone', right.defaultAllowed)

  const left = key('ArrowLeft')
  check('left maps to prev', axisFromKey(left, BOTH) === 'prev')
  check('left leaves the default alone', left.defaultAllowed)

  const down = key('ArrowDown')
  check('down maps to down', axisFromKey(down, BOTH) === 'down')
  check('down suppresses the scroll', !down.defaultAllowed)

  const up = key('ArrowUp')
  check('up maps to up', axisFromKey(up, BOTH) === 'up')
  check('up suppresses the scroll', !up.defaultAllowed)
}

console.log('\n-- a surface only consumes the axes it can perform --')
{
  // The bug this exists to prevent, and which the first draft of axisKeys.ts
  // shipped: a list with no vertical axis suppressing up/down anyway, so the
  // page stopped scrolling and nothing happened in its place.
  const down = key('ArrowDown')
  check('an unhandled axis yields nothing', axisFromKey(down, HORIZONTAL) === null)
  check('...and its default is untouched', down.defaultAllowed)

  const other = key('Home')
  check('a key outside the grammar is not claimed', axisFromKey(other, BOTH) === null)
  check('...so another handler still sees it', other.defaultAllowed)
}

console.log('\n-- the sequence is built from what was rendered --')
{
  const ev = (id: string, url: string, room = '!r:x.net'): any => ({
    getId: () => id,
    getRoomId: () => room,
    getContent: () => ({ msgtype: 'm.image', url, body: id + '.png', info: { mimetype: 'image/png' } }),
  })
  const img = (id: string, url: string): any => ({
    id, kind: 'message', event: ev(id, url), content: { msgtype: 'm.image', url },
  })
  const text = (id: string): any => ({
    id, kind: 'message', event: ev(id, ''), content: { msgtype: 'm.text', body: 'hi' },
  })
  const gallery = (id: string, urls: (string | null)[]): any => ({
    id, kind: 'gallery',
    event: ev(id, ''),
    content: {},
    cells: urls.map((u, i) => (u ? ev(id + ':' + i, u) : null)),
  })

  const seq = buildMediaSequence([
    text('$t1'),
    img('$a', 'mxc://x.net/a'),
    text('$t2'),
    gallery('$g', ['mxc://x.net/b', null, 'mxc://x.net/c']),
    img('$z', 'not-an-mxc'),
    img('$d', 'mxc://x.net/d'),
  ])

  check('one stop per image-bearing message', seq.stops.length === 3, seq.stops.length)
  check('a gallery batch is one stop', seq.stops[1].length === 2, seq.stops[1])
  check('a missing gallery cell is not a stop position',
    seq.stops[1].every((i) => !!i), seq.stops[1])
  check('a message with no usable mxc is skipped', seq.stopOf.get('$z') === undefined)
  check('text does not occupy a stop', seq.stopOf.get('$t1') === undefined)
  check('rows find their own stop', seq.stopOf.get('$a') === 0 && seq.stopOf.get('$g') === 1 && seq.stopOf.get('$d') === 2)
  // An empty stop would be a position the reader can never occupy, so the walk
  // would count a picture that is not there.
  check('no stop is empty', seq.stops.every((s) => s.length > 0))
  // Without this an encrypted room's images open to a broken viewer: the
  // server cannot resolve which room an mxc came from.
  check('every item carries its roomId', seq.stops.flat().every((i) => i.roomId === '!r:x.net'))
  check('order follows the conversation',
    seq.stops.flat().map((i) => i.mxc).join(',') ===
      'mxc://x.net/a,mxc://x.net/b,mxc://x.net/c,mxc://x.net/d')
}

console.log('\n-- the vertical walk crosses messages, image by image --')
{
  const it = (m: string) => ({ mxc: m })
  const stops = [[it('a')], [it('b'), it('c'), it('d')], [it('e')]] as any

  check('counted in images, not messages', totalImages(stops) === 5, totalImages(stops))
  check('flat position spans stops', flatIndex(stops, { stop: 1, index: 2 }) === 3)

  // Walk the whole sequence and confirm it visits every image once, in order.
  // This is the property; the boundary cases below are where it broke.
  //
  // Bounded, and the bound is a named failure rather than a loop that runs out
  // of memory: a walk that wraps never ends, and "the check crashed" is a worse
  // signal than "the walk did not terminate" for whoever reads the output.
  const walk = (from: any, delta: 1 | -1) => {
    const seen: string[] = [stops[from.stop][from.index].mxc]
    let pos = from
    for (let guard = 0; guard <= totalImages(stops); guard++) {
      const next = stepImage(stops, pos, delta)
      if (!next) return seen
      pos = next
      seen.push(stops[pos.stop][pos.index].mxc)
    }
    return null // ran past every image without ending: it wraps
  }

  const seen = walk({ stop: 0, index: 0 }, 1)
  check('forward terminates', seen !== null)
  check('forward visits every image in order', seen?.join('') === 'abcde', seen)

  const back = walk({ stop: 2, index: 0 }, -1)
  check('backward terminates', back !== null)
  check('backward is its exact reverse', back?.join('') === 'edcba', back)

  check('leaving a message lands on the next one\'s first image',
    JSON.stringify(stepImage(stops, { stop: 0, index: 0 }, 1)) === JSON.stringify({ stop: 1, index: 0 }))
  check('entering backwards lands on the previous message\'s LAST image',
    JSON.stringify(stepImage(stops, { stop: 2, index: 0 }, -1)) === JSON.stringify({ stop: 1, index: 2 }))

  // No wrap. A ring here would tell a reader they had reached neither end.
  check('the first image has nowhere above it', stepImage(stops, { stop: 0, index: 0 }, -1) === null)
  check('the last image has nowhere below it', stepImage(stops, { stop: 2, index: 0 }, 1) === null)

  // A lone image: the viewer has a vertical axis only if there is somewhere to go.
  const one = [[it('solo')]] as any
  check('a lone image cannot move either way',
    stepImage(one, { stop: 0, index: 0 }, 1) === null && stepImage(one, { stop: 0, index: 0 }, -1) === null)
  check('an empty sequence has no positions', totalImages([] as any) === 0)
  check('...and no move', stepImage([] as any, { stop: 0, index: 0 }, 1) === null)

  // The viewer owns its horizontal index independently, so it can name an index
  // past the end of the stop it is on. That must not walk off the sequence.
  check('an out-of-range index is clamped, not trusted',
    flatIndex(stops, { stop: 0, index: 9 }) === 0)
  check('...and still steps correctly',
    JSON.stringify(stepImage(stops, { stop: 0, index: 9 }, 1)) === JSON.stringify({ stop: 1, index: 0 }))
}

if (failures > 0) {
  console.log(`\n${failures} FAILED`)
  process.exit(1)
}
console.log('\nALL CHECKS PASSED')
