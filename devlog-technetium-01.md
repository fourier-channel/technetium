# matrix-client — Dev Log 01

**Project:** 41chan / custom Matrix client
**Location:** `/home/saber/matrix-client` (vesper, user `saber`)
**Stack:** Vite + React 19 + TypeScript + matrix-js-sdk 41.6.0
**Dev server:** `http://127.0.0.1:5173/` (bound to 127.0.0.1 to match MAS redirect URI)
**Editor:** VS Code Remote SSH into vesper

---

## Foundation (done before Phase 1)

OIDC-native login working end to end against MAS:
- `.well-known` delegation discovery → `getAuthMetadata()` → static public client
  `00000000000000000000DEVWEB` (registered in `/opt/synapse/mas/config.yaml` on the
  remote server; backup at `/root/mas-config.yaml.bak-2026-06-17-0300`).
- PKCE authorization-code flow → redirect to MAS → `completeAuthorizationCodeGrant`
  → access token → `whoami` → one-shot sync → room list.
- Gotchas resolved: delegation 404 (password grant gone under MSC3861), dynamic
  registration rejected by MAS policy (http/loopback) → static client instead,
  `web` vs `native` application_type, `$userId` filter bug (pass `userId` to
  `createClient`), React StrictMode double-exchange (module-level guard),
  127.0.0.1 vs localhost redirect mismatch, dev server must be running on return.

State at Phase 1 start: single `App.tsx`, one-shot sync, in-memory only — a
refresh logs the user out.

---

## Phase 1 — The spine (IN PROGRESS)

Goal: turn the one-shot login into a persistent, IndexedDB-backed,
continuously-syncing session that survives a page refresh.

Verified SDK surfaces (41.6.0):
- `IndexedDBStore` (top-level export) — opts `{ indexedDB, localStorage, dbName }`.
- `createClient` opts — `store`, `deviceId`, `refreshToken`, `tokenRefreshFunction`.
- `OidcTokenRefresher(issuer, clientId, redirectUri, deviceId, idTokenClaims)`
  with overridable `persistTokens` — for token-expiry refresh.

Steps:
- [x] Step 1 — session store module; save credentials on login (additive, no behavior change).
- [x] Step 2 — single `buildClient` path with IndexedDBStore.
- [x] Step 3 — resume on load (rebuild from stored session, skip MAS, continuous sync).
- [x] Step 4 — token refresh via OidcTokenRefresher.

### Step 1 — session persistence module
(status: in progress)

`src/client/session.ts` — `StoredSession` interface + `saveSession`/`loadSession`/
`clearSession` over one localStorage key (`matrix-client:session`). `App.tsx`
callback now calls `saveSession` right after `whoami`, capturing homeserverUrl,
access + refresh tokens, userId, deviceId, and the OIDC block (issuer, clientId,
redirectUri, idTokenClaims).

Verified: after login, `matrix-client:session` present in localStorage with all
fields including a refresh_token from MAS and the idTokenClaims needed by the
Step 4 refresher. No behavior change yet (this step is purely additive).

### Step 2 — single buildClient path with IndexedDBStore
(status: done)

`src/client/buildClient.ts` — `buildClient(params)` constructs an `IndexedDBStore`
(`dbName: matrix-client-sync`, `window.indexedDB` + `window.localStorage`), passes it
to `createClient`, then `await store.startup()` (required after createClient, before
startClient). Also `startAndWaitForSync(client)` (start + resolve on PREPARED). `App.tsx`
sync path now routes through these; the two remaining `sdk.createClient` calls are the
whoami probe and the auth-metadata discovery client (both correct to keep).

Verified: login + room list unchanged; IndexedDB `matrix-js-sdk:matrix-client-sync`
(7 object stores) present at origin http://127.0.0.1:5173. Sync state now persists to
disk (not yet consumed on reload — that is Step 3).

### Step 3 — resume on load
(status: done)

`App.tsx` bootstrap `useEffect` now branches three ways: (1) `?code` + `?state` ->
`completeLogin` (exchange code, persist, sync); (2) stored session present ->
`resumeSession` (rebuild from localStorage, no MAS visit); (3) neither -> login form.
Shared `startSyncedClient` builds the store-backed client and populates rooms. The
StrictMode guard was renamed `bootstrapStarted` and moved to cover BOTH async paths.
Stale-token handling: `resumeSession` catch -> `clearSession()` + "please log in again"
(placeholder until Step 4 adds real refresh).

Verified: fresh login -> refresh (F5) stays logged in via the resume path (no MAS
redirect), and noticeably faster than first login (resumes from saved sync token in
IndexedDB rather than full initial sync). `localStorage.clear()` + refresh -> back to
login form. Persistence milestone reached.

### Step 4 — token refresh via OidcTokenRefresher
(status: done)

`src/client/tokenRefresher.ts` — `PersistingOidcTokenRefresher` subclasses the SDK's
`OidcTokenRefresher` and overrides `persistTokens` to write refreshed tokens back into
the stored session (so the NEXT reload also resumes valid). `createTokenRefreshFunction()`
builds it from the OIDC params and returns a `TokenRefreshFunction`
(`refreshToken => doRefreshAccessToken`). `buildClient` threads `tokenRefreshFunction`
into `createClient`; both `completeLogin` and `resumeSession` construct and pass it.

SDK contract (41.6.0): `TokenRefreshFunction = (refreshToken) => Promise<AccessTokens>`,
`AccessTokens = { accessToken, refreshToken?, expiry? }`. SDK calls the function on a 401
from an expired access token; MAS issues fresh tokens; persistTokens saves them.

Resume catch tightened: now only clears the session when refresh ALSO fails (refresh
token expired/revoked) rather than on any stale access token.

Verification: regression check (fresh login + refresh still works) done immediately.
Actual silent-refresh fires only on real token expiry — confirmed by leaving the tab
open past token lifetime and seeing "Token refreshed and session updated" with no
logout. (Deferred to natural occurrence; not forced in a quick test.)

---

## Phase 1 COMPLETE

The spine: persistent, IndexedDB-backed, resuming, self-refreshing sessions. A reload
keeps the user logged in; an expired access token refreshes silently. Foundation ready
for Phase 2 (unified spaces>subspaces>rooms left nav).

Files added: `src/client/session.ts`, `src/client/buildClient.ts`,
`src/client/tokenRefresher.ts`. `App.tsx` restructured into a three-path bootstrap.

Next (Phase 2): install Compound (`-im/compound-web` + design-tokens +
fonts), then build the unified left-nav tree. Confirmed React 19.2.6 satisfies Compound's
peer range. Also pending: move from one-shot sync to a living client surfaced via context
+ live event listeners (currently the client is built and synced but not retained in app
state beyond the room-name snapshot).

---

## Phase 2 — Discord-shaped UI (IN PROGRESS)

Goal: unified, compact spaces>subspaces>rooms left nav, always-open member list,
inverted thread/channel layout, relocated typing indicators. First: Compound
foundation + living-client context, then the nav tree.

Dev-server note: Vite now runs in a persistent `tmux` session on vesper
(`tmux new-session -d -s vite '...npm run dev -- --host 127.0.0.1'`), so it
survives SSH/VS Code disconnects. Trade-off: VS Code no longer auto-forwards
5173 — forward it manually via the PORTS tab (one-time, persists per workspace).
Attach: `tmux attach -t vite`; detach: Ctrl+b then d.

### Step 2.1 — Compound foundation wired
(status: done)

Installed `@vector-im/compound-web@9.4.1`, `@vector-im/compound-design-tokens@10.2.2`,
`@fontsource/inter@5`, `@fontsource/inconsolata@5`. `main.tsx` imports (once, before
render): the all-in-one tokens CSS
(`@vector-im/compound-design-tokens/assets/web/css/compound-design-tokens.css` —
pulls in light/dark/HC themes + prefers-color-scheme switching), Inter weights
400/500/600/700, and Inconsolata 400.

Verified: page renders clean, no import errors;
`--cpd-color-bg-canvas-default` resolves to `#101317` (dark-theme canvas) — tokens live.

### Step 2.2 — living client in React context
(status: in progress)

2.2a (done): `src/client/ClientContext.tsx` — `ClientProvider` owns the full client
lifecycle (status: starting -> awaiting_login -> syncing -> ready | error), holds the
MatrixClient in state, and exposes it via the `useClient()` hook. All auth logic
(completeLogin/resumeSession/login/logout) moved here from App.tsx. Not yet wired
(nothing imports it) — App.tsx refactor is 2.2b.

2.2b (done): `main.tsx` wraps `<App/>` in `<ClientProvider>`; `App.tsx` gutted to a
thin status-driven shell (render by ClientStatus: starting/awaiting_login/syncing/
ready/error), consuming `useClient()`. All auth logic removed from App. Added a logout
button (provider exposes `logout`). Login screen simplified — no homeserver field
(provider defaults to https://41chan.net); can re-add multi-homeserver later.

Verified: resume (reload -> room list), logout (-> login screen), and fresh login
(-> MAS -> room list) all work through the provider. Living client now in context;
App ~230 lines -> ~80. Foundation ready for the nav tree.

Step 2.2 COMPLETE.

**fourier-signature note (2026-06-20):** fourier-signature is the renamed fourier-passport — the identity-assertion layer of the Fourier suite, distinct from fourier-auth (the runtime broker / media gate). Spectral signature (identifies a signal) + cryptographic signature (asserts identity). Technetium's browser-side auth primitives are an identity-assertion concern, so fourier-signature is their natural extraction home.

**FOURIER EXTRACTION FLAG:** the auth primitives — `session.ts`, `tokenRefresher.ts`,
and the login/discovery/exchange logic — together form a complete "authenticate a
browser app against MAS + hold a Matrix-capable session + silent refresh" library,
with zero Technetium-specific logic. This is the client-side counterpart to the planned
**fourier-signature** ("unified MAS-backed identity"). Every future Fourier web frontend
(booru login, tooling) needs the same capability. DECISION: keep building it inside
Technetium for now (prove it in one consumer first), but keep these modules free of
client-specific deps so a later lift into a `fourier-signature-web` package is a move,
not a rewrite. `ClientContext.tsx` itself stays in the client (React glue); the
primitives beneath it are the reusable surface.

### Step 2.3 — unified nav tree (spaces > subspaces > rooms)
(status: in progress)
The "image-2 target": one compact left panel showing the full hierarchy.

2.3a (done): `src/client/spaces.ts` — `buildNavTree(client)` returns
`{ spaces, orphanRooms }`. Reads joined rooms + `m.space.child` state; identifies
top-level spaces (not parented by another space), recurses into subspaces/rooms,
sorts by the `order` field (stable manual ordering — fixes Element auto-shuffle),
guards cycles, skips removed/unsynced children. Verified against live hierarchy:
41chan -> 5 subspaces (chrestai/degenerative/generative/get help/technetai),
CUTE AND FUNNY top-level, DMs as orphanRooms. TEMP `window.mxClient` added to App.tsx
for console verification (remove after 2.3b).

2.3b (done): `src/ui/NavTree.tsx` — recursive `TreeRow` renders the full hierarchy
with depth indentation; spaces marked bold with a marker, rooms clickable via an
`onSelectRoom` callback; orphans under a "Direct & other" heading. `App.tsx` ready
view restructured into a two-pane layout (260px nav sidebar | main area), with a
`selectedRoom` state and a timeline placeholder on the right. TEMP `window.mxClient`
debug line removed. Verified: full nesting renders (rooms under subspaces under
41chan), room click selects + shows name on the right. (Noted in passing: a `/sync`
401 fired mid-session and was silently recovered by the token refresher — confirms
refresh works on an active session, not just at startup.)

2.3c (done): `NavTree.tsx` rewritten — collapsible (per-session `Set` of collapsed
space ids, default expanded, marker flips ▾/▸), compact (24px rows, fontSize 13),
and styled with Compound tokens (text-primary/secondary, bg-subtle-secondary hover,
bg-action-primary-rest selection). `App.tsx` passes `selectedRoomId` for highlight.
Verified on live data: full 41chan hierarchy + CUTE AND FUNNY + DIRECT & OTHER render
compact and themed; collapse/expand works; room selection highlights. (Polish notes
for later: selection color a bit loud; could use a subtler selected-state token.)

2.3d (done): `src/client/useNavTree.ts` — hook that builds the tree and rebuilds it
on `ClientEvent.Room`, `ClientEvent.DeleteRoom`, `RoomEvent.Name`,
`RoomEvent.MyMembership`, and `RoomStateEvent.Events` (covers m.space.child). Rebuilds
are debounced 200ms so event bursts coalesce; listeners + timer cleaned up on unmount.
`NavTree.tsx` swapped from one-shot `useMemo(buildNavTree)` to `useNavTree(client)`.
Verified passive: tree renders + collapse/select unchanged, no console errors. Active
(update-from-another-client) deferred to natural occurrence.

**Step 2.3 COMPLETE** — unified spaces>subspaces>rooms nav tree: live, collapsible,
compact, themed. The "image-2 target" is real. New files: `src/client/spaces.ts`,
`src/client/useNavTree.ts`, `src/ui/NavTree.tsx`.

### Step 2.4 — read-only timeline
(status: in progress)

2.4a (done): `src/client/useTimeline.ts` — `useTimeline(client, room)` returns
`{ items, loadOlder, loadingOlder, atStart }`. Reads `room.getLiveTimeline().getEvents()`,
classifies each (message/encrypted/redacted/other), subscribes to `RoomEvent.Timeline`
for live appends, and `loadOlder()` calls `client.scrollback(room, 30)` (detects
start-of-room when no new events return). Returns raw MatrixEvents + kind; renderer owns
presentation.

2.4b (done): `src/ui/Timeline.tsx` — renders rows (time / sender / body) by kind:
message = PLAINTEXT body only (no HTML yet), encrypted = "🔒" placeholder (crypto is a
later phase), redacted = "(message deleted)", other = "[type]". Scrollback button +
auto-scroll-to-newest. `App.tsx` main pane mounts `<Timeline room={selectedRoom}>` with
a room-name header, replacing the placeholder. Verified: clicking rooms shows messages;
encrypted rooms show the lock placeholder (no breakage); scrollback loads older.
Confirmed NO HTML rendering (no formatted_body/innerHTML) — that is 2.4c with dompurify.

2.4c (done): installed `dompurify.4.11`. `src/client/messageBody.ts` —
`renderMessageBody(event)` sanitizes `formatted_body` (org.matrix.custom.html) via
DOMPurify with a STRICT allowlist (formatting/link/code/list/table tags only; no
script/iframe/style/on*; DOMPurify drops javascript: URIs), falling back to plaintext
when no formatted_body. `Timeline.tsx` renders sanitized HTML via
dangerouslySetInnerHTML (safe — already sanitized) for message kind. Verified: bold/
italics/links render in unencrypted rooms; plain messages unaffected. TEMP window.mxClient
debug removed from App.tsx.

**Step 2.4 COMPLETE** — read-only timeline: live events, scrollback, classified
rendering (message/encrypted/redacted/other), sanitized rich text. New files:
`src/client/useTimeline.ts`, `src/client/messageBody.ts`, `src/ui/Timeline.tsx`.

2.4d (deferred/optional): polish — sender grouping, avatars, day separators.

### Step 2.5 — composer (sending messages)
(status: done)

`src/ui/Composer.tsx` — plain-text composer pinned below the timeline. `client.sendTextMessage(roomId, body)` on Enter (Shift+Enter = newline); optimistic clear with restore-on-failure so a failed send doesn't lose text; Send button disabled when empty/sending; auto-refocus after send. Sent messages appear via the existing live `RoomEvent.Timeline` subscription — no manual insertion. `App.tsx` room view now: header / Timeline / Composer.

Verified: type + Enter sends and the message appears in the timeline; Shift+Enter newlines; Send button works and greys when empty. Plain text only for now (markdown/HTML send is a later enhancement via sendHtmlMessage).

**Technetium is now a usable client** — login, navigate spaces>rooms, read formatted history, and send messages. The core chat loop is closed.

### Step 2.6 — formatted (markdown) sending
(status: done)

Installed `marked@18`. `src/client/messageFormat.ts` — `formatMessage(input)` runs
`parseInline` (no block <p> wrap, breaks:true), sanitizes the output with the SAME
strict DOMPurify allowlist as the receive side (marked passes raw HTML through by
default, so sanitizing before send is required), and decides plain-vs-HTML by comparing
the sanitized HTML against an HTML-escaped version of the input — so escaping alone
(a < b) does NOT falsely trigger formatted send. Composer sends `sendHtmlMessage` when
formatting is present, else `sendTextMessage`. Verified: bold/italic/code/links render
after sending; plain stays plain. Read/write formatting is now symmetric.

Remaining candidates:
- room header polish (topic, member count),
- read receipts / unread markers,
- image upload + the planned client-side md5 dedup (ties into the booru pipeline),
- encryption phase (for encrypted-room support).

---

## FUTURE IDEAS (captured 2026-06-21, not scheduled)

### Technetium UX — extreme customizability
- Settings menu shows a LIVE MOCKUP UI that updates as the user changes options
  (see your choices reflected immediately).
- Granular sliders: distance between messages, avatar size, timestamp format +
  position, etc.
- Space/room names user-customizable via right-click -> "Customize name" (local
  override of the display name; does not change the room's actual name for others).

### fourier-resonance (new Fourier component concept)
A "value / combination-of-values" organizer. Two layers:

1. Explicit rules + general "vibes" as a preference store:
   - Explicit: "always default to private", "dark mode whenever possible",
     "accept only strictly-required cookies then purge ASAP", "randomize
     username/password whenever possible".
   - Vibes: fuzzy preferences applied where no explicit rule exists.
   - Open: password-manager integration (1Password? Bitwarden/Vaultwarden already
     in the stack via fourier-envelope) for the randomize-credentials behavior.

2. Right-click "Copy Color / Copy Size / Copy Vibe" (+ Paste variants):
   - Resonance copies the INTRINSIC values of an element, decomposed into
     predefined/user-defined categories logged in a "data matrix".
   - Context-aware options: right-click text -> Color/Size/Kerning/Font/...;
     right-click a background image -> image-relevant options. The browser knows
     the element type, so the option set maps to the element.
   - Map presets to other elements directly or via translation between systems.

3. "Configuration force field" — portable preferences the user carries to new
   sites:
   - On visiting a new site, (auto or on request) scan/research the site's full
     settings tree (with or without AI assistance).
   - Map the user's presets as closely as possible onto that site's actual
     settings.
   - Show the user visually: which settings were DIRECTLY mapped, which were
     MISSED, which were filled via "vibes" (pre-set prompts).

Note: this is a large, ambitious, mostly-separate product idea from Technetium —
captured here so it isn't lost; belongs in its own design space when revisited.

### Step 2.7 — member list (composable, context-aware honorifics)
(status: done)

A pluggable member-source system, not a single aggregator — so a future Discord
source (mapping Discord users to Matrix identities, if the user allows) drops in
as a provider, not a rewrite.

Files:
- `src/client/members.ts` — `Honorific` (~ PL100 owner, @ PL50 op/mod, + PL25
  voice placeholder), `MergedMember` {id, displayName, avatarMxc, sources[],
  powerByRoom{}}, `MemberSource` interface, `maxPower()`, `createMatrixSpaceSource`.
  KEY RULE: space-structured rooms confer power+presence; orphan rooms (DMs/
  direct-joins) record presence ONLY — DMs default both members to PL100, which
  was inflating everyone to ~. Honorifics now reflect real channel authority.
- `src/client/useMembers.ts` — merges sources by identity (combines sources[] +
  powerByRoom{}), debounced 250ms refresh, source-array-ready for future providers.
- `src/ui/MemberList.tsx` — 220px right panel, third column. Three modes:
  Room / All / All· (all-with-current-room-highlighted). Alphabetical sort (PLs
  carried for future honorific-sort + pull-~@+-to-top).

NOVEL FEATURE — context-aware honorifics:
  honorific IDENTITY = member's highest power across the space (what badge).
  honorific VISUAL STRENGTH = power in the CURRENTLY-VIEWED room.
  Full vivid tier color when authority is "here"; dimmed grey (name + badge
  together) when "elsewhere" — "I'm important, just not in this room."
  In All· mode, members present in the current room are emphasized, rest dimmed.
  No true server-wide list (would need privileged admin access — declined as
  wrong for a client). "All" = everyone the client personally knows about,
  space-scoped (mirrors nav-tree population).

Technetium now has the full three-column Discord shape: nav tree | timeline +
composer | member list.

---

## KNOWN BUG (open, deferred to next session) — honorific dim in ROOM mode

Symptom: in **Room** mode, a member's honorific (~/@/+) still renders at FULL
strength even in rooms where that authority does NOT apply. The name/row dims
correctly; the honorific badge does not recede as intended.

Expected: honorific IDENTITY (the badge shown) = highest power across the space;
honorific VISUAL STRENGTH should follow power in the CURRENTLY-VIEWED room — full
vivid tier color when authority is "here", muted/dimmed when "elsewhere".

Where to look:
- `src/ui/MemberList.tsx`, `MemberRow`. The `dimmed` calc for `mode === 'room'`
  is `honorificFor(plHere) !== identityHonor`. Note: in Room mode, the list is
  ALREADY filtered to members present in the room (powerByRoom has this room),
  so `plHere` is their actual PL here. Suspect: the dim/color logic isn't firing
  for the honorific specifically, OR the All·-mode fix (honorColor -> secondary
  when dimmed) isn't taking effect in Room mode, OR `dimmed` is computing false
  when it should be true (e.g. a user who is + in room A and ALSO default in
  room B should dim in B — verify honorificFor(plHere) actually differs from
  identityHonor in that case).
- Likely a logic bug in the Room-mode branch, not the rendering: re-check that
  `plHere` and `identityHonor` produce the intended mismatch, and that the
  honorColor ternary (dimmed ? secondary : tier) is reached.

Repro: view a room where a known +/@ user is present but NOT powered; their badge
shows full color instead of dimmed.

---

## Session 2026-06-26 — member-list dim fix, "Nearby", image posting

### Step 2.7-fix — honorific dim decouple (resolves KNOWN BUG above)

Root cause: `MemberRow` drove BOTH the name and the honorific badge off one
`dimmed` flag. A prior fix coupled the badge color to that flag, so the badge
receded but dragged the whole name grey with it — a member present in the viewed
room yet holding rank ELSEWHERE went fully grey instead of just the badge.

Fix — two independent signals in `MemberRow`:
- `presentHere = !!room && room.roomId in member.powerByRoom` -> NAME (white in
  the viewed room, grey when not).
- `authorityHere = identityHonor && honorificFor(plHere) === identityHonor` ->
  BADGE (tier color when rank is backed HERE, grey when elsewhere).
- Gated by `honorsRoom = mode === 'room' || mode === 'all-highlight'`; 'all'
  overrides room context (everyone full strength).
Verified across all three modes. KNOWN BUG closed.

### Step 2.8 — "Nearby" view + default

"All ·" (all-highlight) relabeled **Nearby**; made the default
(`useState<Mode>('all-highlight')`). On first load with no room selected it shows
the full roster greyed — reads as "connected, here's everyone" instead of the
ambiguous empty pane Room mode gave (empty == indistinguishable from
not-connected/loading).

### Step 2.9 — image posting (render + send)

Render:
- `src/client/media.ts` — sole owner of the media gateway. `parseMxc()`,
  `mediaUrl(mxc, width?)`, `fetchMediaObjectUrl(client, mxc, width?)`. Origin from
  `VITE_MEDIA_BASE` (default https://mxc.41chan.net); fetches with
  `client.getAccessToken()` as Bearer, returns an object URL.
- `src/ui/AuthedImage.tsx` — renders an mxc via the helper; placeholder while
  loading, [image unavailable] on error, revokes the object URL on unmount.
- `src/ui/Timeline.tsx` — `m.image` branch in `Row` renders <AuthedImage
  width={320}> instead of filename-as-text.

Send:
- `src/ui/Composer.tsx` — image attach button + drag-drop; `readImageSize()` for
  info.w/h; `client.uploadContent()` -> `client.sendImageMessage()`. Synapse mints
  a fresh mxc per upload; client-side dedup still deferred (bmb findPostByMd5
  guards dup booru posts).

Auth: media is fetched through fourier-auth in **bearer mode** at mxc.41chan.net
(fourier-auth DEVLOG §9), NOT the client's raw Synapse token — keeping fourier-auth
the single authorization gateway. Verified end-to-end: post from Technetium ->
renders inline -> lands in the booru via bmb.

### Step 2.10 -- thread view (enable, pills, panel, threaded composer)

**Enablement gotcha (cost a debugging loop):** `threadSupport: true` is a
**`startClient`** option, not `createClient`. `supportsThreads()` reads
`this.clientOpts.threadSupport`, and `clientOpts` is populated by `startClient` --
so the flag on `createClient` is silently ignored and every `m.thread` reply stays
flat in the main timeline. Fix: pass it to `startClient({ initialSyncLimit: 1,
threadSupport: true })`. Also `Thread.setServerSideSupport/List/FwdPagination =
FeatureSupport.Stable` before `store.startup()`. After fixing, the prior sync was
poisoned (cached flat) -- had to `indexedDB.deleteDatabase('matrix-client-sync')` +
hard reload for a fresh threaded sync (token survives in localStorage).

- **Pills:** `ThreadChip` on `event.isThreadRoot` rows shows a live reply-count pill
  (`thread.length` + `ThreadEvent.Update/NewReply` subscription); click -> open panel.
- **Panel (`ThreadPanel.tsx`):** resolves its OWN `(roomId, rootId)` via
  `client.getRoom(roomId).getThread(rootId)`, so it **persists across room switches**
  (auto-close on room-switch deliberately removed; manual Close kept). Renders
  root + `thread.timeline` (deduped) through the shared `Row`. Own threaded Composer.
- **Composer:** optional `threadId` routes `sendTextMessage/sendHtmlMessage/
  sendImageMessage(roomId, threadId, ...)` into the thread -- text, markdown, image.
- **Layout:** `aside | main | ThreadList | ThreadPanel | MemberList`; fixed columns
  take width from `main`, member list unaffected.

### Step 2.11 -- cross-room thread list

**Decision -- client-side aggregation, no server service.** A thread list is
**per-user / membership-scoped**, so there's no single shareable list to cache; a
background aggregator would have to re-implement the homeserver's ACLs per user and
hold long-lived per-user tokens. And `room.getThreads()` is a cheap in-memory read
off sync data (not a poll), live via `ThreadEvent`. So aggregation belongs in the
client. (A server-side admin firehose of all threads regardless of membership would
be a separate, deliberate admin-API thing -- not this.)

- **`useThreadList.ts`:** iterates joined rooms -> `room.getThreads()` ->
  `{roomId, roomName, rootId, thread, lastTs}` sorted by last activity; live via
  **client-level** `ThreadEvent.New/Update/NewReply` re-emission + `ClientEvent.Room`;
  `fetchRoomThreads()` per room to backfill the server-side list on open.
- **`ThreadList.tsx`:** ~190px strip left of the panel. Tiles: room / author /
  `(untitled)` title placeholder (future) / start time / text preview or an m.image
  thumbnail (`AuthedImage` w180/h90) / reply count / last-activity time. Per-tile
  expandable **stats** toggle (footer-right, `stopPropagation` so it doesn't open the
  thread): expands to posters / posts / media plus a per-user posts+media breakdown,
  walking root+replies. Caveat: counts reflect **loaded** events -- long unpaginated
  threads undercount until scrolled.
- **JSX-text gotcha:** `\u...` escapes are invalid in raw JSX text (valid only in
  string literals) -- oxc parse error. Use literal glyph characters in JSX children.

### Step 2.12 -- restacked message rows
`Row` (shared by main timeline AND thread panel): inline `[time][sender][body]` ->
**stacked** -- sender (bold) + time (small) on a header line, body indented 16px
below, reply pill under the body. Same-sender grouping not done yet.

### Step 2.13 -- full-width layout
`#root` dropped its fixed centered column -> `width:100%` left-aligned, so the
five-column shell uses the whole viewport.

**Committed:** `7f3105a` (layout), `55e37db` (threads + list + rows). New files:
`ThreadPanel.tsx`, `useThreadList.ts`, `ThreadList.tsx`.

---

## Session 2026-06-27 -- multi-image batches, gallery grid, resizable panels

### Step 2.14 -- multi-image posting + captions
`Composer` reworked: attaching (button or drop) now builds a **pending tray**
instead of firing immediately; `multiple` file select + multi-drop; each thumbnail
removable. On send, images upload + post sequentially, each its own `m.image` (Matrix
has no album event, so bmb/Element are unaffected). Typed text rides as a **caption
on the first image** via **MSC2530** (`filename` = real name, `body` = caption,
`formatted_body` for markdown) -- built as content + `sendMessage` (the
`sendImageMessage` helper can't set caption fields). Mid-batch failure stops and keeps
the unsent images + caption in the tray.

### Step 2.15 -- gallery grouping + grid render
Every batched image carries a dormant **`net.41chan.gallery`** hint
`{id, index, count, layout}`. `toItems` coalesces same-`id` images into one **gallery
item pre-sized to `count`**, each placed by `index`; null slots are placeholders
(pending/failed/interleaved). A run of <2, or interleaved/partial batches, fall back
to normal image rows (no reordering). `GalleryBody` renders three sender-chosen
layouts:
- **grid** -- fixed ~118px square cells, arranged by count: 2/3 in a row, 4 as 2x2,
  **5 as a double-height cell on the left + a 2x2 on the right** (3-col x 2-row
  template, cell-0 spans both rows; `width: max-content` so fixed columns aren't
  clipped).
- **stack** -- constant total height (300px), N full-width rows divide it.
- **strip** -- constant total width+height (360x280), N columns divide it.
`GalleryCell` fills its track (geometry lives in `GalleryBody`); static **pending-
glyph** background (inline SVG, swappable for a served PNG) with the thumbnail layered
over it; `AuthedImage` gained **`fill`** (object-fit cover) + **`transparentLoading`**
(renders nothing while loading so the glyph shows through until paint). Caption from
index-0 below the grid. Sender picks layout in the composer (picker shows for >=2
images); `toItems` reads it off the flag and stamps it on the item -- **viewer
override deferred** (renderer already takes layout as plain input, so a local toggle
layers on cleanly).

### Step 2.16 -- drag-resizable thread list + panel
`ResizeHandle` (5px `col-resize` bar, pointer-capture drag) on each panel's **left
edge**; widths lifted into `App` state, clamped (list 140-420, panel 280-640). Left-
edge drag = inverse of pointer dx (drag left -> wider); `main` (flex:1) absorbs it so
the member list stays fixed. **In-memory** (resets on reload) -- localStorage
persistence deferred.

### Notes
- **Anchored-edit lesson:** multi-line edits keyed off `cat -n` output kept missing on
  whitespace; bare unique single-line substrings (+ a `count==1` guard) are the
  reliable anchor for files not written in-session.

**Committed:** `267488e` (panel resize), `37ed078` (multi-image + caption + gallery
grid). No new files -- all edits to existing.

### Future ideas (raised 2026-06-27) -- thread-list evolution
Sized for whoever picks these up; none built. (#1/#3 lean on Matrix **account data**.)

1. **Star/pin threads to the top.** Smallest. Splits on where the star lives:
   *local* (a `Set` in `localStorage`, sort starred-first in `useThreadList`) is
   trivial; *portable* (stars follow the user to any client) stores a
   `net.41chan.starred_threads` **account-data** event -- same effort tier, syncs
   per-user across devices for free. **Lean portable.** Key must be the
   `(roomId, rootId)` pair, not just `rootId`.
2. **Repopulate active threads across logins** -- looks like a feature, is really a
   **protocol limitation**, and is the **highest-value** of the three. Root cause: the
   list is built from `room.getThreads()`, which only sees threads whose events are in
   the synced window -- so after a fresh login / cache clear, rooms not yet scrolled
   show **nothing**. Fix isn't "remembering"; it's **eager hydration on login**: walk
   joined rooms calling `room.fetchRoomThreads()` (the server-side `/threads` endpoint
   we already enabled) so the list reflects what the server knows. Cost = N requests
   across joined rooms on login -> wants **throttle/backoff + a loading state**.
3. **Containerize threads into user-arranged spaces** (sort / filter / group / custom
   buckets) -- the **big** one. Sort/filter on data already on hand (room, author,
   activity, starred, media-count) is incremental + buildable. User-defined buckets
   with custom drag/arrange means persisting a layout model (account data again) + an
   org UI = a project, not a step. **Scope down:** ship sort + filter on existing
   fields first; custom buckets are the moonshot.

---

## 2026-06-28 (session 2) -- invite UI, nav-tree investigation, hierarchy finding

Client-side work this session:

### Invite accept UI (built, committed `9c6cb49`)
`NavTree.tsx`: rooms/spaces with `getMyMembership() === 'invite'` render **bright
green + bold** (`#3bd16f`) with a click **"join"** affordance (`marginLeft:auto`).
Click -> `client.joinRoom(roomId)`; on success the tree auto-rebuilds via the
EXISTING `RoomEvent.MyMembership` listener in `useNavTree` (already subscribed -- no
hook change needed) and the row becomes a normal joined room. Failure -> red "retry".
`stopPropagation` so join doesn't also fire row-select.
- Covers BOTH cases: channel invites render in-tree; space invites render at top
  level (an invited space passes the `!childIds.has()` top-level filter in
  `buildNavTree`, so it already flows through as a top node).
- **Join-only for now.** Decline deferred (decline == `client.leave()` == reject;
  add later as a companion).

### Dev-only client exposure (committed `9c6cb49`)
`ClientContext.tsx` after `buildClient`: `if (import.meta.env.DEV) window.mxClient = c`.
Vite strips DEV-false branches from prod, so it never ships. Gives console access to
the live authenticated client for interactive debugging (room state, hierarchy,
membership).

### KEY FINDING -- getRoomHierarchy returns the full skeleton to space members
`client.getRoomHierarchy(spaceId, 50, 3)` returns the full space skeleton -- every
subspace AND channel, with names + join rules -- to a member of the space, even for
rooms that member hasn't joined. So the server exposes space structure to space
members regardless of per-room membership. This VALIDATES building the nav tree from
hierarchy structure, not just synced rooms.

### Nav-tree requirement + deferred design (NOT built -- next session opener)
Current `buildNavTree` sources children from `m.space.child` but only renders a child
if it's in `client.getRooms()` (sync) -- so a clean space-member-no-channels session
shows the space EMPTY (channels correctly hidden, BUT subspaces also hidden).
Requirement: **subspaces always visible; channels hidden unless joined (or invited).**
The fix is a HYBRID tree (deferred, designed):
- **Structure** from `getRoomHierarchy(spaceId)` (includes unjoined subspaces +
  channels with names). Async + paginated -> `useNavTree` must gain loading/error +
  caching (fetch on space-load, refresh on `m.space.child` change; membership overlay
  stays live from sync). Real refactor of the nav-tree DATA layer, not a filter.
- **Membership** overlaid from sync (`getMyMembership()`) for styling + the show/hide
  rule.
- **Render rule:** `room_type === 'm.space'` -> always show; room -> show only if
  joined/invited, else hide.

### Dev-environment lesson (cost real time -- recurred 4x this session)
Element and Technetium share dev origin `127.0.0.1:5173`, so they share browser
storage (same-origin policy: storage is per origin, not per app). A prior Element
session left `im.vector.*`/`io.element.*` account data + `m.direct` in that origin's
IndexedDB; Technetium then rendered THOSE rooms + DMs while the live token was a
different user. Ground truth: the homeserver showed the test user in ZERO rooms --
proving the tree was 100% stale local state, not a server leak. **Firefox private
windows do NOT fix this** -- all private windows share ONE private session/storage
pool (private browsing = "forget on close", NOT "isolate concurrent identities"). The
right tool is **Multi-Account Containers** (per-identity isolated storage) or a
separate browser. Test alts there, never the admin browser at the same origin.

---

## Session 2026-06-29 -- nav-tree hybrid (built)

Resolves the "next session opener" from 2026-06-28: the deferred hybrid nav-tree got
built. Structure now from the server hierarchy, membership from sync.

- **`buildNavTree(client, rooms: HierarchyRoom[])`** (`client/spaces.ts`) -- builds
  from `getRoomHierarchy` entries (which INCLUDE unjoined-but-visible rooms).
  `TreeNode` no longer assumes a live `Room`: carries `roomId`/`name`/`membership`/
  `joinRule` explicitly with `room: Room | null` (null when unjoined). Structure from
  `children_state`; membership via `client.getRoom()`.
- **`useNavTree` is async** -- returns `{ tree, loading }`. Roots discovered from sync
  (joined space rooms not parented by another joined space -- no hardcoded root id,
  supports a future 2nd top space). Per-root `getRoomHierarchy` paginated to
  completion via `next_batch`. CHEAP cache-overlay rebuild (re-reads membership/names
  off the cached skeleton -- instant, drives join feedback) vs EXPENSIVE refetch (re-
  pulls hierarchies); a membership change does both. `RoomStateEvent.Events` triggers
  refetch ONLY for `m.space.child`. Sequence counter discards superseded fetches.
  Keep-previous: never blanks mid-fetch.
- **Three-state render** (`ui/NavTree.tsx`), by `membership` + `joinRule`:
  - joined -> normal text (open room / toggle space).
  - joinable (invite, or unjoined restricted/public) -> solid green; click `joinRoom`
    then open.
  - knock (unjoined knock) -> green pill, dark text; click `knockRoom`, row shows
    'requested'. *(Superseded 2026-06-30 -- see nav-tree fixes.)*
  - Ripple-on-join: one-shot green CSS sweep when a row transitions into joined.
- Orphan rooms (DMs/direct-joins, absent from every hierarchy) -> 'Direct & other'
  group at the bottom.

**members.ts decoupled from the nav tree:** `client/members.ts` no longer calls
`buildNavTree`; it enumerates JOINED rooms directly (`getRooms()` filtered to `join`)
with its own space-vs-orphan partition. **Load-bearing decouple, do NOT re-couple:**
the tree now intentionally holds unjoined nodes with `room: null` (no membership/PL to
feed the honorific model); member-list correctness depends on iterating only real
joined rooms.

**Tooling -- typecheck command:** reliable typecheck is
**`npx --no-install tsc --noEmit -p tsconfig.app.json`** (or `tsc -b`). Bare
`tsc --noEmit` silently checks NOTHING on this project-references layout: root
`tsconfig.json` is a solution file (`files: []` + `references`), zero input files,
always "passes." `-p tsconfig.app.json` is the project that actually `include`s
`src/`. (Bare `npx tsc` also pulls a bogus package -- always `--no-install`.)

Deferred: `buildNavTree` walks every joined non-hierarchy room into 'Direct & other'
unconditionally -- fine now, needs grouping/lazy render at DM scale.

---

## Session 2026-06-30 -- nav-tree fixes (post-open)

Real usage surfaced two nav-tree regressions.

### Invited/joined top-level spaces overlaid from sync (`b610e80`)
The hybrid tree fetched `getRoomHierarchy` only for JOINED roots, so a user invited to
the ROOT space (membership `invite`) got an empty tree -- a regression from the old
all-rooms iteration. Fix: `buildNavTree` overlays top-level spaces with membership
`invite` OR `join` from sync that the hierarchy didn't surface (independent of the
fetch). Also covers the post-accept window before the refetch lands (no flicker-to-
empty).

### Knock rooms de-emphasized (`b43ae4e`)
Supersedes the 06-29 render: knock was a green pill with dark text -- too loud. Now
plain **darker-green text** (`#2b9450`), normal weight, transparent bg, normal hover.
Joinable stays bright green (`#3bd16f`); shade alone separates join (bright) from
knock (dark), no fill.

---

## Session 2026-06-30 -- media viewer (lightbox): enlarge, save, in-gallery nav

Full-screen image viewer, built on the inline image rendering (Step 2.9) and the
gallery grid (Step 2.15). Commit `8e38f6e`; deployed to `tc.41chan.net`.

### Media viewer -- click-to-enlarge + save
- `src/ui/Lightbox.tsx` (new) -- `LightboxProvider` + `useLightbox()`, mounted ONCE at
  App root (`src/App.tsx`) so any descendant opens it with no prop-drilling. Matters
  because `Row` is shared by the timeline AND the thread panel (`ThreadPanel` imports
  `Row`) -- one provider covers both.
- Full-res: reuses `fetchMediaObjectUrl(client, mxc)` (media.ts) with NO width param
  (the inline path passes width=320/360 for thumbnails; the viewer omits it). Same
  authed bearer/gateway path -- no new fetch machinery.
- Object-URL lifecycle owned by the provider: fetch on open/navigate, revoke the prior
  blob on change + close. The blob is RETAINED so Save reuses it -- no second round-
  trip.
- Save = synthetic `<a download=filename>` at the already-fetched object URL.
  Filename: `content.filename` (MSC2530 caption case) -> `body` -> mxc mediaId, with an
  extension from `info.mimetype` when the name lacks one (`imageMeta()` in
  Timeline.tsx).
- Dismiss: backdrop / Close button / Escape; image + toolbar clicks stopPropagation.
  `AuthedImage` already exposed `onClick` (+ pointer cursor) -- wired at the single-
  image `m.image` branch in `Row` and in `GalleryCell`.

### In-gallery prev/next
Scoped to WITHIN the clicked gallery (cross-timeline nav deferred).
- Viewer holds an ordered SET + index: `open(items: LightboxItem[], startIndex)`. A
  single image is a one-element set, no arrows (`hasNav = items.length > 1`).
- `GalleryBody` (owns `cells`) builds the set: `present` = non-null valid-mxc cells in
  order + a `presentIndexByCell` map; each cell's `onOpen` opens the whole batch at
  that cell's position -- clicking the 3rd opens ON the 3rd, and prev/next walk only
  REAL images (pending/failed slots skipped, not shown as blanks).
- `GalleryCell` decoupled from the lightbox (takes `onOpen?`, no `useLightbox()`) --
  the component that owns the data owns the open call.
- Controls: prev/next buttons + an `n / N` counter (only when >1), ArrowLeft/ArrowRight
  keys, clamp at the ends (buttons disable + dim, no wrap).

**Files:** new `src/ui/Lightbox.tsx`; edits `src/App.tsx` (provider mount),
`src/ui/Timeline.tsx` (Row onClick, `GalleryCell`/`GalleryBody` nav, `imageMeta()`).
`tsc -b` clean.

**Deferred:** cross-timeline nav; save directly from an inline thumbnail (save
currently lives inside the viewer).

---

## 2026-07-02 -- Media direct-from-storage, timeline UX, thread list rebuild

**Media.** fetchMediaSrc (client/media.ts): full-size images resolve
through the media gateway to a short-lived direct download URL returned as
JSON, assigned straight to <img src> -- no blob, no CORS on the byte leg
(a 302 approach failed: browsers taint Origin to "null" following
cross-origin redirects inside fetch). Thumbnails keep the authed blob
path. Unified { src, revoke } contract; AuthedImage AND Lightbox
converted -- the lightbox was the missed second caller (JSON blobbed into
an <img> renders only alt text). Per-mxc in-memory URL memo (reuse while
>60s TTL remains) so gallery prev/next and scrollback re-views hit the
browser cache instead of re-downloading full originals.

**Timeline.** Initial back-fill to 60 events on room open. Follow-mode
scrolling: pinned to bottom through late layout shifts (async image
paints, back-fill landing) via scroll listener + ResizeObserver;
disengages when the user scrolls up; load-older preserves position via
prepend anchoring. A one-shot initial-scroll flag was insufficient -- the
back-fill prepend raced it; follow-mode makes the whole class moot.

**Room header into Timeline.** Room name + Load older + Threads toggle now
render inside Timeline; the app-level header was removed. Rationale: a
self-contained room view is the unit for future multi-window / popped-out
rooms.

**Thread list rebuild.** Normalized ThreadListItem model; scope (this room
/ all rooms, per-room default) and sort (latest / created / replies) as
pure functions. Stats dropdown replaced by an inline cluster (posts /
media / posters) with hover-or-tap per-user breakdown. SDK gotcha:
room.fetchRoomThreads() silently no-ops unless
room.createThreadsTimelineSets() has run first (the deposit is
null-chained) -- threads beyond the sync horizon never appeared, and an
empty catch hid it. Initialize-then-fetch; backfill failures now warn.

Next: favorites, user-default prefs, favorites filter.

---

## 2026-07-15 -- Thread Cards v1: draggable, live, animated thread list (overnight auto run)

Turned the thread-list rows into physical-feeling **cards**: one shared FLIP
reorder system, live per-card stats with rate-limited "pop", auto-resort
etiquette, and hand-rolled drag-to-reorder with a persisted custom order. Run
UNATTENDED with per-step self-verification (typecheck + eslint + `tsc -b` build)
gating each commit; visual/interactive checks are logged as PENDING OPERATOR
VERIFICATION below (never claimed as passing without eyes). No new dependencies
(D4 honored -- no dnd-kit).

New files: `src/ui/flip.ts`, `src/ui/pop.ts`, `src/ui/threadOrder.ts`,
`src/ui/threadDrag.ts`, `src/ui/threadOrderStore.ts`. Edited: `src/ui/ThreadList.tsx`.
`src/client/useThreadList.ts` intentionally UNCHANGED (custom order is a
presentation concern; see D-tc01).

### Per-step summary
- **Step 0 -- recon/gate.** Baseline typecheck clean; no drift from the 2026-07-02
  model; D5 stubs (`favorite`, `threadListDefaults()`) confirmed present. Sort seam
  is `SORTERS` in useThreadList; card identity is the `(roomId, rootId)` pair.
- **Step 1 -- FLIP utility** (`flip.ts`). `captureRects`/`playFLIP` + a
  `useFlipList(containerRef, orderKey)` hook. Measures in CONTAINER-CONTENT
  coordinates so a scroll between capture and play isn't mistaken for movement;
  batched read/write with a single forced reflow (no thrash, D2); cleanup uses a
  setTimeout failsafe (G-04f01d). Wired into the existing sort-mode switch.
- **Step 2 -- live stats + pop** (`pop.ts`). Card memoized with a FIELD-LEVEL
  comparator (the list rebuilds all item objects on every ThreadEvent, so a shallow
  ref-compare wouldn't isolate re-renders). `usePopOnIncrease` pulses a card on a
  last-activity increase, rate-limited to one pop / card / 2s, applied to an INNER
  element so pop-scale never fights FLIP-translate on the outer card.
- **Step 3 -- auto-resort etiquette** (`threadOrder.ts`, D3). Decouples DATA order
  from DISPLAY order: while the pointer is over the list (even parked) or
  scrolling, the on-screen order is frozen and each slot rebinds to the latest item
  (stats/pops stay live); ~1.5s after the pointer leaves, the live order is adopted
  and FLIP shuffles once. Never yanks a card out from under the pointer.
- **Step 4 -- drag core** (`threadDrag.ts`, D4 hand-rolled). Pointer-capture,
  5px engage threshold (plain click still opens the thread), lerp-follow "weight",
  live sibling displacement by the dragged card's height projected from static
  centers. FLIP is suppressed for the gesture via a `FlipControl` handle; on drop
  the new order commits (switching to custom mode) and the card settles finger->slot
  via WAAPI, then FLIP is rebaselined.
- **Step 5 -- drop physics + cancel + autoscroll.** Overshoot settle; Escape or a
  release far outside the list springs the card back with no reorder; edge
  autoscroll with the scroll delta folded into the follow target so the projected
  index stays correct in content space while scrolling.
- **Step 6 -- custom mode + persistence** (`threadOrderStore.ts`). Per-scope
  localStorage under `net.41chan.thread_order:<scopeKey>` (D5 naming, `(roomId,
  rootId)` flip-id lists). Reload restores custom mode; new/unsaved threads sort to
  the TOP with a "new" badge until the next drag re-saves the order (O3).
- **Step 7 -- polish + reduced-motion.** `prefers-reduced-motion`: FLIP shuffles
  become opacity crossfades; pop becomes an accent-color blink; drag follows
  directly (no lerp weight, no tilt) and settles/cancels without spring.

### Open-question resolutions (adopted brief recommendations)
- **O1** -- dragging in a non-custom sort SILENTLY switches to custom (baseline =
  the current visual order captured at drag start), no prompt. The `<select>`
  gaining a "Custom" entry is the mode indicator.
- **O2** -- custom order persists PER-SCOPE ("this room" vs "all rooms" independent).
- **O3** -- new arrivals in custom mode go to the TOP, marked "new".

### DRAFT fourier-phase nodes (for later canonical minting)
- **D-tc01 (decision).** Thread-list order is a two-layer model: the data hook
  (`useThreadList`) owns the three data SORTS; the UI layer owns the CUSTOM
  arrangement, the freeze/auto-resort overlay, and new-thread placement. Custom is
  a UI `SortMode`, not a data sort. Keeps the reusable data hook free of
  presentation policy.
- **D-tc02 (decision).** One FLIP system animates every order change (sort switch,
  scope switch, idle-released auto-resort, drag settle). The drag layer temporarily
  cedes control of transforms to itself via a shared `FlipControl` (setDragging +
  recapture) rather than forking a second animation path.
- **G-tc01 (gotcha).** This project's ESLint runs React-Compiler-aware rules that
  TypeScript does NOT enforce: `react-hooks/refs` (no ref `.current` access during
  render) and `react-hooks/set-state-in-effect` (no synchronous setState in an
  effect body). Order-memory that must survive renders therefore can't be a
  render-mutated ref, and can't be snapshotted via a `[dep]`-keyed setState effect.
  Working pattern: drive setState from EVENT HANDLERS / timeouts, and mirror render
  values into a ref via a no-dep effect (ref writes in effects are allowed) so
  handlers read current values. Always run eslint, not just tsc -- all of these
  pass `tsc --noEmit`.
- **G-tc02 (gotcha).** `getBoundingClientRect()` reflects active CSS transforms, so
  measuring a dragged card's "resting" slot must happen AFTER its drag transform is
  cleared, not before -- otherwise the settle starts from the finger position twice.
- **G-tc03 (observation, not this mission's doing).** `src/client/useThreadList.ts`
  on main already violates `react-hooks/set-state-in-effect` (`rebuild()` in the
  subscription effect). Pre-existing; a full-project `npm run lint` will flag it
  independently of Thread Cards. Left untouched this session.

### PENDING OPERATOR VERIFICATION (visual/interactive -- not self-runnable)
Each needs eyes (and a 2nd Multi-Account-Container identity where noted):
- Sort/scope switch visibly FLIP-shuffles surviving cards (~200ms ease-out).
- Post from a 2nd identity: stat ticks, exactly one pop, siblings do NOT re-render
  (React DevTools highlight); a burst within 2s pops once.
- Pointer parked on the list: new activity pops but does NOT move cards; on leaving,
  cards shuffle within ~1.5-2s.
- Drag feel: lift (scale/shadow/tilt/weight), live sibling displacement, plain click
  still opens, no text selection during drag, overshoot settle, Escape/outside
  cancel springs back, edge autoscroll.
- Reorder survives reload; sort away+back restores custom; per-scope orders
  independent; new-thread "new" badge at top clears after a drag.
- Reduced motion emulated in devtools: crossfades/blinks, drag without spring.

### Deferred (not built this session)
- **Touch reorder** -- mouse/pen only in v1 (distinguishing touch-drag from
  touch-scroll needs `touch-action: none` on cards, which breaks list scroll). Touch
  still scrolls the list normally.
- **Keyboard-accessible reorder** -- deferred per the feel spec.
- **v2 portable order** -- `net.41chan.thread_order` account-data (the localStorage
  key is namespaced to match, so it's a move not a rename).

---

## 2026-07-15 -- Room-list enrichment (overnight auto run, branch room-list-enrichment)

Enriched the left nav (`NavTree`) into a live, iconified, notification-aware room
list with per-room right-click controls. Run UNATTENDED with per-step
self-verification (tsc + eslint + build) gating each commit; visual/interactive
checks are logged PENDING below. Branched from main (independent of the parallel
thread-cards-v1 branch).

New files: `src/client/useRoomNotifications.ts`, `src/ui/roomListSettings.ts`,
`src/ui/RoomListSettingsProvider.tsx`, `src/ui/reducedMotion.ts`,
`src/ui/RoomContextMenu.tsx`. Edited: `NavTree.tsx`, `App.tsx`, `main.tsx`,
`index.css`, dependency manifests. New dep: `@fontsource/space-grotesk`.

### Per-step summary
- **P1.1 -- techy font.** Space Grotesk (techy + high readability), imported in
  `main.tsx`, surfaced as the swappable CSS var `--tc-ui-font` (applied to the
  nav; the future settings UI changes it in one place). Recorded in
  CLIENT_MANIFEST.md + DEPENDENCIES.md.
- **P1.2 -- settings store.** `net.41chan.room_list_settings` in localStorage via
  a context/provider: animationsEnabled, favorites, per-room icon overrides,
  per-room mutes. Context+hook in a `.ts`, provider in a `.tsx` (fast-refresh
  split, see G-rl01).
- **P1.3 -- notification data.** `useRoomNotifications` -> Map roomId ->
  {total, highlight} from `room.getUnreadNotificationCount(...)`, refreshed
  (debounced) on sync / timeline / receipt / unread-notifications events.
- **P1.4 -- icons + spacing.** A `RoomIcon` left of each name: user override
  emoji -> room/space avatar (via AuthedImage) -> generated initial. Rows given
  roomier height (28px) and gap while staying compact.
- **P1.5 -- unread treatment.** Unread rooms get an orange glow + "(N)"; a ping
  (highlight>0) adds an orange "@" and a pulse that travels the name letter by
  letter (staggered per-glyph CSS animation, ~moderate). Muted rooms render
  plain. Orange lives in CSS vars (--tc-unread*).
- **P1.6 -- fluid collapse.** Space children collapse/expand by animating
  `grid-template-rows: 1fr <-> 0fr` (fluid to auto-height, no measurement).
  Favorited descendant rooms stay pinned/visible while a space is collapsed, and
  the collapsed space header inherits an aggregated unread badge (sum of
  descendant rooms, muted excluded).
- **P1.7 -- right-click menu.** `RoomContextMenu` (portal, closes on
  outside-click/Escape): favorite/unfavorite, notification Mute + Snooze
  1h/8h/24h + Unmute, icon picker (preset emoji + custom input) + clear, and
  Leave room/space (two-click confirm).
- **P1.8 -- master toggle + reduced-motion.** A room-list Animations ON/OFF
  toggle (seed for the settings UI) gates every pulse/glow-motion/collapse
  animation; `prefers-reduced-motion` is also honored (both fold into one
  `animate` flag). Static unread indicators (glow, count, @, badge) remain when
  animation is off so information is never lost.

### Open-question resolutions / Claudecisions
- Favorites and mutes are LOCAL (localStorage) for v1. Portable lifts deferred:
  favorites -> `m.favourite` room tag; mute -> server push rules. Mute currently
  suppresses THIS client's visual treatment (glow/count/pulse and parent
  aggregation); it does not yet silence server-side pushes. FLAGGED.
- Icons are a LOCAL per-room visual override (does not change the room's real
  avatar for others) -- matches the devlog's "customize name" future-idea intent.

### DRAFT fourier-phase nodes
- **D-rl01 (decision).** Room-list client-preferences (animations toggle,
  favorites, icon overrides, mutes) live in ONE localStorage-backed context
  (`net.41chan.room_list_settings`), the same local-first -> portable path as
  thread order. Keeps all row-level UI state reactive from a single source.
- **D-rl02 (decision).** Fluid collapse uses the CSS `grid-template-rows`
  0fr<->1fr transition rather than JS height measurement -- animates to auto
  height with no ResizeObserver and no fixed-height assumptions.
- **G-rl01 (gotcha).** A React context module that exports BOTH a hook and its
  Provider component trips `react-refresh/only-export-components`. Split it: put
  the context object + hook + types in a `.ts` (no component export -> rule
  inactive) and the Provider in its own `.tsx`. (The old `ClientContext.tsx`
  predates this lint and carries the violation; do not copy it as a template.)
- **G-rl02 (gotcha).** Reading notification counts in a `useState`-map hook must
  not seed state with a synchronous setState in the effect body
  (`react-hooks/set-state-in-effect`). Seed via a lazy useState initializer and
  do the first compute through the same debounce timer as updates (setState in a
  timer callback is allowed).

### PENDING OPERATOR VERIFICATION (visual/interactive)
- Icons render left of names (override emoji / avatar / initial); rows readable
  and compact; Space Grotesk visibly applied.
- Unread: orange glow + (N); ping shows @ + a pulse traveling letter-by-letter at
  a moderate pace; muted room shows nothing.
- Collapse/expand animates fluidly (not instant); favorited rooms stay visible
  under a collapsed space; collapsed space header shows the aggregated badge.
- Right-click menu: favorite toggles (★ + stays-visible-when-collapsed), mute /
  snooze suppress the treatment, snooze auto-expires, set/clear icon works, Leave
  (two-click) removes the room.
- Animations OFF toggle + reduced-motion: no pulse/collapse animation, but static
  unread indicators remain.

### Deferred / flagged
- Server-side mute (push rules) and portable favorites (`m.favourite` tag) -- v2.
- Snooze expiry refresh is best-effort (re-evaluated on the next notif event /
  interaction; no dedicated timer) -- a visual could linger briefly past expiry.
- Avatars fetch per-row through the media gateway; fine at current room counts,
  may want batching at scale.

---

## 2026-07-15 -- Spatial mode (overnight auto run, branch spatial-mode)

A visual "canvas" mode for a room: participants pick a position, their
avatar/name travels there, speech shows as bubbles attached to avatars, and the
normal chat log + composer stay below. Run UNATTENDED, self-verified per step
(tsc/eslint/build); the canvas visuals and multi-user behavior need eyes / a
second live client (flagged PENDING). Branched from main (independent of the
parallel thread-cards-v1 and room-list-enrichment branches).

New files: `src/client/useSpatialPositions.ts`, `src/client/useSpatialBubbles.ts`,
`src/ui/SpatialCanvas.tsx`, `src/ui/spatialSettings.ts`, `src/ui/SpatialView.tsx`.
Edited: `src/client/useTimeline.ts` (filter + incidental fix), `src/App.tsx`.

### Per-step summary
- **S2.1 -- position transport.** `useSpatialPositions`: each participant's
  position is a normalized (x,y) broadcast as a custom TIMELINE event
  (`net.41chan.spatial.position`). Chosen over state events because custom
  timeline events are allowed at PL0, while state events usually need PL50 --
  regular users must be able to move. Own position is also persisted locally per
  room (renders immediately, survives re-entry). Sends are throttled (trailing).
  `useTimeline.toItems` filters `net.41chan.spatial.*` out of every chat log.
- **S2.2 -- canvas.** `SpatialCanvas`: techy grid background, click anywhere to
  place yourself, avatar "pucks" (image / initial / color) that travel to their
  position with a CSS transition (reduced-motion disables the travel). Names
  under each puck; the self puck is ringed.
- **S2.3 -- bubbles.** `useSpatialBubbles`: a live message pops a speech bubble
  on the sender's avatar, auto-expiring on a readability-scaled timer (longer
  text lingers). Backfill/scrollback events are ignored so entering a room
  doesn't burst stale bubbles.
- **S2.4 -- backdrop + avatar.** `spatialSettings` (local): per-room backdrop
  image (rendered beneath the grid) and per-user avatar override (an emoji on
  the puck). Right-click your own puck -> avatar picker.
- **S2.5 -- integration.** `SpatialView` = header (room name; right-click ->
  change backdrop; + Exit) / canvas / the unchanged chat log as a sizeable panel
  / composer. `App` gains a per-session "Spatial mode" toggle on the room view.

### Claudecisions / flags
- Transport is timeline events (PL0-safe) filtered from logs; a state-event or
  EDU transport is a v2 refinement. Multi-user rendering is wired but UNVERIFIED
  (needs a second live client) -- FLAGGED.
- Backdrop + avatar overrides + own position are LOCAL (localStorage). Sharing a
  backdrop as room state, or the avatar as the real Matrix avatar, is deferred.
- **Incidental fix:** `useTimeline` had a pre-existing
  `react-hooks/set-state-in-effect` violation (`refresh()` in the effect body);
  since this step edits the file for the log filter, the reset was moved into a
  `queueMicrotask` (same frame, lint-clean) with a cancellation guard. Behavior
  unchanged; the file is now lint-clean.

### DRAFT fourier-phase nodes
- **D-sp01 (decision).** Ephemeral per-user spatial data (position) rides the
  TIMELINE as a custom event, not room state -- the only transport a PL0 user can
  actually write. Consumers filter `net.41chan.spatial.*` from message logs.
- **G-sp01 (gotcha).** `client.sendEvent` is typed to known event names, so a
  custom event type must be sent through a loosely-typed alias
  (`as unknown as (roomId, type, content) => Promise<...>`), not a bare string.

### PENDING OPERATOR VERIFICATION
- Toggle Spatial mode: canvas with grid renders; click places your avatar; it
  travels smoothly; name shows; chat log + composer usable below.
- Send a message: a bubble appears on your avatar and fades after a few seconds.
- Right-click room name -> set a backdrop URL: image shows beneath the grid;
  Remove clears it.
- Right-click your avatar -> pick an emoji: puck shows it; Reset restores.
- Multi-user (NEEDS 2ND CLIENT): a second identity's position + bubbles appear
  and their avatar travels. UNVERIFIED this session.
- Reduced motion: no travel transition.

### Deferred / flagged
- Multi-user verification; state-event/EDU transport; shared backdrop; drag-to-
  move (currently click-to-place); presence/idle fade of absent users; avatar
  images (only emoji override in v1, plus the real Matrix avatar when set).

---

## 2026-07-16 -- Post-deploy bugfix pass (thread cards / room list / spatial)

The three 2026-07-15 features shipped to production (tc.41chan.net, release
399de84) after a round of live-testing fixes. Each fix was made on its feature
branch, verified (tsc/eslint/build), merged to main, and deployed; the feature
branches were then pruned (trunk-based -- branch fresh off main next time). An
earlier consolidated note was lost with a throwaway integration branch, so this
is the canonical record.

Fixes:
- **Threads un-enterable.** The drag hook called setPointerCapture on pointerdown,
  which suppresses the following `click` in Chromium -- every press read as a drag
  and tiles never opened. Capture now happens only once the drag ENGAGES past the
  threshold; a plain click never captures and opens the thread.
- **Unread indicators frozen.** The base client never sent read receipts, so a
  room's unread count (and the room-list glow/ping) stayed at its login value and
  viewing never cleared it. New `useReadMarker` sends an unthreaded read receipt
  for the latest sent event on room open and on new live events while the room is
  the visible, open one (tab-visibility gated).
- **Avatars didn't load.** The media gateway authorizes booru content and 403s
  avatars ("not authorized for this media"), which aren't booru content. Avatars/
  chrome now load via the homeserver's Matrix authenticated-media endpoint
  (`/_matrix/client/v1/media/thumbnail`) with the access token; message images stay
  on the gateway. `AuthedImage` gained `viaHomeserver` + a `fallback` (degrade to
  an initial); new `media.ts` helper `fetchHomeserverThumb`.
- **Spatial move threw.** `client.sendEvent` was called through a detached alias so
  `this` was undefined (`this.addThreadRelationIfNeeded`) and it threw on every
  move -- positions never broadcast. Bound to the client.
- **Spatial positions rejected.** Positions were sent as [0,1] floats -> Matrix
  `M_BAD_JSON` "Bad JSON value: float". Now sent as integer permyriad [0,10000] and
  divided back to [0,1] on read.
- **Read-receipt 400.** `useReadMarker` was receipting a `~`-prefixed local-echo /
  unsent event (400). It now walks back to the latest fully-sent event with a real
  id, skipping local echoes and our own `net.41chan.spatial.*` presence events.

### DRAFT fourier-phase nodes
- **D-bf01 (decision).** Media splits by kind: booru CONTENT (message images) goes
  through the fourier-auth media gateway; CHROME (avatars, and other standard
  Matrix media the gate isn't meant to authorize) goes through the homeserver's
  Matrix authenticated-media endpoint with the access token. `AuthedImage`'s
  `viaHomeserver` selects the path.
- **G-bf01 (gotcha).** Calling `setPointerCapture` inside pointerdown suppresses the
  element's subsequent `click` in Chromium. For click-vs-drag, capture only when a
  real drag engages (past the movement threshold), never on pointerdown.
- **G-bf02 (gotcha).** A read receipt for a local-echo / unsent event (a
  `~`-prefixed transaction id, or non-null `MatrixEvent.status`) 400s. Only receipt
  fully-sent events (status null, real id).
- **G-bf03 (gotcha).** `client.sendEvent` uses `this` internally
  (`this.addThreadRelationIfNeeded`); a detached reference throws. Bind it to the
  client, or call as `client.sendEvent(...)`. Supersedes G-sp01's cast-only advice.
- **G-bf04 (gotcha).** Matrix canonical JSON forbids floats -- a float in event
  content 400s with `M_BAD_JSON` "Bad JSON value: float". Encode fractional data as
  scaled integers (e.g. positions as permyriad 0..10000).

---

## 2026-07-16 -- Domain mode, part 1 (branch domain-mode, solo run)

Start of a multi-goal UX pass renaming "spatial mode" to **domain mode** and
building it out: canvas customization (backgrounds), interactables, position/
object persistence, and an avatar right-click menu + profile. Run solo, self-
verified per step (tsc / eslint on changed files / build). One dev branch
(`domain-mode`), one commit per step. This entry covers Steps 1-3; Steps 4-6
are scoped below for the next run.

### Fourier name registry (logged as requested)
- **fourier-transform (NEW).** Named this session as "a capstone project for
  isolating and manipulating UI elements in a given operating environment." The
  UI-manipulation module that domain-mode's background Transform UI seeds
  (animated dotted selection, resize/rotate handles, per-object button overlays
  -- "the UI of the UI builder") is a *consumer library of fourier-transform*.
  Build rule: PORTABLE, destined for its own repo; every tunable (dotted-line
  shift frequency, handle marker size/shape, button-overlay style, toggle look)
  reads from a config var, never hardcoded.
- **fourier-signature (existing).** Identity-assertion layer. Binds to the
  profile module (Goal 4): the future "own your profile across platforms".
- **fourier-resonance (existing).** Portable preference/values organizer;
  adjacent to the portable-UI-config idea, not built here.
- New canonical TERMS: "domain" = the user-interactible canvas; "domain mode" =
  the feature; "roompos" = the single-source-of-truth position system (its own
  project); the portable UI-manipulation module remains unnamed (feeds
  fourier-transform).

### Per-step summary
- **Step 1 -- rename.** Files/components/hooks `Spatial*` -> `Domain*`; button
  "Spatial mode" -> "Expand Domain", "Exit spatial" -> "Collapse Domain", header
  "* domain". Wire + storage namespace (`net.41chan.spatial.*`, localStorage
  keys) kept STABLE -- protocol/persistence identifiers already in production.
- **Step 2 -- roompos SSOT.** `useDomainPositions` becomes the single source of
  truth: canonical positions are normalized [0,1] (scale-free -- each renderer
  projects onto its own rect, so multiple UI scales agree). Added a `present`
  flag to the position event: entering the domain re-asserts present:true at the
  saved spot; collapsing releases present:false at the last spot (effect
  cleanup). Absent users render desaturated/dimmed at their saved spot -- the
  "spot saver". Wire flag defaults true (pre-flag clients read as present).
- **Step 3 -- Domain Options panel.** Header "Options" button opens a panel.
  User: "Show backgrounds" toggle (local per-user display pref, default on;
  hides the backdrop layer on this screen only). Admin (PL >= 50): "Set
  background..." (opens the existing backdrop menu for now) + "Remove
  background". Admin gate lives in a non-component module (`domainRoles.ts`:
  `DOMAIN_ADMIN_PL`, `isDomainAdmin`) shared with the future avatar force-
  collapse.

### Claudecisions
- **CD-1 -- one dev branch, staged commits (not parallel branches).** The goals
  share the same surface (DomainView/DomainCanvas) and two foundations (roompos
  SSOT, Options panel), so parallel branches would collide for no isolation
  benefit; prior parallel work already lost a note to a throwaway integration
  branch. Read-only research may still fan out.
- **CD-2 -- rename code symbols but NOT wire/storage keys.** `net.41chan.spatial.*`
  and localStorage keys stay; renaming them is a breaking migration that orphans
  deployed clients' data for zero user benefit. Historical-name comment left at
  the event const.
- **CD-3 -- collapse desaturation deferred out of the rename into Step 2**, since
  it depends on the roompos SSOT (its own project, flagged "important to get
  right").
- **CD-4 -- admin/mod threshold = PL >= 50**, matching the state-write power an
  admin needs to actually change a domain for everyone; centralized in
  `domainRoles.ts` so one var retunes every gate.

### DRAFT fourier-phase nodes
- **D-dm01 (decision).** roompos canonical unit is NORMALIZED [0,1], never
  pixels -- one truth, many projections. This is how a position stays consistent
  across UI surfaces at different scales; renderers project at read time.
- **D-dm02 (decision).** Domain presence ("here" vs "was here") rides the SAME
  PL0 timeline position event via a `present` boolean, not a separate channel.
  Entry asserts true, collapse (effect cleanup) asserts false; absent = show the
  saved spot desaturated. Boolean is canonical-JSON-safe (only floats 400).
- **D-dm03 (decision).** The portable UI-manipulation module (feeds
  fourier-transform) reads every tunable from a config var. Non-negotiable for a
  clean later lift into its own repo.
- **G-dm01 (gotcha).** A `.tsx` file that exports a component AND a plain
  const/function trips eslint `react-refresh/only-export-components`. Put shared
  constants/helpers in a non-component module (e.g. `domainRoles.ts`).

### PENDING OPERATOR VERIFICATION (needs the running app; 2nd client for multi-user)
- Expand Domain / Collapse Domain labels; header reads "* domain".
- Collapse then re-open from a 2nd identity: the collapsed user shows
  desaturated at their last spot; on their re-entry they un-desaturate.
- Options -> "Show backgrounds" off: backdrop hidden on this screen only.
- Options admin section only visible at PL >= 50; "Remove background" clears.

### Next run -- Steps 4-6 (scoped, not yet built)
- **Step 4 -- background upload + Transform UI (the portable module).** Options
  "Set background" toggles the whole domain into an image drop-box; disable the
  current background; image sits BEHIND users and the grid. Left-drag to move,
  mousewheel to scale, arrows to nudge. `T` opens the Transform UI: animated
  dotted selection + square handles, free transform. Bottom-left button strip:
  "Oops" (undo one step; double-click = reset to pre-transform), "H|H"
  (h-mirror), "V/V" (v-mirror) as momentary press-and-return buttons, "4:3->4:3"
  (snap to original aspect ratio) as a lit/greyed TOGGLE, then a red Cancel and
  green Apply. After Apply, stay in interact mode with the transformed image.
  Bottom-right floating "Cancel" / "Set Background". Build portable, all tunables
  via a config var (feeds fourier-transform).
- **Step 5 -- media-post objects + TTD.** A media post in domain mode spawns
  thumbnail-card objects from the sender's avatar; cards persist on the canvas
  and click through like the inline image. Time-to-depop (TTD) control near the
  grid options: a box defaulting to 60, clears to a blinking `#`-cursor on click,
  shows "Hit Enter To Confirm" on input, restores prior focus on Enter. Range
  1..600s (hard cap). Objects visible to anyone who joins within the TTD window;
  TTD eventually scales with power level.
- **Step 6 -- avatar right-click menu + profile.** Right-click another user's
  puck -> menu. Non-admin: "Inspect" (basic profile popover: avatar, user:server
  -- scoped as the seed of a full profile module, future fourier-signature
  ownership). Admin/mod (reuse `isDomainAdmin`): "Force-collapse" (kick the user
  out of the visible space).

---

## 2026-07-16 -- Domain mode, part 2 (Step 4a: background upload)

Branch `domain-mode` continued. Delivered a working uploadable / movable /
scalable / persistent domain background, built on the first slice of the
portable transform module. Self-verified (tsc / eslint-on-changed / build).

New files: `src/ui/uitransform/transform.ts` (portable), `src/client/
useDomainBackground.ts`, `src/ui/DomainBackgroundEditor.tsx`. Edited:
`media.ts` (+`fetchHomeserverMedia`), `DomainCanvas`, `DomainView`,
`DomainOptions`.

### What shipped
- **Portable transform seed (`uitransform/transform.ts`).** Scale-free
  `Transform` (normalized center tx/ty, width-multiplier `scale`, rotation,
  flipH/V), `transformToStyle` CSS projection, canonical-JSON wire codec
  (permyriad/milli ints; bools ok), pure ops (`nudge`/`scaleBy`/`mirrorH/V`).
  Zero Matrix/Tc specifics -- this is the library fourier-transform will
  consume. Config-of-tunables (`config.ts`) lands with 4b's visual chrome.
- **Shared background as room state** (`net.41chan.domain.background`, single
  state key): admin sets `{ url: mxc, ...transformWire }`; everyone renders it.
  Non-admin state write 403s (caught). Precedence over the legacy local backdrop
  URL. `showBackgrounds` pref still gates per-user display.
- **Background media path.** Backgrounds upload via `client.uploadContent`
  (standard Matrix media, NOT booru content), so they render through the new
  `fetchHomeserverMedia` (homeserver authenticated-download), NOT the
  fourier-auth gate (which 403s non-booru media -- D-bf01).
- **Editor.** Options "Set background" -> whole domain becomes a drop-box; pick/
  drop -> drag to move, wheel to scale, arrows to nudge, image behind the grid
  (z0) with a transparent capture layer (z60); Cancel / Set Background. `T`
  routes to a callback for 4b.

### Claudecisions
- **CD-5 -- 4b free-transform stays scale-free via width-fraction + aspect
  ratio, NOT container-relative sx/sy.** A naive non-uniform model (independent
  x/y scale as fractions of the container) is NOT resolution-independent: the
  same pair renders a different visual aspect at different container aspect
  ratios, breaking the roompos SSOT principle (D-dm01). So 4b extends `Transform`
  with a display **aspect ratio** `ar` (pixel width:height, container-
  independent) rendered via CSS `aspect-ratio`; `ar` unset == natural (height
  auto). Free resize edits width `w` and `ar`; the "4:3->4:3" toggle snaps `ar`
  back to the image's natural ratio (captured on image load). Uniform wheel/
  handle keeps `ar`. Rotation + flips unchanged. *Against container-relative
  sx/sy:* not scale-free. *Against uniform-only scale:* can't satisfy "transform
  freely".

### DRAFT fourier-phase nodes
- **G-dm02 (gotcha).** React Compiler lint (`react-hooks/refs`) forbids writing
  `ref.current` during render (the "latest value" mirror pattern). Do it in an
  effect: `useEffect(() => { ref.current = x }, [x])`.
- **G-dm03 (watch).** React attaches `onWheel` as a passive listener, so
  `e.preventDefault()` inside it may be ignored/warn. Harmless here (the domain
  canvas has `overflow:hidden`, nothing to scroll), but if wheel-scale ever
  fights page scroll, attach a native non-passive wheel listener via a ref.
- **D-dm04 (decision).** The domain background is SHARED room state, not a local
  pref -- "admins set/remove backgrounds from domains" is inherently room-wide;
  PL>=50 is exactly the state-write gate. The per-user `showBackgrounds` toggle
  is the only LOCAL background pref.

### PENDING OPERATOR VERIFICATION (needs the running app; admin identity for state write)
- Options (as PL>=50) -> "Set background": domain becomes a drop-box; drop an
  image; drag/scroll/arrows reposition it behind the grid; "Set Background"
  persists; it renders for a second identity in the room.
- "Remove background" clears it. Non-admin: state write silently no-ops (403).

### Next: Step 4b (transform editor) then Steps 5-6 as previously scoped.

---

## 2026-07-17 -- Domain mode, part 3 (Step 4b: portable Transform UI)

Branch `domain-mode`. Built the Transform editor -- the portable UI-manipulation
module ("the UI of the UI builder") that fourier-transform will consume -- and
wired it as a sub-mode of the background editor (press T). Self-verified
(tsc / eslint-on-changed / build). Interaction is UNVERIFIED in-app (flagged).

New files under `src/ui/uitransform/`: `config.ts`, `SelectionOverlay.tsx`,
`TransformButtons.tsx`, `TransformEditor.tsx`. Extended `transform.ts`. Edited
`DomainBackgroundEditor.tsx`.

### What shipped
- **Model (`transform.ts`).** + `ar` display aspect ratio (pixel width:height,
  container-independent; 0 == natural). Box geometry `transformToBox` /
  `boxToTransform`, `resizeBox` (8 handles, opposite edge/corner anchored,
  aspect-lock derives the free dimension), `snapAspect`. Wire codec carries
  `ar` as a scaled int.
- **Config (`config.ts`).** `UiTransformConfig` -- every drawn value (marching-
  ants dash/gap/thickness/color/period, handle size/shape/fill/stroke/width,
  button + toggle look) is a field, none hardcoded. Components take
  `config = defaultUiTransformConfig`. The theme surface fourier-transform owns.
- **Chrome.** `SelectionOverlay` = animated marching ants (SVG stroke-dashoffset
  keyframe) + 8 square handles with resize cursors, purely presentational.
  `TransformButtons` = momentary Oops (click undo, dbl-click reset) / H-mirror /
  V-mirror, a lit/dim maintain-aspect toggle, round red Cancel / green Apply.
- **Harness (`TransformEditor`).** CONTROLLED: host owns the Transform and
  renders the target; the editor draws chrome over the target's projected box,
  resizes via handle-drag, and routes mirror/aspect/undo through an internal
  history. Decoupled from React refs by a `getRect()` accessor (portability).
  Cancel restores the transform captured on entry; Apply keeps the current one;
  both return to interact mode, still movable/scalable.

### Claudecisions
- **CD-6 -- portable module takes `getRect()`, not a React ref.** fourier-
  transform must isolate elements in arbitrary hosts, so the module can't couple
  to a host's React ref / element type. A `() => DOMRect | null` accessor is the
  minimal host contract. *Against passing a ref:* leaks host framework types
  into the portable surface.

### DRAFT fourier-phase nodes
- **D-dm05 (decision).** Free (non-uniform) transform stays scale-free via a
  container-independent display aspect `ar` rendered with CSS `aspect-ratio`
  (not container-relative x/y scale). Same transform, identical render at any
  surface size. Supersedes any sx/sy sketch.
- **D-dm06 (decision).** The portable UI-manipulation module theming contract:
  ALL chrome values live in one `UiTransformConfig`; components read from it,
  never literals. A host reskins the whole manipulation surface by passing a
  different config -- the extraction seam for fourier-transform.

### Known v1 gaps (live-tuning candidates, not blockers)
- Rotation is modelled but has no handle; `resizeBox` assumes rotation 0.
- Capture-layer move/scale/nudge are not recorded in the Oops history (only
  handle-resize / mirror / aspect are); "reset" still reverts everything to the
  pre-transform entry snapshot.
- Handle-resize math + marching-ants feel are UNVERIFIED in-app -- need eyes.

### PENDING OPERATOR VERIFICATION (needs the running app)
- Set background -> pick image -> T: marching-ants selection + 8 handles appear;
  drag a corner resizes; H|H / V/V mirror; 4:3->4:3 lights and snaps aspect;
  Oops steps back, double-click resets; Cancel reverts + returns to interact;
  Apply keeps the transform + returns to interact; Set Background persists it.

---

## 2026-07-17 -- Domain mode, part 4 (Steps 5-6: media objects, avatar menu)

Branch `domain-mode`. Completes the mission's build phase: media-post objects +
TTD control, and the avatar right-click menu (profile + admin force-collapse).
Self-verified (tsc / eslint-on-changed / build; full-tree lint still 24 = no new
problems). In-app interaction UNVERIFIED (flagged).

New files: `src/client/useDomainMedia.ts`, `src/ui/DomainTtdControl.tsx`,
`src/client/useDomainModeration.ts`, `src/ui/DomainUserMenu.tsx`. Edited
`Composer`, `DomainView`, `DomainCanvas`.

### Step 5 -- media-post objects + TTD
- A media post made in domain mode is stamped by the composer with
  `net.41chan.domain_ttd` (seconds). The stamp MARKS it as a canvas object AND
  carries its lifetime. `useDomainMedia` derives live objects from timeline
  m.image events with the stamp, younger than their ttd; expiry is a 1/s
  wall-clock filter. Cards spawn from the sender's puck (per-sender cascade,
  pop-in), click == the shared lightbox, same as inline.
- `DomainTtdControl` (top-left): default 60; click erases to a blinking `#`
  cursor; typing shows "Hit Enter To Confirm"; Enter commits (clamped 1..600)
  and hands focus back to the pre-click element.

### Step 6 -- avatar right-click menu + profile + force-collapse
- Right-click another user's puck (hit-tested at the canvas level so click-to-
  place still works; the self puck keeps its emoji menu) -> `DomainUserMenu`.
  Everyone: "Inspect" -> `DomainProfileCard` (avatar / name / user:server /
  standing+PL) -- minimal but its own component, scoped as the profile-module
  seed. Admin/mod: "Force-collapse domain".
- `useDomainModeration`: force-collapse is a custom timeline event
  `net.41chan.domain.force_collapse { target }`, honored ONLY when the sender is
  verified PL >= DOMAIN_ADMIN_PL (no PL0 forgery). A puck hides while the
  collapse ts >= the user's latest position ts; re-placing (newer ts) returns
  them. Kept OUT of the roompos SSOT.

### Claudecisions
- **CD-7 -- TTD rides with the media post, not the viewer.** Depop lifetime is a
  property of the object, so it must travel with the event (`domain_ttd` field)
  for all clients + joiners to agree. A viewer-local TTD would make "visible to
  anyone who joins during the window" ill-defined. The same stamp doubles as the
  "posted in domain mode" marker. *Against local TTD:* inconsistent lifetimes.
- **CD-8 -- force-collapse is a moderation SIGNAL verified on RECEIPT, not a
  redaction.** Redacting a user's position events would be destructive and
  heavy; a signal event that clients honor only from a verified-admin sender is
  lighter, reversible (target re-places to return), and needs no elevated send
  power. Verification is client-side against room PLs. *Against redaction:*
  destructive + many events; *against trusting the event blindly:* PL0 forgery.

### DRAFT fourier-phase nodes
- **D-dm07 (decision).** Domain media persistence needs NO bespoke transport: an
  object is any stamped m.image on the timeline younger than its ttd, so timeline
  history + a wall-clock filter make it automatically visible to later joiners.
- **D-dm08 (decision).** Cross-user moderation over a PL0 timeline transport is
  made safe by verifying the SENDER's power level on receipt (honor only if
  sender PL >= threshold), not by relying on send-side permissions.

### PENDING OPERATOR VERIFICATION (needs the running app; 2nd + admin identities)
- Post an image in domain mode -> a card pops from your puck, persists ~ttd,
  then depops; a 2nd identity joining within the window sees it; clicking opens
  the lightbox. Change TTD via the box (click -> blinking `#`, type, Enter).
- Right-click another user -> Inspect shows their profile; as an admin,
  Force-collapse hides their puck for everyone until they re-place.

### Mission status
All six planned steps built + committed on `domain-mode` (not merged/deployed).
Remaining is operator smoke-testing (much of it needs 2nd/admin identities) and
the flagged v1 gaps (transform rotation handle; Oops history for capture-layer
moves; per-post TTD power-level gating). Portable UI-manipulation module lives
in `src/ui/uitransform/` ready for later extraction into fourier-transform.

---

## 2026-07-17 -- Login flow, part 1 (branch login-flow, L1-L3)

The barebones "Log in with Matrix" button was fine for early dev; approaching a
launchable product it isn't. This mission rebuilds the entry experience around
one unchanging mission (below) and a mascot. Run solo, self-verified per step
(tsc / eslint-on-changed / build; full-tree lint held at the 24 baseline). New
module: `src/onboarding/`. Branched from main, independent of `domain-mode`.

### New canon (in auto-memory + docs)
- **Onboarding-UX-law (the unfailable mission).** Make the next action obvious
  WITHOUT agency-removing rails -- no screen-dim-to-5%-bouncing-finger tour, no
  self-checkout hostage UX. Every action gives realtime progress; no silent
  stale states ("refresh to see it" without saying so is treason against trust).
  Teach by legibility, preserve agency.
- **Fourier-chan.** Mascot/guide of the Fourier suite: cheerful, wholesome,
  genuinely DSP-knowledgeable AI who leads onboarding. Strictly PG on launch.
  Full brief lives in `docs/fourier-chan-brief.md` (living doc).

### Per-step
- **L1 -- landing + choice node.** Logo / Create account / Log in, then a choice:
  guided walkthrough vs. "I know what I'm doing" (straight to the form). The
  escape hatch is the anti-rails law made literal. Primitives: `SilentBoundary`
  (a throwing subtree renders NOTHING) and one-var asset slots (`assets.ts` /
  `AssetImage`: `text` is placeholder now AND caption later; `hasImage()` is the
  single-bit check).
- **L2 -- perceptible boot + stale-then-live rooms.** `serverShape.ts` persists
  the nav tree's structure as the "last known shape". `useNavTree` seeds from it
  so the room list paints instantly (dimmed + a "Syncing your rooms..." pulse)
  and reconciles to live opacity the moment a real tree lands. Guard: a mid-sync
  EMPTY build never clobbers a non-empty stale preview. `BootScreen` moves (a
  signal spectrum). The real shell mounts DURING sync once a client exists, with
  an indeterminate top progress bar -- no blank screen, ever.
- **L3 -- guided walkthrough.** A 5-step teaching wizard: Fourier-chan (portrait
  = an Image-TBD slot with a signal-monogram placeholder) walks a newcomer
  through what this is / account / joining rooms / done, then hands off to the
  same MAS sign-in. Back + "Skip to the form" on every step; progress dots. The
  41chan join guide 403'd on fetch -> go-fish degrade to known-flow copy + TBD
  quote slots the operator swaps in later.

### Claudecisions (continue the project sequence; CD-1..8 are on branch domain-mode)
- **CD-9 -- silent-null UI.** A UI element that fails to render is replaced by
  nothing -- no error card, no layout shift.
- **CD-10 -- go-fish data (one saving throw).** Primary source -> single next
  likeliest -> else categorical (log once, stop retrying). Accept broadened
  types; discard mismatches by the cheapest boolean.
- **CD-11 -- stale-then-live.** Cache last-known shape, paint it marked stale,
  reconcile live with a transition. Stale/live is a visual differentiator, not a
  blocking gate.
- **CD-12 -- perceptible progress.** No static "Loading"; motion + staged status;
  the stale list gives the user something real to watch.
- **CD-13 -- one var, many uses.** An asset slot is a single `{ src?, text }`;
  `text` is placeholder now / caption later. Point at existing sources; don't
  mint parallel vars.
- **CD-14 -- agency-preserving onboarding.** No rails/hostage tutorials; the
  guided flow always offers Back + Skip and shows progress.

### DRAFT fourier-phase nodes
- **D-lf01 (decision).** Room list is stale-then-live off a serialized
  "server shape" in localStorage; the live `Room` handle is dropped (not
  serializable) and stale nodes are un-clickable-until-live -- correct for boot.
- **D-lf02 (decision).** The app shell mounts DURING initial sync (once a client
  exists), not gated on PREPARED, so the cached room list shows immediately; a
  brief pre-client boot screen covers only the moment before a client exists.
- **G-lf01 (gotcha).** During initial sync `getRooms()` is empty until PREPARED,
  so a naive nav rebuild yields an EMPTY tree that would wipe the stale preview
  and the cache. Guard every commit: an empty build must not replace a non-empty
  tree, and only a non-empty tree is persisted.
- **G-lf02 (gotcha).** Seeding `useState` from `localStorage` is fine, but the
  React-Compiler lint still forbids writing a ref during render (see G-dm02);
  do stale/live bookkeeping in state + effects, not render-time ref writes.

### NEW node type: C- (comedy) -- taxonomy minted this session
The operator proposed a `C-` prefix: mint a node whenever a snarky / casual /
comedic input actually ENCODES a real decision. Threshold to adopt was 5
candidates in a session; we hit 7, so it's adopted. C-01 links only to itself,
in homage to "the robot told me to delete this useless line, but I kept it
because it was funny." Initial mint:
- **C-01.** "the robot told me to delete this useless line, but I kept it
  because it was funny." -> the C-node concept itself. Links: [[C-01]] (only).
- **C-02.** self-checkout hell (keyed 8012 for bananas, "GET HELP", 1980s
  over-inflected voice, the whole thing halting) -> onboarding must never remove
  agency -> [[onboarding-ux-law]] / CD-14.
- **C-03.** "dim the entire screen to 5% except for a circle containing a
  bouncing pointy finger" -> no spotlight/rails tutorials.
- **C-04.** "borderline treason as far as user distrust goes" -> silent stale
  states must be communicated -> CD-11 / CD-12.
- **C-05.** "apparently the creator had certain interests." -> Fourier-chan's
  canonical verbatim deflection line.
- **C-06.** "you me (the human who can kinda talk to computers) and you (the
  computer that can kinda talk to humans)" -> the trust-delegation model.
- **C-07.** "AIRPing" / "dude im so high right now braindump" -> lore-dump mode
  vs. code mode; compartmentalize the input, keep the actionable part.

### PENDING OPERATOR VERIFICATION
See `docs/smoke-login-flow.md` (the "need to feel it" list) -- landing/choice,
stale-then-live boot, and the guided wizard all need a human at the running app;
the stale->live reconcile in particular wants a reload with a warm cache.

### Deferred / next
- **L4** -- room-less default content ("click any room to join"), which is the
  DEFAULT for a room-less chat frame but NOT the generic fallback (a failed load
  leaves emptiness, CD-9).
- **L5** -- formalize the go-fish/degradation helpers app-wide; reduced-motion
  audit; polish.
- **Branch note:** `domain-mode` and `login-flow` are both unmerged off main and
  each carries its own devlog entries after the 2026-07-16 bugfix entry -- expect
  a devlog merge to reconcile them; CD/node numbering is global and continues
  across both.

---

## 2026-07-18 -- Merge to main + housekeeping

Both feature branches were approved and merged to `main` (not yet deployed --
deploy is a separate operator-only step), then pruned (trunk-based: branch fresh
off main next time).

- `domain-mode` -> main: fast-forward (11 commits).
- `login-flow` -> main: 3-way merge. Conflicts only in `App.tsx` (the auth-gate
  region from login-flow vs. the spatial->domain rename from domain-mode -- kept
  `DomainView` + `AuthLanding`/`BootScreen`, dropped the stale `SpatialView`
  import) and this devlog (both appended after the 2026-07-16 bugfix entry --
  kept both, in order). tsc / build clean; full-tree lint holds at the 24
  baseline.

Housekeeping pass (chore commit on login-flow, now on main):
- Deleted 18 untracked `.bak` snapshots from the working tree (gitignored; zero
  repo impact).
- Removed unused Vite-scaffold assets (`react.svg`, `vite.svg`, `hero.png`).
- Dropped `@types/dompurify` (dompurify 3.x bundles its own types; that stub is
  deprecated for v3). tsc still clean.
- Recorded `marked` (^18.0.5, markdown->HTML, always piped through dompurify) in
  `DEPENDENCIES.md` + `CLIENT_MANIFEST.md` per the recorded-rationale discipline.

STILL PENDING (operator): live smoke-tests of BOTH missions -- domain-mode
(`docs`-adjacent checklist / the earlier artifact) and login-flow
(`docs/smoke-login-flow.md`). Merged != verified; much needs 2nd/admin
identities. Held (not forgotten): the 24 pre-existing eslint problems, for a
future debt-burndown pass.

## 2026-07-18 -- fourier-chan-brief.md retired (Merge and Purge)

The character brief was written as instructions to CREATE the living canon
doc but was misread as BEING it. Canon now lives in the private
fourier-channel/fourier-chan repo (canon/ tree, per-aspect files). All
salvageable brief content merged there first, then this purge. Onboarding
code keeps referencing her normally; canon questions route to that repo.
