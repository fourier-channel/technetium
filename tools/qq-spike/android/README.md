# qq-spike on an Android tablet

Drives `../spike.html` on a USB-connected Android tablet from the PC it is plugged into.
Results: master reference sec 22.12 (private).

1. Tablet: Developer options, USB debugging on, this PC allowed. Chrome 132+.
2. PC: `node ../serve.mjs`, then `adb reverse tcp:5199 tcp:5199`. The tablet opens
   `http://localhost:5199/spike.html`, which is a secure context, as on the desktop runs.
3. Test set: `adb push <qq-test>/. /sdcard/Pictures/qq-test/` with a `.nomedia` in it,
   so the images stay out of the gallery. Not the root of Download: the picker refuses it.
4. Pick the folder on the tablet (a person has to tap; the picker is a system screen).
5. `adb forward tcp:9222 localabstract:chrome_devtools_remote`, then from this folder:
   - `node cdp.mjs @runall.js 3600` -- list, scan, read + MD5 at 1, 4, 8 at once
   - `node cdp.mjs @split.js 280` -- where the per-file cost goes
   - `adb push restart.sh /data/local/tmp/ && adb shell sh /data/local/tmp/restart.sh`,
     then `node cdp.mjs` -- the grant after a proven restart
   - `native.sh` -- the same files read without Chrome, for the baseline
6. Undo: `adb reverse --remove-all`, `adb forward --remove-all`, stop serve.mjs.
