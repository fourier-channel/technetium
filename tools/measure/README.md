# Layout measurement harnesses

One-off measurements against a real browser, for facts about LAYOUT that
reading source does not settle and that the pure checks in `checks/` cannot
reach. Deliberately NOT part of `npm run gate`: playwright is not a dependency
of this repo, and the gate has to run anywhere.

Run them with the checks' own TypeScript loader, so they import app modules
unchanged:

    node --import ./checks/_hooks.mjs tools/measure/<file>.mjs

Playwright is borrowed from the fourier-sampling checkout on vesper; the import
path at the top of each file says so. If it moves, these stop running, which is
the intended failure -- they are evidence-gathering tools, not a suite.

## dm-face-measure.mjs

Measures the DM strip's faces. Imports the REAL `dmFaceStyle` from
`src/ui/dmStrip.ts`, so it cannot pass against a copy that has drifted from
what ships. Asserts every face is the same square box, is border-box, and that
image faces and bare-initial faces share one vertical centre.

## dm-face-before.mjs

The control for the above, reproducing the geometry as it shipped before
2026-09-07. Its job is to FAIL, proving the measurement has teeth.

It reproduces the reported oval exactly: with `EpicycleReveal`'s `size`
defaulting to 20 while the icon inside was passed 30, a face measured 20 wide
by 30 tall, and `border-radius: 50%` on that box is a 3:2 ellipse. A face whose
reveal was not playing measured 30 by 30 instead, so the shape depended on
animation state.

It does NOT reproduce differing vertical centres, which was also reported. All
three control faces share a centre. So the height difference has some other
cause, or was the ellipse being read as an offset. The current geometry makes
every face identical by construction regardless of content or reveal state, so
the symptom is closed either way -- but the mechanism behind that half of the
report was never established, and this file is the honest record of that.
