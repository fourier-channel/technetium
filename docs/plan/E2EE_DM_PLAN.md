<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/docs/plan/E2EE_DM_PLAN.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
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
| branch | MERGED to `main` 2026-08-26 (flag off) |
| base | `main` at the interactions-v1 merge, deployed 2026-08-23 |
| tsc / lint / check / build | CLEAN / CLEAN / 1402 / PASSING (measured 2026-09-09) |
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
  **REOPENED 2026-09-09** -- it is no longer free, because Synapse's storage
  provider takes one bucket and cannot route to another. Four options and a
  recommendation: `fourier-basis/docs/design/ENCRYPTED_MEDIA_BUCKET.md`.
  Awaiting a ruling; E6 shipped without it.
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

### G-e4 -- `isEncrypted()` stays true after a SUCCESSFUL decryption

Found by reading, before it could be found in a browser, where it would have
been maddening: the SDK insisting decryption worked while every message
rendered as a padlock.

`MatrixEvent.isEncrypted()` returns `this.event.type === 'm.room.encrypted'` --
the WIRE type, which never changes. It is therefore true forever after a
message decrypts fine. `getType()` is the opposite: it returns `clearEvent.type`
once decrypted, so it stops reporting `m.room.encrypted` at exactly the right
moment.

The pre-existing test `getType() === 'm.room.encrypted' || ev.isEncrypted()`
would thus have classified EVERY decrypted message as encrypted, keeping the
padlock on the whole conversation the moment E4 started encrypting.

The correct tests are `isDecryptionFailure()` (could not) and
`isBeingDecrypted()` (not yet). Anything else is simply its own kind.

Corollary that cost a check run: the harness's `MatrixEvent` doubles omitted
both methods, so they threw rather than misclassifying. That is the harness
working -- a double that silently returns undefined would have passed while
the real interface had moved.

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

- **No SERVER thumbnail exists for encrypted media, ever.** The upload is
  `application/octet-stream`, which fails the server's supported-format gate,
  and dynamic thumbnailing is off -- a thumbnail request errors. Re-confirmed
  2026-09-09: the encrypted upload has zero thumbnail rows while the server
  holds 4,325 overall.
  **CORRECTED 2026-09-09 -- the conclusion drawn from that was wrong.** This
  said every encrypted image is therefore a full-size download, and that E6
  must downscale ON RECEIPT. Receipt-side downscaling still pulls the whole
  picture, once per recipient per device. The spec's answer, and Element's, is
  that the SENDER makes it: downscale before encrypting, encrypt the thumbnail
  as a SEPARATE attachment with its own key and IV, upload it separately, and
  reference it as `info.thumbnail_file` (matrix-js-sdk types it). The recipient
  fetches kilobytes and pulls the full image only on click. Proven on
  production: a 1600x1200 send produced a 14,907-byte thumbnail beside the
  47,251-byte image, and the recipient rendered 512x384. Landed in `imageThumbnail.ts`.
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

**MVP COMPLETE 2026-09-09, and PROVEN END TO END.** All nine MVP steps plus E6.
E11 (the destructive reset) is the only open step and is deliberately last.

What 2026-09-09 changed, beyond finishing E6 and paying E9's debt (the notice
now has a surface, and a runtime switch means encryption can be tried without a
rebuild): it found that the client had been sending CLEARTEXT into encrypted
rooms. `m.room.encryption` was missing from sliding sync's `required_state`, so
no outbound encryptor was ever built and the SDK, asking its own room model,
sent plaintext. Decryption never broke, so it looked healthy from the inside.
Second, nothing anywhere listened for `MatrixEventEvent.Decrypted`, so a
decrypted message never repainted -- which is why a reload always seemed to fix
it. Both fixed, both guarded by checks, both re-proven against production by
reading the room's events back OFF THE SERVER rather than trusting the client.

Still open, and infrastructure rather than client work: **D-e7**, the separate
`matrix-encrypted-media` bucket. The bucket exists, but Synapse's
`s3_storage_provider` takes ONE bucket and routes by media id with no
content-type signal, so it cannot send encrypted media there. Reaching it means
the client uploading straight to R2 on a presigned PUT from fourier-auth --
which the read path already allows for, since Technetium fetches media through
fourier-auth rather than Synapse, but it is a cross-repo change and a
fourier-auth deploy.

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| D1 | Attachment decryption: decide the dependency | resolved | `8dfc6ce` | NO new dependency, as recommended. `client/encryptedFile.ts` is ~150 lines of WebCrypto and its checks run the real round trip in node, which a wrapper dependency would not have made easier. |
| E1 | `initRustCrypto` + IndexedDB crypto store, with the load surfaced | landed | `83df9c7` | Behind `VITE_E2EE=1`; DEFAULT OFF, so nothing changed for anyone. `client/cryptoProgress.ts` (pure, 30 checks) + `client/crypto.ts` (11 checks) + `onboarding/KeysArrival.tsx` + `CryptoArrivalHost`. Checks 981 -> 1022. **PENDING: E1-a..E1-f.** |
| E2 | Adopt or create the cross-signing identity | landed | `6f7288a` | `client/cryptoIdentity.ts` (pure decision) + `observeCryptoIdentity`/`applySilentIdentityAction` in `client/crypto.ts`. Silent actions run at boot; anything needing the user is published as state and WAITED on, never acted upon. 26 checks, incl. all four safety properties proved over the full 96-state input space and a source-level guard that the SDK's reset option cannot be named outside the (not yet written) reset module. **PENDING: E2-a.** |
| E3 | Secret storage + recovery key, incl. RESTORE | landed | `fd0db6e` `0af3640` `9046d69` | `client/recovery.ts` + `client/recoveryPlan.ts` (pure), surfaced in `ui/SettingsDialog.tsx`: create a recovery key and restore from one, each refusing on its own rather than trusting the caller. `9046d69` stops setup RESETTING a backup that already exists -- G-e1 with the safety catch on. Closes the half E8 owed. |
| E4 | New DMs are created encrypted, WITH the D-e4 guard | landed | `772f1ac` | `client/dmEncryption.ts` (pure) + `recipientCryptoCapability` in `dm.ts`. Encryption is `initial_state` at creation, never sent after. `startDm` returns the decision so E9 can state it. 18 checks; the D-e4 property proved over the full input space. **OWED BY E9: the decision is returned but not yet SHOWN** -- a DM that is quietly unencrypted is the E10 failure, and the notice text exists (`dmEncryptionNotice`) but has no surface. **PENDING: E4-a, E4-b.** |
| E5 | Decrypt and render encrypted timeline events | landed (text) | `2f8788f` | Fixes G-e4 -- `classify()` would have padlocked every SUCCESSFULLY decrypted message. `client/decryptionState.ts` explains WHY a message is unreadable and whether the user can fix it; the placeholder string is gone from the tree. 22 checks, incl. the taxonomy verified complete against the installed SDK enum. **Attachments (H3) still owed** -- moves with E6. **PENDING: E5-a, E5-b.** |
| E6 | Encrypted attachments | landed | `8dfc6ce` | `client/encryptedFile.ts` -- the spec's EncryptedFile on WebCrypto, no new dependency (D1 taken as recommended). Composer encrypts before upload and the event carries `file` INSTEAD of `url`; the timeline recognises `file`, downloads the ciphertext and decrypts for display. Deliberately does NOT share the plaintext thumbnail sizes or URL-keyed blob cache -- H3 is a property of the format, not an omission. Upload name/type are `encrypted`/octet-stream so the filename does not travel in the clear beside its own ciphertext. VERIFIED on production: B rendered a 64x64 PNG from a blob URL in 3s while the bytes on the server begin `9031 f1f9`, not the PNG magic. 30 checks incl. the zero-counter IV, a single flipped bit, truncation and no-dedup. |
| E7 | Device verification UI | landed | `e427eea` `c9a1152` `9ed309e` `f66f8f1` `4097b17` | `client/ownDevices.ts` (your sessions, and what each one's trust actually means), `client/verification.ts` + `client/verificationStage.ts` (the phases, and what each must never claim), `ui/IncomingVerification.tsx` (answering one, without which the flow can never finish). PROVEN end to end on production 2026-09-07: two sessions of one account, request -> accept -> the same seven emoji in the same order on both sides -> both Verified, 12 of 12. Found three defects a reading would not have caught: READY starts nothing until a method is named, identical display names made the device list unaimable, and a failed accept was swallowed. |
| E8 | Key backup (connect) | landed | `05b2d65` | `client/keyBackup.ts` (pure, 14 checks) + `connectKeyBackup`. Strictly non-destructive -- it can connect to an existing backup, never create or replace one. Only ONE state claims the keys are safe: a backup that exists but this session is not connected to protects only what is already in it. The source guard now covers `resetKeyBackup`/`deleteKeyBackupVersion`/`disableKeyStorage` too, not just the cross-signing option. **OWED: creating a backup for an account that has none needs a recovery key, so it moves with E3.** **PENDING: E8-a.** |
| E9 | Encryption is VISIBLE | landed | `e507b27` | `m.room.encryption` removed from the hidden list and PINNED visible by a check, with its neighbours asserted still hidden so the carve-out cannot become a hole. `ui/RoomShieldBadge.tsx` in the header, driven by E10's `roomShield`. Deliberately absent on content rooms -- a "not encrypted" badge on every one is noise that trains people to ignore it where it matters. **OWED: `dmEncryptionNotice` still has no surface.** **PENDING: E9-a.** |
| E10 | Degrade honestly when crypto is unavailable | landed | `e507b27` | `client/roomShield.ts` (pure, 20 checks). The law proved over the full input space: **privacy is never claimed while crypto is unavailable.** Adds `unverifiable` -- a room marked encrypted that we cannot decrypt or check is neither private NOR plainly unencrypted, and reporting either is a false claim. The two warnings ("someone cannot read you" / "someone may not be who you think") stay distinct. |
| E11 | The destructive reset, gated | todo | | D-e1 + D-e2 + G-e1 + G-e2. Type-your-Matrix-ID confirm with the ID displayed; mandatory key export first; honest copy about what is and is not lost. Last, because everything else exists to keep users out of it. |

---

## Open questions -- resolve with the operator, do not assume

All of O-e1..O-e5 are RESOLVED above. Nothing currently open.

---

## PENDING OPERATOR VERIFICATION

This box is headless; nothing below has been seen in a browser.

UPDATE 2026-09-09: that sentence is no longer true of all of it. Two live runs
have since gone against production -- an encrypted DM between two real accounts
(2026-09-05) and device verification between two sessions of one account
(2026-09-07, 12 of 12, emoji matching in order). Items below are deliberately
NOT struck off one by one, because each names a specific observation and only
some of them were made; treat every item as unproven until it carries a date.
The 09-05 run left one thing open that is not on this list: B's reply never
reached A's device, suspected to be an artifact of a test account carrying 18
devices with exhausted one-time keys. Re-check with persistent profiles before
calling it a product defect.

- **E1-a** With `VITE_E2EE=1`, the arrival box appears at login, the bar moves,
  and it leaves on its own once crypto is ready.
- **E1-b** The reported total matches reality -- the bar reaches 100% as the
  download completes rather than overshooting or stalling short (G-e3 is the
  trap this is checking for).
- **E1-c** On a SECOND login the box does not appear, or flashes only briefly:
  the asset is content-hashed and immutable, so it should come from cache.
  Confirmed statically -- a fresh build reproduces the deployed filename
  `matrix_sdk_crypto_wasm_bg-B71jdgYD.wasm` byte-for-byte -- but not in a
  browser.
- **E1-d** With the flag OFF (the default), no wasm request is made at all and
  the box never mounts. Confirmed in the build output (the wasm is referenced
  only from the lazy `rust-crypto-*.js` chunk and is not preloaded from
  `index.html`), but not at runtime.
- **E1-e** The failure path: with the network blocked mid-download, the box
  stays, turns red, and says encryption could not be set up -- rather than
  spinning forever or vanishing silently.
- **E1-f** The title renders with its spacing intact: `A r gh   the  Ke  y    s`.
- **E8-a** On an account with an existing backup, the session connects to it
  and reports `active` rather than `present-disconnected`.
- **E9-a** The shield badge renders in an encrypted DM's header, is absent on
  content rooms, and the `m.room.encryption` event now appears in the log.
- **E4-a** A new DM with a person is created encrypted, and one with a bridge
  bot is created in the clear with the reason shown.
- **E4-b** The encrypted DM is readable by BOTH parties -- the guard prevents
  the case where one side sends into the void, but only a live conversation
  proves the ordinary case works.
- **E5-a** In a real encrypted DM, decrypted messages render as MESSAGES, not
  as padlocks (G-e4's regression, the one this step exists to prevent).
- **E5-b** An undecryptable message shows its reason, and an actionable one
  (unverified device) is visually distinct from a permanent one.
- **E2-a** On a real account that already has an identity, the boot reaches
  `recover-from-secret-storage` or `verify-with-other-device` -- and NOT
  `bootstrap-new`. The decision is proved over its whole input space, but that
  the observed facts are read correctly from a live server is not something a
  headless box can show.

---

## Merged to main with the flag OFF -- what that did and did not change

Merged 2026-08-26 on the operator's instruction. `VITE_E2EE=0` is now PINNED
in `.env.production` with its precondition written next to it, because a flag
that is off because nobody set it looks identical to one that is off on
purpose.

**Do not enable it until E3 and E7 land.** They are the two ways a new device
gets the keys to read existing conversations; without them, enabling this
means people create encrypted DMs their next device cannot read.

Merging is not deploying. Three things DO change for users at the next deploy,
even with the flag off, and all three land on DMs that other clients already
encrypted:

- Unreadable rows say "Encrypted. This client cannot read encrypted messages
  yet." rather than promising decryption later. A fifth outlook, `unavailable`,
  exists precisely so this is not reported as a decryption FAILURE -- with no
  engine present nothing was attempted, and saying otherwise describes an event
  that did not happen.
- Those DMs' headers gain a red "Encryption unavailable" badge. Kept
  deliberately: it is true, and the user genuinely cannot read those
  conversations here. Silence would be the dishonest option (E10).
- `m.room.encryption` is now visible in the log where it was hidden (O-e1).

## Standing law added during this campaign

**NO BRANCHES. Commit to `main`.** Ruled by the operator 2026-08-26,
superseding "trunk-based, ONE integration branch, merge at approved
boundaries". Recorded HERE as well as in CLAUDE.md because CLAUDE.md is
gitignored and does not travel with the repo.

Every step is a gated commit straight onto `main`, pushed after each one.

The reason, which is the part that matters: a branch lets a later session
treat earlier work as somebody else's finished artifact -- "that other
branch's work" -- and defer to it rather than judge it, when it was the same
operator and the same assistant a day earlier. Work parked on a branch
acquires a false authority the moment it stops being visibly in progress.

The gate does the job the branch was pretending to do. If a step is not safe
to put on `main` it is not finished, and a flag defaulted OFF is how an
unfinished feature ships without shipping -- which is exactly how this
campaign's seven landed steps sit on `main` today.

## 2026-09-10, late -- the operator's own account, and the encryption menu

What the operator's screenshots surfaced, in order, and what each became:

- **Foreign tokens.** Element showed the verified device idle and an
  unverified one carrying every request. Cause: the token refresher wrote
  refreshed tokens over the shared session record regardless of whose device
  it named, so a tab left open on a 2026-09-06 login (Za3UFulvTE) stamped its
  tokens onto the record of a 2026-09-09 login (7pISD02Vsw). Fix: tokens are
  persisted only into a record naming the refresher's own device, and resume
  asks whoami once before starting crypto (`sessionIdentity.ts`, checked,
  proven live with a wrong stored device id).
- **Crypto store keyed by user only.** The forced re-login then found the
  previous device's store under its name and "could not set up encryption".
  Store is now keyed by user AND device; the orphaned per-user store of 7p
  is harmless (its keys are in the backup). Proven live: a second device on
  a profile holding the first device's store came up encrypted.
- **Set-up recovery was broken** ("getSecretStorageKey callback returned
  falsey"): the callback answered only for a typed key, never for the key
  the SDK had just created. Now held for the duration of the creating
  operation only (`withCreatedKey`). Proven live on a throwaway.
- **Encryption menu v2** (operator request): "Make a new recovery key"
  (`recoveryKeyPlan.ts`, refuses unless identity keys and backup key are on
  this device; never `setupNewKeyBackup`) -- proven: old key refused on a
  fresh device, new key restores and signs. "Sign out the N unverified" /
  "all N others" via MAS GraphQL (`masSessions.ts`, `sessionPurgePlan.ts`),
  with login now requesting `urn:mas:graphql:*` through our own authorize
  URL (`oidcAuthorize.ts`; MAS 1.22 keeps a session's scope across refresh).
  Every MAS call refreshes an expired token once (MAS tokens live 5 min; the
  SDK refreshes only on a homeserver 401).

**Resolved 2026-09-11 (operator ran the edit):** MAS's GraphQL rejects EVERY bearer token
unless the listener resource says `undocumented_oauth2_access: true`
(crates/handlers/src/graphql/mod.rs, `get_requester`). Until that line is
added under `- name: graphql` in the web listener of
`/opt/synapse/mas/config.yaml` (gitignored, edit in place) and MAS is
restarted, the Sessions section reports "sign in again" for everyone. The
edit and restart were blocked by the session's permission classifier; the
operator ran them. Proven after: a scoped token is answered as User, and the
panel signed out 5 of 6 sessions on the test account (Synapse devices 9 -> 4).

Test accounts made tonight: `claudekey`, `claudekey2` (MAS passwords in the
session scratchpad, never printed); `claudeone` got a password for the OIDC
login probe and a second device id token.

## Operator-side items -- the human-fingers batch

Not client work, and deliberately grouped: the operator handles these in one
pass rather than one at a time.

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
