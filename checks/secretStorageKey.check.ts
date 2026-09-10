// Checks for the one place a recovery key is handed to the SDK.
//
// Two properties matter and both are about what the key does NOT do: it is
// never left behind after the operation, and it is never offered for a key id
// other than the one the user typed.
import { cryptoCallbacks, withRecoveryKey } from '../src/client/secretStorageKey.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}
const ask = (ids: string[]) =>
  cryptoCallbacks.getSecretStorageKey!({ keys: Object.fromEntries(ids.map((k) => [k, {} as never])) }, 'm.megolm_backup.v1')
const KEY = new Uint8Array(32).fill(7) as Uint8Array<ArrayBuffer>

console.log('== outside an operation')
check('with nothing pending, the SDK is told we know no key', (await ask(['abc'])) === null)

console.log('\n== during an operation')
{
  let inside: unknown = 'not-run'
  let other: unknown = 'not-run'
  await withRecoveryKey('abc', KEY, async () => {
    inside = await ask(['abc'])
    other = await ask(['zzz'])
  })
  const got = inside as [string, Uint8Array] | null
  check('the typed key is handed over for its own id', !!got && got[0] === 'abc' && got[1] === KEY)
  check('and NOT for some other key id -- a null lets the operation fail honestly', other === null)
  check('the id must be among the keys the SDK is asking about',
    (await withRecoveryKey('abc', KEY, () => ask(['other1', 'other2']))) === null)
}

console.log('\n== it is always cleared')
check('after a successful operation', (await ask(['abc'])) === null)
{
  let threw = false
  try { await withRecoveryKey('abc', KEY, async () => { throw new Error('boom') }) } catch { threw = true }
  check('the failure propagates', threw)
  check('and the key is cleared even when the operation threw', (await ask(['abc'])) === null)
}
check('the operation result is returned',
  (await withRecoveryKey('abc', KEY, async () => 42)) === 42)

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
