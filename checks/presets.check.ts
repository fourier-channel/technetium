// The preset store: what a device opens on, and surviving malformed data.
import {
  readStore, writeStore, emptyStore, putPreset, dropPreset, setDefaultPreset,
  setMobilePreset, setOverflow, startingCode, isMobileBrowser, findPreset, MAX_PRESETS,
} from '../src/ui/presets.ts'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' -- ' + JSON.stringify(extra))) }
}
const A = '123456789', B = '987654321', C = '555555555'

// --- reading what is actually out there ------------------------------------
{
  check('a legacy { code } reads as a store with no presets', (() => {
    const s = readStore({ code: A })
    return s.code === A && s.presets.length === 0 && s.defaultPreset === null
  })())
  check('absent account data reads as an empty store', readStore(undefined).code === '' && readStore(null).presets.length === 0)
  check('junk in every field is survived', (() => {
    const s = readStore({ code: 'not-a-number', presets: [{ name: '', code: A }, { name: 'ok', code: 'nope' }, 42, null], defaultPreset: 'ghost', overflow: 'sideways' })
    return s.code === '' && s.presets.length === 0 && s.defaultPreset === null && s.overflow === 'replace'
  })())
  check('a default naming a preset that does not exist is dropped, not kept',
    readStore({ code: A, presets: [{ name: 'Desk', code: B }], defaultPreset: 'Gone' }).defaultPreset === null)
  check('duplicate names collapse to the first', readStore({ code: A, presets: [{ name: 'D', code: B }, { name: 'D', code: C }] }).presets.length === 1)
  check('a store round-trips through write and read', (() => {
    const s = setMobilePreset(setDefaultPreset(putPreset(putPreset({ ...emptyStore(), code: A }, 'Desk', B), 'Phone', C), 'Desk'), 'Phone')
    const back = readStore(writeStore(s))
    return back.code === A && back.presets.length === 2 && back.defaultPreset === 'Desk' && back.mobilePreset === 'Phone'
  })())
}

// --- editing ----------------------------------------------------------------
{
  const one = putPreset({ ...emptyStore(), code: A }, 'Desk', B)
  check('a preset is saved under a cleaned name', findPreset(one, ' Desk ')?.code === B)
  check('saving the same name replaces rather than duplicates', putPreset(one, 'Desk', C).presets.length === 1 && findPreset(putPreset(one, 'Desk', C), 'Desk')?.code === C)
  check('an unnamed preset is refused', putPreset(one, '   ', C).presets.length === 1)
  check('a preset with a non-numeric code is refused', putPreset(one, 'Bad', 'abc').presets.length === 1)
  const pointed = setDefaultPreset(one, 'Desk')
  check('a device default can only point at a preset that exists', setDefaultPreset(one, 'Nope').defaultPreset === null && pointed.defaultPreset === 'Desk')
  check('deleting a preset un-points anything naming it', dropPreset(pointed, 'Desk').defaultPreset === null)
  check('the store is capped', (() => {
    let s = emptyStore()
    for (let i = 0; i < MAX_PRESETS + 5; i++) s = putPreset(s, 'p' + i, A)
    return s.presets.length === MAX_PRESETS
  })())
  check('overflow mode is stored and only ever the two values', setOverflow(one, 'layer').overflow === 'layer' && readStore(writeStore(setOverflow(one, 'layer'))).overflow === 'layer')
}

// --- which layout a device opens on ------------------------------------------
{
  const s = setMobilePreset(setDefaultPreset(putPreset(putPreset({ ...emptyStore(), code: A }, 'Desk', B), 'Phone', C), 'Desk'), 'Phone')
  check('a phone opens on the mobile preset', startingCode(s, true) === C)
  check('a desktop opens on the default preset', startingCode(s, false) === B)
  check('with no mobile preset a phone falls back to the default', startingCode(setMobilePreset(s, null), true) === B)
  check('with no presets at all, the live layout is used', startingCode({ ...emptyStore(), code: A }, true) === A)
  check('a store with nothing in it starts from nothing, not a crash', startingCode(emptyStore(), false) === '')
}

// --- is this a phone ---------------------------------------------------------
{
  check('an iPhone agent is mobile', isMobileBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Mobile Safari' }))
  check('an Android agent is mobile', isMobileBrowser({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome Mobile Safari' }))
  check('a desktop agent is not', !isMobileBrowser({ ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128 Safari/537.36', width: 1440 }))
  check('a touch device on a narrow screen counts even with a desktop agent',
    isMobileBrowser({ ua: 'Mozilla/5.0 (Macintosh) Safari', coarsePointer: true, width: 430 }))
  check('a touch screen that is wide does not', !isMobileBrowser({ ua: 'Mozilla/5.0 (Macintosh) Safari', coarsePointer: true, width: 1600 }))
  check('a narrow window with a mouse is not a phone', !isMobileBrowser({ ua: 'Mozilla/5.0 (X11) Chrome', coarsePointer: false, width: 400 }))
  check('nothing known is not a phone', !isMobileBrowser({}))
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
