// ---------------------------------------------------------------------------
// Which speech bubble a line gets.
//
// The SHAPES are the feature; these rules are only how a line is matched to
// one, and they are deliberately all in one function so retuning them is a data
// change rather than a hunt. If the operator would rather choose per message
// than have it inferred, this is the piece that gets replaced -- the four
// bubbles do not care where the answer comes from.
//
// Conventions people already use, not ones invented here: a trailing '?' asks,
// a trailing '!' or all-caps shouts, and a wholly parenthesised or trailing-off
// line is an aside. Nothing new to learn, and nothing to opt into.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export type BubbleTone = 'standard' | 'thinking' | 'yelling' | 'questioning'

// Shouting needs enough letters to be a word rather than an initialism: "OK"
// and "IMO" are not raised voices.
const MIN_SHOUT_LETTERS = 4

export function bubbleTone(body: string): BubbleTone {
  const text = body.trim()
  if (!text) return 'standard'

  // An aside, first: "(if anyone is still reading)" is a thought even when it
  // ends in a question mark, because the brackets are the stronger signal.
  if (/^\(.*\)$/s.test(text) || /(\.\.\.|…)$/.test(text)) return 'thinking'

  // Volume beats interrogation, so "WHAT?!" shouts rather than asks -- which is
  // how it reads out loud.
  //
  // ASCII letters only, on purpose. `toUpperCase()` is the identity for scripts
  // without case, so testing "is it already uppercase" would call every CJK or
  // Cyrillic message a shout. Those scripts simply have no caps-lock tell, and
  // inventing one for them would be worse than not having it.
  const letters = text.replace(/[^a-z]/gi, '')
  const shouting =
    letters.length >= MIN_SHOUT_LETTERS && letters === letters.toUpperCase()
  if (text.endsWith('!') || shouting) return 'yelling'

  if (text.endsWith('?')) return 'questioning'
  return 'standard'
}
