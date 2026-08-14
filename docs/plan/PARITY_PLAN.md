# PARITY_PLAN.md -- technetium parity-v1 campaign ledger

> The spine of the parity-v1 campaign. A fresh session re-orients from
> CLAUDE.md + THIS FILE + the current wave section of the handoff.
> Never from re-reading the devlog, never from the audit xlsx.
>
> Every landed step writes its one-line result + pendings here IMMEDIATELY.
> The ledger is the compaction; history is dereferenced, not re-read.

---

## Compact state

| field | value |
| --- | --- |
| campaign | parity-v1 (30 features, 3 audit categories) |
| current wave | **CAMPAIGN COMPLETE, MERGED, DEPLOYED.** 30/30 features; `parity-v1` merged to `main`; live at release `20260808-035127-de5fff9`. |
| pure checks | 447 passing (`npm run check`) -- 17 harnesses; 61 are sanitizer/security |
| devlog | 2 entries appended (Wave 0+1, Wave 2 part 1) |
| branch | `parity-v1` (off `main`) |
| base HEAD | `d4d1494` (main, "Merge branch 'chatbox-domain-v1'") |
| current HEAD | see `git log -1` |
| tsc baseline | CLEAN (`npx --no-install tsc --noEmit -p tsconfig.app.json`, exit 0) |
| lint baseline | **23 problems (22 errors, 1 warning)** -- HOLD THIS NUMBER |
| build baseline | PASSING (`npm run build`, ~700ms, 1.38MB index chunk) |
| deploys | NONE. Ever. tc.41chan.net is the operator's. |
| new deps so far | `jsdom`+`@types/jsdom` (DEV ONLY, O-tp11); `highlight.js` (prod, +57kB gzip); dompurify patched 3.4.11 -> 3.4.13 |

### Lint baseline detail (23 = the number to hold)

Pre-existing, not to be "fixed" opportunistically -- any change that
alters this count needs a ledger line explaining it.

| file | count | rules |
| --- | --- | --- |
| `src/client/ClientContext.tsx` | 7 | react-refresh/only-export-components, 2x "cannot access variable before declared", set-state-in-effect, 3x no-explicit-any |
| `src/client/members.ts` | 6 | no-explicit-any |
| `src/client/spaces.ts` | 3 | no-explicit-any |
| `src/client/tokenRefresher.ts` | 1 | no-explicit-any |
| `src/client/useMembers.ts` | 1 | set-state-in-effect |
| `src/client/useNavTree.ts` | 2 | set-state-in-effect + exhaustive-deps (the 1 warning) |
| `src/ui/Composer.tsx` | 1 | react-hooks/refs -- ref write during render (line 101) |
| `src/ui/Lightbox.tsx` | 2 | react-refresh/only-export-components, set-state-in-effect |

NOTE (correction to the handoff): the handoff names `useThreadList.ts`
set-state-in-effect (G-tc03) as the known pre-existing offender. It is
NOT in the current output -- that one is clean now. The live offenders
are the eight files above.

### Path corrections vs the handoff

- Devlog lives at repo root `devlog-technetium-01.md`, NOT
  `docs/devlogs/devlog-technetium-01.md`. Wave entries append there.
- `CLAUDE.md` already existed (Thread Cards v1 mission, now shipped).
  Wave 0 rewrote its mission block to point at this campaign; the
  operator's standing rules and environment facts were preserved verbatim.
- **`CLAUDE.md` is GITIGNORED by design** (`.gitignore:32`, the "brain/ops
  docs belong in fourier-basis, never in this public repo" guard). It was
  NOT force-added. It lives on vesper only -- so THIS LEDGER is the only
  tracked campaign artifact, and it is written client-clean accordingly:
  no infra internals, origins, ports, room names or gating config.

---

## Claudecision register (O-tp)

| id | decision | status |
| --- | --- | --- |
| O-tp1 | Server-wide member list stays EXCLUDED (recorded ruling wins over literal "all non-Yes"). | **CONFIRMED BY OPERATOR 2026-08-06** -- closed, not reopening |
| O-tp2 | Mute semantics: server push rule is source of truth; local mute setting survives as read-fallback, migrated forward on first toggle-touch (no silent mass-migration). Snooze stays local by design. | open, proceed |
| O-tp3 | Custom emoji standard is MSC2545 image packs (Cinny/nheko interop). | open, proceed |
| O-tp4 | Poll events follow whatever prefix matrix-js-sdk 41.x emits/parses natively; no hand-rolled event support. | open, proceed |
| O-tp5 | Room order persists locally under a `net.41chan.room_order`-namespaced key; account-data portability is a recorded v2 (same pattern as thread order). | open, proceed |
| O-tp6 | FLAG, not a task: redacting an image message does NOT remove its booru post. Cross-component design question for the bmb/chanbooru side. | recorded, no action |

### New this wave

| id | decision | status |
| --- | --- | --- |
| O-tp7 | Devlog stays at repo root (path correction above); no `docs/devlogs/` move -- moving a 122KB tracked file to satisfy a handoff typo is churn. | open, proceed |
| O-tp8 | CLAUDE.md mission block replaced rather than appended -- Thread Cards v1 is shipped (flip.ts, threadDrag.ts, threadOrder.ts, threadOrderStore.ts, pop.ts, reducedMotion.ts all present in tree). Standing rules + environment facts preserved. | open, proceed |
| O-tp9 | Test path is `checks/*.check.ts` run by `npm run check` -- standalone harnesses executed by Node's native TS type stripping. **Zero new dependencies** (no vitest/jest). Justification: the standing law REQUIRES sanitizer negative tests in Wave 2, so a test path must exist; the project already compiles under `erasableSyntaxOnly`, so its sources are directly Node-runnable; and the dependency stance here is prefer-hand-rolled. Constraint: a module under check must import matrix-js-sdk TYPES only. `checks/` is eslint-ignored and outside tsconfig.app's src-only include. If the operator would rather have vitest, this is one `npm i -D` and a rewrite of thin harness scaffolding -- cheap to reverse. | open, proceed |
| O-tp11 | **RESOLVED 2026-08-06 by the operator: add the dependency.** Chose `jsdom` over the recommended `happy-dom` -- these are SECURITY tests and spec-completeness beats speed (DOMPurify's own suite runs against jsdom; a lighter DOM could pass a test a browser would fail). 51 sanitizer checks now run, including a vacuity guard proving the sanitizer is actually executing -- without a DOM, DOMPurify's `sanitize()` returns its input UNCHANGED, so every negative test would have passed while sanitizing nothing. Proven by running the suite with the DOM removed: it fails on assertion one. Also bumped dompurify 3.4.11 -> 3.4.13 (GHSA-c2j3-45gr-mqc4; we use neither affected hook). Original text: The standing law requires sanitizer negative tests for any allowlist WIDENING (syntax highlighting needs `span`+`class`; spoilers need `data-mx-spoiler`). DOMPurify cannot run in bare Node, so the zero-dependency harness (O-tp9) cannot test them. Options: (a) add `jsdom` or `happy-dom` as the campaign's first dev dependency, (b) run those two negative tests in the browser as an operator-verified checklist, (c) restructure the sanitizer so the POLICY is a pure exported object asserted by the harness while the DOM call stays untested. Recommendation: (a) happy-dom -- dev-only, no prod bytes, and the security tests are non-negotiable. NOT proceeding on the widenings until this is answered. | **CLOSED -- jsdom installed, unblocked** |
| O-tp10 | S1 does NOT filter thread replies out of the main timeline. That is pre-existing behaviour (a threaded reply appears both inline and in the panel) and reads as deliberate for a chan-shaped client, so changing it is a product call, not a substrate one. Flagged, untouched. | open, operator's call |

---

## Server-config switchboard (OPERATOR ONLY -- never touched from this repo)

Client side always degrades gracefully: feature silently absent/disabled
when the server says no.

| item | wave | server requirement |
| --- | --- | --- |
| Presence | 4 | `presence.enabled: true` in homeserver.yaml (often off for perf -- operator's call) |
| URL previews | 5 | `url_preview_enabled: true` PLUS a correct `url_preview_ip_range_blacklist` (SSRF guard, not optional) |
| Message search | 5 | server-side `/search` support; Wave 5 probes the capability, falls back to a client-side filter over loaded events if absent |

Client-side rule for all three: probe, then degrade silently. Never fake a
state the server did not give us.

---

## Recon maps (Wave 0)

### Lane A -- timeline / composer / message rendering

**Item model.** `src/client/useTimeline.ts:15-25`
`interface TimelineItem { event: MatrixEvent; kind: TimelineItemKind; id: string; cells?: (MatrixEvent|null)[]; layout?: GalleryLayout }`,
kind at `:11` = `message|encrypted|redacted|other|gallery`. Conversion:
`classify(ev)` `:27`, `toItems(events)` `:64-117` (exported; ThreadPanel
uses it too). No sender/date/grouping/relation fields at all.

**Relations today: NONE.** No `m.replace`, `m.annotation`,
`m.in_reply_to`, `rel_type`, `getRelation`, `replacingEvent` anywhere in
useTimeline. Only subscription is `RoomEvent.Timeline` at `:165`.
Rebuild via `refresh()` `:130-136`; scrollback `:152-159` (depth 60),
`loadOlder` `:173-186` (page 30). No Redaction / LocalEchoUpdated /
Receipt / Typing / Decrypted listeners. Thread awareness is UI-only
(`Timeline.tsx:340` isThreadRoot, `ThreadChip` `:526-565`).

**Row anatomy.** `Row` is a separate exported component
`src/ui/Timeline.tsx:272-344`, **NOT memoized**, reused by
`ThreadPanel.tsx:109`. `SenderPill` `:212-270` (avatar `:233-252`, name
`:253-265`, timestamp `:267`) rendered at `:328`. Body dispatch
`:280-324`; text path `:302-312` uses `renderMessageBody` +
`dangerouslySetInnerHTML`. Footer slot = the thread chip line `:340` --
this is where reactions strip + receipts cluster land.
**Hover affordances: NONE.** No mouseenter, no toolbar, root row div
`:327` lacks `position:relative`.

**Composer.** `src/ui/Composer.tsx`, props `:53-63`
`{room, threadId?, domainTtd?}`. Single `send()` `:158-235`: text branch
`:167-186` (`sendHtmlMessage`/`sendTextMessage`, threadId overload split
`:172-176`), image branch `:191-235` (`uploadContent` `:202`,
`sendMessage(roomId, threadId ?? null, content)` `:216-219`).
Keyboard `:242-247`: Enter sends, Shift+Enter newline; **no Escape, no
ArrowUp, no Tab interception**. Caret machinery `:74`, `:87-96` (the
pattern mention-autocomplete insertion copies). No reply/edit mode state,
no draft persistence.

**Sanitizer.** `src/client/messageBody.ts:7-15` ALLOWED_TAGS =
b,strong,i,em,u,s,del,strike,a,code,pre,blockquote,ul,ol,li,p,br,hr,span,
h1-h6,sub,sup,caption,table,thead,tbody,tr,th,td. `:19` ALLOWED_ATTR =
href,title,alt,colspan,rowspan,start. Call site `:40-46` with
`ALLOW_DATA_ATTR: false`. So today: no `img`, no `mx-reply`, no `class`,
no `data-mx-*` -- reply quoting, spoilers, pills and hljs classes are ALL
stripped. Send side `messageFormat.ts:8-15` is narrower still
(ALLOWED_ATTR `:15` = href,title). Plain-vs-HTML trick: `parseInline`
`:33` -> sanitize `:34-38` -> compare vs `escapeHtml(plain).replace(/\n/g,'<br>')`
`:44`; identical => omit formatted_body `:45-47`. Because it is
`parseInline`, fenced code blocks NEVER produce `<pre><code>` today --
relevant to Wave 2 syntax highlighting.

**Hooks:** item model `useTimeline.ts:15`; fold point `:64-117`;
subscriptions `:165`; Row root `Timeline.tsx:326-343`; footer `:340`;
body render `:302-312`; allowlist `messageBody.ts:7-19`; composer send
+ keys `Composer.tsx:158-186`, `:242-247`; ThreadPanel parity `:72`, `:109`.

### Lane B -- nav tree / rooms / notifications / receipts

**Nav model.** `TreeNode` `src/client/spaces.ts:7-22`
(`roomId, name, isSpace, membership, joinRule, room, children`), hidden
`_order` stamped `:148` from `m.space.child`, consumed by `sortChildren`
`:49-56`. `NavTree = {spaces, orphanRooms}` `:24-27`; built by `buildNode`
`:139-154` from `getRoomHierarchy`; orphans (= DMs) `:163-180`.
Refresh: cheap overlay `rebuildFromCache` `useNavTree.ts:103-106` vs
authoritative refetch `:109-136`; `commit` `:90-99` rejects structure
regressions via `structureScore` `:58-60`. Listeners `:158-172`.

**Context menu.** Opened via `onContext` `NavTree.tsx:109-112`, rendered
`:408-415`, portal + viewport clamp `RoomContextMenu.tsx:53-54`.
Actions: Favorite `:110-114`, Mute/Snooze `:116-134`, icon grid
`:136-197`, Clear icon `:198-202`, Leave `:204-217`.
**New-action insertion points: `:114`** (after Favorite) for
mark-as-read / rename / invite; **`:203`** (before Leave) for
destructive-adjacent. `MenuItem` `:223-255`, `Divider` `:257-274`.

**Settings store.** `RoomListSettings` `src/ui/roomListSettings.ts:22-31`
(animationsEnabled, favorites[], icons{}, mutes{roomId: number|null},
soundEnabled, soundVolume, panelWidth, panelLocked); defaults `:33-44`;
API `:46-67`. **localStorage**, key `net.41chan.room_list_settings` `:20`.
Loader validation `RoomListSettingsProvider.tsx:10-28`, save `:30-36`,
mutators `:43-101`, memo API `:103-143`. Adding `renames` / `roomOrder`
touches exactly those six places. Comment `:16-17` already flags the
local-for-v1 stance and the deferred lift.

**Notifications / mute.** `useRoomNotifications.ts:33-70` returns
`Map<roomId,{total,highlight}>`, joined rooms only, 200ms debounce
`:39-42`, listeners `:54-58`. Local mute = `isMutedNow`
`RoomListSettingsProvider.tsx:121-126` (`null` = forever, number =
snooze-until vs Date.now). Applied at render only: `NavTree.tsx:804-807`
(name suppression) and `aggregateNotif` `:700-719` (check `:708`).
Known wart: `isMutedNow` is time-dependent but not re-evaluated on a
timer, so snooze expiry only surfaces on an unrelated re-render.

**Receipts.** `useReadMarker.ts:14-57`; the walk-back is the loop at
**`:29-37`** -- iterate live-timeline events backwards, skip local echo
(`ev.status`), skip missing/`~`-prefixed ids, skip `net.41chan.spatial.*`;
first survivor wins. Dedupe `lastSent` `:39`, send
`client.sendReadReceipt(target, undefined, true)` `:43`, visibility gate
`:22`. **Lift is clean**: the loop needs only a `Room` and pure
predicates -- no React, no client, no refs. Extract
`findReceiptableEvent(room)` + `markRoomRead(client, room)` into
`src/client/receipts.ts`; the hook keeps effect/listener/visibility only.

**Drag pattern to reuse.** `src/ui/threadDrag.ts`: `ThreadDragOptions`
`:76-83` `{containerRef, orderedIds, onReorder, flipControlRef}`;
`useThreadDrag(opts) -> {getCardHandlers(id), consumeClickSuppressed(id)}`
`:109-117`; measures `[data-flip-id]` descendants `measureCards` `:86-98`;
tunables `:28-42`. `threadOrderStore.ts`: `orderScopeKey` `:15-17`,
`loadCustomOrder` `:19-31`, `saveCustomOrder` `:33-39`, prefix `:13`.
`threadOrder.ts`: `arrangeByCustom` `:120-146` (unknown ids to TOP,
reported as new), `useDeferredThreadOrder` `:151-173` (freeze during
interaction, release on idle). Reference wiring: `ThreadList.tsx:94-108`
+ FLIP `:87-90`.

**Hooks:** mark-as-read `RoomContextMenu.tsx:114` + receipts helper;
room header `App.tsx:106-129` (existing per-room toolbar strip,
`selectedRoom` at `:23`/`:101`); rename consumed `NavTree.tsx:451` +
`:937` + width walk `:37-39`; room order applied `NavTree.tsx:391` and
`:657` over `sortChildren`; drag container ref `Sidebar.tsx:65`;
push-rule mute swaps `Provider:121-126` (read) + `:88-101` (write) with
consumers unchanged; invite/DM surface `MemberList.tsx` (mounted
`App.tsx:165`); create-room entry `Sidebar.tsx:65` region, refresh already
arrives via `useNavTree.ts:170-172`.

### Lane C -- members / profile / media

**Member model.** `MergedMember` `src/client/members.ts:20-26`
(`id, displayName, avatarMxc?, sources[], powerByRoom{}` -- SPACE rooms
only, DMs deliberately excluded). `MemberSource` `:28-33`. Merge
`useMembers.ts:12-27`, hook `:31-61`, 250ms debounce `:47`.
No honorific field -- derived.

**Honorific pipeline.** `Honorific = '~'|'@'|'+'|null` `members.ts:5`;
`honorificFor(pl)` `:7-12` (>=100 `~`, >=50 `@`, >=25 `+` [placeholder],
else null); `maxPower(m)` `:38-42` = max across powerByRoom = the
identity honorific. Labels `~ Owner / @ Moderator / + Voice` duplicated
at `DomainUserMenu.tsx:23-27`. Colors `MemberList.tsx:13-17`.
**Only sort today: `MemberList.tsx:50-52`, pure alphabetical.**
`orderKey` `:58` already drives FLIP/pop, so a sort change animates free.
Admin gate `DOMAIN_ADMIN_PL = 50` `domainRoles.ts:11`.

**Profile card.** `DomainProfileCard` `DomainUserMenu.tsx:117-220`,
props `:118-129` `{x, y, userId, room, onClose}`, portal `:162`, viewport
clamp `:158-160`, dismiss `:143-156`. Renders 56px avatar via
`AuthedImage(... viaHomeserver)` `:197` + `initials()` `:18-21`, name,
split user/:server `:139-141`, two Tag pills (standing + `PL {pl}`)
`:213-216`. **Coupling to domain mode is LOW** -- only reads
`room.getMember(userId)` `:131`. Lift is easy: widen `room` to
`Room | null`, fall back to `MergedMember` + `maxPower` when roomless
(needed for MemberList All/Nearby), move to `src/ui/ProfileCard.tsx`,
hoist `initials()` and `HONORIFIC_LABEL` into `members.ts`.

**Member list.** `MemberList.tsx` (205 lines), mounted `App.tsx:165`.
220px right rail `:64`, 3 modes `:73-77` (`room|all|all-highlight` `:10`),
count header `:80-82`, rows `:83-85`. `MemberRow` `:91-172`, root div
`:133-149` carries `data-flip-id` + `title`. **No click handlers at all
today.** ProfileCard wiring: row div `:134-148` onClick, anchor state at
`:22`, card render at `:86`, prop threaded at `:84`. Roster hydration
already handled `:34-38` + `useMemberBackfill` `:27`.

**Media / avatar.** `AuthedImage` `:14-38`, props include
`mxc, width?, maxHeight, fill, transparentLoading, fallback, viaHomeserver`;
owns object-URL lifecycle + retry backoff `:6-8`, `:90-98`. Avatars use
the **homeserver** path `:71-73` ->
`fetchHomeserverThumb` `media.ts:139-160` (Bearer, `/v1/media/thumbnail`),
deliberately bypassing the fourier-auth gate which 403s avatars
(comment `:132-138`) -- this is D-bf01. Non-avatar path `fetchMediaSrc`
`:96-130`, `THUMB_SIZES` `:31`.
**No upload helper exists**: raw `client.uploadContent` inlined at
`Composer.tsx:202`, `ChatBackground.tsx:87`,
`DomainBackgroundEditor.tsx:132`. Also absent everywhere in `src`:
`setAvatarUrl`, `setDisplayName`, `getProfileInfo`, `searchUserDirectory`,
`.invite(`, `createRoom`, `m.direct`, ignore-list. **Lane C's entire
write side is greenfield.**

**Hooks:** honorific sort `MemberList.tsx:50-52`; ProfileCard extract
`DomainUserMenu.tsx:117-129`; open from list `MemberList.tsx:134`/`:22`/`:86`;
open from sender `Timeline.tsx:212-268` (card state must live at `Row`
`:270` or a Timeline-level portal host); presence `members.ts:113-120`
subscribe block + model `:20-26` + `ensure()` `:75-88` + render
`MemberList.tsx:150`; UserPicker feeds off `useMembers.ts:31`;
upload helper extraction `media.ts:186` (end of file).

---

## Step rows

Status vocabulary: `todo | in-progress | landed | blocked | pending-eyes`.
PENDING = needs operator eyes in a browser (headless box cannot verify).

### Wave 0 -- recon, baselines, ledger

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W0.1 | Clean `main`, branch `parity-v1` | landed | `11743d1` | branched off `d4d1494`, pushed to origin; only untracked file was `TESTING-chatbox-domain-v1.md` (left alone) |
| W0.2 | Record baselines | landed | `11743d1` | tsc clean; lint 23 (22e/1w); build passing |
| W0.3 | CLAUDE.md campaign block | landed | (untracked) | mission block replaced (O-tp8); standing rules preserved; file is gitignored by design, NOT force-added |
| W0.4 | 3 read-only recon lanes | landed | `11743d1` | maps above |
| W0.5 | O-tp register | landed | `11743d1` | O-tp1 CONFIRMED by operator; O-tp7/O-tp8 added |

### Wave 1 -- substrate (S1/S2/S3 file-disjoint, parallelizable; S4/S5 ride along)

| id | step | files | status | commit | result / pendings |
| --- | --- | --- | --- | --- | --- |
| S1 | Relations read layer: edits (`m.replace`), reactions (`m.annotation`), reply targets (`m.in_reply_to`) on the item model, live-updating | `useTimeline.ts`, new `relations.ts`, new `checks/` | **landed** | `fb7ab49` | Pure single-pass index, NOT the sdk RelationsContainer. Item gains `content`/`editedTs`/`reactions`/`replyTo`. Fixed 2 live bugs: remote edits rendered as duplicate rows, remote reactions as `[m.reaction]` junk. Forged-edit rejection + MSC3440 fallback suppression enforced. Added Redaction/LocalEchoUpdated/TimelineReset subs + burst coalescing. 36/36 pure checks pass. |
| S2 | Message action bar shell: hover/focus bar + keyboard reach + slot registry (no verbs) | `Timeline.tsx`, new `messageActions.ts` + `MessageActionBar.tsx`, `index.css` | **landed** | `ea5a802` | Builder registry, not props: verbs return an action or null per item, Row never learns a verb. Visibility is CSS (`.tc-row:hover/:focus-within`) -- React hover state would re-render unmemoized Rows on every pointer crossing. ARIA toolbar w/ roving tabindex = ONE tab stop per row. Inert until a builder registers. |
| S3 | Composer modes `normal\|reply\|edit` + banner + Esc cancel; threadId preserved | `Composer.tsx`, new `composerMode.ts` + `ComposerModeProvider.tsx` + `client/eventPreview.ts`, `App.tsx`, `ThreadPanel.tsx`, `DomainView.tsx` | **landed** | `d40018d` | One provider PER composer (room / thread / domain) so a thread reply cannot retarget the room composer. Unprovided = frozen inert context = exact pre-S3 behaviour. Esc bound to the textarea, not window (would steal from menus/lightbox). eventPreview is plain text, never HTML, and strips the mx-reply fallback. |
| S4 | Receipts helper extraction -> `client/receipts.ts`; useReadMarker becomes a caller | `useReadMarker.ts`, new `receipts.ts` | **landed** | `504a852` | `findReceiptableEvent(room)` + `markRoomRead()`. No behaviour change. Hook keeps only visibility gate + dedupe + listeners. |
| S5 | ProfileCard promotion -> shared `ui/ProfileCard.tsx`; domain mode consumes it | `DomainUserMenu.tsx`, `DomainCanvas.tsx`, `members.ts`, new `ProfileCard.tsx` | **landed** | `1d6832e` | Two identity sources: RoomMember, else MergedMember + maxPower (member list All/Nearby has no room PL). `actions` slot for Wave 3/4. `initials`/`HONORIFIC_LABEL`/`standingLabel`/`splitUserId` hoisted to members.ts -- HONORIFIC_LABEL was duplicated. |

**Wave 2 COMPLETE** -- all 9 chain steps + all 4 lane items landed.

**Wave 1 COMPLETE.** All five substrate tracks landed. Lint held at 23
throughout; one intermediate violation (react-refresh/only-export-components
from mixing the registry and its components in one file) was fixed by
splitting rather than by moving the baseline.

### Wave 2 -- message verbs (chain is SERIAL; lanes are parallel)

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W2.1 | Reply composing (+ enriched reply pill, click-to-jump) | **landed** | `9b9e89c` | Verb registry wired (`MessageVerbs.tsx`). Sanitizer NARROWED (`FORBID_CONTENTS: mx-reply`) -- fixed a live bug where Element replies rendered their quoted text inline. Fallback quotes ESCAPED PLAIN TEXT, never the target's formatted_body (no HTML relay). Jump bounded to 8 pages. `renderMessageBody` now takes content, so edits render. |
| W2.2 | Message editing (`m.replace`, "(edited)" marker) | **landed** | `3e0c300` | Own messages only (forged edits are rejected by S1 anyway). Seed from `item.content`, not `getContent()` -- else a 2nd edit reverts to the original. Sent with `threadId: null` (an event cannot carry both m.thread and m.replace). Draft stashed/restored around edit mode. |
| W2.3 | Redact / delete (two-step confirm, PL-gated) | **landed** | `86e19b9` | Own OR `hasSufficientPowerLevelFor('redact')`. Verb HIDDEN when not permitted, not shown-and-403ing. Modal confirm, not click-again -- the bar is under the pointer. |
| W2.4 | Row footer design note (ledger only, NO code) | **landed** | (this ledger) | See "Row footer layout" below. |
| W2.5 | Reactions (strip, toggle, EmojiPicker anchored) | **landed** | `0111379` | Tallies from S1. Built the W2.4 footer; thread chip moved in. Footer ABSENT when empty (no-forced-reflow). ONE picker keyed by event id across the action bar's React verb + each strip's `+`. Local echoes (`~` ids) excluded. Shared `useRoving` -- and it owns NO ref: returning a ref from a hook trips the React-Compiler refs-during-render rule when spread (cost 8 lint errors before rework). |
| W2.6 | Read-receipts display (seen-by cluster, +N cap) | **landed** | `74156b5` | Walks MEMBERS not events -> O(members), independent of scrollback. Self excluded. Capped at 5 + N. Right-aligned for a stable column. 250ms debounce. Reaches the footer by context (thread panel shares Row, computes none). |
| W2.7 | Pinned messages | **landed** | `42d6aba` | State, so PL-gated via `maySendStateEvent`; verb HIDDEN when unwritable. Whole-list replace -> read-modify-write, re-read from state immediately before writing to narrow the lost-pin window. Panel previews only LOADED events (no fetch-per-pin), says so honestly, jump still works. Sticky overlay -> no reflow. |
| W2.8 | Forwarding | **landed** | `2739400` | Strips `m.relates_to`/`m.new_content`/**`m.mentions`**/gallery/domain_ttd + both reply fallbacks -- forwarding must not ping people from another conversation. Images by MXC REFERENCE: no re-upload, no duplicate booru post. `RoomPicker` built generic for Wave 3's invite/DM. |
| W2.9 | Mention autocomplete | **landed** | `0dfb608` | Masked before markdown / restored after sanitize (substituting into finished HTML would corrupt hrefs). Longest-match-first; deleted mentions don't ping; split/join for `$`. Reply adds the answered sender (MSC3952). **Sanitizer NOT widened** -- anchors already allowed, asserted. Ordinary send path byte-identical. |
| W2.L1 | Syntax highlighting | **landed** | `a5fb423` | 4-step shape: sanitize w/ class -> scrubClasses (deletes all but `language-*` on `<code>`) -> hljs -> re-sanitize. Pass 2's allowance is safe because its INPUT is our output. Parses via `createHTMLDocument` (inert, exists wherever `document` does). Bounded: 20k skip, 2k autodetect cap. **COST: +171kB raw / +57kB gzip** -- lib/core + explicit registerLanguage is the cheaper fallback, noted in DEPENDENCIES.md. |
| W2.L2 | Spoiler RENDERING | **landed** | `fd4d3a9` | `data-mx-spoiler` admitted BY NAME (ALLOW_DATA_ATTR stays false). tabindex/role/aria set by US after pass 1 deleted the sender's. Delegated click/keydown (innerHTML can't carry React handlers). Blur is a filter -> revealing never reflows. **Also fixed a FORBID_CONTENTS regression I introduced in W2.1** -- see G-tp09. |
| W2.L3 | Spoiler COMPOSING + fenced code blocks on the send side | **landed** | `310c8bc` | Masked BEFORE markdown, restored AFTER sanitize (so the span is ours, and hand-written `data-mx-spoiler` stays refused). Block parser used ONLY when a fence exists -- wholesale would wrap every message in `<p>`. Send-side class scrub added: a user CAN type literal HTML. Caught a real regex bug: `\|\|one\|\| and \|\|two\|\|` mis-parsed. |
| W2.L4 | Typing indicators | **landed** | `fcfed38` | Bar BETWEEN timeline and composer, reserves height permanently -> no reflow. Reads sdk's `RoomMember.typing` (it owns expiry). Throttle in refs not state (keystroke setState would re-render the composer). Retracts on send + unmount. |

#### W2.4 -- Row footer layout (the design note)

Reactions (W2.5) and read receipts (W2.6) both want the space under the
message body, and the thread chip is already there. Specifying the region
once so the two do not collide.

Row anatomy after Wave 2, top to bottom:

```
  [action bar]                                <- absolute overlay, top-right
  SenderPill  time
    |- reply pill            (W2.1, above body, own line)
    |- body  (edited)        (W2.2 marker is INLINE, never its own line)
    |- FOOTER  <-------------------------------- this note
```

The FOOTER is one flex row, `align-items: center`, `gap: 6px`,
`flex-wrap: wrap`, `padding-left: 16px` (matching the body column), rendered
only when it has at least one child. Order is fixed, left to right:

1. **Reactions strip** (W2.5) -- `flex-wrap` so a heavily-reacted message
   grows downward, never sideways past the body.
2. **Thread chip** (existing) -- moves INTO the footer rather than keeping
   its own line, so a threaded + reacted message costs one row, not two.
3. **Spacer** (`margin-left: auto`).
4. **Receipts cluster** (W2.6) -- right-aligned, so it sits in a stable
   column down the timeline instead of jittering with reaction count.

Rules the two features must both honour:

- **The footer never reflows the body.** It is appended, not inserted; it has
  no min-height, and it is absent (not empty-but-present) when there is
  nothing to show. This is the no-forced-reflow law: adding a reaction must
  not push the message text.
- **Fixed heights.** Reaction pills and receipt avatars are both 20px tall so
  a row's height does not change when one appears without the other.
- **Nothing in the footer is a tab stop by default.** Reaction pills are
  buttons, so the footer participates in the row's `:focus-within` and is
  reachable, but W2.5 must use the same roving-tabindex treatment the action
  bar uses or the timeline becomes untabbable.
- **Grouping-safe** (W6.2). Same-sender grouping collapses the pillbox, not
  the footer -- every grouped message keeps its own footer.

### Wave 3 -- rooms & navigation

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W3.1 | Mark-as-read | **landed** | `ac5a2e0` | Uses the S4 helper so it cannot drift from the auto-marker. Space walk: joined non-spaces only, deduped (a room can sit under 2 spaces), depth-first, SEQUENTIAL (50 concurrent writes to save a second is a bad trade), capped at 200 and logged. |
| W3.2 | Room header: topic + joined member count | **landed** | `ac5a2e0` | Landed in the Timeline header, not App.tsx. Topic ellipsises inside a fixed shape so a paragraph topic never pushes the timeline. |
| W3.3 | Local room rename override | **landed** | `ac5a2e0` | NOT a state rename -- renaming for everyone is a moderator action. One resolution point so nav + header cannot disagree. Empty override = removal, else a room could be renamed to nothing and become unfindable. |
| W3.4 | Custom room ordering | **landed** | `c610ffc` | Deferred once, then closed. Per-parent drag scopes (one container over the tree would allow cross-space drops). Group-as-container is geometrically correct (scrollTop stays 0); cost is edge-autoscroll only. Drag offered only while EXPANDED -- collapsed spaces hoist favourites outside the group. Reuses `useThreadDrag` + FLIP + unknown-ids-first. |
| W3.5 | Server-side mute via push rules | **landed** | `3fdf6dc` | Wraps sdk `setRoomMutePushRule` (carries the SYN-590 delete-then-add workaround). Local map survives as read-fallback, migrates on first toggle-touch. **Snooze stays local**: a push rule has no expiry, and a timer in a closable tab is a promise the client can't keep. `isMutedNow` shape preserved -> zero consumer changes. |
| W3.6 | UserPicker primitive | **landed** | `f897bec` | local members -> directory -> raw MXID (the directory only indexes users who share a room or are published, so a valid id can be missing entirely). Raw id LAST so a typo can't outrank a real match. Debounced; a disabled directory degrades to local members. |
| W3.7 | Send invites | **landed** | `f897bec` | `describeInviteError` surfaces the server's own reason; 403 says 'you do not have permission' rather than 'invite failed'. |
| W3.8 | Start-a-DM | **landed** | `f897bec` | Detection FIRST. `m.direct` is not self-cleaning (keeps left rooms), so a hit is verified against membership before reuse. `trusted_private_chat` -- neither party moderates the other. `m.direct` write awaited: if it fails the room is a DM nowhere. |
| W3.9 | Create room / space | **landed** | `9e2327d` | `m.space.child` is written INTO THE SPACE, needing power there, not in the new room -- so creation can succeed while parenting fails. That case keeps the dialog open and prints the room id to adopt by hand. Join rules = the 3 house rules; `knock` via initial_state (no preset). Visibility Private regardless -- publishing is a separate decision. |

**Wave 4 COMPLETE.**

#### W3.4 -- RESOLVED (`c610ffc`). Kept for the record: the four obstacles and how each closed.

Obstacle 3 turned out better than recorded -- passing the GROUP as the drag
container is geometrically correct, because the group does not scroll, so
`container.scrollTop` stays 0 and the arithmetic holds. The only real cost is
edge-autoscroll, which writes to a scrollTop that never moves. Sibling groups
are short, so that gap is small -- and it is stated rather than hidden.

Original analysis follows.

#### W3.4 -- why room ordering was deferred

The store half shipped with W3.3: `roomOrder: Record<string, string[]>` keyed
by PARENT scope (`''` = root/orphans), with loader validation and a
`setRoomOrder` mutator. Only the drag UI remains.

`useThreadDrag` IS reusable in principle -- it is generic over
`[data-flip-id]` descendants of a container plus an `orderedIds` array. Four
concrete obstacles, none fatal, all needing browser verification:

1. **Nav rows carry no `data-flip-id`.** `measureCards` finds nothing today.
   MemberList rows have it; nav rows do not.
2. **The tree needs PER-SIBLING-GROUP containers.** `measureCards` grabs every
   descendant, so one container over the whole tree would let a room be
   dragged into another space's slot and produce a meaningless order. Each
   parent's children wrapper (`NavTree.tsx` ~:658) has to be its own drag
   scope, i.e. the hook is called per group.
3. **The scroll container is not the drag container.** `measureCards` uses
   `container.scrollTop` and the edge-autoscroll drives the container it is
   given, but the nav scrolls on `Sidebar.tsx:61`'s `<aside>` while the
   children wrapper is a non-scrolling div inside a `grid-template-rows`
   collapse animation. Autoscroll would drive the wrong element.
4. **Favourited descendants render OUTSIDE their group.** `NavTree.tsx:~678`
   hoists them as siblings of the container when a space is collapsed, so the
   dragged set and the rendered set disagree in exactly that state.

None of this is hard; all of it is drag geometry that cannot be verified from
a headless box, and it lands in a large working file. Doing it half-checked
risks a nav that is worse than one without the feature. Recorded rather than
rushed.

### Wave 4 -- members & presence

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W4.1 | Honorific-based sorting | **landed** | `6c3a219` | TIER then alpha -- not raw PL. 50 and 99 are both `@` and must rank equally, else list order disagrees with the glyphs shown. FLIP/pop animates it free. |
| W4.2 | ProfileCard wiring | **landed** | `6c3a219` | Member row + sender pillbox, both keyboard-reachable. Card owned ABOVE the rows per surface (two rows can't each open one); reaches Row via `profileOpener` context since Row is shared with the thread panel. |
| W4.3 | Edit own profile | **landed** | `6c3a219` | Avatar via HOMESERVER upload (D-bf01), not the gateway which 403s avatars. Empty display name ALLOWED -- in Matrix it legitimately means 'fall back to MXID'. 8MB guard fails with a sentence, not a bare 413. |
| W4.4 | Block / ignore | **landed** | `6c3a219` | Account data -> follows every device. Server stops sending ignored events but NOT retroactively, so `toItems` filters too -- there rather than in the renderer, so no gap, no 'hidden' row, no orphaned reaction/receipt. Repaints on account-data change. Self-ignore refused (reads as data loss). |
| W4.5 | Presence display | **landed** | `6c3a219` | **Expected to render NOTHING until the operator enables presence** -- that is correct behaviour, not a bug. Unknown != offline; a grey dot everywhere would be a client-invented claim. |
| -- | Server-wide member list | **EXCLUDED** | -- | O-tp1 confirmed by operator 2026-08-06. Closed. |

### Wave 5 -- heavy independents

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W5.1 | Message search | **landed** | `1a85d41` | Capability probed once + cached; only a CAPABILITY failure (404/501/M_UNRECOGNIZED) disables it -- a rate limit must not convince the client the server can't search. Local fallback labelled PARTIAL everywhere. |
| W5.2 | Link previews | **landed** | `1a85d41` | Opt-IN: a preview makes the HOMESERVER fetch a third-party URL for the reader. Only http(s) sent (SSRF surface; the ip-range blacklist is the operator's half). Renders NOTHING when declined -- no skeleton, no reflow. |
| W5.3 | Polls | **landed** | `1a85d41` | O-tp4: sdk `M_POLL_*` matchers decide the wire name (reads both prefixes). Tally rules enforced by the READER: last-vote-wins, post-close votes discarded, redactions ignored, max_selections trimmed, **only the creator may end it**. Undisclosed renders no fill (a 0-width bar leaks that nobody voted). |
| W5.4 | Custom emoji (MSC2545) | **landed (partial -- see note)** | `1a85d41` | O-tp3. Reads room-state + account-data packs; custom-emoji REACTIONS render their mxc key as an image. **NOT done: `im.ponies.emote_rooms`** (packs in other rooms) and `m.sticker` SENDING -- deliberately, since half-doing the pointer list would show some of a user's packs and silently omit the rest. |

### Wave 6 -- layout finale + closeout (serial, single agent)

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| W6.1 | Day separators | **landed** | `16fe956` | Marker items from `applyLayout`, branched at the CALL SITE -- Row untouched, as the design note required (an early return above Row's hooks broke rules-of-hooks). |
| W6.2 | Same-sender grouping | **landed** | `16fe956` | Second pass over folded items, so grouping collapses the HEADER and nothing else. Breaks on sender change, >5min gap, day boundary, and REPLY. Grouped rows show their time in the gutter on hover. 6 explicit regression checks: reactions/edited/content/event/id all survive. |
| W6.3 | Regression sweep | **landed** | (this ledger) | No stray debug in campaign code (the one `console.log` is pre-existing, `tokenRefresher.ts`, from Phase 1). All non-ASCII is UI glyph literals (the allowed functional-literal exception). All 24 commit hashes cited in this ledger resolve. Gates green. |
| W6.4 | Closeout | **landed** | (this ledger) | Consolidated PENDING list below; draft node register below; DEPENDENCIES.md current; merge-readiness stated. **Nothing deployed -- tc.41chan.net is the operator's.** |

---

## CLOSEOUT

### Merge readiness

`parity-v1` is feature-complete against the audit: **30 of 30**. Gates have
held on every commit -- tsc clean, **lint at exactly 23** (the Wave 0
baseline, never moved), build passing, 425 pure checks passing, `npm audit`
clean (3 pre-existing advisories resolved along the way).

**Nothing has been deployed. Nothing outside this repo has been written.**
Deployment is the operator's, via `./deploy.sh`, when the operator says so.

### BLOCKING on someone else (not code)

| what | who | detail |
| --- | --- | --- |
| ~~Backdrop media in R2~~ | ~~fourier-auth~~ | **RESOLVED, no gateway change needed** (`465b0e2`). The gate authorizes media with a POST behind it; backgrounds had none because they were referenced only from state. They are now posted as a flagged `m.image` and the state event references that mxc, so they authorize exactly like every other image. |
| ~~Booru: skip background posts~~ | ~~bmb~~ | **NOT BLOCKING.** Background posts carry `net.41chan.background`, and the booru can filter or hide anything by flag on its own side. The flag is the whole requirement and it already ships. No action needed anywhere. |
| Presence | operator / homeserver | `presence.enabled: true`. Until then presence renders NOTHING, which is the designed behaviour, not a fault. |
| Link previews | operator / homeserver | `url_preview_enabled: true` **plus** a correct `url_preview_ip_range_blacklist` (SSRF guard -- not optional). Previews stay absent until both that and the per-user opt-in are on. |
| Message search | operator / homeserver | Server-side `/search`. The client probes and degrades to a labelled partial search if absent. |

### Known gaps, stated rather than hidden

- **W5.4 partial**: `im.ponies.emote_rooms` (packs in OTHER rooms) is not
  followed, and `m.sticker` sending is not implemented. Reading room + user
  packs and rendering custom-emoji reactions IS done. Half-doing the pointer
  list would show some of a user's packs and silently omit the rest.
- **W3.4**: no edge-autoscroll while dragging a room (the drag container is
  the sibling group, which does not scroll). Groups are short; the reorder
  itself is correct.
- **Server-wide member list**: EXCLUDED, O-tp1, confirmed by the operator.
- **Keyboard reorder** for drag surfaces: still deferred, as recorded in the
  Thread Cards mission.
- **Chat backgrounds are per-user by design** (`ui/chatBackground.ts`). They
  are not "failing to share"; a shared variant is a recorded v2 and a real
  design decision, not a bug fix.

### Draft phase-node register (for the operator's next fourier-basis pass)

Decisions: **D-tp01** zero-dep check harness - **D-tp02** CLAUDE.md mission
replaced - **D-tp03** devlog stays at repo root - **D-tp04** reply fallbacks
quote escaped plain text, never the target's HTML - **D-tp05** edit offered on
own messages only - **D-tp06** delete hidden when not permitted - **D-tp07**
`class` allowed only as a code-block language hint - **D-tp08** a forward
strips context, `m.mentions` above all - **D-tp09** mentions masked before
markdown - **D-tp10** mute to the server, snooze deliberately not - **D-tp11**
partial success reported, never swallowed - **D-tp12** sort by tier not power
level - **D-tp13** presence renders nothing by design - **D-tp14** backdrops
belong on the R2 gateway, with no fallback - **D-tp15** make the media the thing
the gate already authorizes (post it, then reference it) - **D-tp16** no failure
is silent: 36 discarded-error sites audited, 11 deliberate swallows each stating
why at the site.

Gotchas: **G-tp01** react-refresh mixed exports - **G-tp02** a ref returned
from a hook trips refs-during-render - **G-tp03** Node cannot load
extensionless relative imports - **G-tp04** an event carries ONE
`m.relates_to` - **G-tp05** MSC3440 thread replies carry a FALLBACK
`m.in_reply_to` - **G-tp06** an `m.replace` must be honoured only from the
original sender - **G-tp07** seed edits from effective content, not
`getContent()` - **G-tp08** `sendEvent` rejects the string `'m.reaction'` -
**G-tp09** `FORBID_CONTENTS` REPLACES DOMPurify's default, it does not extend
it - **G-tp10** a security suite that passes without a DOM is worthless -
**G-tp11** substring assertions on HTML lie in both directions - **G-tp12**
derived data does not belong in state - **G-tp13** `m.direct` keeps rooms the
user has left - **G-tp14** ignoring is not retroactive - **G-tp15** the
harness could not load modules reading `import.meta.env` - **G-tp16** a caught
write rejection that resolves anyway makes a failed save pixel-identical to a
successful one - **G-tp17** a day separator as an early return inside Row breaks
rules-of-hooks; it belongs at the call site - **G-tp18** sliding sync delivers
ONLY the state named in `required_state`; unlisted state never arrives and
`currentState` returns null forever.

**Register hygiene note (2026-08-13):** D-tp14..16 and G-tp16..18 were minted in
the devlog during the post-closeout sessions of 2026-08-07/08 but were never
added here, so the register the minting pass would have read was six nodes
short. Added above. The devlog entries are the authoritative text for each.

### Post-campaign UI pass -- 2026-08-13 (draft, unminted)

Decisions: **D-tp17** a hover-revealed affordance is placed where revealing it
costs no height -- a rail to the RIGHT of a media body (with the "+" pinned at
the TOP of the column, so it does not migrate as tallies accumulate), or a
reserved inline slot trailing a text body. The old single `ReactionStrip` split
into `ReactionAdd` + `ReactionPills` precisely because the two halves belong in
different places - **D-tp18** pin a chat scroller with `scrollTop =
scrollHeight`, never `scrollIntoView` on a sentinel: the sentinel's box excludes
the container's bottom padding, and `scrollIntoView` is permitted to scroll
ancestor scrollers too - **D-tp19** the selected room is a subtle fill plus an
inset accent bar, not a solid pill: it keeps `text-primary` readable and leaves
the unread orange/green uncontested - **D-tp20** a DM is presented as the PERSON
(`getAvatarFallbackMember()`), and its unread state is a glow ring rather than a
badge, because a 30px icon has no room for a counter.

Gotchas: **G-tp19** anything revealed on hover that OCCUPIES LAYOUT moves the
row -- and in a timeline that follows the bottom, moving one row moves the whole
conversation. The empty row footer collapsed to `height:0` and grew on hover;
every hover slid the log up and every mouse-off dropped it back. Reserve the
slot, or put the control where there is already room - **G-tp20** a `scroll`
event does not mean the user scrolled. A late-loading image grows a row, the
distance-from-bottom jumps, and a scroll event fires with the pointer untouched;
reading that as intent disengages follow mode permanently. Compare `scrollHeight`
between samples -- a changed height means the event carries no intent -
**G-tp21** Compound's `bg-action-primary-rest` and `text-primary` BOTH resolve to
`gray-1400` (#ebeef2). Pairing them renders text at exactly 1.00:1 contrast.
Solids pair with `text-on-solid-primary`; a semantic token name is not evidence
that two tokens differ - **G-tp22** an inline image with no reserved box is a
late layout jump of a couple of hundred px: `AuthedImage` showed a 120x90
placeholder and then an image up to `maxHeight`. The event's own `info.w`/`info.h`
are available before any fetch, so the box can be settled at first paint -
**G-tp23** **Simplified Sliding Sync (MSC4186) does not deliver notification
counts.** Synapse sends `notification_count: 0` and `highlight_count: 0` for
every room, always. It SENDS the field, so `sliding-sync-sdk`'s `!= null` guard
passes and `setUnreadNotificationCount` is called with a real zero -- no error,
no warning, no absent value to notice. `getUnreadNotificationCount()` has
therefore returned 0 for every room since sliding sync landed (2026-07-19), and
the room-list unread glow, the `(N)` count, the ping treatment and the
`aggregateNotif` space rollup have all been rendering a permanent zero. The
second sibling of G-tp18: what sliding sync does not give you, it does not tell
you it is not giving you.

**G-tp24** -- **under sliding sync, `ClientEvent.Sync` is a HIGH-FREQUENCY
signal, and a debounce on it starves.** It fires on every long-poll cycle, which
completes in a few hundred ms while a room is busy. The G-tp23 poller first
shipped with a 1.5s debounce that cleared and re-armed per event, so the
deadline outran the clock and it never fired at all: counts updated only once
traffic went quiet, which in practice meant only when the current room changed.
The burst that most needs a refresh is exactly the burst that prevents it. Any
timer driven by `ClientEvent.Sync` must arm on the FIRST event and ignore the
rest until it lands (`nextPollDelay`), never re-arm per event. Caught in review
by the operator, not by a gate -- the code typechecked, linted and built.

**Evidence (2026-08-13, same account, same room, same minute).** Classic
`/sync` with a minimal filter reports room `chat` at `unread_notifications:
{notification_count: 5}`; the sliding-sync path set that same room's count to 0.
Ruled out first, in this order: the render path (`getUnreadNotificationCount`
reads what `setUnreadNotificationCount` writes, plus thread counts); a client
read-receipt race (a hook on `sendReadReceipt` recorded no call, and the rooms
in question had no receipt at all -- `ExtensionReceipts` is registered
unconditionally, so absent means absent); push-rule suppression (the only
enabled non-notifying rules are stock defaults, and `.m.rule.message` is enabled
with a `notify` action). The reproduction is a single filtered classic `/sync`
through `client.http.authedRequest`, which is non-destructive and needs no mode
change.

### Membership rows -- 2026-08-13 (draft, unminted)

Decisions: **D-tp21** membership events are their own `TimelineItemKind` and
branch at the CALL SITE, not inside `Row` (G-tp17): they render as a PERSON, so
they have no sender pill, action bar or footer, and an early return above Row's
hooks would break rules-of-hooks - **D-tp22** **only ARRIVALS animate.** A ban
or kick rendered as a cheerful pop is a moderation action made illegible, and a
profile edit replaying every time it scrolls past is noise. Restricting motion to
arrivals is also what keeps it MEANING something: movement in the log says
somebody showed up - **D-tp23** the variant and phrase are picked from the event
id, not at random per play. A fresh pick per replay would make one row look like
a different event each time it scrolled past, which reads as a rendering glitch
rather than as character; the two picks are salted apart so they do not move in
lockstep - **D-tp24** the animation replays on each entry into view rather than
once ever, because scrolling to a message is a deliberate act -- read the log
straight through and each plays exactly once - **D-tp25** the avatar pill is
EXTRACTED (`ui/AvatarPill.tsx`) and shared with the sender row rather than
copied: the effect depends on the thing popping into view being recognisably the
person's own pill, which a near-copy would erode.

Gotchas: **G-tp25** an `m.room.member` carries the WHOLE member state every
time, so a rename is indistinguishable from a join unless `prev_content` is
consulted -- `join -> join` is a profile edit, never an arrival. Likewise a
leave is only a kick when `sender !== state_key`, and `ban -> leave` is an
unban even though a moderator sent it. None of these are separable from the
rendered text, which is why this keys on the transition - **G-tp26** **`grep -P`
is not reliable in this environment** (`grep` resolves to ugrep): it silently
reported no match for a literal present in the file, and reported zero non-ASCII
characters on a line that plainly contained one. Every ASCII-discipline check in
this session had to be re-run through Python to be trusted. Any gate that greps
for a pattern it expects NOT to find is worthless here unless verified another
way -- a clean result from that tool is not evidence.

### O-tp dispositions

O-tp1 CLOSED (operator confirmed) - O-tp2 through O-tp5 proceeded as recorded -
O-tp6 remains a flag for the bmb/chanbooru side (redacting an image does not
remove its booru post) - O-tp7/O-tp8 proceeded - O-tp9 proceeded, then
SUPERSEDED in part by O-tp11 - O-tp10 still the operator's call (thread replies
appear both inline and in the panel) - O-tp11 RESOLVED by the operator: jsdom
added.

| id | decision | status |
| --- | --- | --- |
| O-tp14 | **Green/orange unread counters: DEFERRED and no longer a standing request** (operator, 2026-08-14). Recorded for possible revisit. Nothing blocks them -- the counts they need now exist (G-tp23) -- they are simply not wanted yet. What ships is the existing treatment: orange glow, `(N)`, `@` ping, letter pulse. | recorded, not scheduled |
| O-tp13 | **How unread counts are obtained, given G-tp23.** Sliding sync will not provide them. Options were: (a) a counts-only classic `/sync` poller feeding `useRoomNotifications`; (b) compute client-side via the sdk's push processor over loaded events -- rejected, since `timeline_limit: 1` means almost nothing is loaded and it would undercount the way thread stats do; (c) leave counts dead until Synapse implements it. | **RESOLVED 2026-08-13 by the operator: (a).** Built in `client/notificationCounts.ts` (pure parse/compare, 28 checks) + `useRoomNotifications.ts` (request + the two source paths). Three constraints are load-bearing and each is stated at its site: the request is **STATELESS -- never a `since` token**, or it would ack the to-device queue out from under the sliding-sync stream and silently break the deferred encryption phase; the counts are held in the hook rather than written back into Room state, which sliding sync re-zeroes on every touch; and the classic-sync path is kept intact and selected by mode, since the sdk's counts are correct and free when sliding sync is off. |
| O-tp12 | **The verification matrix below is ASSUMED PASS** (operator, 2026-08-13). The pass was performed and mostly succeeded, but the per-row results were not saved, so no row can be cited as evidence. Treat every row as passed-by-assumption: a later contradiction is a finding AGAINST THE ASSUMPTION, not a regression, and does not imply the row ever passed. Unfortunate and unavoidable; recorded rather than quietly forgotten. | recorded, standing |

---

## PENDING OPERATOR VERIFICATION (running list)

Headless box: typecheck / lint / build are self-verified. Anything
visual or interactive is claimed only as PENDING.

**Status of the parity-v1 rows below: ASSUMED PASS (O-tp12).** Rows added by
later sessions carry their own status and are NOT covered by that assumption.

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| S1-a | Remote edits no longer render as a duplicate message row; remote reactions no longer render as `[m.reaction]` junk rows. Both were live bugs. | yes -- react/edit from a 2nd identity |
| S1-b | An edited message shows the edited text (the renderer still reads `event.getContent()`; W2.2 switches it to `item.content`). Expect NO visible edit marker yet. | yes |
| S2-a | Hovering a message reveals a small bar at the row's top-right with NO buttons in it (inert until W2.1). Confirm no layout shift and no stray empty box. | no |
| S5-a | Domain canvas right-click -> Inspect renders the profile card exactly as before: avatar, name, user:server, standing pill, PL pill. | no |
| S3-a | Composer is visually and behaviourally unchanged in all three mounts (room, thread panel, domain). No banner should ever appear yet. | no |
| W2.1-a | Reply verb on hover -> banner -> sent reply shows a pill in BOTH clients; clicking the pill scrolls + flashes. | yes |
| W2.1-b | **Replies sent from Element no longer show their quoted text inline** (was a live bug). | yes |
| W2.2-a | Edit only on your own text messages; prefill; Esc restores a stashed draft; "(edited)" appears; editing twice starts from the latest text. | yes |
| W2.2-b | **Edits made in Element show as edits, not duplicate rows** (was a live bug). | yes |
| W2.3-a | Delete hidden on others' messages at PL0, present for a moderator; confirm modal; row becomes "(message deleted)" in both clients. | yes |
| W2.5-a | Reaction pills tally across identities; own reaction visibly distinct; toggle on/off; `+` and React verb open the SAME picker. | yes |
| W2.5-b | **Reactions from Element no longer render as `[m.reaction]` junk rows** (was a live bug). | yes |
| W2.5-c | A message with no reactions reserves NO footer height until hovered -- confirm no vertical jitter scrolling a busy room. | no |
| W2.6-a | Other identity's avatar appears under the last message it has seen and advances as it reads; your own never appears; caps at 5 + N. | yes |
| W2.L1-a | A fenced code block from Element renders highlighted, in BOTH light and dark; a very large block renders plain without stalling. | yes |
| W2.L2-a | A spoiler from Element renders blurred; reveals on click AND on Enter/Space; the reason label shows; a link inside a revealed spoiler is clickable. | yes |
| W2.L3-a | Typing `||secret||` sends a spoiler that renders blurred in Element; a ``` fence sends a highlighted block; ORDINARY messages are visually unchanged (regression risk: the parseInline -> parse switch). | yes |
| W2.L4-a | Typing in one client shows the line in the other; clears on send, on emptying the box, and on leaving; never shifts the messages above it. | yes |
| BUNDLE-a | Judgement call: is +57kB gzip acceptable for highlighting? If not, `lib/core` + explicit registerLanguage is a one-file change. | no |
| W2.7-a | Pin absent at PL0, present for a moderator; header count; panel lists newest-first and jumps; unpin from panel AND action bar; a pin made in Element appears. | yes |
| W2.8-a | Forwarding text and an image both land in the chosen room; the image needs no re-upload and creates NO second booru post (O-tp6 is the related flag); forwarding a reply carries no quote. | yes |
| W2.9-a | `@` opens/filters the picker; arrows/Enter/Tab/Escape behave; the sent mention renders as a pill in Element and links back; the mentioned user is NOTIFIED; a reply notifies the person replied to. | yes |
| W3.1-a | "Mark as read" clears a room's glow; on a SPACE it clears every child. | no |
| W3.2-a | Header shows topic + joined count; a very long topic ellipsises and does NOT push the timeline. | no |
| W3.3-a | A renamed room shows the override in BOTH nav and header, survives reload, and "Reset to server name" restores it. | no |
| W3.5-a | Muting here silences the room in Element too, and vice versa; unmute clears both; a snooze still expires locally; a pre-existing local mute still reads muted and migrates on toggle. | yes |
| W3.6-a | Picker finds local members instantly, directory users after a pause, and accepts a raw `@user:server` the directory does not surface. | yes |
| W3.7-a | Invite sends and the other identity sees it; inviting without permission shows the PERMISSION message, not a generic failure. | yes |
| W3.8-a | "+ DM" opens a conversation; a SECOND attempt reuses the same room rather than creating a duplicate; the room shows as a DM in Element. | yes |
| W3.9-a | New room appears in the nav without reload; nesting works; creating in a space you lack rights in reports the room id instead of vanishing. | no |
| W4.1-a | Member list groups by tier (~ then @ then + then plain), alphabetical inside each; the reorder animates. | no |
| W4.2-a | Clicking a member row OR a message sender pill opens ONE card; Escape and outside-click close it. | no |
| W4.3-a | Own card changes display name and avatar; both propagate to Element; "Remove avatar" works. | yes |
| W4.4-a | Block hides that user's messages everywhere immediately (no gap, no placeholder row); Unblock restores them; the block is visible in Element's ignore list. | yes |
| W4.5-a | **Presence renders NOTHING** until `presence.enabled: true` is set server-side (section 4). Absence here is the correct result, not a failure. | operator/server |
| KBD-a | Tab from the timeline reaches the composer in a sane number of stops; arrows move within a row's action bar and reaction strip. | no |

### Added 2026-08-13 -- UI pass (NOT covered by O-tp12; never yet seen)

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| UI1-a | **The bump is gone.** Mouse across messages in a room scrolled to the bottom: nothing moves, at all. Previously the whole log slid up on hover and dropped back on mouse-off. | no |
| UI1-b | An IMAGE post shows the "+" directly right of the thumbnail's TOP edge on hover; reactions stack downward beneath it, and the "+" stays put as they accumulate. | yes |
| UI1-c | A TEXT post shows the "+" in the slot just after the text on hover; the gap where it lives is reserved when hidden, so nothing shifts. Tallies still render below the text. | yes |
| UI1-d | The React verb (smiley) in the hover bar and the "+" still open the SAME picker, and reacting still works from both. | yes |
| UI2-a | **Posting an image while at the bottom keeps the view at the bottom** as it loads -- no drift, no half-scrolled state. Previously an expanding image stranded the log part-way up. | no |
| UI2-b | Scrolling up to read history still holds position, and does NOT get yanked back down by a new message or a late image. | yes |
| UI2-c | Images no longer visibly resize from a small grey box to full size -- they occupy their final box from the first frame. An image whose event carries no `info.w/h` still behaves as before. | no |
| UI3-a | **The current room's name is readable.** It was invisible (identical fill and text colour). Confirm the selected row is also clearly distinct from a merely HOVERED row. | no |
| UI4-a | The room list is vertically tighter (32px -> 28px pitch) and still comfortable to hit. Say if it is now too tight. | no |
| UI5-a | A DM shows the OTHER user's avatar, not a generic initial; a DM with no avatar shows that person's initial. A group/orphan room in that row is unchanged. | yes |
| UI5-b | A DM with an unread message glows orange; a ping glows brighter. Muting it silences the glow. | yes |
| UI6-a | **Unread rooms light up at all** (G-tp23 fix). Room `chat` was at notification_count 5 server-side while the client showed 0; its name should now glow with a `(5)`. This is the first time this treatment has ever rendered a non-zero number. | no |
| UI6-b | A new message in a room you are NOT viewing raises its count within ~2s (the settle debounce), not 30s (the backstop). | yes |
| UI6-c | Reading a room clears its count, and the change survives to the OTHER surfaces -- a collapsed space header's aggregate drops too. | no |
| UI6-d | No console warning `[tc] failure -- notification counts: classic /sync poll`. If it appears, the poll is erroring and the count is stale, which is now visible rather than silent. | no |
| UI6-e | Backgrounding the tab stops the polling (Network tab: no `/sync` on the v3 prefix while hidden) and it resumes on return. | no |

### Added 2026-08-13 -- membership rows (unattended run, branch `ui-pass-v1`)

| id | what needs eyes | 2nd identity? |
| --- | --- | --- |
| UI7-a | `[m.room.member]` is gone. A join renders as the person's avatar pill bursting in, with a phrase after it. | no |
| UI7-b | Scroll a join out of view and back: it plays AGAIN, once. Scrolling straight past plays it exactly once. Sitting still does not replay it. | no |
| UI7-c | Different joins use different variants (six exist: poof, warp, slam, sparkle, glitch, iris) and the SAME join always plays the same one. | no |
| UI7-d | A leave / kick / ban / rename renders as a quiet STATIC line with no animation; kick and ban read in the critical colour. | yes |
| UI7-e | The membership pill matches the sender pill exactly (same avatar, same shape) and clicking it opens the profile card. | no |
| UI7-f | A membership row never changes the row's height as it animates -- messages above and below stay put while it plays. | no |
| UI7-g | A message following a join from the SAME person still shows its own sender pill (it must not group into the join line). | yes |
| UI7-h | `prefers-reduced-motion` in devtools: membership rows render static, no animation at all. | no |
| UI7-i | ~~Judgement call: six variants?~~ **CLOSED 2026-08-14: six is right, pacing settled at 0.9-1.1s.** | -- |

Standing note: receipts, typing, reactions and presence all need a
SECOND identity. Use Firefox Multi-Account Containers, never a private
window, never the admin browser at the same origin (shared-origin storage
poisoning has cost a session before).

---

## Draft phase nodes (draft-NN -- never well-formed phase IDs, orphan rule G-e5128a)

| label | kind | note |
| --- | --- | --- |
| (none yet) | | |

Carried gotchas cited by ID this campaign: G-tc01 (React-Compiler lint:
no ref reads in render, no sync setState in effects), G-bf01
(setPointerCapture on pointerdown suppresses click -- capture only past
the drag threshold), G-bf03 (`client.sendEvent` needs its `this` --
never detach), G-bf04 (no floats in event content -- scaled integers),
D-bf01 (chrome media goes via the homeserver path, not the fourier-auth
gateway), JSX `\u` escapes invalid in raw JSX text.

---

## Dependency deltas

| dep | version | wave | rationale | DEPENDENCIES.md |
| --- | --- | --- | --- | --- |
| `jsdom` + `@types/jsdom` | `^30.0.1` | 2 | **DEV ONLY.** DOMPurify cannot run without a DOM, so the mandated sanitizer negative tests had nowhere to run. Chose jsdom over happy-dom because these are SECURITY tests and spec-completeness beats speed. | recorded |
| `highlight.js` | `^11.11.1` | 2 | Pre-approved. `lib/common` (~40 langs), not the full build. **+171kB raw / +57kB gzip.** | recorded, with the cheaper `lib/core` fallback |
| `dompurify` | `3.4.11 -> 3.4.13` | 2 | Patch for GHSA-c2j3-45gr-mqc4. We use neither affected hook, so we were never exposed. | recorded |

Pre-approved ahead of time: `highlight.js` (core build + common languages
only) for W2.L1. Everything else needs a ledger justification first.
