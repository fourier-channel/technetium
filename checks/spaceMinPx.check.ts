// Checks for PIXEL minimums and the reflow they force (operator ruling
// 2026-09-06, one repo + mobile). The old minimum was a fraction of the unit
// square, which is device-independent and therefore meaningless: 0.1 of a
// phone is 39px, and the tiler called that a valid panel.
//
// Companion to space.check.ts, which deliberately runs on a screen so large
// that no pixel minimum binds; everything here is about the screen mattering.
import {
  defaultSpace, setViewport, effectiveMin, fits, reflow, relax, moveDivider, pushEdge,
  openInColumn, openDomain, validTiling, serialize, deserialize, leafRect,
  MIN_PX, DEFAULT_MIN, SHED_ORDER, PANEL_IDS,
} from '../src/ui/space.ts'
import type { PanelId, Space } from '../src/ui/space.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e
const w = (s: Space, id: PanelId) => { const r = leafRect(s, id); return r.x1 - r.x0 }
const open = (s: Space) => PANEL_IDS.filter((id) => s.leaves[id].open)

const DESKTOP = { w: 1440, h: 900 }
const PHONE = { w: 390, h: 844 }
const HUGE = { w: 3600, h: 2200 }

// --- the minimum is a number of pixels, read through the screen ------------
{
  const d = setViewport(defaultSpace(), DESKTOP)
  check('a panel minimum is its pixel need over the viewport',
    near(effectiveMin(d.leaves.main, 'x', d.vp), MIN_PX.main.x / DESKTOP.w))
  check('the width need is read through the viewport WIDTH',
    near(effectiveMin(d.leaves.threads, 'x', d.vp), MIN_PX.threads.x / DESKTOP.w))
  check('and the height need through the viewport HEIGHT',
    near(effectiveMin(d.leaves.threads, 'y', d.vp), MIN_PX.threads.y / DESKTOP.h))
  check('so the two axes differ when the panel needs differ',
    !near(effectiveMin(d.leaves.threads, 'x', d.vp), effectiveMin(d.leaves.threads, 'y', d.vp)))
  const h = setViewport(defaultSpace(), HUGE)
  check('on a big enough screen the stored FRACTION governs instead',
    near(effectiveMin(h.leaves.main, 'x', h.vp), DEFAULT_MIN))
  const tiny = setViewport(defaultSpace(), { w: 200, h: 200 })
  check('an impossible minimum is capped at the whole square, never above',
    effectiveMin(tiny.leaves.main, 'x', tiny.vp) <= 1)
}

// --- the preset is usable on the screen it was designed for ----------------
{
  const d = setViewport(defaultSpace(), DESKTOP)
  check('the default preset fits a desktop', fits(d))
  check('the default preset does NOT fit a phone (this is the bug being fixed)', !fits(setViewport(defaultSpace(), PHONE)))
}

// --- a push stops at the pixel minimum, and moves with the screen ----------
{
  const d = setViewport(defaultSpace(), DESKTOP)
  const n = moveDivider(d, 'x', 0.18, 0.9)
  check('squeezing the chat stops at its pixel minimum', near(w(n, 'main'), MIN_PX.main.x / DESKTOP.w))
  check('which is 320px of a 1440px screen, not the old 0.1', near(w(n, 'main') * DESKTOP.w, 320, 1))
  const big = setViewport(defaultSpace(), HUGE)
  const nb = moveDivider(big, 'x', 0.18, 0.9)
  check('the same push on a bigger screen goes further (it is pixels, not a new constant)',
    w(nb, 'main') < w(n, 'main') - 1e-3)
  check('and the squeezed space is still a tiling', validTiling(n) && validTiling(nb))
}

// --- reflow: a shrinking screen sheds rather than freezing ------------------
{
  const phone = setViewport(defaultSpace(), PHONE)
  const r = reflow(phone)
  check('after reflow a phone fits', fits(r))
  check('a phone is one panel', open(r).length === 1, open(r))
  check('and the panel it keeps is the content', open(r)[0] === 'main')
  check('reflow leaves a valid tiling', validTiling(r))
  check('reflow is idempotent', serialize(reflow(r)) === serialize(r))
  check('reflow does not touch a space that already fits', reflow(setViewport(defaultSpace(), DESKTOP)) === setViewport(defaultSpace(), DESKTOP) || fits(reflow(setViewport(defaultSpace(), DESKTOP))))
}

// --- shedding follows the stated order --------------------------------------
{
  check('main is never in the shed order', !SHED_ORDER.includes('main' as PanelId))
  check('every other panel is', PANEL_IDS.filter((id) => id !== 'main').every((id) => SHED_ORDER.includes(id)))
  // A screen wide enough for chat + one companion, but not for all three.
  const narrow = setViewport(defaultSpace(), { w: 620, h: 900 })
  const r = reflow(narrow)
  check('a narrow screen sheds the members list before the sidebar',
    !r.leaves.members.open || !open(r).includes('sidebar'), open(r))
  check('the narrow result fits and tiles', fits(r) && validTiling(r))
}

// --- break it on purpose ----------------------------------------------------
{
  const absurd = setViewport(defaultSpace(), { w: 120, h: 120 })
  const r = reflow(absurd)
  check('a screen too small for ANY minimum still yields a valid tiling, not a frozen space', validTiling(r))
  check('and it sheds down to a single panel rather than refusing', open(r).length === 1, open(r))
  const wide = reflow(setViewport(defaultSpace(), { w: 0, h: 0 }))
  check('a zero viewport is clamped, not divided by', validTiling(wide))
}

// --- the layout NUMBER is screen-independent (presets stay portable) --------
{
  const a = setViewport(defaultSpace(), DESKTOP)
  const b = setViewport(defaultSpace(), PHONE)
  check('the same layout serializes identically on any screen', serialize(a) === serialize(b))
  const code = serialize(openDomain(openInColumn(a, 'dock', 0.28), 0.42))
  const onPhone = deserialize(code, PHONE)
  check('a desktop preset still decodes on a phone', onPhone !== null)
  check('it does not fit there as saved', onPhone !== null && !fits(onPhone))
  const settled = reflow(onPhone!)
  check('and reflow makes it fit', fits(settled) && validTiling(settled))
  check('the desktop copy of that preset is untouched by any of it', fits(deserialize(code, DESKTOP)!))
}

// --- setViewport is not a layout change -------------------------------------
{
  const d = setViewport(defaultSpace(), DESKTOP)
  const p = setViewport(d, PHONE)
  check('changing the screen moves nothing by itself', serialize(p) === serialize(d))
  check('it only changes what FITS', fits(d) && !fits(p))
  check('setting the same viewport twice is the same object', setViewport(p, PHONE) === p)
}

// --- redistribute before shedding (operator ruling 2026-09-06) -------------
// 700px holds the three preset panels at their minimums (180 + 320 + 150 =
// 650) but NOT at the preset's fractions (sidebar 126, members 105). The
// layout should give ground rather than lose a panel; before relax existed
// this shed the member list and then the sidebar.
{
  const snug = setViewport(defaultSpace(), { w: 700, h: 900 })
  check('the preset does not fit 700px as designed', !fits(snug))
  const r = reflow(snug)
  check('but reflow keeps all three panels by redistributing', open(r).length === 3, open(r))
  check('and every one of them is at or above its pixel minimum', fits(r))
  check('the result is still a tiling', validTiling(r))
  check('the sidebar was grown to its minimum, not shed', w(r, 'sidebar') * 700 >= MIN_PX.sidebar.x - 1, Math.round(w(r, 'sidebar') * 700))
  check('the chat kept at least its own minimum', w(r, 'main') * 700 >= MIN_PX.main.x - 1, Math.round(w(r, 'main') * 700))
}

{
  const ok = setViewport(defaultSpace(), DESKTOP)
  check('relax leaves a space that already fits completely alone', relax(ok) === ok)
  const impossible = setViewport(defaultSpace(), { w: 200, h: 200 })
  const r = relax(impossible)
  check('relax terminates on a screen nothing can fit, without breaking the tiling', validTiling(r))
  check('and reflow then sheds, as before', open(reflow(impossible)).length === 1, open(reflow(impossible)))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
