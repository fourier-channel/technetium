<!-- coherence:hydrated -- canon is fourier-basis/docs/repos/technetium/docs/plan/EGRESS_CONSENT_PLAN.md
     Edit canon and run `coherence hydrate`, never this delivered copy.
     An edit here is drift: hydration will refuse to overwrite it and the
     doc axis reports it edited-in-place until someone promotes or discards it. -->
# EGRESS_CONSENT_PLAN.md -- informed egress, and the record of it

> Spec + ledger for the consent system requested 2026-08-15. Client-clean:
> no infra internals, origins, room names or gating config.

---

## The principle, stated once

**Any time the client is about to hand the user's information to a surface it
does not control, the user is told plainly, in advance, and can decline without
losing the rest of the client.**

That is a suite-wide rule, not a KLIPY feature. KLIPY is simply the first case
that forces it to exist. The 41chan front page now states the same idea for the
site itself: connecting already discloses you, and a notice that pretends
otherwise is worse than none.

Three properties follow, and they are what make this different from a cookie
banner:

1. **It is a record, not a dismissal.** What you consented to, and when, is
   kept and shown back to you.
2. **It is revocable** -- individually or wholesale -- and revoking is not a
   polite request. It hard-blocks the surface.
3. **A blocked surface explains itself** and offers the switch, without
   nagging and without obstructing anything else.

---

## The consent record

Stored as account data (`net.41chan.egress_consent`) so it follows the user
across devices, mirrored to localStorage for a pre-login read.

    {
      "<surface-id>": {
        granted: boolean,
        at: number,             // ms, when the current state was set
        version: number,        // the notice version consented to
        readPolicy?: boolean    // did they actually open the linked policy
      },
      ...
    }

**D-eg01 -- absence means "not granted", never "not asked".** A surface with
no record is blocked and shows its explanation. Defaulting to allowed would
make a storage failure into a silent opt-in, which is the exact failure this
whole system exists to prevent.

**D-eg02 -- a consent is versioned.** Every surface declares a `noticeVersion`.
Bumping it invalidates existing grants for that surface and re-asks, because a
material change to what is disclosed is a different question from the one the
user answered.

**D-eg03 -- revocation is a hard block, not a preference.** A revoked surface
is not merely hidden: nothing loads, no request is made, no URL is constructed.
The distinction matters because the harm being prevented is the CONNECTION,
not the display.

**D-eg04 -- "stop asking" is separate from "deny".** Revoking resets the
surface to unasked, so it will prompt again next time it is used. A user who
finds that tiresome can permanently disable the prompt for that surface, which
denies it silently forever. Two switches, because "I do not want this" and "I do
not want to be asked about this" are different sentences.

---

## The notice

One component, one shape, every surface. Per the operator's wording:

> KLIPY is a 3rd party resource, and by using it, you as the user are making a
> direct connection to that resource. This can potentially expose your IP
> (among other information.) We recommend using a VPN for all layers of online
> activity.

Generalised, a notice declares: **who** the surface is, **what leaves** the
device, **what they can see**, and **what happens if you decline**. The VPN
recommendation is standing text on every egress notice.

**D-eg05 -- the VPN link is data, not code.** A sponsor slot exists; until one
is set, the sentence stands alone. Inventing a vendor to fill a link would be
an endorsement nobody authorised. Same treatment as the front page.

---

## The fallback state

When a surface is blocked, whatever would have rendered is replaced by a quiet
panel: what is missing, why, and a direct control to enable it.

**D-eg06 -- informative, never obstructive.** The panel occupies only the space
the feature would have used. It never overlays, never steals focus, never
appears more than once per surface per view, and it is dismissible for the
session. A privacy feature that makes the client annoying teaches people to
click through privacy notices, which is the opposite of the goal.

---

## Surface register (v1)

| id | surface | what leaves the device |
| --- | --- | --- |
| `gif.klipy` | KLIPY GIF/sticker search | search terms, IP, user agent, on every keystroke-debounced query |
| `preview.url` | URL previews | the URL you were sent, to OUR homeserver, which then fetches it |
| `media.remote` | remote-media rendering | nothing new today (media is proxied) -- registered so it stays visible |

`preview.url` is already opt-in and predates this system; it is folded in so
there is ONE place a user sees everything, rather than a per-feature scattering.

### KLIPY: the contract, sourced 2026-08-15

Obtained from KLIPY's own public demo apps and migration guide after
`docs.klipy.com` refused automated fetches. Read off working client code, not
from memory -- but it is still SECOND-HAND and must be confirmed against the
real docs before shipping.

- **Base URL:** `https://api.klipy.com/api/v1/{API_KEY}` -- the key is a **PATH
  SEGMENT**, not a query parameter or header.
- **It is a drop-in Tenor replacement** (`tenor.googleapis.com` ->
  `api.klipy.com`), which is why the shape is familiar.
- **Endpoints:** `GET /gifs/trending`, `GET /gifs/search`, `GET /gifs/categories`,
  `GET /gifs/recent/{customer_id}`, `POST /gifs/view/{slug}`,
  `POST /gifs/share/{slug}`, `POST /gifs/report/{slug}`,
  `DELETE /gifs/recent/{customer_id}`. Stickers, clips and memes mirror this.
- **Parameters:** `page`, `per_page`, `customer_id`, `locale`, plus ad params.
- **Item shape:** `{ id, title, slug, blur_preview, file: <size variants>, type,
  width, height, content }`.

**Two findings that change the notice, not just the code:**

1. **`customer_id` is required on every call.** A persistent per-user identifier
   goes to KLIPY with every search. That is materially more than "they see your
   IP and your queries" -- it links a user's entire search history together. The
   surface register was written before this was known and understated it; now
   corrected. Nothing has shipped, so this is an edit rather than a
   `noticeVersion` bump.
2. **`view` and `share` are POST endpoints.** Which results you looked at and
   which you sent are reported back individually. Whether calling them is
   optional or contractually required is one of the open questions below.

**Correction to what this ledger said on 2026-08-14:** I recorded that KLIPY
"places ads between content". Their migration guide describes monetization as an
opt-in feature a developer may integrate, not something imposed on the response.
The earlier statement was stronger than the evidence supported.

**Brand attribution is a requirement**, not a courtesy: the migration guide's
step 3 requires KLIPY attribution in the search bar and content area. That is a
UI obligation to design in, not a footnote.

**Production access is gated:** keys start in sandbox and production must be
requested through their partner panel.

**Still needed before G2 can ship** (see the message to the operator): the
`search` query parameter's exact name, response envelope and pagination fields,
rate limits, whether `view`/`share` reporting is mandatory, the attribution
asset requirements, and the verbatim caching clause.

**KLIPY-specific note.** Their terms currently forbid caching their content,
which forces the direct client-to-KLIPY connection and therefore forces the
notice -- the restriction and the disclosure requirement are the same fact seen
from two sides. The operator is pursuing a waiver; if granted, a proxied or
cached mode would materially change what leaves the device and would therefore
be a `noticeVersion` bump, not a silent improvement.

---

## Profile surface (v2)

"Information you have shared" in the user profile: every surface, its state,
when it was granted, whether the policy was opened, and per-row revoke plus a
revoke-all. Deferred to v2, but the record above is designed so that page is a
pure read of it -- no migration needed.

---

## Step ledger

| id | step | status | result |
| --- | --- | --- | --- |
| C1 | Consent model: record, defaults, versioning, revoke (pure + checks) | **landed** | `client/egressConsent.ts`, 40 checks |
| C2 | Store: account data + localStorage mirror, live updates | | |
| C3 | `<EgressNotice>` prompt component | | |
| C4 | `<EgressBlocked>` fallback panel | | |
| C5 | Settings surface: per-surface toggle + "stop asking" | | |
| C6 | Wire `preview.url` into the register (migrate the existing pref) | | |
| C7 | Wire `gif.klipy` when the adapter exists (gated on G2) | | |
| C8 | Profile "information shared" page | v2 | |

---

## Open questions

- **O-eg1** Should a denied surface be denied per-room or per-account?
  Recommendation: per-account. A GIF picker you distrust in one room is one you
  distrust everywhere, and per-room state multiplies the record for no benefit.
- **O-eg2** Should the notice block the FIRST use, or appear at settings time?
  Recommendation: first use. A notice shown when nothing is happening is not
  read; one shown at the moment of consequence is.
- **O-eg3 -- RESOLVED 2026-08-15 (operator): separate, and said so plainly.**
  They are different surfaces -- a web surface reached by browser versus an app
  surface intended to become a standalone wrapper -- with different storage and
  different threat models. Implying one record would claim a guarantee that does
  not technically exist.
- ~~**O-eg3** Does the front page's gate and this client's register need to be
  the same record?~~ They are different origins with different storage.
  Recommendation: no -- keep them separate and say so, rather than implying a
  cross-surface guarantee that does not technically exist.
