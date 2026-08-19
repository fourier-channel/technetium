'use strict'

// ---------------------------------------------------------------------------
// The only bridge between any renderer and the main process.
//
// Loaded into BOTH windows, which is safe because what it exposes is safe: two
// booleans in, two booleans out. It carries no path, no token, no filesystem
// handle and no way to ask for one -- so even the window showing REMOTE content
// gains nothing it could be tricked into misusing. Widening this file is the
// moment to stop and think, not a routine edit.
// ---------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('technetiumShell', {
  isDesktop: true,
  quickQueue: {
    get: () => ipcRenderer.invoke('qq:get'),
    set: (next) => ipcRenderer.invoke('qq:set', next),
  },
  closeConsent: () => ipcRenderer.send('qq:close'),
})
