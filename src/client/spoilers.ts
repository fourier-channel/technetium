// ---------------------------------------------------------------------------
// W2.L2 -- spoiler rendering (MSC2010).
//
// The wire format is `<span data-mx-spoiler>hidden</span>`, or
// `<span data-mx-spoiler="reason">hidden</span>` where the reason is shown
// unblurred as a label.
//
// `data-mx-spoiler` is the only data attribute permitted through the
// sanitizer, and it is permitted BY NAME -- ALLOW_DATA_ATTR stays false, so no
// other data-* survives. Its value is a sender-supplied reason string that we
// render as TEXT, never as markup.
//
// tabindex/role/aria-expanded are added HERE, by us, after sanitizing has
// already deleted any the sender supplied (they are not in the pass-1
// allowlist). A sender-controlled tabindex could reorder the page's focus and
// a sender-controlled role could lie to a screen reader, so they are ours to
// set and never theirs.
// ---------------------------------------------------------------------------

export const SPOILER_ATTR = 'data-mx-spoiler'

// Class the delegated click handler toggles to reveal.
export const SPOILER_REVEALED_CLASS = 'tc-spoiler-revealed'

export function prepareSpoilers(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`[${SPOILER_ATTR}]`))) {
    // A reason is shown next to the blur, so the reader can decide. Kept as an
    // attribute rather than injected markup: CSS renders it via content:
    // attr(), so it can never become an element.
    const reason = el.getAttribute(SPOILER_ATTR) ?? ''

    el.setAttribute('class', 'tc-spoiler')
    el.setAttribute('tabindex', '0')
    el.setAttribute('role', 'button')
    el.setAttribute('aria-expanded', 'false')
    el.setAttribute(
      'aria-label',
      reason ? `Spoiler: ${reason}. Activate to reveal.` : 'Spoiler. Activate to reveal.',
    )
  }
}

// Toggle one spoiler. Called from the delegated handler on the message body,
// which is how a dangerouslySetInnerHTML subtree gets behaviour at all.
export function toggleSpoiler(el: Element): void {
  const revealed = el.classList.toggle(SPOILER_REVEALED_CLASS)
  el.setAttribute('aria-expanded', revealed ? 'true' : 'false')
  if (revealed) el.setAttribute('aria-label', 'Spoiler revealed')
}
