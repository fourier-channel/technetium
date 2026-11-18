// Whether QuickQueue (tc.152) is offered at all.
//
// QuickQueue is built in steps and is held behind a flag until it is finished,
// the way domain mode was (checks/domainMode says why). What this guards is
// the direction of every doubt: unset, unreadable or unrecognised means OFF.
// The failure that matters is not "the operator cannot try it", it is "a half
// built panel appeared for everybody".
import { readFileSync } from 'node:fs'
import {
  qqEnabledFrom, applyQqOptIn, qqPassphraseAccepted, QQ_PASSPHRASE, QQ_OPT_IN_KEY,
} from '../src/client/qqMode.ts'

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
check('nothing set at all', qqEnabledFrom({}, store(null)) === false)
check('no store either', qqEnabledFrom({}, null) === false)
for (const flag of ['0', 'false', '', 'yes', 'true', 0, 1, true, null, undefined]) {
  check(`VITE_QQ=${JSON.stringify(flag)} is not "1", so it is off`, qqEnabledFrom({ flag }, store(null)) === false)
}
check('a browser with storage disabled is off, not on', qqEnabledFrom({}, store(null, true)) === false)
check('a store holding something other than "1" is off', qqEnabledFrom({}, store('yes')) === false)

console.log('== the three ways it turns on')
check('the build flag, exactly "1"', qqEnabledFrom({ flag: '1' }, store(null)) === true)
check('a dev server, with nothing configured', qqEnabledFrom({ dev: true }, store(null)) === true)
check('the per-browser opt-in, on a production build', qqEnabledFrom({ flag: '0', dev: false }, store('1')) === true)
check('dev must be exactly true, not truthy', qqEnabledFrom({ dev: 1 }, store(null)) === false)

console.log('== the opt-in switch')
{
  const s = store(null)
  check('the wrong passphrase changes nothing', applyQqOptIn(s, 'nope', true) === 'bad-passphrase' && s.value === null)
  check('the right one enables it', applyQqOptIn(s, QQ_PASSPHRASE, true) === 'enabled' && s.value === '1')
  check('turning it OFF needs no passphrase', applyQqOptIn(s, '', false) === 'disabled' && s.value === null)
  check('whitespace around the passphrase is forgiven', qqPassphraseAccepted(`  ${QQ_PASSPHRASE}\n`))
  check('case is not', !qqPassphraseAccepted(QQ_PASSPHRASE.toLowerCase()))
}
{
  const broken = store(null, true)
  check('storage that refuses is reported, not claimed as success',
    applyQqOptIn(broken, QQ_PASSPHRASE, true) === 'bad-passphrase')
  check('and turning it off against broken storage still says disabled', applyQqOptIn(broken, '', false) === 'disabled')
}
check('the key is its own', QQ_OPT_IN_KEY === 'net.41chan.qq_opt_in')

console.log('== the build that ships says no, and the app asks')
const env = readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
check('.env.production holds VITE_QQ=0', /^VITE_QQ=0$/m.test(env))
check('and does not also say 1', !/^VITE_QQ=1$/m.test(env))
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
check('the availability answer is read once per mount', /useState\(qqEnabled\)/.test(app))
check('the drawer is not rendered when unavailable', /\{qqAvailable && <QuickQueueDrawer \/>\}/.test(app))
check('App never imports the panel itself (it loads on first open)', !/QuickQueuePanel/.test(app))
const drawer = readFileSync(new URL('../src/qq/QuickQueueDrawer.tsx', import.meta.url), 'utf8')
check('the drawer fetches the panel lazily', /lazy\(\(\) => import\('\.\/QuickQueuePanel'\)\)/.test(drawer))
check('and has no static import of it', !/^import .*QuickQueuePanel/m.test(drawer))
check('the drawer grip captures the pointer (memory drag-across-an-iframe)', /setPointerCapture\(/.test(drawer))
const store2 = readFileSync(new URL('../src/qq/folderStore.ts', import.meta.url), 'utf8')
check('step 1 asks for READ access only, never readwrite',
  /mode: 'read' \}\)/.test(store2) && !/picker\(\{[^}]*readwrite/.test(store2))

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nquickqueue mode: all checks passed')
