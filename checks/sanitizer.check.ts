// SECURITY checks for the message-body sanitizer.
//
// Standing law: any DOMPurify allowlist widening needs a test proving
// script/style/on*/javascript: still die. This is that test.
//
// THE TRAP THIS FILE IS BUILT AROUND: without a DOM, DOMPurify's default
// export is created with a null window, `isSupported` is false, and
// `sanitize()` RETURNS ITS INPUT UNCHANGED. Every negative test below would
// then "pass" while sanitizing nothing at all -- worse than having no tests.
// So jsdom is installed onto globalThis BEFORE messageBody is imported, and
// the first assertion is a live proof that the sanitizer is actually running.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
// @ts-expect-error -- installing a DOM into a bare Node global
globalThis.window = dom.window
// @ts-expect-error -- ditto
globalThis.document = dom.window.document

// Dynamic import: static imports hoist above the lines above, and DOMPurify
// binds its window at module-evaluation time.
const { renderMessageBody } = await import('../src/client/messageBody.ts')
const DOMPurify = (await import('dompurify')).default

let failures = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log('  ok   ' + name)
  } else {
    failures++
    console.log('  FAIL ' + name, extra ?? '')
  }
}

const html = (formatted: string, body = 'fallback') =>
  ({ msgtype: 'm.text', body, format: 'org.matrix.custom.html', formatted_body: formatted }) as any

const render = (formatted: string) => renderMessageBody(html(formatted)).html ?? ''

console.log('\n-- the sanitizer is actually running (guards against a vacuous suite) --')
{
  check('DOMPurify reports isSupported', DOMPurify.isSupported === true)
  // If sanitize were a no-op this would come back byte-identical.
  const proof = render('<script>alert(1)</script>')
  check('a script tag does NOT survive verbatim', proof !== '<script>alert(1)</script>', proof)
  check('sanitizer demonstrably strips something', render('<iframe></iframe>') === '', render('<iframe></iframe>'))
}

console.log('\n-- scripts and script-like elements --')
{
  check('script stripped', !render('<script>alert(1)</script>').includes('<script'))
  check('script contents do not survive as text', !render('<script>alert(1)</script>').includes('alert(1)'))
  check('style stripped', !render('<style>body{display:none}</style>').includes('<style'))
  check('style contents do not leak', !render('<style>body{display:none}</style>').includes('display:none'))
  check('iframe stripped', !render('<iframe src="https://evil.test"></iframe>').includes('iframe'))
  check('object stripped', !render('<object data="x"></object>').includes('<object'))
  check('embed stripped', !render('<embed src="x">').includes('<embed'))
  check('form stripped', !render('<form action="x"><input name="p"></form>').includes('<form'))
  check('input stripped', !render('<input value="x">').includes('<input'))
  check('svg stripped', !render('<svg><script>alert(1)</script></svg>').includes('<svg'))
  check('math stripped', !render('<math><mtext></mtext></math>').includes('<math'))
  check('base stripped', !render('<base href="https://evil.test">').includes('<base'))
  check('meta stripped', !render('<meta http-equiv="refresh" content="0;url=x">').includes('<meta'))
}

console.log('\n-- event handler attributes --')
{
  check('onerror stripped', !render('<img src=x onerror=alert(1)>').includes('onerror'))
  check('onclick stripped', !render('<b onclick="alert(1)">hi</b>').includes('onclick'))
  check('onload stripped', !render('<b onload="alert(1)">hi</b>').includes('onload'))
  check('onmouseover stripped', !render('<a href="#" onmouseover="alert(1)">x</a>').includes('onmouseover'))
  check('ONERROR uppercase stripped', !render('<b ONERROR="alert(1)">hi</b>').toLowerCase().includes('onerror'))
  check('onfocus+autofocus stripped', !render('<b onfocus=alert(1) autofocus>x</b>').includes('onfocus'))
  // The element may survive; the handler must not.
  check('bold survives without its handler', render('<b onclick="alert(1)">hi</b>').includes('hi'))
}

console.log('\n-- dangerous URI schemes on href --')
{
  check('javascript: dropped', !render('<a href="javascript:alert(1)">x</a>').includes('javascript:'))
  check(
    'JaVaScRiPt: dropped',
    !render('<a href="JaVaScRiPt:alert(1)">x</a>').toLowerCase().includes('javascript:'),
  )
  check(
    'javascript: with embedded tab/newline dropped',
    !render('<a href="java\tscript:alert(1)">x</a>').toLowerCase().replace(/\s/g, '').includes('javascript:'),
  )
  check('data:text/html dropped', !render('<a href="data:text/html,<script>alert(1)</script>">x</a>').includes('data:text/html'))
  check('vbscript: dropped', !render('<a href="vbscript:msgbox(1)">x</a>').includes('vbscript:'))
  check('https: survives', render('<a href="https://example.test/">x</a>').includes('https://example.test/'))
  check('matrix.to permalink survives', render('<a href="https://matrix.to/#/@a:x.net">x</a>').includes('matrix.to'))
}

console.log('\n-- style attribute and CSS injection --')
{
  check('style attr stripped', !render('<b style="position:fixed;top:0">x</b>').includes('style'))
  check(
    'style attr with url() stripped',
    !render('<b style="background:url(javascript:alert(1))">x</b>').includes('background'),
  )
}

console.log('\n-- data attributes stay off (ALLOW_DATA_ATTR: false) --')
{
  // W2.L2 will deliberately allow data-mx-spoiler. Until then NOTHING data-* is
  // permitted, and this check is what makes that widening visible in a diff.
  check('data-mx-spoiler NOT yet allowed', !render('<span data-mx-spoiler="">x</span>').includes('data-mx-spoiler'))
  check('arbitrary data-* not allowed', !render('<b data-evil="1">x</b>').includes('data-evil'))
  check('class NOT yet allowed', !render('<code class="language-js">x</code>').includes('class'))
}

console.log('\n-- mx-reply fallback is removed WITH its contents --')
{
  // DOMPurify UNWRAPS a disallowed tag by default: it drops the element and
  // KEEPS the children. FORBID_CONTENTS is what removes the subtree. Without
  // it, every reply renders the message it was answering inline.
  const out = render('<mx-reply><blockquote>QUOTED</blockquote></mx-reply>the answer')
  check('mx-reply tag gone', !out.includes('mx-reply'))
  check('quoted contents gone too, not merely unwrapped', !out.includes('QUOTED'), out)
  check('the actual reply survives', out.includes('the answer'))
}

console.log('\n-- the permitted spec subset still renders --')
{
  check('bold', render('<b>x</b>') === '<b>x</b>')
  check('emphasis', render('<em>x</em>') === '<em>x</em>')
  check('code', render('<code>x</code>') === '<code>x</code>')
  check('pre', render('<pre>x</pre>') === '<pre>x</pre>')
  check('blockquote', render('<blockquote>x</blockquote>') === '<blockquote>x</blockquote>')
  check('list', render('<ul><li>x</li></ul>') === '<ul><li>x</li></ul>')
  check('table cell', render('<table><tbody><tr><td>x</td></tr></tbody></table>').includes('<td>x</td>'))
  check('span survives', render('<span>x</span>') === '<span>x</span>')
}

console.log('\n-- mXSS / parser-confusion shapes --')
{
  check(
    'nested noscript does not resurrect a script',
    !render('<noscript><p title="</noscript><img src=x onerror=alert(1)>">').includes('onerror'),
  )
  check(
    'malformed nesting does not leak a handler',
    !render('<b><i></b><img src=x onerror=alert(1)></i>').includes('onerror'),
  )
  check(
    'comment-wrapped script does not survive',
    !render('<!--<script>alert(1)</script>-->').includes('alert(1)'),
  )
}

console.log('\n-- plaintext path is never treated as HTML --')
{
  const plain = renderMessageBody({ msgtype: 'm.text', body: '<script>alert(1)</script>' } as any)
  check('no format -> text branch, html undefined', plain.html === undefined)
  check('raw text preserved verbatim for React to escape', plain.text === '<script>alert(1)</script>')
}

console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'))
process.exit(failures === 0 ? 0 : 1)
