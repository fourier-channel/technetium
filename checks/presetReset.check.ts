// `?preset=default`: the way back to the default layout that no layout can
// hide. Operator, 2026-10-19: "Applying default should make a save of the
// previous state and then save the default as current preset."
import {
  emptyStore, putPreset, setDefaultPreset, setMobilePreset, findPreset, startingCode, MAX_PRESETS,
  resetToDefault, wantsDefaultReset, withoutResetParam, resetStamp, DEFAULT_PRESET, type LayoutStore,
} from '../src/ui/presets.ts'
import { defaultSpace, serialize } from '../src/ui/space.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const DEF = serialize(defaultSpace())
const LIVE = '123456789', DESK = '987654321', OWN_DEFAULT = '555555555'
const STAMP = '2026-10-19 05:31'
const reset = (s: LayoutStore, mobile = false) => resetToDefault(s, DEF, mobile, STAMP)

// --- the ruling: save what was there, then the default is current ----------
{
  const r = reset({ ...emptyStore(), code: LIVE })
  check('the layout that was live is saved as a preset before anything changes',
    r.kind === 'reset' && findPreset(r.store, `Before reset ${STAMP}`)?.code === LIVE, r)
  check('the default becomes the live layout', r.kind === 'reset' && r.store.code === DEF)
  check('the default is saved as the Default preset', r.kind === 'reset' && findPreset(r.store, DEFAULT_PRESET)?.code === DEF)
  check('and this device now starts from it', r.kind === 'reset' && r.store.defaultPreset === DEFAULT_PRESET && startingCode(r.store, false) === DEF)
  check('the saved earlier layout is reported back by name', r.kind === 'reset' && r.kept.length === 1 && r.kept[0].code === LIVE)
}

// --- a start preset can no longer bring the problem back -------------------
{
  const s = setDefaultPreset(putPreset({ ...emptyStore(), code: LIVE }, 'Desk', DESK), 'Desk')
  check('before: this desktop starts from Desk', startingCode(s, false) === DESK)
  const r = reset(s)
  check('after: it starts from the default, not from the preset that was broken',
    r.kind === 'reset' && startingCode(r.store, false) === DEF)
  check('the Desk preset itself is untouched', r.kind === 'reset' && findPreset(r.store, 'Desk')?.code === DESK)
  const m = reset(setMobilePreset(s, 'Desk'), true)
  check('on a phone it is the phone pointer that moves, and the desktop one stays',
    m.kind === 'reset' && m.store.mobilePreset === DEFAULT_PRESET && m.store.defaultPreset === 'Desk')
}

// --- nothing is saved twice, nothing is lost --------------------------------
{
  const already = putPreset({ ...emptyStore(), code: DESK }, 'Desk', DESK)
  const r = reset(already)
  check('a live layout some preset already holds is not saved again',
    r.kind === 'reset' && r.kept.length === 0 && r.store.presets.length === 2, r.kind === 'reset' ? r.store.presets : r)
  const twice = r.kind === 'reset' ? reset(r.store) : null
  check('resetting an already-default board saves nothing new', twice?.kind === 'reset' && twice.kept.length === 0 && twice.store.presets.length === 2)

  const own = putPreset({ ...emptyStore(), code: LIVE }, DEFAULT_PRESET, OWN_DEFAULT)
  const o = reset(own)
  check('a Default preset of the user\'s own is saved before it is overwritten',
    o.kind === 'reset' && findPreset(o.store, `Default before ${STAMP}`)?.code === OWN_DEFAULT, o)
  check('and the live layout is kept as well', o.kind === 'reset' && findPreset(o.store, `Before reset ${STAMP}`)?.code === LIVE)

  const clash = putPreset({ ...emptyStore(), code: LIVE }, `Before reset ${STAMP}`, DESK)
  const c = reset(clash)
  check('a name already taken (two resets in one minute) gets a suffix, never an overwrite',
    c.kind === 'reset' && findPreset(c.store, `Before reset ${STAMP}`)?.code === DESK && findPreset(c.store, `Before reset ${STAMP} (2)`)?.code === LIVE)
  check('an empty account saves nothing but the Default', (() => {
    const e = reset(emptyStore())
    return e.kind === 'reset' && e.kept.length === 0 && e.store.presets.length === 1
  })())
}

// --- full: refuse rather than drop the earlier layout -----------------------
{
  let full: LayoutStore = { ...emptyStore(), code: LIVE }
  for (let i = 0; i < MAX_PRESETS; i++) full = putPreset(full, `P${String(i).padStart(2, '0')}`, String(100000 + i))
  const r = reset(full)
  check('with every preset slot taken, the reset is refused, not done lossily', r.kind === 'full', r)
  check('one free slot is not enough when two are needed (the live layout and the Default)',
    reset({ ...full, presets: full.presets.slice(1) }).kind === 'full')
}

// --- the address bar ----------------------------------------------------------
{
  check('?preset=default asks for it', wantsDefaultReset('?preset=default'))
  check('case and spaces do not matter', wantsDefaultReset('?preset=%20Default%20'))
  check('beside other parameters', wantsDefaultReset('?x=1&preset=default'))
  check('no parameter, no reset', !wantsDefaultReset('') && !wantsDefaultReset('?x=1'))
  check('another preset name is not a reset', !wantsDefaultReset('?preset=Desk'))
  check('a fragment is not the trigger', !wantsDefaultReset('#preset=default'))
  check('the parameter is removed and everything else kept',
    withoutResetParam('https://tc.41chan.net/?x=1&preset=default#room') === '/?x=1#room', withoutResetParam('https://tc.41chan.net/?x=1&preset=default#room'))
  check('removing the only parameter leaves no bare ?', withoutResetParam('https://tc.41chan.net/?preset=default') === '/')
  check('the stamp is minutes in local time, short enough for a preset name',
    resetStamp(new Date(2026, 9, 19, 5, 31, 59)) === STAMP && `Default before ${STAMP} (99)`.length <= 40)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
