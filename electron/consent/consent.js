'use strict'

// Reads and writes exactly two booleans over the preload bridge. No other
// capability is reachable from this page, by construction -- see preload.js.

const bridge = window.technetiumShell
const contextMenu = document.getElementById('contextMenu')
const keybind = document.getElementById('keybind')

// Reflect what is actually stored, so reopening from the menu shows the real
// current state rather than the defaults. A settings screen that lies about the
// present state is worse than none.
bridge.quickQueue.get().then((v) => {
  contextMenu.checked = !!v.contextMenu
  keybind.checked = !!v.keybind
})

// "Not now" is a decision, not an escape: it records that the user was asked
// and declined, so they are not asked again on every launch. Both integrations
// stay off, which is already their stored state.
document.getElementById('later').addEventListener('click', async () => {
  await bridge.quickQueue.set({ contextMenu: false, keybind: false })
  bridge.closeConsent()
})

document.getElementById('save').addEventListener('click', async () => {
  await bridge.quickQueue.set({
    contextMenu: contextMenu.checked,
    keybind: keybind.checked,
  })
  bridge.closeConsent()
})
