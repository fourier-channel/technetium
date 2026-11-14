# QQ_M1_PLAN.md -- QuickQueue M1: clear the poster from every picture

> Ledger for roadmap tc.151 (master reference sec 22.10). Spans technetium and
> fourier-tunnel; kept with technetium's because that session took the brief.
> Written client-clean.

---

## The brief, as given

Operator ruling 2026-11-01 (memory identify-the-image-not-the-user): metadata
that identifies the IMAGE -- the prompt and other generation data -- may stay;
anything that identifies the USER -- location, device, system settings,
timestamps -- is stripped and discarded, built as an allowlist, no backfill.
Alongside it: AVIF is stripped, not refused; a refusal is told to the poster;
HEIC is refused before upload with the fix. Operator 2026-11-14: "Start with
M1."

| id | ask | state |
| --- | --- | --- |
| M1.1 | The allowlist as data, one list for every surface | DONE: canon `lib/image-metadata.js` (fourier-basis c7cffd3), hydrated into technetium as `src/canon-image-metadata.js` |
| M1.2 | Technetium clears every picture before it leaves | DONE technetium `6ade7f6`, live v2026.11.14: composer tray, background save, Replace picture, avatar |
| M1.3 | AVIF stripped, not refused (client) | DONE `6ade7f6`: blanked in place, offsets never move |
| M1.4 | HEIC refused before upload, with the fix | DONE `6ade7f6` |
| M1.5 | A refusal is told to the poster (client) | DONE `6ade7f6`: reason and fix, at stage 'prepare', nothing reaches the server |
| M1.6 | Fixtures with GPS, device and time; sabotage control | DONE `6ade7f6`: `checks/identityStrip.check.ts`, `checks/attachmentUpload.check.ts`; hand mutants all killed |
| M1.7 | Read the stored media back from the server | DONE 2026-11-14 (below) |
| M1.8 | The tunnel strips again with the SAME list | OPEN: fourier-tunnel `strip-generation.js` carries its own copies of the lists; adopt canon's module and delete the copies |
| M1.9 | The tunnel strips AVIF instead of refusing it | OPEN: it refuses an unstripped AVIF today and passes the client-stripped one |
| M1.10 | The tunnel tells a refusal to the poster, not only its log | OPEN |
| M1.11 | Live behaviour in the browser UI (tray, refusal sentence) | PENDING OPERATOR VERIFICATION |

## Readings chosen

- **Clear, then everything else.** The strip runs before encryption,
  thumbnailing and upload, so an encrypted room (where the server cannot strip)
  gets the same protection. A retry whose uploads all landed does not strip
  again; the event's `info.size` is the cleared file's.
- **A file that cannot be read is refused, never passed.** TIFF and unknown
  formats: "convert"; a truncated file, an unknown critical PNG chunk or JPEG
  marker: "re-save". The sentence names the file, the reason and the fix.
- **HEIC is refused now, not "once AVIF works".** AVIF works in the client in
  the same commit, so the condition the roadmap set is met.
- **`dropped` names kinds, never content**, so nothing a picture carried can
  reach a log by way of the report of what was removed.

## Proven

- Shipped stripper output decodes pixel-identical to its input (Pillow), for
  PNG, JPEG (both byte orders), WebP, GIF and AVIF.
- fourier-tunnel's own `stripGeneration` accepts all five cleared outputs and
  reads the prompt back from PNG, JPEG, WebP and GIF.
- End to end, 2026-11-14, as the parity account in a test room: the dirty
  JPEG fixture (4165 bytes, five planted strings) cleared to 834 bytes with
  the prompt kept, uploaded and posted, then read back through the media gate:
  698 bytes, picture data byte-identical, no planted string, Exif holding
  Orientation only. The prompt is absent from the SERVED file by the
  one-file-per-image design: the tunnel takes generation data into the
  booru's record and serves the stripped file. So the client keeping the
  prompt is what lets the tunnel record it.

## Known losses

- A prompt held only in XMP (Midjourney JPEG/WebP, Draw Things) or only in a
  Raw profile chunk is dropped with the XMP. Admitting a named XMP field is
  a canon list change, if wanted.
- An AVIF's Exif item goes whole, any prompt in it included.
