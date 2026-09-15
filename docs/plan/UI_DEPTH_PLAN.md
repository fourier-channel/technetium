<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/docs/plan/UI_DEPTH_PLAN.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
# UI_DEPTH_PLAN.md -- technetium ui-depth-v1 campaign ledger

> Spec + ledger for the campaign opened 2026-09-15 from an operator braindump.
>
> Same discipline as PARITY_PLAN.md, INTERACTIONS_PLAN.md and E2EE_DM_PLAN.md:
> a fresh session boots from CLAUDE.md + this file, and from nothing else.
> Every landed step writes its result here immediately. Written client-clean
> -- no infra internals, origins, ports, room names or gating config.

---

## Compact state

| field | value |
| --- | --- |
| campaign | ui-depth-v1 |
| branch | `main` (no branches -- operator correction 2026-09-14) |
| base | `main` at `eed0567`, "docs: site design delivered from canon" |
| measured gate at base | lint 0 problems / check 1633 ok / build passing (2026-09-15) |
| measured gate at `9e502d9` | lint 0 problems / check 1869 ok / build passing (2026-09-15) |
| deploys | operator's call, `./deploy.sh` only |

**The baseline numbers in CLAUDE.md were stale at the start of this campaign.**
It recorded "23 problems (22 errors, 1 warning)" for lint and "981 checks";
measured at `eed0567` on 2026-09-15 the tree lints CLEAN and runs 1633 checks.
The gate to hold is therefore ZERO lint problems, not 23. Recorded here rather
than silently obeyed: WORKING-RULES rule 0 -- current state is not a rule, and a
number nobody re-measured is the case rule 6 exists for.

---

## The brief, as given

The operator's braindump of 2026-09-15, one row per ask. Nothing here was
narrowed; where a reading had to be chosen it is stated in the row.

| id | ask | state |
| --- | --- | --- |
| U1 | Title/header bars must read as distinct from the panel they head -- a fade toward a darker grey, either direction | DONE `1204465` |
| U2 | Dividers get depth (3d/squishy), outlined subtle 41chan GREEN when their panel is neutral and subtle 41chan ORANGE when it is active | DONE `1204465` + `9a89393` |
| U3 | The post time pushes the bubbles down; append it to the END of the bubble instead | DONE `83bac08` |
| U4 | Bubbles are too tall -- shrink about 20-25% | DONE `83bac08` -- measured 42.1px -> 32.9px, 22% |
| U5 | The question/exclamation/thinking bubble animators are low quality: pill first, then pop to the jagged burst keeping both colours; pill then morph to cloudy bubbles; pill with question marks floating up over it, fading in on spawn and out on despawn | DONE `4432b35` |
| U6 | Enter with an image attached must POST it, not open something | DONE `9889adc` |
| U7 | The Edit User interface must work in both the room list and the chat panel, and must set room power level | DONE `d3f1fab` |
| U8 | A Server Permissions tab in Settings: the whole server structure, every space/room's settings at a glance, everyone above a power-level floor, alphabetised and ranked by power; set moderators and voices; confirm every room holds the right settings and change them; visible to the operator only | DONE `c60c816`, `9e502d9` |
| U9 | User list: an on-panel display toggle that obeys low-animation mode, with the CURRENT display as the low-animation version; the animated version adds avatars, bigger type, more spacing, and pulses an honorific while active | DONE `fda1b83` |

---

## Readings chosen, and why

Recorded because a reading is a decision and an unrecorded decision is
re-litigated by the next session.

**U2, which divider belongs to which panel.** The operator's worked example is
the whole rule: *"pulling out domain mode changes domain's left divider to
orange. the right side would still be green, unless thread view is also open.
in that case, left domain wall is orange, the shared wall is orange, and thread
view's right wall is green."*

The only rule that satisfies both halves is **a divider belongs to the panel on
its right -- the panel it is the leading edge of**, and it is ORANGE when that
panel is one that gets PULLED OUT and is currently out. The shared wall between
the domain and the thread view is the thread view's left wall, so it goes
orange when the thread view is out; the thread view's right wall is the member
list's left wall, and the member list is standing furniture, so it stays green.
That is also exactly how the tree already renders them: every right-hand panel
emits its own `ResizeHandle` immediately before itself.

**U7, "the room list".** The braindump's other row calls the member panel the
"User List", so "room list" here is read as the room-list side of the app --
and the practical answer covers both: `ProfileActions` is the one component
behind the card in the member panel AND in the chat panel, so the power-level
editor lands in both surfaces by being written once (D-tc01).

**U8, "correct settings".** No server policy was handed down, so the panel does
not invent one. It reports two different kinds of finding and labels them
differently: HARD rules, which are true of any Matrix room regardless of taste
(a room with no administrator cannot be administered; `users_default` above 0
makes every joiner an operator; the power-levels event itself must not be
sendable by everyone), and OUTLIERS, which are rooms disagreeing with the rest
of this server's own rooms on a setting. An outlier is not called a fault.

**U9, "pulse when active".** Read as a steady state, not a one-shot: an
honorific pulses while that member is ONLINE. Bounded per
`infinite-animations-cost-a-core`: an infinite animation may touch transform or
opacity and nothing else, and this campaign adds the check that enforces it.

---

## Standing law carried into this campaign

- **No branches.** Commit to `main` (operator correction 2026-09-14).
- **Gate before every commit**: typecheck clean + lint at ZERO + `npm run check`
  passing + build passing. Run the gate ALONE and read its exit code before
  committing -- never chain a commit after a gate.
- **Commit per step**, factual message, push after every commit.
- **ASCII** in new and edited committed content except functional literals.
- **Sanitizer changes are their own commit.** Nothing in this campaign touches
  the sanitizer; if that changes, that change is its own commit with a test
  proving script/style/on*/javascript: still die.
- **Every landed step writes its result to this table IMMEDIATELY.**
- Draft phase nodes are `draft-NN` labels in the devlog, never well-formed
  phase IDs (G-e5128a).
- **NO DEPLOYS** unless the operator says so, and then only `./deploy.sh`.

---

## What this box can and cannot verify

vesper is headless, and the standing rule has been that browser behaviour is
never claimed, only logged as PENDING OPERATOR VERIFICATION. **That rule is
narrowed for this campaign, deliberately:** a Playwright Chromium build is
installed on this box and renders, so a CSS surface CAN be rendered here and
looked at. Every visual row below carries a rendered screenshot taken from the
repo's own stylesheet.

What that proves: the stylesheet produces the intended shape. What it does NOT
prove: the React tree hands that stylesheet the markup the harness assumes, and
nothing here exercises a live Matrix client. Rows that depend on live data
still say PENDING OPERATOR VERIFICATION, and say which half was seen.

---

## Ledger

One line per landed step, appended as it lands.

| step | result | pendings |
| --- | --- | --- |
| U3 + U4 `83bac08` | The timestamp floats right at the end of the bubble instead of owning a 14px line above it; the bubble is 22% shorter (6px lead, 1.35 leading) and the avatar 40px -> 34px, because the line's height is max(bubble, avatar) and the avatar was the taller of the two. `display: flow-root` contains the float on the bubble and on the bodies that get no bubble. | None. Measured with tools/visual against this tree's own stylesheet: 42.1px -> 32.9px. |
| U5 `4432b35` | All three animators open as the ordinary pill and then become something: the burst keeping its border and fill, the cloud, the floating question marks. The shape is a layer behind the words with a drop-shadow outline; three separate CSS facts had to be learned the hard way and are written into the file (filter is applied before clip-path on the same element; a negative-z-index layer is painted over by any opaque element background above it; a tiled silhouette in a translucent colour seams where its layers overlap). Sequenced by `ui/useBubbleFx.ts`, play-once on first sight, unmounted on a timer. | Motion itself was not watched running -- the phases were rendered as stills. PENDING OPERATOR VERIFICATION for the pacing. |
| U5b `472481b` | The org rule from `infinite-animations-cost-a-core` is now a check over every stylesheet and CSS-in-JS block in `src/`. It found THREE violations, one of them the exact incident: the DM waiting glow animated `box-shadow` forever on a face that is lit for as long as a DM is unread. All three fixed; one exemption (the layout editor's marching ants) carries its reason and is asserted to still be real. | None. |
| U6 `9889adc` | Enter with a picture waiting posts it. It was a focus bug: attaching leaves focus on the attach button, so Enter re-opened the file chooser. The caret now moves to the composer when a picture lands, and a panel-level Enter rule (pure, 20 checks) covers wherever focus actually ends up. | The browser's focus behaviour was not observed. PENDING OPERATOR VERIFICATION. |
| U7 `d3f1fab` | A room power-level editor on the shared `ProfileActions`, so the member list, the chat panel AND the domain canvas get it from one implementation. The homeserver's three rules and the one exception (you may always lower your own level) are a pure module with 29 checks, mutation-tested three ways. Every refusal names its remedy; both one-way doors are flagged before the click. | No live room was edited. PENDING OPERATOR VERIFICATION for the round trip. |
| U9 `fda1b83` | The user list gets an on-panel Full/Compact switch. Compact is exactly the old display and is what low animation forces; the preference survives the override and the panel says when it is in force. The honorific pulse is opacity-only on a pseudo-element copy, gated on rich + a rank + the server actually saying online. | None. |
| U8 `c60c816`, `9e502d9` | A Server Permissions tab: the whole structure nested and alphabetised, every setting at a glance, everyone in a power window (10-100 by default, both ends inclusive), the ranks settable from the row, and a search to give a rank to somebody who holds none. The audit reports FAULTS and DIFFERENCES separately and never calls a difference a fault; a consensus needs a strict majority, and with too few rooms the panel says so instead of showing an empty list. Visible when Synapse's admin API says so, and it says out loud that this hides a view and not the information. | No live server was audited and no level was set from the panel. PENDING OPERATOR VERIFICATION. |
| U2b `9a89393` | The reading pane opens over an open domain. Closed the finding above. | Needs a screen of at least ~1440px wide for all three at once; below that the conversation's 320px minimum refuses, visibly. |
| U1 + U2 `1204465` | `.tc-panel-head` sinks every title bar below its panel with a shade and a lip; `.tc-divider` gives every wall a groove, a raised rail, a squash, and a tone outline. `ui/dividerTone.ts` holds the tone rule, 26 new checks. The room list's header left the scroller; the settings dialog's title row is sticky. The domain got a drag grip it never had. | **U2b below.** Hover and grab behaviour is CSS-only and was not driven by a pointer -- PENDING OPERATOR VERIFICATION for the feel of the squash. |

---

## U2b -- the state the operator's own example describes is unreachable

Found while writing U2's check, measured, and NOT fixed in that commit.

With the domain open, `openThreadView` refuses at **every fraction and every
screen size**. It takes the whole of the thread view's width from the panels
whose right edge touches the region -- once the domain is out, that is only the
domain -- and the domain cannot spare that much above its 240px minimum. The
width IS available: on a 1440px screen the domain can spare 0.135 of the screen
and the conversation another 0.146, against the 0.208 the thread view needs. It
is never asked for, because the squeeze does not cascade left.

So "domain out AND thread view open" -- the case the operator describes in the
U2 brief, the one with three walls in it -- cannot currently be reached by
clicking. Opening a thread with the domain out silently does nothing.

The fix is a cascading squeeze in `openThreadView`: the rightmost column gives
what it can spare above its minimum, the remainder comes from the column to its
left, and everything already squeezed travels left with it. The complication
worth writing down before starting is that the DM dock spans the whole region
width, so it is not a member of any column and has to take the total reduction
in one go while the columns below it cascade.

`checks/dividerTone.check.ts` builds that state by hand and says so, so fixing
the geometry cannot quietly hide the tone rule, or the reverse.

| state | value |
| --- | --- |
| id | U2b |
| found | 2026-09-15, writing U2's check |
| touches | `src/ui/space.ts` `openThreadView`, which is fuzz-checked |
| state | **CLOSED** `9a89393` |

**How it was fixed, and the thing that nearly went wrong.** The region is now
squeezed into what is left by an affine map of its x axis -- every open panel
shrinks in proportion -- rather than by a cascade down the columns. The cascade
was the obvious answer and it is wrong here: the DM dock spans the whole region
while the conversation and the domain split the part below it, so a per-column
walk shrinks the dock by the first column's share only and leaves it
overlapping the new pane. One transform preserves the tiling in every
horizontal band by construction.

Where only the chat is in the region, proportional and subtractive are the same
arithmetic, so the ordinary case is untouched. A screen that genuinely cannot
hold all three still refuses: 1280x800 does, because the conversation would
land at 292px against its 320px minimum. That is a minimum doing its job and it
is a different thing from the silent refusal it replaces.
