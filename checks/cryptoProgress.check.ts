// Checks for the crypto engine's arrival state.
//
// The failures this guards are not "the bar is slightly off". They are:
//   - a denominator that has silently drifted from the real asset, which aims
//     the bar wrong without ever throwing (D-tc01);
//   - a bar that renders full, or renders a number at all, when the total is
//     not actually known (G-e3, E10);
//   - a box that disappears on failure, which is the silent-failure rule with
//     encryption behind it (G-tc05).
import { readFileSync } from 'node:fs'
import {
  CRYPTO_WASM_BYTES,
  CRYPTO_LOAD_IDLE,
  cryptoPercent,
  formatBytes,
  cryptoProgressLabel,
  shouldShowCryptoBox,
  type CryptoLoadState,
} from '../src/client/cryptoProgress.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

const at = (over: Partial<CryptoLoadState>): CryptoLoadState => ({ ...CRYPTO_LOAD_IDLE, ...over })

console.log('\n-- the denominator tracks the real asset (D-tc01) --')
{
  // The value exists in two places by necessity: a constant the bundle can read
  // synchronously, and the file itself. A check that reads both is the only
  // thing standing between an SDK bump and a progress bar that quietly aims at
  // the wrong total for the rest of the release.
  const wasm = readFileSync(
    'node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm',
  )
  check('CRYPTO_WASM_BYTES equals the shipped wasm byte length',
    wasm.byteLength === CRYPTO_WASM_BYTES,
    { constant: CRYPTO_WASM_BYTES, actual: wasm.byteLength })
}

console.log('\n-- an unknown total never produces a number --')
{
  check('null total is indeterminate, not 0%',
    cryptoPercent(at({ phase: 'downloading', total: null, received: 100 })) === null)
  check('a zero total is indeterminate, not a divide-by-zero',
    cryptoPercent(at({ phase: 'downloading', total: 0, received: 100 })) === null)
  check('a negative total is indeterminate',
    cryptoPercent(at({ phase: 'downloading', total: -1, received: 100 })) === null)
  check('idle reports nothing', cryptoPercent(at({ phase: 'idle' })) === null)
  check('failed reports nothing, not 0% and not 100%',
    cryptoPercent(at({ phase: 'failed', error: 'x' })) === null)
}

console.log('\n-- the bar stays believable at both ends --')
{
  check('mid-download is the real fraction',
    cryptoPercent(at({ phase: 'downloading', total: 200, received: 50 })) === 25)
  // A cached response can deliver the whole body in one chunk, and a stale
  // constant can be smaller than what actually arrives. Neither may render
  // past the end of the track.
  check('over-delivery clamps to 100, never 130',
    cryptoPercent(at({ phase: 'downloading', total: 100, received: 130 })) === 100)
  check('negative received clamps to 0',
    cryptoPercent(at({ phase: 'downloading', total: 100, received: -5 })) === 0)
  check('installing shows a full bar (the bytes really are in)',
    cryptoPercent(at({ phase: 'installing' })) === 100)
  check('ready is 100', cryptoPercent(at({ phase: 'ready' })) === 100)
  check('a NaN received does not escape as NaN%',
    cryptoPercent(at({ phase: 'downloading', total: 100, received: NaN })) === null)
}

console.log('\n-- bytes read the way a human reads them --')
{
  check('bytes under 1K stay bytes', formatBytes(512) === '512 B')
  check('kilobytes round', formatBytes(2048) === '2 KB')
  check('megabytes carry one decimal', formatBytes(1_800_000) === '1.7 MB')
  check('the real asset reads as MB', formatBytes(CRYPTO_WASM_BYTES) === '5.3 MB')
  check('a negative length does not render as -0 B', formatBytes(-1) === '0 B')
  check('a NaN length does not render as NaN', formatBytes(NaN) === '0 B')
}

console.log('\n-- the label never lies and never leaks a stack trace --')
{
  check('downloading names both halves',
    cryptoProgressLabel(at({ phase: 'downloading', total: 1024, received: 512 })) === '512 B of 1 KB')
  check('an unknown total omits the total rather than inventing one',
    cryptoProgressLabel(at({ phase: 'downloading', total: null, received: 512 })) === '512 B')
  check('a failure with a message shows that message',
    cryptoProgressLabel(at({ phase: 'failed', error: 'Encryption could not be set up.' }))
      === 'Encryption could not be set up.')
  // A failure with no message must still say something a user can act on.
  check('a failure with no message still says something',
    cryptoProgressLabel(at({ phase: 'failed', error: null })).length > 0)
}

console.log('\n-- the box appears exactly when it has something to say --')
{
  check('hidden while idle', shouldShowCryptoBox(at({ phase: 'idle' })) === false)
  check('shown while downloading', shouldShowCryptoBox(at({ phase: 'downloading' })) === true)
  check('shown while installing', shouldShowCryptoBox(at({ phase: 'installing' })) === true)
  // The box explains a wait. Once the wait is over it is just a dialog to
  // dismiss, so it must leave on its own.
  check('gone once ready', shouldShowCryptoBox(at({ phase: 'ready' })) === false)
  // The one that matters: a crypto failure the user never sees is exactly the
  // omission G-tc05 was minted for.
  check('STAYS on failure', shouldShowCryptoBox(at({ phase: 'failed', error: 'x' })) === true)
}

console.log('\n-- the default state is honest --')
{
  check('idle starts at zero received', CRYPTO_LOAD_IDLE.received === 0)
  check('idle carries no error', CRYPTO_LOAD_IDLE.error === null)
  check('idle is not shown', shouldShowCryptoBox(CRYPTO_LOAD_IDLE) === false)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
console.log('\nALL CHECKS PASSED')
