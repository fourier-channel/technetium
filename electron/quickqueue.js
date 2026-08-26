'use strict'

// ---------------------------------------------------------------------------
// QuickQueue -- the shell seam. Step 1 stubs the two OS integrations and
// implements only argv parsing, because parsing is what the rest of the design
// hangs off and what a sandbox run can actually verify.
//
// The seam it defends: QQ is an INPUT, never a pipeline. Nothing in this file
// or its successors may upload, send, or talk to Matrix. Paths arriving here
// end up in the composer's existing addFiles() and travel the same road as a
// drag-and-drop, so a queued post is indistinguishable from a dragged one and
// the bridge, the autotagger and the gallery renderer never learn a second
// source exists.
// ---------------------------------------------------------------------------

const FLAG = '--qq'

// Explorer hands a legacy verb its selection as plain arguments. With
// MultiSelectModel=Player the whole selection arrives in ONE invocation, which
// is why this returns a list -- the batch is a batch before any watcher sees it.
//
// `--qq` is a BOOLEAN switch, not a positional marker, and that distinction was
// paid for: Chromium reorders argv so switches are hoisted ahead of positional
// arguments. Launching `electron . --qq a.png b.png` arrives as
// `[electron, --qq, ., a.png, b.png]`, so "everything after the flag" swallowed
// the app path and reported four files for three. Parse by CLASS instead of by
// position -- switches out, argv[0] out, the app path out, and what remains is
// the selection in any order the runtime chooses to present it.
function parseArgv(argv, appPath) {
  if (!argv.includes(FLAG)) return []
  const skip = new Set()
  if (appPath) skip.add(appPath)
  skip.add('.')
  return argv
    .slice(1) // argv[0] is the executable, never a selection
    .filter((a) => typeof a === 'string' && a.length > 0)
    .filter((a) => !a.startsWith('-'))
    .filter((a) => !skip.has(a))
}

// Step 1: report intent, change nothing. The registry write and the global
// shortcut land in later steps, gated on the consent values -- never called
// unless the corresponding toggle is true, enforced here rather than at each
// call site so there is exactly one place to audit.
function applyIntegrations(settings, log) {
  const { contextMenu, keybind } = settings.quickQueue
  log(`[qq] context-menu integration: ${contextMenu ? 'ENABLED (stub -- no registry write yet)' : 'off'}`)
  log(`[qq] keybind integration: ${keybind ? 'ENABLED (stub -- no shortcut registered yet)' : 'off'}`)
}

module.exports = { FLAG, parseArgv, applyIntegrations }
