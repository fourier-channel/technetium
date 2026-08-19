'use strict'

// ---------------------------------------------------------------------------
// Shell-local settings. Deliberately NOT Matrix account data: these describe
// this INSTALLATION on this machine -- whether it has claimed a slot in the
// operating system's shell -- and that is a property of the box, not of the
// account. Syncing them would mean signing in on a second machine silently
// registers a context menu there, which is exactly the surprise the consent
// screen exists to prevent.
//
// Stored as one JSON file in Electron's per-user data directory. Reads are
// fail-soft: a corrupt or missing file yields defaults, because a settings
// file that cannot be parsed must not stop the app from starting.
// ---------------------------------------------------------------------------

const fs = require('node:fs')
const path = require('node:path')
const { app } = require('electron')

// Both integrations default to OFF. An opt-in that ships enabled is not an
// opt-in. `consentShown` is what distinguishes "the user said no" from "the
// user has not been asked", which look identical from the values alone.
const DEFAULTS = {
  consentShown: false,
  quickQueue: {
    contextMenu: false,
    keybind: false,
  },
  window: {
    width: 1440,
    height: 900,
    x: undefined,
    y: undefined,
    maximized: false,
  },
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'shell-settings.json')
}

// Shallow-merge one level deep so a settings file written by an older build,
// missing a key added since, still yields a complete object rather than
// undefined halfway through a lookup.
function merge(base, loaded) {
  const out = { ...base }
  for (const [k, v] of Object.entries(loaded || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...base[k], ...v } : v
  }
  return out
}

function read() {
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(settingsPath(), 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

// Write via a temp file and rename. Rename is atomic on both NTFS and ext4, so
// a crash mid-write leaves the previous settings intact rather than a truncated
// file that read() would silently discard back to defaults -- which would read
// to the user as their opt-out having been forgotten.
function write(next) {
  const p = settingsPath()
  const tmp = p + '.part'
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  fs.renameSync(tmp, p)
  return next
}

function update(patch) {
  const next = merge(read(), patch)
  return write(next)
}

module.exports = { read, update, settingsPath, DEFAULTS }
