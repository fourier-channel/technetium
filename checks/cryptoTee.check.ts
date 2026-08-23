// Checks for the progress tee that sits in front of the wasm download.
//
// This is instrumentation wrapped around a security-critical asset, and the
// failure mode is the worst kind: a tee that drops, truncates or reorders a
// chunk hands WebAssembly a corrupt module, and the resulting error names a
// compile failure with nothing pointing at the progress meter that caused it.
// So the bytes are asserted identical, not merely counted.
import { countingResponse } from '../src/client/crypto.ts'

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log('  ok   ' + name)
  else { failures++; console.log('  FAIL ' + name, extra ?? '') }
}

// A body delivered in several chunks, as a real network response would be.
function chunkedResponse(chunks: Uint8Array[], headers: Record<string, string>) {
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(ch); c.close() },
  })
  return new Response(stream, { status: 200, statusText: 'OK', headers })
}

const CHUNKS = [
  new Uint8Array([0x00, 0x61, 0x73, 0x6d]),
  new Uint8Array([0x01, 0x00, 0x00, 0x00]),
  new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
]
const EXPECTED = new Uint8Array([...CHUNKS[0], ...CHUNKS[1], ...CHUNKS[2]])

console.log('\n-- the bytes come through untouched --')
{
  const seen: number[] = []
  const res = countingResponse(
    chunkedResponse(CHUNKS, { 'content-type': 'application/wasm' }),
    (n) => seen.push(n),
    () => {},
  )
  const out = new Uint8Array(await res.arrayBuffer())

  check('byte length is preserved', out.byteLength === EXPECTED.byteLength,
    { got: out.byteLength, want: EXPECTED.byteLength })
  check('every byte is identical, in order',
    out.every((b, i) => b === EXPECTED[i]), { got: [...out], want: [...EXPECTED] })
}

console.log('\n-- the response still looks like wasm to instantiateStreaming --')
{
  const res = countingResponse(
    chunkedResponse(CHUNKS, { 'content-type': 'application/wasm', 'x-marker': 'kept' }),
    () => {}, () => {},
  )
  // instantiateStreaming REJECTS on a wrong content-type, so losing this header
  // turns the whole feature off with an error that blames WebAssembly.
  check('content-type survives the tee', res.headers.get('content-type') === 'application/wasm')
  check('other headers survive too', res.headers.get('x-marker') === 'kept')
  check('status survives', res.status === 200)
  await res.arrayBuffer()
}

console.log('\n-- progress is cumulative and lands on the true total --')
{
  const seen: number[] = []
  const res = countingResponse(chunkedResponse(CHUNKS, {}), (n) => seen.push(n), () => {})
  await res.arrayBuffer()

  check('one report per chunk', seen.length === CHUNKS.length, seen)
  check('counts are cumulative, not per-chunk',
    seen.every((n, i) => i === 0 || n > seen[i - 1]), seen)
  check('the final count equals the real byte length',
    seen[seen.length - 1] === EXPECTED.byteLength, seen)
}

console.log('\n-- done fires once, and only after the last byte --')
{
  let done = 0
  let lastAtDone = -1
  let received = 0
  const res = countingResponse(
    chunkedResponse(CHUNKS, {}),
    (n) => { received = n },
    () => { done++; lastAtDone = received },
  )
  await res.arrayBuffer()

  check('done fired exactly once', done === 1, done)
  // If done fires early the box flips to "Installing" while bytes are still
  // moving, which is a lie of exactly the kind E10 forbids.
  check('done fired only after every byte was counted',
    lastAtDone === EXPECTED.byteLength, { lastAtDone, total: EXPECTED.byteLength })
}

console.log('\n-- a bodyless response is passed through, not wrapped --')
{
  // A 204 or a cache hit synthesised without a body must not be turned into a
  // stream that never closes.
  const empty = new Response(null, { status: 204 })
  const res = countingResponse(empty, () => { failures++ }, () => { failures++ })
  check('the same response object is returned untouched', res === empty)
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1) }
