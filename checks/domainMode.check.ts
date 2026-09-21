// Whether domain mode is offered at all.
//
// Launch is imminent and domain mode is not ready (operator, 2026-09-21), so
// it stays in the tree and is not offered. What this guards is the direction
// of every doubt: unset, unreadable or unrecognised must mean OFF. The failure
// that matters is not "the operator cannot try it", it is "it appeared for
// everybody on launch day".
import { readFileSync } from 'node:fs'
import {
  domainEnabledFrom, applyDomainOptIn, domainPassphraseAccepted,
  DOMAIN_PASSPHRASE, DOMAIN_OPT_IN_KEY,
} from '../src/client/domainMode.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const store = (value: string | null, broken = false) => {
  let v = value
  return {
    read: () => { if (broken) throw new Error('storage off'); return v },
    write: (x: string) => { if (broken) throw new Error('storage off'); v = x },
    remove: () => { if (broken) throw new Error('storage off'); v = null },
    get value() { return v },
  }
}

console.log('== off is the default, and every doubt resolves to off')
check('nothing set at all', domainEnabledFrom({}, store(null)) === false)
check('no store either', domainEnabledFrom({}, null) === false)
for (const flag of ['0', 'false', '', 'yes', 'true', 0, 1, true, null, undefined]) {
  // A truthiness test would let VITE_DOMAIN=0 and =false read as YES, which
  // is exactly the bug that puts it in front of everybody.
  check(`VITE_DOMAIN=${JSON.stringify(flag)} is not "1", so it is off`,
    domainEnabledFrom({ flag }, store(null)) === false)
}
check('a browser with storage disabled is off, not on',
  domainEnabledFrom({}, store(null, true)) === false)
check('a store holding something other than "1" is off',
  domainEnabledFrom({}, store('yes')) === false)

console.log('== the three ways it turns on')
check('the build flag, exactly "1"', domainEnabledFrom({ flag: '1' }, store(null)) === true)
check('a dev server, with nothing configured', domainEnabledFrom({ dev: true }, store(null)) === true)
check('the per-browser opt-in, on a production build', domainEnabledFrom({ flag: '0', dev: false }, store('1')) === true)
check('dev must be exactly true, not truthy', domainEnabledFrom({ dev: 1 }, store(null)) === false)

console.log('== the opt-in switch')
{
  const s = store(null)
  check('the wrong passphrase changes nothing', applyDomainOptIn(s, 'nope', true) === 'bad-passphrase' && s.value === null)
  check('the right one enables it', applyDomainOptIn(s, DOMAIN_PASSPHRASE, true) === 'enabled' && s.value === '1')
  // A switch that demands a password to undo it is a trap.
  check('turning it OFF needs no passphrase', applyDomainOptIn(s, '', false) === 'disabled' && s.value === null)
  check('whitespace around the passphrase is forgiven', domainPassphraseAccepted(`  ${DOMAIN_PASSPHRASE}\n`))
  check('case is not', !domainPassphraseAccepted(DOMAIN_PASSPHRASE.toLowerCase()))
}
{
  const broken = store(null, true)
  check('storage that refuses is reported, not claimed as success',
    applyDomainOptIn(broken, DOMAIN_PASSPHRASE, true) === 'bad-passphrase')
  check('and turning it off against broken storage still says disabled',
    applyDomainOptIn(broken, '', false) === 'disabled')
}
check('the key is its own, not encryption\'s', DOMAIN_OPT_IN_KEY === 'net.41chan.domain_opt_in')

console.log('== every route into domain mode is behind the same answer')
// Gating the button alone would be cosmetic. A SAVED LAYOUT can carry the
// domain panel open -- space.ts deserialize restores every panel's open flag
// -- so the effect that opens the geometry is gated too, and so is the render.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
check('the availability answer is read once per mount', /useState\(domainEnabled\)/.test(app))
check('the tab is not rendered when unavailable', /\{domainAvailable && \(\s*<DomainTab/.test(app))
check('the view is not rendered when unavailable', /\{domainAvailable && domainReveal\.mounted/.test(app))
check('the layout effect refuses to open it',
  /if \(domainExpanded && domainAvailable\) openDomain\(\); else closeDomain\(\)/.test(app),
  'a saved layout with the domain open must be closed, not honoured')
check('and the effect re-runs when availability does', /\}, \[domainExpanded, domainAvailable\]\)/.test(app))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\ndomain mode: all checks passed')
