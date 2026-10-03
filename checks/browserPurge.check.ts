// Purge (operator, 2026-10-03): what it deletes from this browser, and the one
// thing it never does -- delete the encryption keys (ruling the same day:
// "keys only via the reset"). Also the hard refresh's file list, and the words
// purge asks with.
import { readFileSync } from 'node:fs'
import {
  PURGE_QUESTION,
  browserPurgePlan,
  executePurge,
  keepsDatabase,
  refreshUrls,
  type PurgeWindow,
} from '../src/client/browserPurge.ts'
import { E2EE_OPT_IN_KEY } from '../src/client/e2eeOptIn.ts'
import { CRYPTO_STORE_PREFIX } from '../src/client/storeNames.ts'
import { SESSION_END_REASONS, planSessionEnd } from '../src/client/sessionEnd.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

// The names as the SDK actually makes them: the rust crypto store and its
// meta store under our per-device prefix, and the sync cache.
const CRYPTO = `${CRYPTO_STORE_PREFIX}::@saber:41chan.net::ABCDEFGH::matrix-sdk-crypto`
const CRYPTO_META = `${CRYPTO_STORE_PREFIX}::@saber:41chan.net::ABCDEFGH::matrix-sdk-crypto-meta`
const SYNC = 'matrix-js-sdk:matrix-client-sync::@saber:41chan.net'

console.log('== the keys stay; everything else goes')
{
  const plan = browserPurgePlan(
    [CRYPTO, CRYPTO_META, SYNC, 'some-other-db', ''],
    ['matrix-client:session', E2EE_OPT_IN_KEY, 'net.41chan.room_list_settings', 'net.41chan.avatar_shape'],
  )
  check('the device\'s crypto stores are kept', JSON.stringify(plan.keepDatabases) === JSON.stringify([CRYPTO, CRYPTO_META]), plan.keepDatabases)
  check('the sync cache and every other database are deleted', JSON.stringify(plan.deleteDatabases) === JSON.stringify([SYNC, 'some-other-db']), plan.deleteDatabases)
  check('the encryption opt-in is kept, so the kept keys are still used', JSON.stringify(plan.keepLocalKeys) === JSON.stringify([E2EE_OPT_IN_KEY]))
  check('the stored session and every setting are removed',
    plan.removeLocalKeys.length === 3 && plan.removeLocalKeys.includes('matrix-client:session'), plan.removeLocalKeys)
  check('a database that merely mentions crypto further in is not a key store', !keepsDatabase('other::matrix-js-sdk::matrix-sdk-crypto'))
  const cryptoSrc = read('src/client/crypto.ts')
  check('the crypto store is created under the same prefix the purge keeps',
    /import \{ CRYPTO_STORE_PREFIX \} from '\.\/storeNames'/.test(cryptoSrc) && /cryptoDatabasePrefix: cryptoStorePrefixFor\(userId, deviceId\)/.test(cryptoSrc) &&
    /`\$\{CRYPTO_STORE_PREFIX\}::\$\{userId\}::\$\{deviceId\}`/.test(cryptoSrc))
}

console.log('== running it')
{
  const local = new Map<string, string>([['matrix-client:session', '{}'], [E2EE_OPT_IN_KEY, '1'], ['net.41chan.x', '1']])
  const deleted: string[] = []
  let sessionCleared = false
  const cachesDeleted: string[] = []
  const win: PurgeWindow = {
    localStorage: {
      get length() { return local.size },
      key: (i: number) => [...local.keys()][i] ?? null,
      removeItem: (k: string) => { local.delete(k) },
    },
    sessionStorage: { clear: () => { sessionCleared = true } },
    indexedDB: { databases: async () => [{ name: CRYPTO }, { name: SYNC }], deleteDatabase: (n: string) => { deleted.push(n) } },
    caches: { keys: async () => ['a'], delete: async (k: string) => { cachesDeleted.push(k); return true } },
  }
  const { failed } = await executePurge(win)
  check('nothing failed', failed.length === 0, failed)
  check('only the opt-in is left in local storage', JSON.stringify([...local.keys()]) === JSON.stringify([E2EE_OPT_IN_KEY]), [...local.keys()])
  check('the key store was never asked to be deleted', !deleted.includes(CRYPTO) && deleted.includes(SYNC), deleted)
  check('session storage and caches are cleared', sessionCleared && cachesDeleted.join() === 'a')

  const broken: PurgeWindow = {
    ...win,
    sessionStorage: { clear: () => { throw new Error('denied') } },
    indexedDB: { databases: async () => { throw new Error('no') }, deleteDatabase: () => {} },
  }
  const r = await executePurge(broken)
  check('what could not be cleared is named, not hidden', r.failed.includes('session storage') && r.failed.includes('the list of browser databases'), r.failed)
}

console.log('== no way of ending a session deletes the keys, purge included')
{
  check('purge is a reason', SESSION_END_REASONS.includes('purge'))
  check('and like a logout it drops the sync cache and the stored session',
    planSessionEnd('purge').deleteSyncStore && planSessionEnd('purge').clearStoredSession && planSessionEnd('purge').stopClient)
  check('no reason deletes the crypto store', SESSION_END_REASONS.every((r) => planSessionEnd(r).deleteCryptoStore === false))
}

console.log('== hard refresh, and the question')
{
  const urls = refreshUrls('https://tc.41chan.net/', [
    { name: 'https://tc.41chan.net/assets/index-abc.js' },
    { name: 'https://tc.41chan.net.evil.example/x.js' },
    { name: 'https://auth.41chan.net/x' },
  ], 'https://tc.41chan.net')
  check('the page and its own files, nothing from another host', JSON.stringify(urls) === JSON.stringify(['https://tc.41chan.net/', 'https://tc.41chan.net/assets/index-abc.js']), urls)
  check('the operator\'s words, the same on every surface', PURGE_QUESTION ===
    "Are you sure you want to do this? While we're confident that our services are configured to work properly regardless of the age of your access token, that token itself is unique, and you are performing an irreversible action.")
  const ui = read('src/ui/SiteReset.tsx')
  check('the rectangle asks in place with that question, and says the keys stay',
    /\{PURGE_QUESTION\}/.test(ui) && /except your encryption\s+keys/.test(ui) && /Settings &gt; Encryption/.test(ui) && !/window\.confirm|confirm\(/.test(ui))
  const purgeAt = ui.indexOf('aria-label="Purge"')
  const refreshAt = ui.indexOf('aria-label="Hard refresh"')
  check('symbols, not words: the bin first, the recycling mark second, each named',
    purgeAt > -1 && refreshAt > purgeAt &&
    ui.indexOf('<ResetIcon d={PURGE_ICON} />') > purgeAt && ui.indexOf('<ResetIcon d={REFRESH_ICON} />') > refreshAt &&
    !/>\s*(Refresh|Purge)\s*</.test(ui), { purgeAt, refreshAt })
  check('it sits under the name card', /<\/div>\n\s*<SiteReset \/>\n\s*<\/div>/.test(read('src/App.tsx')))
}

if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nbrowser purge: all checks passed')
