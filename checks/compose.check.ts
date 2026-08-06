// Checks for the SEND side: markdown -> Matrix content, spoiler composing, and
// the plain-vs-HTML decision. Needs a DOM (marked + DOMPurify + the class
// scrub), so jsdom is installed before the module is imported -- see
// checks/sanitizer.check.ts for why that ordering matters.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
// @ts-expect-error -- installing a DOM into a bare Node global
globalThis.window = dom.window
// @ts-expect-error -- ditto
globalThis.document = dom.window.document

const { formatMessage } = await import('../src/client/messageFormat.ts')
const { maskSpoilers } = await import('../src/client/composeSpoilers.ts')

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

console.log('\n-- plain stays plain (no pointless formatted_body) --')
{
  check('plain text sends no html', formatMessage('hello there').html === undefined)
  check('plain text body preserved', formatMessage('hello there').plain === 'hello there')
  check('input is trimmed', formatMessage('  hi  ').plain === 'hi')
  check('empty input', formatMessage('   ').plain === '')
  // Escaping alone is not formatting.
  check('an ampersand alone is still plain', formatMessage('a & b').html === undefined)
  check('a bare < is still plain', formatMessage('a < b').html === undefined)
  check('multiline stays plain', formatMessage('one\ntwo').html === undefined)
}

console.log('\n-- markdown produces html --')
{
  check('bold', formatMessage('**bold**').html === '<strong>bold</strong>')
  check('italic', formatMessage('*it*').html === '<em>it</em>')
  check('inline code', formatMessage('`x`').html === '<code>x</code>')
  check('link', (formatMessage('[a](https://x.test)').html ?? '').includes('href="https://x.test"'))
}

console.log('\n-- a user typing literal HTML cannot put it on the wire --')
{
  check('script stripped', !(formatMessage('<script>alert(1)</script>').html ?? '').includes('<script'))
  check(
    'script CONTENTS stripped too (FORBID_CONTENTS superset)',
    !(formatMessage('<b><script>alert(1)</script></b>').html ?? '').includes('alert(1)'),
    formatMessage('<b><script>alert(1)</script></b>').html,
  )
  check('onerror stripped', !(formatMessage('<img src=x onerror=alert(1)>').html ?? '').includes('onerror'))
  check('javascript: stripped', !(formatMessage('<a href="javascript:alert(1)">x</a>').html ?? '').includes('javascript:'))
  // A user CAN type literal HTML into the composer. Without the class scrub
  // they could send markup that styles someone else's client.
  check(
    'a hand-written app class is not sent',
    !(formatMessage('<span class="tc-row-actions">x</span>').html ?? '').includes('tc-row-actions'),
    formatMessage('<span class="tc-row-actions">x</span>').html,
  )
  check(
    'a hand-written data-mx-spoiler is not sent',
    !(formatMessage('<span data-mx-spoiler="">x</span>').html ?? '').includes('data-mx-spoiler'),
  )
}

console.log('\n-- fenced code blocks (W2.L3) --')
{
  const out = formatMessage('```js\nconst a = 1\n```').html ?? ''
  check('fence becomes pre>code', out.includes('<pre><code'), out)
  check('language hint survives onto the wire', out.includes('language-js'), out)
  check('the code text is present', out.includes('const a = 1'), out)
  check('plain body keeps the fence markers', formatMessage('```js\nconst a = 1\n```').plain.includes('```'))

  const noLang = formatMessage('```\nplain code\n```').html ?? ''
  check('fence without a language still becomes a block', noLang.includes('<pre><code'), noLang)

  // Inline parsing must remain the default: block parsing would wrap ordinary
  // messages in <p> and change every existing message's shape.
  check('an ordinary message is NOT wrapped in <p>', !(formatMessage('**b**').html ?? '').includes('<p>'))
  // The literal text "onerror=" DOES appear -- inside &lt;...&gt;, which is
  // inert. What matters is that no element is ever constructed from it.
  const fencedNasty = formatMessage('```\n<img src=x onerror=alert(1)>\n```').html ?? ''
  check('angle brackets inside a fence stay escaped', fencedNasty.includes('&lt;img'), fencedNasty)
  check('no img element is built from fenced code', !fencedNasty.includes('<img'), fencedNasty)
}

console.log('\n-- spoiler masking --')
{
  const m = maskSpoilers('a ||secret|| b')
  check('one spoiler captured', m.spoilers.length === 1)
  check('text captured', m.spoilers[0].text === 'secret')
  check('no reason', m.spoilers[0].reason === '')
  check('markers removed from the masked text', !m.masked.includes('||'))

  const r = maskSpoilers('||ending|Rosebud||')
  check('reason captured', r.spoilers[0].reason === 'ending')
  check('text captured with a reason', r.spoilers[0].text === 'Rosebud')

  const two = maskSpoilers('||one|| and ||two||')
  check('two spoilers on one line stay separate', two.spoilers.length === 2, two.spoilers)
  check('non-greedy: first is "one"', two.spoilers[0]?.text === 'one')
  check('non-greedy: second is "two"', two.spoilers[1]?.text === 'two')

  check('no spoiler leaves input alone', maskSpoilers('a | b || c').spoilers.length === 0)
}

console.log('\n-- spoiler composing end to end --')
{
  const out = formatMessage('||secret||').html ?? ''
  check('emits a spoiler span', out.includes('data-mx-spoiler=""'), out)
  check('carries the hidden text', out.includes('secret'), out)
  check('plain body keeps the || markers as the fallback convention', formatMessage('||secret||').plain === '||secret||')

  const reasoned = formatMessage('||ending|Rosebud||').html ?? ''
  check('reason lands in the attribute', reasoned.includes('data-mx-spoiler="ending"'), reasoned)

  // The span is injected AFTER sanitizing, so its contents must be escaped by
  // us -- this is the check that proves they are.
  const nasty = formatMessage('||<img src=x onerror=alert(1)>||').html ?? ''
  check('hostile spoiler text is escaped', !nasty.includes('<img'), nasty)
  check('escaped form present', nasty.includes('&lt;img'), nasty)

  const nastyReason = formatMessage('||"><script>alert(1)</script>|x||').html ?? ''
  check('hostile reason cannot break out of the attribute', !nastyReason.includes('<script'), nastyReason)

  // A `$` in the text would be read as a replacement pattern by String.replace.
  const dollar = formatMessage('||costs $1 & $2||').html ?? ''
  check('a $ in spoiler text survives literally', dollar.includes('costs $1'), dollar)
  check('an & in spoiler text is escaped', dollar.includes('&amp;'), dollar)

  check('a spoiler always sends html', formatMessage('||x||').html !== undefined)
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
