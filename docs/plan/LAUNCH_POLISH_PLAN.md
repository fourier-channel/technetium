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
| L1 | The thread list has dead space above and below the thread cards; remove it | todo |
| L2 | Threads travel two positions per mouse-wheel tick; it should be one | todo |
| L3 | The thread list's title bar: the panel's label "Thread Listing" centred; left of centre "Show Threads: (Here) (Everywhere)"; right of centre "Sort By: (Replies)" | todo |
| L4 | Pin a thread: it keeps the leftmost/first position whatever sort is chosen | todo |
| L5 | For ALL images, the tag bubble sits underneath the image, its top-left anchored to the image's bottom-left. Reuse chanbooru's Modulation preset: the creator tag ALWAYS shows, the character tag whenever present; the rest hide behind the "expose tags" button, which unfurls to the right as a true attached popup that may cover the user list -- not constrained to its own panel in thread view | todo |
| L6 | Reactions own the first column on the right side of the image; the unfurled tag list may overlap them | todo |
| L7 | Emoji about twice as big as they are now, in general | todo |

---

## Readings chosen, and why

(Filled as each row is taken.)

---

## Ledger

One line per landed step, appended as it lands.

| step | result | pendings |
| --- | --- | --- |
