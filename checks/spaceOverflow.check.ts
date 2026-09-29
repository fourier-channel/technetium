// One-slot screens: REPLACE swaps the panel that is up, LAYER covers it and
// remembers what was underneath (operator ruling 2026-09-06). This is stage
// two's "crossing" restricted to a screen that can hold exactly one thing.
import { defaultSpace, setViewport, singleSlot, present, dismiss, reflow, fits, validTiling, serialize, PANEL_IDS, bringBackPanel, putAwayPanel, isMomentary, damagedByPhone, deserialize, moveDivider } from '../src/ui/space.ts'
import type { PanelId, Space } from '../src/ui/space.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const open = (s: Space) => PANEL_IDS.filter((id) => s.leaves[id].open)

const PHONE = { w: 390, h: 844 }
const DESKTOP = { w: 1440, h: 900 }

// --- when does the rule apply ---------------------------------------------
{
  check('a phone is a one-slot screen', singleSlot(setViewport(defaultSpace(), PHONE)))
  check('a desktop is not', !singleSlot(setViewport(defaultSpace(), DESKTOP)))
  check('a tablet-width screen is not either', !singleSlot(setViewport(defaultSpace(), { w: 900, h: 1200 })))
}

// --- the room list and the member list come back (2026-09-29) -------------
// Operator: "When loading tc on mobile, only chanbooru shows up. there is no
// way to get to the other pages ... user list, room list, nothing shows."
// Reflow sheds both on a phone; these are the routes their tabs take.
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  check('a phone sheds the room list and the member list', !phone.leaves.sidebar.open && !phone.leaves.members.open, open(phone))
  for (const mode of ['replace', 'layer'] as const) {
    for (const id of ['sidebar', 'members'] as const) {
      const up = bringBackPanel(phone, id, mode)
      check(`${mode}: the ${id} comes back as the one panel up, filling the screen`,
        open(up).join() === id && fits(up) && validTiling(up), open(up))
      const back = putAwayPanel(up, id, mode)
      check(`${mode}: putting it away returns to the chat`, open(back).join() === 'main', open(back))
    }
  }
  const desk = reflow(setViewport(defaultSpace(), DESKTOP))
  check('on a desktop both are open, so bringing them back changes nothing',
    bringBackPanel(desk, 'sidebar', 'replace') === desk && bringBackPanel(desk, 'members', 'replace') === desk)
  // Between the two: a screen that shed the member list but holds two panels.
  // The tab must never do nothing -- carve it back beside the chat if it
  // fits, present it alone if not.
  for (const w of [520, 600, 700]) {
    const mid = reflow(setViewport(defaultSpace(), { w, h: 900 }))
    for (const id of ['sidebar', 'members'] as const) {
      if (mid.leaves[id].open) continue
      const up = bringBackPanel(mid, id, 'replace')
      check(`at ${w}px a shed ${id} comes back (beside the chat or alone) and the layout still fits`,
        up.leaves[id].open && fits(up) && validTiling(up), open(up))
    }
  }
}

// --- a phone's view is never saved as the layout (2026-09-29) --------------
// Operator: "toggling a panel left and right while on mobile also hides it
// permanently on desktop." The layout is one number shared by every device.
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  const up = bringBackPanel(phone, 'sidebar', 'replace')
  check('a phone putting the room list up is only a view', isMomentary(phone, up))
  check('and putting it away again', isMomentary(up, putAwayPanel(up, 'sidebar', 'replace')))
  const desk = reflow(setViewport(defaultSpace(), DESKTOP))
  const dragged = moveDivider(desk, 'x', desk.leaves.sidebar.x1, 0.02)
  check('a desktop drag is a real change to the layout, and saves', dragged !== desk && !isMomentary(desk, dragged))
  for (const w of [520, 600, 700]) {
    const mid = reflow(setViewport(defaultSpace(), { w, h: 900 }))
    for (const id of ['sidebar', 'members'] as const) {
      if (mid.leaves[id].open) continue
      const back = bringBackPanel(mid, id, 'replace')
      const alone = PANEL_IDS.filter((k) => back.leaves[k].open).length === 1
      if (alone) {
        check(`at ${w}px a list brought back ALONE is a view, and so is putting it away`,
          isMomentary(mid, back) && isMomentary(back, putAwayPanel(back, id, 'replace')))
      }
    }
  }
  // The damage already in account data: a layout with one panel open.
  const lone = serialize(bringBackPanel(phone, 'sidebar', 'replace'))
  const onDesk = deserialize(lone, DESKTOP)!
  check('a saved one-panel layout read on a desktop is recognised as the damage', damagedByPhone(onDesk))
  check('the ordinary desktop layout is not', !damagedByPhone(desk))
  check('on a phone a one-panel layout is harmless and left alone', !damagedByPhone(deserialize(lone, PHONE)!))
}

// --- REPLACE ---------------------------------------------------------------
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  check('the phone starts on the chat alone', open(phone).join() === 'main')
  const withDomain = present(phone, 'domain', 'replace')
  check('presenting the domain leaves only the domain', open(withDomain).join() === 'domain', open(withDomain))
  check('it fills the screen and tiles', fits(withDomain) && validTiling(withDomain))
  check('replace remembers nothing', withDomain.stack.length === 0)
  const back = dismiss(withDomain, 'domain', 'replace')
  check('dismissing it falls back to the chat', open(back).join() === 'main', open(back))
}

// --- LAYER -----------------------------------------------------------------
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  const a = present(phone, 'domain', 'layer')
  check('layering the domain covers the chat', open(a).join() === 'domain', open(a))
  check('and remembers what it covered', a.stack.join() === 'main', a.stack)
  const b = present(a, 'members', 'layer')
  check('layering again stacks up', open(b).join() === 'members' && b.stack.join() === 'main,domain', b.stack)
  const c = dismiss(b, 'members', 'layer')
  check('dismissing pops back to the domain', open(c).join() === 'domain' && c.stack.join() === 'main', [open(c), c.stack])
  const d = dismiss(c, 'domain', 'layer')
  check('and again back to the chat', open(d).join() === 'main' && d.stack.length === 0, [open(d), d.stack])
  const e = dismiss(d, 'main', 'layer')
  check('dismissing the last one with an empty stack still leaves the chat', open(e).join() === 'main', open(e))
  check('every step stayed a valid tiling', [a, b, c, d, e].every((s) => validTiling(s) && fits(s)))
}

// --- the stack is runtime state, never part of the layout ------------------
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  const layered = present(present(phone, 'domain', 'layer'), 'members', 'layer')
  const replaced = present(present(phone, 'domain', 'replace'), 'members', 'replace')
  check('layer and replace reach the same LAYOUT', serialize(layered) === serialize(replaced))
  check('they differ only in what they remember', layered.stack.length > 0 && replaced.stack.length === 0)
  check('the stack is not reachable from the number', !serialize(layered).includes('undefined') && layered.stack.length === 2, layered.stack)
}

// --- presenting something already up ---------------------------------------
{
  const phone = reflow(setViewport(defaultSpace(), PHONE))
  const same = present(phone, 'main', 'layer')
  check('presenting the panel that is already up does not stack it on itself', same.stack.length === 0, same.stack)
  check('and leaves it up', open(same).join() === 'main')
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
