'use strict'
// QuickQueue M0 (tc.150): the Electron half of the folder-access spike.
// Loads spike.html in a bare Electron window with a session permission handler
// that LOGS every request and grants only 'fileSystem' read. The question it
// answers: after a restart, does requestPermission on a folder handle restored
// from IndexedDB route through this handler (so the app can restore a grant
// with no prompt), or does Electron refuse before asking?
// Run: npx electron@43.4.0 tools/qq-spike/electron-spike.js
// It is a spike: the product shell (electron/main.js) is not touched.
const { app, BrowserWindow, session } = require('electron')
const path = require('path')

app.setName('qq-spike') // its own profile dir, so the real Technetium profile is never read
app.whenReady().then(() => {
  const s = session.defaultSession
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    const grant = permission === 'fileSystem' && details.fileAccessType !== 'writable'
    console.log('[request]', permission, JSON.stringify({ filePath: details.filePath, isDirectory: details.isDirectory, access: details.fileAccessType }), '->', grant ? 'GRANT' : 'deny')
    callback(grant)
  })
  s.setPermissionCheckHandler((wc, permission, origin, details) => {
    console.log('[check]', permission, origin, JSON.stringify(details || {}))
    return permission === 'fileSystem'
  })
  const w = new BrowserWindow({ width: 980, height: 900, webPreferences: { sandbox: true, contextIsolation: true } })
  w.loadFile(path.join(__dirname, 'spike.html'))
  console.log('electron', process.versions.electron, 'chrome', process.versions.chrome, 'userData', app.getPath('userData'))
})
app.on('window-all-closed', () => app.quit())
