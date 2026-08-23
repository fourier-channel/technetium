# E2EE_DM_PLAN.md -- end-to-end encryption for direct messages

> Spec + ledger for the campaign opened 2026-08-23.
>
> Same discipline as PARITY_PLAN.md and INTERACTIONS_PLAN.md: a fresh session
> boots from CLAUDE.md + this file, and from nothing else. Every landed step
> writes its result here immediately. Written client-clean -- no infra
> internals, origins, ports, room names or gating config. The server-side
> census behind the rulings below lives in the canonical devlog and the master
> reference, NOT here.

---

## Compact state

| field | value |
| --- | --- |
| campaign | e2ee-dms |
| branch | `e2ee-dms`, cut off `main` at `41bd9b4` |
| base | `main` at the interactions-v1 merge, deployed 2026-08-23 |
| tsc / lint / check / build | CLEAN / 23 (HOLD) / 981 / PASSING |
| deploys | operator's call, `./deploy.sh` only |

---

## The scope line, stated once

**Direct messages are encrypted. Content rooms are not.**

That is not a compromise reached for convenience, it is the project's recorded
stance narrowed rather than reversed. Content rooms stay unencrypted BY DESIGN:
they feed the booru pipeline, they are searchable, and a chan-shaped board whose
history only its participants can read is a different product. DMs are the
carve-out because a private conversation between two people has none of those
requirements and all of the opposite ones.

Anything that pushes encryption toward content rooms is out of scope and should
be brought back to the operator rather than absorbed.

---

## The premise that was wrong, and now frames everything

The campaign was opened as "add encryption to a client that has none". Server
verification on 2026-08-23 replaced that premise:

**Technetium is the last client here to adopt E2EE, not the first.** Users
arriving at this client overwhelmingly ALREADY have a cross-signing identity
and a live key backup, created by another client that encrypts DMs by default.
Human-to-human DMs are already encrypted; Technetium currently draws every one
of them as the "decryption coming later" padlock.

Three consequences, and they reorder the whole campaign:

1. **E2/E3 are "adopt an existing identity", not "create one".** The dangerous
   call is the one that looks like setup. `bootstrapCrossSigning({ setupNewCrossSigning: true })`
   or `resetKeyBackup()` against a user who already has an identity destroys
   working credentials and orphans every key in their backup. See D-e1.
2. **E7 cannot be deferred.** A fresh Technetium login is an UNVERIFIED device
   on an account that already has cross-signing. It receives no room keys, so
   existing conversations stay padlocked and every peer sees a warning shield.
   "Fully functional DMs" therefore requires at least one of recovery-key entry
   (E3) or verify-with-another-device (E7). Both are in the MVP; E3 first,
   because a recovery key always works and SAS needs the other device present.
3. **E4 as originally written was a bug.** "All new DMs are created encrypted"
   breaks DMs with appservice/bot users, which is how people are onboarded.
   See D-e4 -- the guard is part of E4, not a follow-up.

---

## Resolved -- rulings, not recommendations

Operator, 2026-08-23. These are canonical; do not relitigate.

- **D-e1 -- non-destructive by default.** On detecting an existing cross-signing
  identity, offer recovery-key entry or device verification. NEVER reset without
  an explicit, separately-confirmed destructive action. The confirm is gated as
  heavily as the client can gate it: the user's own Matrix ID is DISPLAYED, and
  they must TYPE IT to proceed. This is a once-ever action and it is
  irreversible; a button is the wrong shape for it.
- **D-e2 -- key export is a MANDATORY gate on reset.** Before any reset can
  proceed the user must save a room-key export, or explicitly acknowledge they
  cannot produce one. `CryptoApi.exportRoomKeysAsJson()` /
  `importRoomKeysAsJson()` exist in 41.6. This is the difference between a reset
  that costs nothing and one that costs everything, and the user is by
  definition not placed to judge which they are in.
- **D-e3 -- encrypted media never reaches the pipeline, and says so.** Copy, as
  ruled: "All media posted in encrypted DMs stays here. Nothing is tagged and
  nothing is posted to chanbooru." The client's job is to SAY this; the bridge
  is already structurally incapable of acting on encrypted events, so this is
  disclosure, not enforcement.
- **D-e4 -- never encrypt a room the other party cannot read.** Before creating
  an encrypted DM or offering to upgrade one, check
  `getUserDeviceInfo([otherParty])`. No device keys means the other party cannot
  receive encrypted messages, full stop -- do not encrypt, and say why. Stated
  as a capability check, NOT a hardcoded bot list, because the list is the part
  that goes stale.
- **D-e5 -- upgrading an existing plaintext DM is deferred, not built.** The
  offer is explicit and one-way when it exists, but it currently has no
  human conversation to apply to, and every plaintext DM that does exist is one
  D-e4 forbids touching. Build the D-e4 guard now; build the upgrade flow when
  there is something to upgrade.
- **O-e1 RESOLVED -- yes.** `m.room.encryption` comes out of the hidden
  system-event list. It is the one system event with a security meaning.
- **O-e5 RESOLVED -- warn, never block.** Unverified devices produce a warning.
  A client that refuses to send is a client people stop using.
- **Crypto initialises at LOGIN**, not lazily on first DM. Most users have
  encrypted DMs waiting for them, so lazy buys little, and a shield that arrives
  three seconds late is a shield nobody trusts.
- **D-e6 -- the crypto load is SHOWN, not hidden.** A one-time multi-megabyte
  fetch that happens silently at login is indistinguishable from a hang. It
  gets an arrival box with a real progress meter and copy that states plainly
  what is being installed and what it will and will not encrypt. See E1 and
  G-e3.
- **D-e7 -- encrypted media gets its OWN R2 bucket.** Not for cost -- the spend
  is negligible at realistic volume -- but for three things it makes possible:
  independent growth tracking, an independent lifecycle policy (D-e8), and
  immunity to a future tool that grabs the first bucket it enumerates rather
  than the one it was configured for. Verified 2026-08-23: nothing we currently
  run enumerates buckets (both consumers name theirs explicitly from config),
  so this is a forward-looking guard taken while it is free. Operator-side.
- **D-e8 -- encrypted DM media has a lifecycle, and its terminal state is
  deletion.** DM media is revisited far less than room or thread media, and
  vastly less than thread media; dormant DMs go fully cold. Tier by last read
  toward deep storage, and purge outright once a conversation is dead.

  The purge predicate is **all participants gone, never any participant
  gone.** A deactivated account's peer may still hold the room keys and still
  read their half. "No longer registered" applied per-user destroys live
  conversations; applied to the whole room it destroys nothing, because
  ciphertext whose keys are gone is not merely unwanted data -- it is
  **unreadable by anyone forever**. That is the rare case where deletion
  removes no information, since the information is already gone.

  Explicitly NOT keyed on time since last login. Dormancy is a property of the
  conversation, not of a login timestamp.

---

## Verified server facts -- do not re-derive

Checked against the deployed server 2026-08-23. Client-relevant only.

- **Cross-signing bootstrap needs NO UI.** First-time cross-signing key upload
  is permitted without UIA unconditionally (MSC3967 behaviour is not
  flag-gated). Only a RESET requires approval.
- **The reset path is a redirect, and the SDK already speaks it.** A reset
  returns a UIA error carrying `flows: [{stages:["m.oauth"]}, {stages:["org.matrix.cross_signing_reset"]}]`
  with `params.<stage>.url` pointing at the auth service's account-management
  page. matrix-js-sdk 41.6 knows `AuthType.OAuth = "m.oauth"` (MSC4312), so this
  routes through the ordinary UIA callback. Nothing needs inventing.
- **Key backup works and every crypto endpoint is reachable.** `/keys/query`,
  `/keys/upload`, `/keys/device_signing/upload` and `/room_keys/version` all
  answer through the edge. Nothing is filtered.
- **MSC4133 is still off** -- O-in6 (local-only avatar masks) is unchanged and
  remains out of this campaign.

---

## Read this before writing code

### G-e1 -- deleting a key backup version DESTROYS the keys, whatever the docs say

Synapse's `delete_e2e_room_keys_version` carries the docstring "Doesn't delete
their actual key data." **The docstring is wrong.** The transaction runs a
delete against the room-keys table before flagging the version deleted. On the
deployed server every deleted backup version holds zero keys.

This is the fact D-e2 exists to defend against. Anyone reading Synapse's own
documentation would build the opposite safety assumption and ship a reset flow
that quietly incinerates history. Draft node, for minting at session end.

### G-e2 -- resetting cross-signing does NOT make old messages unreadable

The three things routinely conflated as "your encryption identity" fail
differently, and only one of them is destructive:

| thing | what it governs | cost of resetting |
| --- | --- | --- |
| cross-signing identity | device TRUST -- who is verified | everyone re-verifies. Messages unaffected. |
| secret storage / recovery key | the keychain holding the backup key | a new recovery key to save |
| key backup (`/room_keys`) | server-side store of Megolm session keys | **destructive -- see G-e1** |

Megolm decryption never consults cross-signing. Reset the identity outright and
every old message still decrypts, provided the session keys are still held.
This is why D-e2's export/import preserves the ACTUAL events -- individually
viewable, authorship intact -- rather than a flattened transcript.

**Rejected alternative, recorded so it is not re-proposed:** re-posting old
decrypted content into the room as a lump-sum "historical activity" message.
It fails three ways. It only works when the user can still decrypt, which is
largely the case where nothing was going to be lost. It FORGES ATTRIBUTION -- a
transcript of the other person's words, signed by your new identity, renders in
their client as your message, which is precisely the property E2EE exists to
deny. And it broadcasts to the peer, resurrecting anything they redacted.

### G-e3 -- the wasm progress meter has no hook, and its denominator lies

Two traps, both in E1.

**There is no progress hook.** `initAsync()` does
`WebAssembly.instantiateStreaming(fetch(url))` with nothing to observe. The
way to a real meter is to prefetch the wasm ourselves with a streaming reader
that counts bytes, then call `initAsync(ourUrl)` -- it memoizes its load
promise, so the SDK's later no-arg call reuses ours and resolves off the warm
HTTP cache. No forked SDK, no patched package.

**`Content-Length` is the COMPRESSED length; the stream yields DECODED
bytes.** The asset is served gzipped, so the obvious
`received / contentLength` meter runs to roughly 290% and looks broken. The
denominator must be the true decompressed size, which is known at build time.
Per D-tc01 that constant lives in one place and a check reads the real asset
and compares, so a drift fails the gate instead of quietly mis-aiming the bar.

### H1 -- the classic /sync poller must stay STATELESS. This is the big one.

`client/notificationCounts.ts` + `useRoomNotifications.ts` run a counts-only
classic `/sync` alongside the sliding-sync stream. It **never sends a `since`
token**, and the reason recorded at the time was precisely this campaign:

> the request is STATELESS -- never a `since` token, or it would ack the
> to-device queue out from under the sliding-sync stream and silently break the
> deferred encryption phase.

To-device messages are how room keys arrive. A second sync that acks them means
keys are delivered to a consumer that throws them away, and the symptom is not
an error -- it is messages that cannot be decrypted, intermittently, for
reasons that look like anything but a second sync loop.

**If you touch that poller, or add any second sync, re-read O-tp13 in
PARITY_PLAN.md first.** Adding `since` to make counts incremental is the exact
optimisation that breaks this, and it will look like a free win.

### H2 -- the media room hint was built for this and has never fired

`client/media.ts`'s `mediaUrl()` sends a `room_id` hint **only when the room
carries an encryption state event**, gated on `Room.hasEncryptionStateEvent()`.
In an unencrypted room the server can already see the event, so the hint is
noise -- and sending it unconditionally is what caused a round of 403s before it
was gated.

It is correct as written and has 15 checks (`checks/media.check.ts`), but has
never run against a real encrypted room. Expect to verify it, not rewrite it.

### H3 -- encrypted attachments have no `url`, no thumbnail, and no dedup

An encrypted `m.image` carries `content.file` (an `EncryptedFile`: mxc, key, iv,
hashes), **not** `content.url`. Every media site in the client reads
`content.url` and runs it through `parseMxc()`, which returns null for an absent
url -- so an encrypted picture currently falls through to being rendered as its
text body, silently. That silent fallthrough is what E5's placeholder must
replace even though E6 is deferred.

Verified against the deployed server, and both are worse than the ledger first
assumed:

- **No thumbnails exist for encrypted media, ever.** The upload is
  `application/octet-stream`, which fails the server's supported-format gate,
  and dynamic thumbnailing is off -- a thumbnail request errors. **Every
  encrypted image is a full-size download to render any preview at all.** An
  8 MB image costs 8 MB to show a 300px thumb. E6 must downscale once on
  receipt and cache the derived thumbnail client-side; there is no server path.
- **Dedup is impossible in principle.** A fresh key and IV per upload means the
  same image uploaded twice yields different ciphertext, a different content
  URI and a different hash. The planned client-side MD5 dedup does not apply in
  encrypted DMs and must not claim to.

Decryption happens in the client, so a decrypted attachment is a blob the
existing cache can hold -- but key it on something that cannot collide with the
plaintext URL for the same mxc.

### H4 -- `m.room.encryption` is currently hidden

`client/systemEvents.ts` lists `m.room.encryption` among the system events
hidden from the log by default, so turning encryption on would be invisible.
O-e1 rules that it comes out. That is a deliberate change to a list, in E9.

### H5 -- encryption is not all-or-nothing at room creation

`m.room.encryption` is an ordinary state event, sendable at any point by anyone
at `state_default`. Other clients simply send it at creation for DMs, which is
where the impression comes from. It IS effectively one-way -- clients must not
honour a downgrade -- so a room that gains it has two halves that mean different
things, with the pre-encryption events plaintext and readable forever. This is
what D-e5's copy has to be honest about, whenever D-e5 gets built.

---

## What already exists

- **The crypto engine is already in the bundle, and it is cheaper than it
  looks.** matrix-js-sdk 41.6 uses Rust crypto. The build emits
  `rust-crypto-*.js` (~231 KB) plus `matrix_sdk_crypto_wasm_bg.wasm` as
  separate chunks. Both sit behind `initRustCrypto`'s dynamic import, so
  nothing fetches them yet: E1 is the commit that makes the cost real.

  **Measured against the deployed asset 2026-08-23, not estimated from the
  build output:** 5.58 MB on disk, **1.94 MB gzip, 1.72 MB brotli on the
  wire**. Served as `application/wasm` with `public, max-age=31536000,
  immutable` and a content-hashed filename, so it is **downloaded once,
  effectively ever** -- not per session, not per deploy. It re-downloads only
  when the SDK's crypto wasm version changes, or when the user clears site
  data.

  That last case is the one that matters, and not for the 1.7 MB: clearing
  site data also destroys the **IndexedDB crypto store**. The download is
  cheap; the store is the thing whose loss costs a conversation. That is
  E8's entire reason to exist.
- **`classify()` already knows about encryption.** `useTimeline.ts` returns the
  `'encrypted'` kind for `m.room.encrypted`, and Row renders the padlock
  placeholder reading "Encrypted (decryption coming later)". That string is a
  promise this campaign is here to keep.
- **`startDm()`** in `client/dm.ts` creates with `is_direct: true` and no
  encryption.
- **`initRustCrypto()` must be called after `createClient` and before
  `startClient`.** `buildClient.ts` already has the comment marking where the
  crypto store "will hang later"; that is the spot.
- **No new dependency is needed for attachments.** matrix-js-sdk exports no
  attachment encryption (confirmed against `node_modules`: no
  `encryptAttachment`/`decryptAttachment` anywhere in its type surface), but
  `EncryptedFile` is AES-CTR-256 plus SHA-256 -- all native WebCrypto, roughly
  80 lines in a pure module the harness can load (O-tp9). See D1.

---

## Step ledger

Status vocabulary: `todo | in-progress | landed | blocked | pending-eyes`.
PENDING = needs operator eyes in a browser (this box is headless).

**MVP line ("fully functional DMs"):** E1, E2, E3, E4, E5, E7, E8, E9, E10.
E6 is deferred -- with an honest placeholder, per E5.

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| D1 | Attachment decryption: decide the dependency | todo | | Recommendation: NO new dependency. Hand-roll `client/encryptedFile.ts` on WebCrypto and record the decision in DEPENDENCIES.md as a decision NOT to take one. Belongs with E6, so it moves with E6. |
| E1 | `initRustCrypto` + IndexedDB crypto store, with the load surfaced | todo | | After `createClient`, before `startClient`. Init at LOGIN. Must not change behaviour for anyone until E4. Includes the arrival box (D-e6) and its honest failure path (E10). |
| E2 | Adopt or create the cross-signing identity | todo | | First-time bootstrap needs no UI. The work is DETECTING an existing identity and not clobbering it (D-e1). |
| E3 | Secret storage + recovery key, incl. RESTORE | todo | | Restore-from-recovery-key is the MVP-critical half, not creation. Show a new key ONCE and make the user confirm they have it. A recovery key shown twice is a recovery key in a screenshot. |
| E4 | New DMs are created encrypted, WITH the D-e4 guard | todo | | `startDm()` gains an `m.room.encryption` initial state event ONLY when the other party has device keys. New DMs only. |
| E5 | Decrypt and render encrypted timeline events | todo | | Replaces the "decryption coming later" placeholder. A failed decryption must say WHY (unknown session, no key, unverified device) rather than showing the padlock forever -- D-tp16 applied to the thing users will actually hit. Includes the honest placeholder for encrypted ATTACHMENTS while E6 is deferred (H3). |
| E6 | Encrypted attachments | DEFERRED | | H3 + D1 + D-e3. Read `content.file`, decrypt, feed the existing blob cache; downscale once on receipt for the thumbnail the server will never provide. Upload side encrypts before upload. |
| E7 | Device verification UI | todo | | Emoji SAS. See your own devices, verify a new one, see whether the person you are talking to is verified. NOT deferrable -- see the premise section. |
| E8 | Key backup | todo | | `checkKeyBackupAndEnable`. Mostly already true server-side for existing users; the client work is enabling it and never calling reset by accident. |
| E9 | Encryption is VISIBLE | todo | | O-e1. Shield state in the DM header, and `m.room.encryption` shown in the log rather than hidden. |
| E10 | Degrade honestly when crypto is unavailable | todo | | Campaign law: never fake a state. If the crypto store cannot open, say the DM is not encrypted -- do not show a shield that means nothing. |
| E11 | The destructive reset, gated | todo | | D-e1 + D-e2 + G-e1 + G-e2. Type-your-Matrix-ID confirm with the ID displayed; mandatory key export first; honest copy about what is and is not lost. Last, because everything else exists to keep users out of it. |

---

## Open questions -- resolve with the operator, do not assume

All of O-e1..O-e5 are RESOLVED above. Nothing currently open.

---

## PENDING OPERATOR VERIFICATION

Nothing yet. Everything visual and every real-server behaviour goes here.

---

## Operator-side items this campaign depends on

Not client work; recorded here so they are not lost.

- **Cloudflare is not edge-caching the wasm.** It answers `cf-cache-status:
  DYNAMIC` because `.wasm` is not in the default cacheable-extension list, so
  every user's first load pulls from origin. A Cache Rule on the asset path
  fixes it. Cheap, and worth taking BEFORE this file starts loading for real.
- **The separate encrypted-media bucket** (D-e7).
- **The media lifecycle policy** (D-e8) -- tiering and purge.

---

## Carried in from interactions-v1

The pending lists at the end of `INTERACTIONS_PLAN.md` were **never worked
through** -- roughly 35 rows across LX, SG, FC, TD and TC. The campaign merged
and deployed on the operator's instruction with that verification outstanding,
which was their call and is recorded as such. If something in the chat window
turns out to be broken during this campaign, check those lists before treating
it as new.

---

## Noted for the master-reference pass (not this campaign)

Doc drift found while verifying, recorded so it is not lost: the booru bridge
described in the master reference as `fourier-bmb` is not what is running --
the service that carries the autotagger and booru integration is
`fourier-tunnel`, which has no component-index entry. Master ref sec 4.1 and
the sec 4 index both need a pass. Belongs to fourier-coherence's remit.
