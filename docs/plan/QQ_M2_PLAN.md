# QQ_M2_PLAN.md -- QuickQueue M2: the image browser inside Technetium

> Ledger for roadmap tc.152 (master reference sec 22). Kept with technetium's
> plans; written client-clean.

---

## The brief, as given

Operator 2026-11-01: "Technetium becomes the image browser itself." (D-89dc7a.)
The panel is, on desktop, pulled up from the chat box, above the ticker, and
resized as needed; its full-screen view is the same Lightbox a room's images
open in. It loads only when opened. Operator 2026-11-18: "You can begin M2
step 1." Held behind a flag, as domain mode is, until M2 is ready to show.

Operator 2026-11-18, on SMB: if Chrome cannot read SMB shares, QuickQueue gets
something built in that can. That decision waits (docs/design/QQ_FOLDER_INDEX.md).

| id | ask | state |
| --- | --- | --- |
| M2.1a | The flag: off for everyone, on by env or a per-browser opt-in | DONE technetium `32041b8`: `VITE_QQ` ("1" only), 0 in `.env.production`; Settings opt-in with a passphrase, the domain-mode pattern (`src/client/qqMode.ts`) |
| M2.1b | A drawer above the ticker, resized by its top edge, loaded only when opened | DONE `32041b8`: `src/qq/QuickQueueDrawer.tsx`; the panel is its own chunk (about 9.5 KB), never fetched until the first open; the grip uses pointer capture; the height is kept per browser and never leaves the chat under 200 px |
| M2.1c | Folders from File System Access, remembered, permission asked every time | DONE `32041b8`: handles in IndexedDB (`technetium-quickqueue`), read mode only; reopen / denied / unsupported each say what to do |
| M2.1d | The folder grid | DONE `32041b8`: listed whole with a running count, then subfolders and pictures in natural order; hidden entries (`.quickqueue/`) never shown; other files counted; windowed, so 100,000 files mount only the rows in view |
| M2.1e | Thumbnails made on the device | DONE `32041b8`: 256 px WebP, four at a time LIFO, bounded cache that revokes what it evicts; a tile scrolled away gives up its turn |
| M2.1f | Full screen is the room Lightbox | DONE `32041b8`: `LightboxItem.local` reads the file itself, so a local picture needs no client and no upload |
| M2.1g | Live on a real folder: the system picker, a grant across a restart, the tablet, a big folder | PENDING OPERATOR VERIFICATION |
| M2.1h | Operator on the preview 2026-11-18: the panel opened empty; the tab did not move inside the panel when open | DONE technetium `0763d2c`, on the preview: a browser without File System Access now says so (it rendered nothing); the tab rides the panel's top edge as every drawer's does |
| M2.2 | Scan: state the cost and index size first, then build the index | NOT STARTED; where the index lives awaits the ruling on QQ_FOLDER_INDEX.md |
| M2.3 | Search and filters over the index | NOT STARTED |
| M2.4 | Queues | NOT STARTED |
| M2.5 | Send: re-check the MD5, then Composer.addFiles | NOT STARTED |
| M2.6 | Purge checklist entries | NOT STARTED; purge deletes the folder database today as it does every database but the keys |

## Readings chosen

- **The listing is shown whole.** Sorting a half-listed folder would move
  tiles under the reader's eyes as names arrived (memory
  no-forced-reflow-law). Listing is the cheap half: about a minute per
  100,000 names over SMB on a PC (sec 22.12-22.13).
- **A file that is not a picture is counted, not shown,** and the count is
  said, so a folder that looks empty is never silently full of something else.
- **The panel takes its height from the chat, never draws over it**, and keeps
  its folder and scroll when pushed down: zero tall, it mounts no rows.
- **Permission is never assumed.** A stored handle is asked `queryPermission`
  every time; Android Chrome needs one tap per folder after each restart.
- **Read mode only in step 1.** Nothing is written into a picked folder until
  the index ruling says what may be.

## Proven

- `checks/qqMode.check.ts` and `checks/qqGrid.check.ts` run in the gate (about
  60 and 125 assertions): the flag fails closed, the file rules, natural
  order, the grid window's edges, the height bounds, the folder states.
- `tools/visual/qq-react.tsx` drives the real drawer and panel on real
  directory handles (OPFS, the picker stubbed), five runs of five clean: the
  panel chunk absent before opening, 316 px of a 700 px column, the count
  line "40 pictures, 1 folder, 1 other file not shown", folders first and
  1..40 in order from files created shuffled, `.quickqueue` not shown, 40
  thumbnails, the subfolder's breadcrumbs, and the Lightbox showing 1.png
  read from the file at 320x480.
- The served preview carried commit `32041b8` with the panel as a separate
  chunk and none of the grid's code in the main bundle.

## Not proven

- The system folder picker, a grant brought back after a browser restart,
  the Android tablet and a folder of tens of thousands: the harness stubs the
  picker and uses OPFS, which is always granted.

## Gotcha found on the way

- In a GPU-less headless shell, `OffscreenCanvas.convertToBlob` to PNG hung
  on the ninth encode, stalling the harness before any panel code ran (a
  watchdog naming the stage found it). The harness now builds its PNGs by
  hand. The panel's own WebP thumbnails encoded 40 of 40 in the same shell.
- The panel rendered NOTHING in a browser without File System Access
  (Firefox, Safari, Brave by default): it waited for a folder list that is
  never read there, so the "cannot open folders" note was never reached. The
  check "unsupported, whatever else" was green throughout -- it held for
  `folderView`, which the panel did not ask until the list had loaded. The
  function now takes the loading state, so what the panel shows is exactly
  what the check sees; the harness has a `?nofsa=1` run with the API removed.
