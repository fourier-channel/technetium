# INTERFACE_OPTIONS_PLAN.md -- the chosen bubbles, Interface Options, IRC style

> Ledger for the asks of 2026-11-07. Technetium only. Written client-clean.

---

## The brief, as given

The operator picked bubble designs from a comparison page (yelling E "Double
ring", thinking B "Cumulus", questioning E "Raised tail"), then: "Make sure the
bubbles don't clip into/over one another, that the tail is always pointed at
the avatar, and that the tail leaves when the avatar advances to a new line.
In Technetium settings, a new tab at the front for "Interface Options" allow
for this option to be toggled on/off, and let the user decide the color of
each bubble. In this same space the user has a slider that determines the
space between messages. An option to toggle the chat mode to an "IRC-style"
preset which is just the person's username in < > with their honorific
attached to the front. No avatars, no fancy bubbles, just chat in the box,
even, close spacing. Image posts would render as links to the booru post(s).
Very, very minimalistic."

| id | ask | state |
| --- | --- | --- |
| IO1 | Yelling is the double ring: the pill, a canvas gap, a second ring; the pop kept | landed `503919e`, v2026.11.07.3 |
| IO2 | Thinking is the cumulus: an uneven scalloped cloud drawn to the bubble's measured size, with a two-circle trail | landed `503919e`, v2026.11.07.3 |
| IO3 | Questioning is the raised tail: the tail tilted up 22 degrees, the rounded corner and the floating marks kept | landed `503919e`, v2026.11.07.3 |
| IO4 | No bubble clips into or over another | landed `503919e`, v2026.11.07.3 |
| IO5 | The tail always points at the avatar | landed `503919e`, v2026.11.07.3 |
| IO6 | The tail leaves when the avatar advances to a new line | landed `503919e`, v2026.11.07.3 |
| IO7 | Settings gets an "Interface Options" tab, first | landed `503919e`, v2026.11.07.3 |
| IO8 | The styled bubbles can be turned off (every line a plain bubble) | landed `503919e`, v2026.11.07.3 |
| IO9 | The user picks the colour of each bubble | landed `503919e`, v2026.11.07.3 |
| IO10 | A slider sets the space between messages | landed `503919e`, v2026.11.07.3 |
| IO11 | An IRC-style chat mode: `<~name> text`, no avatars, no bubbles, even close spacing, pictures as links to their booru posts | landed `503919e`, v2026.11.07.3 |

## Readings chosen

- **"This option" is the styled bubbles.** Off means every line is the plain
  bubble; the tone detection still runs, nothing about a message changes.
- **Remembered in account data** (`net.41chan.tc.interface`), so it follows the
  person to every device; written one write at a time, never ahead of its echo
  (the pinSync rule, generalised rather than copied).
- **Colours are any colour**, picked with the platform's colour picker, stored
  as `#rrggbb` and admitted only in that exact form. Each tone keeps its own
  strengths (fill and outline alphas), so a picked colour reads as that tone.
  "Reset" returns a tone to its default.
- **Spacing is the gap between rows in whole pixels, 0 to 24, default 8**
  (the gap the timeline had). A bubble whose shape reaches past its box (the
  ring, the cloud) carries its own clearance, so even 0 cannot make two
  bubbles touch.
- **IRC style** shows the display name (what people know each other by), the
  rank glyph from the same rule as the member list, every line, a dim time in
  front. Replies, reactions and threads stay, as text on the line. The
  message's hover actions stay (they cost no height). A picture is a link to
  its booru post once the booru names it; until then, or when it is not on
  the booru (a direct message), the line says so and opens the picture.
- **IRC style has fixed close spacing.** The slider, the colours and the
  styled toggle apply to Bubbles only; in IRC style they stay visible but
  disabled, with a line saying so, so nothing is lost by switching back.

## What is and is not verified

- **Proved by the check suite.** The stored shape (only exact shapes admitted,
  round-trip, defaults write nothing); the stylesheet's default colours equal
  the picker's (D-tc01); the cloud's reach and the ring stay inside each row's
  clearance for every bubble size, no animation scales past 1, the tails' rays
  enter the avatar's disc (the 22 degree question tail included), the tail is
  off on every line but the speaking one; IRC captions use the same rule as
  bubbles. Sabotaged clearance, scale, tail angle and default colour each
  turn the suite red.
- **Seen in a headless render** (`tools/visual/interface.html`): the IRC rows
  and the Settings tab in both modes. This proves the stylesheet for that
  markup, not the React tree.
- **Served.** v2026.11.07.3 serves the bundle carrying the tab and the IRC
  rows.
- **PENDING OPERATOR VERIFICATION.** Live behaviour against the homeserver:
  the setting following the person to a second device, colour picking and
  the slider redrawing the timeline, IRC links resolving to booru posts.
