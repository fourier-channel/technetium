'use strict'

// ---------------------------------------------------------------------------
// QuickQueue -- the shell seam. Step 1 stubs the two OS integrations and
// implements only the argv parsing, because parsing is the part the rest of
// the design hangs off and the part a sandbox run can actually verify.
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
// is why this returns a list rather than a single path -- and why the batch is
// already a batch before any watcher sees it.
//
// Everything after the flag is treated as a path. Electron's own switches
// (--inspect, --disable-gpu, and the ones Chromium adds unasked) are dropped by
// requiring the leading `--qq` and ignoring anything else that starts with a
// dash, so a Chromium switch appended after ours can never be read as a file.
function parseArgv(argv) {
  const i = argv.indexOf(FLAG)
  if (i === -1) return []
  return argv.slice(i + 1).filter((a) => typeof a === 'string' && a.length > 0 && !a.startsWith('-'))
}

// Step 1: report intent, change nothing. The registry write and the global
// shortcut land in later steps, gated on the consent values -- never called
// unless the corresponding toggle is true, which is enforced here rather than
// at each call site so there is exactly one place to audit.
function applyIntegrations(settings, log) {
  const { contextMenu, keybind } = settings.quickQueue
  log(`[qq] context-menu integration: ${contextMenu ? 'ENABLED (stub -- no registry write yet)' : 'off'}`)
  log(`[qq] keybind integration: ${keybind ? 'ENABLED (stub -- no shortcut registered yet)' : 'off'}`)
}

module.exports = { FLAG, parseArgv, applyIntegrations }
