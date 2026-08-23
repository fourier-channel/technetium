# E2EE_DM_PLAN.md -- end-to-end encryption for direct messages

> Spec + ledger for the campaign opened 2026-08-23.
>
> Same discipline as PARITY_PLAN.md and INTERACTIONS_PLAN.md: a fresh session
> boots from CLAUDE.md + this file, and from nothing else. Every landed step
> writes its result here immediately. Written client-clean -- no infra
> internals, origins, ports, room names or gating config.

---

## Compact state

| field | value |
| --- | --- |
| campaign | e2ee-dms |
| branch | not yet cut -- take `e2ee-dms` off `main` |
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

## Read this before writing code

Four facts about the tree that will otherwise cost a day each.

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

The moment a DM is encrypted, that branch starts firing for the first time in
production. It is correct as written and has 15 checks (`checks/media.check.ts`),
but it has never run against a real encrypted room. Expect to verify it, not to
rewrite it.

### H3 -- encrypted attachments have no `url`

An encrypted `m.image` carries `content.file` (an `EncryptedFile`: mxc, key, iv,
hashes), **not** `content.url`. Every media site in the client reads
`content.url` and runs it through `parseMxc()`, which returns null for an
absent url -- so an encrypted picture currently falls through to being rendered
as its text body, silently.

matrix-js-sdk does **not** export attachment decryption. Element uses the
separate `matrix-encrypt-attachment` package. That is a new dependency and needs
a DEPENDENCIES.md entry with rationale before it lands (see D1).

Note that decryption happens in the client, so a decrypted attachment is a blob
the existing cache can hold -- but key it on something that cannot collide with
the plaintext URL for the same mxc.

### H4 -- `m.room.encryption` is currently hidden

`client/systemEvents.ts` lists `m.room.encryption` among the system events
hidden from the log by default. Turning encryption on for a DM would therefore
be invisible. That is almost certainly wrong for this campaign -- "this
conversation became encrypted" is a security-relevant fact and the one system
event a user should see -- but it is a deliberate change to a list, not a bug to
fix in passing. See O-e1.

---

## What already exists

- **The crypto engine is already in the bundle.** matrix-js-sdk 41.6 uses Rust
  crypto, and the build emits `rust-crypto-*.js` plus a ~5.5MB
  `matrix_sdk_crypto_wasm_bg.wasm` as separate chunks today, with nothing ever
  calling into them. Confirm whether those chunks are actually FETCHED at
  runtime before treating the size as a new cost -- they are emitted, which is
  not the same as loaded.
- **`classify()` already knows about encryption.** `useTimeline.ts` returns the
  `'encrypted'` kind for `m.room.encrypted`, and Row renders the padlock
  placeholder reading "Encrypted (decryption coming later)". That string is a
  promise this campaign is here to keep.
- **`startDm()`** in `client/dm.ts` creates with `is_direct: true` and no
  encryption.
- **The SDK surface** (verified against `node_modules`, 41.6.0):
  `client.initRustCrypto({ useIndexedDB })`, `client.getCrypto()`, and on
  `CryptoApi`: `bootstrapCrossSigning`, `bootstrapSecretStorage`,
  `createRecoveryKeyFromPassphrase`, `checkKeyBackupAndEnable`,
  `resetKeyBackup`, `getActiveSessionBackupVersion`,
  `isEncryptionEnabledInRoom`, `getUserVerificationStatus`,
  `getDeviceVerificationStatus`, `getUserDeviceInfo`, `crossSignDevice`,
  `resetEncryption`.
- **`initRustCrypto()` must be called after `createClient` and before
  `startClient`.** `buildClient.ts` already has the comment marking where the
  crypto store "will hang later"; that is the spot.

---

## Step ledger

Status vocabulary: `todo | in-progress | landed | blocked | pending-eyes`.
PENDING = needs operator eyes in a browser (this box is headless).

| id | step | status | commit | result / pendings |
| --- | --- | --- | --- | --- |
| D1 | DEPENDENCIES.md entry for attachment decryption | todo | | Required BEFORE the dependency lands, per standing law. Establish first whether it is genuinely needed or whether the SDK has since absorbed it. |
| E1 | `initRustCrypto` + IndexedDB crypto store, behind a flag | todo | | After `createClient`, before `startClient`. Must not change behaviour for anyone until E4. Verify the wasm chunk actually loads and what it costs. |
| E2 | Device identity: cross-signing bootstrap | todo | | `bootstrapCrossSigning` takes a UIAuthCallback. **Auth here is MAS/OIDC, not password UIA** -- do not assume the Element flow transfers. Verify against the real server before building UI. |
| E3 | Secret storage + recovery key | todo | | `bootstrapSecretStorage` / `createRecoveryKeyFromPassphrase`. Needs UI: show the key ONCE, make the user confirm they have it. A recovery key shown twice is a recovery key in a screenshot. |
| E4 | New DMs are created encrypted | todo | | `startDm()` gains an `m.room.encryption` initial state event. **New DMs only** -- silently encrypting an existing DM changes what its history means. |
| E5 | Decrypt and render encrypted timeline events | todo | | Replaces the "decryption coming later" placeholder. A failed decryption must say WHY (unknown session, no key) rather than showing the padlock forever -- that is the D-tp16 rule applied to the thing users will actually hit. |
| E6 | Encrypted attachments | todo | | H3. Read `content.file`, decrypt, feed the existing blob cache. Upload side too: an image sent in an encrypted DM must be encrypted before upload and must NOT reach the booru pipeline. |
| E7 | Device verification UI | todo | | Emoji SAS. At minimum: see your own devices, verify a new one, see whether the person you are talking to is verified. |
| E8 | Key backup | todo | | `checkKeyBackupAndEnable` / `resetKeyBackup`. Without it, a lost device is a lost conversation, and users will lose devices. |
| E9 | Encryption is VISIBLE | todo | | O-e1. The shield state in the DM header, and the `m.room.encryption` event shown in the log rather than hidden. |
| E10 | Degrade honestly when crypto is unavailable | todo | | Campaign law: never fake a state. If the crypto store cannot open, say the DM is not encrypted -- do not show a shield that means nothing. |

---

## Open questions -- resolve with the operator, do not assume

- **O-e1** Should `m.room.encryption` come out of the hidden system-event list?
  Recommendation: yes, for DMs at least. It is the one system event with a
  security meaning, and hiding it makes a state change invisible.
- **O-e2** Existing DMs: leave unencrypted, offer to encrypt, or encrypt
  silently? Recommendation: leave them, offer explicitly. A room that becomes
  encrypted mid-history has two halves that mean different things, and the user
  should be the one who decides that.
- **O-e3** What happens to media in an encrypted DM with respect to the booru
  and the media gate? An encrypted attachment cannot be indexed and must not be
  posted. Confirm the gate's behaviour for media that has no post behind it --
  this is the same shape as D-in06 (emoji) and D-tp15 (backgrounds), and both
  took a round to get right.
- **O-e4** Does the deployed homeserver have cross-signing and key backup
  enabled, and does MAS change the UIA path for `bootstrapCrossSigning`?
  **Operator-side; verify before building E2/E3.**
- **O-e5** Do unverified devices block sending, warn, or neither?
  Recommendation: warn, never block. A client that refuses to send is a client
  people stop using.

---

## PENDING OPERATOR VERIFICATION

Nothing yet. Everything visual and every real-server behaviour goes here.

---

## Carried in from interactions-v1

The pending lists at the end of `INTERACTIONS_PLAN.md` were **never worked
through** -- roughly 35 rows across LX, SG, FC, TD and TC. The campaign merged
and deployed on the operator's instruction with that verification outstanding,
which was their call and is recorded as such. If something in the chat window
turns out to be broken during this campaign, check those lists before treating
it as new.
