<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/docs/plan/LAUNCH_POLISH_PLAN.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
# LAUNCH_POLISH_PLAN.md -- technetium launch-polish campaign ledger

> Spec + ledger for the campaign opened 2026-09-24 from an operator braindump,
> with more asks announced ("more to come").
>
> Same discipline as the earlier ledgers: a fresh session boots from CLAUDE.md
> + this file. Every landed step writes its result here immediately. Written
> client-clean -- no infra internals, origins, ports, room names or gating
> config.

---

## Compact state

| field | value |
| --- | --- |
| campaign | launch-polish |
| branch | `main` (no branches) |
| base | `main` at `3564e92` |
| gate at base | `npm run gate` passing, lint 0 problems (2026-09-24) <!-- derived-ok: dated --> |
| deploys | operator's call, `./deploy.sh` only |

**Why this campaign is named for launch.** On 2026-09-21 the operator said
launch is imminent and held domain mode back for it. Everything in this brief
is about how the surfaces people will reach on day one look and behave.

---

## The brief, as given

Operator, 2026-09-24, one row per ask. Nothing here was narrowed; where a
reading had to be chosen it is stated below.

| id | ask | state |
| --- | --- | --- |
| L1 | The thread list has dead space above and below the thread cards; remove it | DONE `db9208f` |
| L2 | Threads travel two positions per mouse-wheel tick; it should be one | DONE `58921de`, `906c73d` |
| L3 | The thread list's title bar: the panel's label "Thread Listing" centred; left of centre "Show Threads: (Here) (Everywhere)"; right of centre "Sort By: (Replies)" | DONE `db9208f`, `d43f19a` |
| L4 | Pin a thread: it keeps the leftmost/first position whatever sort is chosen. Clarified 2026-09-24: "an admin-pinned thread that has priority over all others. For example, I would pin the 'Welcome' thread in the one room everyone automatically lands in: #chat. Pinned threads would start open by default, and hideable behind a Pushpin icon." | DONE `f1391fa`, `385119f` |
| L8 | Drag-to-reorder in the thread strip: "we can drop that functionality now" | DONE `f1391fa` |
| L5 | For ALL images, the tag bubble sits underneath the image, its top-left anchored to the image's bottom-left. Reuse chanbooru's Modulation preset: the creator tag ALWAYS shows, the character tag whenever present; the rest hide behind the "expose tags" button, which unfurls to the right as a true attached popup that may cover the user list -- not constrained to its own panel in thread view | DONE `6138231` |
| L6 | Reactions own the first column on the right side of the image; the unfurled tag list may overlap them | DONE `6138231` |
| L7 | Emoji about twice as big as they are now, in general | DONE `6138231` |
| L9 | Operator, 2026-09-25: the room, DM and thread title bars are "too thick" -- shrink them about 50% -- "and restyle the buttons so they're not all Windows 3.1" | DONE `62f5cfc` |
| L10 | "the space between status update lines and date changes": about 50% less | DONE `62f5cfc` |
| L11 | "I regret that we are going back to the old Discord-style 'avatar on the left, name on the top right, text under name'"; avatar on the first message of a run only (asked, answered) | DONE `62f5cfc` |
| L12 | Operator, 2026-09-26: "the avatar travel down the gutter to match each new line ... the NAME stays at the top ... the previous lines then lose their speech arrows, while keeping the other effects" | DONE `d226e73` |

---

## Readings chosen, and why

Recorded because a reading is a decision and an unrecorded decision is
re-litigated by the next session.

**L1, "dead space".** The strip is exactly header + card + a tab lane, a
fixed 180px, rather than a share of the layout: nothing in the interface
resizes it, so there was never a size the user chose for a share to honour.

**L2, "one position per tick".** A notch is known by its TIMING, not its
size: an event arriving on its own steps once whatever its delta (notches
run from 4px to 400px across browsers and mice); a burst of events a few ms
apart is a stream (hi-res wheel, trackpad) and is paced at about a card's
width of scroll per step. A very fast spin may move fewer cards than
notches; it never moves more.

**L3, "Sort By: (Replies)".** Read as a pill showing the CURRENT sort, like
"(Here) (Everywhere)", that opens the choices (Latest, Created, Replies, and
Custom once a drag has made one). It is a native select wearing the pill, so
its list is drawn outside the strip. "Left of centre" / "right of centre"
read as the two sides of a centred title, hugging the edges.

**L4, "Pin".** A pin is the ROOM's: one `net.41chan.thread.pins` state event
per room, listing its pinned thread roots in order. Everyone in the room sees
pinned threads first under every sort; only someone the room's power levels
allow to send that state gets the control, and everyone else sees a pushpin
mark. Several pins keep their order and a new one is appended. "Here" shows
this room's pinned threads first; "Everywhere" shows every room's pins first,
the current room's leading. Not `m.room.pinned_events`, which is pinned
MESSAGES and has its own panel.

**L4, "start open, hideable behind a Pushpin icon".** Asked, and answered
"out in the thread strip": entering a room whose pinned threads you have not
folded away pulls the strip down, once per entry, with them at the front. The
pushpin at the strip's left end folds them out of the strip (not back into the
order) and brings them back, with a count. Folds are yours, per thread, in
account data -- a thread pinned later starts out again -- and folded threads
stop opening the strip. Closing the strip sticks for that visit.

**L5, "the creator tag".** The ARTIST-category tag -- every upload mints the
poster's tag as artist, and Modulation's creator axis is built from artist
names. Never provenance 'creator', which is the private prompt bucket.
Modulation's shelf also shows copyright; the operator named creator and
character, so copyright folds. The button is labelled as the operator named
it, "expose tags". The popup opens ON the button, with "collapse" where
"expose tags" was, so it reads as the button unfurling.

**L5, "for all images".** Every image that is a message -- the timeline, the
DM dock, the thread view, the lightbox -- gets the line under it. Gallery
cells, thread-card covers and canvas cards are tiles in a fixed mosaic and
keep their count chip, which now opens the same popup (and no longer clips
it). If the mosaic should carry lines too, that is a one-line change of
variant per surface.

**L6.** The reactions are one column; if they outgrow the picture's height
the column continues down rather than opening a second one.

**L7, "in general".** Every reaction pill, the rail's "+", and custom emoji,
everywhere reactions show. Not emoji inside message text (that would undo
the U4 bubble height), and not the "+" inside a text line, which is a
control and keeps its size.

**L9, "title bars".** Asked which headers, answered: the room, DM and thread
title bars. Their buttons were the browser's own grey bevelled buttons; they
now wear the thread strip's pill -- the one header-control shape already built
for that bar (L3) -- rather than a second style. The DM dock stacked its own
bar over the room header of the timeline inside it; it is now one bar.

**L10, "status update lines".** The membership lines (joins, leaves, name
changes) and the date dividers between days.

**L11, "the old Discord-style".** Avatar at the left of the FIRST message of a
run only, the name on the top line to its right, the text under the name;
follow-up lines keep the text column and carry no avatar. The narrow thread
panel keeps its one-line user line, which is already that shape without a
gutter. Bubbles and the trailing timestamp are unchanged.

---

## Ledger

One line per landed step, appended as it lands.

| step | result | pendings |
| --- | --- | --- |
| L2 `58921de` | The wheel's rule became wheelStep in carousel.ts, pure and checked: one step per event at most, the remainder spent. | Superseded by the second pass below. |
| L1 + L3 + L4 `db9208f` | The strip is 180px -- header 32 + 8 + card 124 + 16 -- every part declared in the CSS and compared by checks/threadStrip; the card is border-box (which also ended a 2px-per-card centring drift) and its foot row appears for the first time. The title bar is three columns with the title centred. Pins: applied last, in account data, optimistic; pinned cards are not draggable. | PENDING OPERATOR VERIFICATION: the pin round trip, the sort pill's list, the tab positions. |
| L5 + L6 + L7 `6138231` | Tags under the picture as one line exactly its width; the rest in AnchoredPopup, portalled over the page, which follows its control and cannot be clipped. Chips open the same popup. Reactions are the first column beside the picture; emoji 2x from one set of tokens; custom emoji in a box of definite size. | PENDING OPERATOR VERIFICATION: the live read filling the line, the popup over the member list and the lightbox. |
| review `d43f19a` | An adversarial review of the strip commits confirmed 12 defects; this fixes: pins lost a fast second click (the SDK skips a write equal to its stale store) -- now one write in flight, never ahead of its echo (client/pinSync.ts, checked against a fake SDK server); the DM tab covered the scope pills -- now on the strip, right of the title, clamped; the strip was a scroll container that a focused Pin could scroll -- now overflow:clip; header columns named; the freeze release resets the idle detector. | None beyond the browser feel. |
| L2 second pass `906c73d` | A notch is known by its timing, not its size: the first rule stalled on small-notch mice (4px ticks) and let trackpad flings cross the list. Checked against the reviewers' streams; fails 12 ways against the first rule. Enter after clicking a Pin opens the card; a drag keeps pinned threads' places. | PENDING OPERATOR VERIFICATION: the feel under a real wheel and trackpad. |
| L4 revised + L8 `f1391fa` | Pins are room state, moderators only, applied last; sliding sync requests the event. Drag-to-reorder, the Custom sort and the "new" chip are gone from the thread list; threadDrag.ts stays for the room list. | PENDING OPERATOR VERIFICATION: a moderator pinning and a member seeing it first. |
| L4 start-out `385119f` | Pinned threads pull the strip down on entering their room, once per entry; a pushpin at the strip's left end folds them away and back, per person, in account data. | PENDING OPERATOR VERIFICATION: a newcomer landing in #chat. |
| L9 + L10 + L11 `62f5cfc` | Title bars a declared 24px (room 51 -> 24, thread 47 -> 24, DM 88 -> 24, one bar in the dock); buttons are the thread strip pill, one rule. Date dividers and membership lines at half their spacing. Rows in the Discord shape, avatar and name on the first message of a run. | PENDING OPERATOR VERIFICATION: all three in the browser. |
| L12 `d226e73` | The avatar sits beside a run's newest line and travels down to each new one (transform, skipped under reduced motion); the name stays on the first line; earlier lines keep their bubble and lose the arrow. | PENDING OPERATOR VERIFICATION: the travel in the browser. |
