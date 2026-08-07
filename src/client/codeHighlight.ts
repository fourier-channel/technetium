import hljs from 'highlight.js/lib/common'

// ---------------------------------------------------------------------------
// W2.L1 -- syntax highlighting for code blocks in received messages.
//
// SECURITY SHAPE. This is the only place `class` is permitted to survive
// sanitizing, so the order below is load-bearing:
//
//   1. sanitize WITH class allowed  -- so `<code class="language-js">` from
//      Element survives long enough for us to read the language hint
//   2. scrubClasses()               -- delete every class attribute except
//      `language-*` on a <code>. This is what removes an attacker's classes,
//      and it runs before anything is rendered
//   3. highlight                    -- hljs reads textContent (already parsed,
//      so already inert) and emits its own escaped markup with hljs-* classes
//   4. sanitize again               -- defence in depth; by now the only
//      classes present are ones WE generated
//
// Why class is worth guarding at all: our own UI is styled by class. A message
// that could set `class="tc-row-actions"` on its own content could paint
// something that looks like part of the app. Step 2 is what makes step 4's
// allowance safe -- its input is our output, not the sender's.
// ---------------------------------------------------------------------------

// Highlighting is synchronous and runs during render. A pasted 10k-line file
// should not freeze the timeline, so beyond this it renders plain.
const MAX_HIGHLIGHT_CHARS = 20_000

// Auto-detection is a guess, and an expensive one. Only attempt it on small
// blocks with no declared language; a big undeclared block renders plain.
const MAX_AUTODETECT_CHARS = 2_000

const LANGUAGE_CLASS = /^language-([A-Za-z0-9_+-]+)$/

// Strip every class attribute in the tree except `language-*` on a <code>.
//
// Exported for the security tests: this is the step that stands between a
// sender's markup and our stylesheet.
export function scrubClasses(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('[class]'))) {
    const isCode = el.tagName.toLowerCase() === 'code'
    if (!isCode) {
      el.removeAttribute('class')
      continue
    }
    const kept = el.className
      .split(/\s+/)
      .filter((token) => LANGUAGE_CLASS.test(token))
    if (kept.length > 0) el.setAttribute('class', kept.join(' '))
    else el.removeAttribute('class')
  }
}

function declaredLanguage(code: Element): string | null {
  for (const token of code.className.split(/\s+/)) {
    const m = LANGUAGE_CLASS.exec(token)
    if (m && hljs.getLanguage(m[1])) return m[1]
  }
  return null
}

// Highlight every <pre><code> in place. Mutates the document.
export function highlightCodeBlocks(root: ParentNode): void {
  for (const code of Array.from(root.querySelectorAll('pre > code'))) {
    const text = code.textContent ?? ''
    if (text.length === 0 || text.length > MAX_HIGHLIGHT_CHARS) continue

    const declared = declaredLanguage(code)
    let result: { value: string; language?: string }
    try {
      if (declared) {
        // ignoreIllegals: a snippet is usually a fragment, and a strict parse
        // failure should degrade to plain text, never throw mid-render.
        result = hljs.highlight(text, { language: declared, ignoreIllegals: true })
      } else if (text.length <= MAX_AUTODETECT_CHARS) {
        result = hljs.highlightAuto(text)
      } else {
        continue
      }
    } catch {
      continue // leave the block as plain text
    }

    // hljs escapes its input and emits only hljs-* classed spans, so this is
    // our own markup -- and it is re-sanitized by the caller regardless.
    code.innerHTML = result.value
    const lang = declared ?? result.language
    code.setAttribute('class', lang ? `hljs language-${lang}` : 'hljs')
  }
}
