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
| U1 | Title/header bars must read as distinct from the panel they head -- a fade toward a darker grey, either direction | PENDING |
| U2 | Dividers get depth (3d/squishy), outlined subtle 41chan GREEN when their panel is neutral and subtle 41chan ORANGE when it is active | PENDING |
| U3 | The post time pushes the bubbles down; append it to the END of the bubble instead | PENDING |
| U4 | Bubbles are too tall -- shrink about 20-25% | PENDING |
| U5 | The question/exclamation/thinking bubble animators are low quality: pill first, then pop to the jagged burst keeping both colours; pill then morph to cloudy bubbles; pill with question marks floating up over it, fading in on spawn and out on despawn | PENDING |
| U6 | Enter with an image attached must POST it, not open something | PENDING |
| U7 | The Edit User interface must work in both the room list and the chat panel, and must set room power level | PENDING |
| U8 | A Server Permissions tab in Settings: the whole server structure, every space/room's settings at a glance, everyone above a power-level floor, alphabetised and ranked by power; set moderators and voices; confirm every room holds the right settings and change them; visible to the operator only | PENDING |
| U9 | User list: an on-panel display toggle that obeys low-animation mode, with the CURRENT display as the low-animation version; the animated version adds avatars, bigger type, more spacing, and pulses an honorific while active | PENDING |

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
| (none yet) | | |
