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

console.log('\n-- forbidden contents: the text inside a stripped tag must go too --')
{
  // REGRESSION GUARD. Passing FORBID_CONTENTS to DOMPurify REPLACES its
  // default list rather than extending it. W2.1 passed ['mx-reply'] alone and
  // silently un-forbade all of these -- `<b><script>alert(1)</script></b>`
  // rendered as `<b>alert(1)</b>`. The bare-tag cases below kept passing
  // throughout, which is why the nested form is what is tested here.
  check('nested script contents gone', render('<b><script>alert(1)</script></b>') === '<b></b>')
  check('nested style contents gone', render('<b><style>x{y:z}</style></b>') === '<b></b>')
  check('nested noscript contents gone', render('<b><noscript>hidden</noscript></b>') === '<b></b>')
  check('nested title contents gone', render('<b><title>hidden</title></b>') === '<b></b>')
  check('nested template contents gone', render('<b><template>hidden</template></b>') === '<b></b>')
  check('nested xmp contents gone', render('<b><xmp>hidden</xmp></b>') === '<b></b>')
  check('nested plaintext contents gone', render('<b><plaintext>hidden</plaintext></b>') === '<b></b>')
  check('nested iframe contents gone', !render('<b><iframe>hidden</iframe></b>').includes('hidden'))
  check('nested svg contents gone', !render('<b><svg><desc>hidden</desc></svg></b>').includes('hidden'))
  check('nested math contents gone', !render('<b><math><mtext>hidden</mtext></math></b>').includes('hidden'))
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

console.log('\n-- data attributes: ONLY data-mx-spoiler, by name (W2.L2) --')
{
  // ALLOW_DATA_ATTR stays FALSE. data-mx-spoiler is admitted by name; the
  // data-* family is not. These checks are what keep that distinction real.
  check('arbitrary data-* not allowed', !render('<b data-evil="1">x</b>').includes('data-evil'))
  check('data-mx-anything-else not allowed', !render('<b data-mx-evil="1">x</b>').includes('data-mx-evil'))
  check('data-mx-color not allowed', !render('<span data-mx-color="red">x</span>').includes('data-mx-color'))
  check('data-mx-spoiler IS allowed', render('<span data-mx-spoiler="">x</span>').includes('data-mx-spoiler'))
}

console.log('\n-- spoilers (W2.L2) --')
{
  const out = render('<span data-mx-spoiler="">hidden</span>')
  check('spoiler class applied', out.includes('tc-spoiler'), out)
  check('keyboard reachable', out.includes('tabindex="0"'), out)
  check('announced as a button', out.includes('role="button"'), out)
  check('collapsed state announced', out.includes('aria-expanded="false"'), out)
  check('the hidden text survives to be revealed', out.includes('hidden'))

  const reasoned = render('<span data-mx-spoiler="ending">hidden</span>')
  check('reason preserved for the CSS label', reasoned.includes('data-mx-spoiler="ending"'), reasoned)

  // A sender-supplied reason is rendered by CSS content: attr(). It must stay
  // an attribute VALUE and never become markup.
  // Re-PARSE the output rather than string-matching it. `<` inside an attribute
  // VALUE is legal and inert, so a substring test both false-positives and
  // proves nothing about what a browser would build.
  const nastyReason = render('<span data-mx-spoiler="&lt;img src=x onerror=alert(1)&gt;">hidden</span>')
  const reparsed = dom.window.document.implementation.createHTMLDocument('')
  reparsed.body.innerHTML = nastyReason
  check('hostile reason builds no element', reparsed.body.querySelectorAll('img').length === 0, nastyReason)
  check(
    'hostile reason stays an attribute value',
    reparsed.body.querySelector('[data-mx-spoiler]')?.getAttribute('data-mx-spoiler') === '<img src=x onerror=alert(1)>',
    nastyReason,
  )

  // tabindex/role are OURS. A sender's must be dropped in pass 1 -- a
  // sender-controlled tabindex could reorder the page's focus order.
  const senderAttrs = render('<b tabindex="5" role="alert">x</b>')
  check('sender tabindex dropped on a non-spoiler', !senderAttrs.includes('tabindex'), senderAttrs)
  check('sender role dropped on a non-spoiler', !senderAttrs.includes('role'), senderAttrs)
  const senderSpoilerAttrs = render('<span data-mx-spoiler="" tabindex="99" role="alert">x</span>')
  check('sender tabindex on a spoiler is replaced by ours', senderSpoilerAttrs.includes('tabindex="0"'), senderSpoilerAttrs)
  check('sender role on a spoiler is replaced by ours', !senderSpoilerAttrs.includes('alert'), senderSpoilerAttrs)

  check('a script inside a spoiler still dies', !render('<span data-mx-spoiler=""><script>alert(1)</script></span>').includes('alert(1)'))
}

console.log('\n-- class survives ONLY as a code-block language hint (W2.L1) --')
{
  // `class` is permitted in the highlighting path, so these are the checks
  // that stop it becoming a general-purpose styling hole. Our own UI is styled
  // by class: a message able to set class="tc-row-actions" on its content
  // could paint something that looks like part of the app.
  check('class on a bold is deleted', !render('<b class="anything">x</b>').includes('class'))
  check('class on a span is deleted', !render('<span class="anything">x</span>').includes('class'))
  check('class on a link is deleted', !render('<a href="https://x.test" class="anything">x</a>').includes('class'))
  check(
    'an app class cannot be applied to message content',
    !render('<span class="tc-row-actions">x</span>').includes('tc-row-actions'),
  )
  check(
    'a non-language class on <code> is deleted',
    !render('<code class="tc-row-actions">x</code>').includes('tc-row-actions'),
  )
  check(
    'a language hint on <code> is honoured',
    render('<pre><code class="language-js">const a = 1</code></pre>').includes('language-js'),
  )
  check(
    'mixed classes on <code> keep only the language token',
    (() => {
      const out = render('<pre><code class="tc-evil language-js other">const a = 1</code></pre>')
      return out.includes('language-js') && !out.includes('tc-evil') && !out.includes('other')
    })(),
  )
}

console.log('\n-- syntax highlighting (W2.L1) --')
{
  const out = render('<pre><code class="language-js">const a = 1</code></pre>')
  check('code block is highlighted', out.includes('hljs'), out)
  check('highlighting emits spans', out.includes('<span'), out)
  check('only hljs-* classes are emitted inside the block', !/class="(?!hljs)[^"]*"/.test(out.replace(/class="hljs language-js"/g, '')), out)
  check('the code text survives', out.includes('const') && out.includes('1'))

  // The code TEXT is attacker-controlled. It must come out as text, never markup.
  const nasty = render('<pre><code class="language-js">&lt;img src=x onerror=alert(1)&gt;</code></pre>')
  // The literal text "onerror=" DOES appear -- inside &lt;...&gt;, which is
  // inert. The property that matters is that the angle brackets stay escaped,
  // so no element is ever constructed from code text.
  check('angle brackets in code text stay escaped', nasty.includes('&lt;img'), nasty)
  check('no img element is created from code text', !nasty.includes('<img'), nasty)
  check(
    'the only tags present are our own pre/code/span',
    (nasty.match(/<([a-z]+)/gi) ?? []).every((t) => ['<pre', '<code', '<span'].includes(t.toLowerCase())),
    nasty,
  )

  const nastyUnknown = render('<pre><code class="language-notareallanguage">x</code></pre>')
  check('an unknown language does not throw or inject', !nastyUnknown.includes('notareallanguage'))

  check('inline code is left alone', render('<code>x</code>') === '<code>x</code>')
  check('a pre without code is left alone', render('<pre>x</pre>') === '<pre>x</pre>')
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
