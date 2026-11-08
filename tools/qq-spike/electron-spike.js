'use strict'
// QuickQueue M0 (tc.150): the Electron half of the folder-access spike.
// Loads spike.html in a bare Electron window with session permission handlers
// shaped the way the product's would be: a folder the user granted is saved to
// grants.json in this app's own profile, and the check handler answers "yes"
// only for a path under a saved folder. Chromium consults the check handler on
// EVERY file read, so it counts calls and logs only the first few; the first
// run of this spike logged each one and that logging became the bottleneck.
// Run: npx electron@43.4.0 tools/qq-spike/electron-spike.js
// It is a spike: the product shell (electron/main.js) is not touched.
const { app, BrowserWindow, session } = require('electron')
const fs = require('fs')
const path = require('path')

app.setName('qq-spike') // its own profile dir, so the real Technetium profile is never read
let grantsFile
function loadGrants() { try { return JSON.parse(fs.readFileSync(grantsFile, 'utf8')) } catch { return [] } }
function under(p, root) {
  const a = path.resolve(p).toLowerCase(), r = path.resolve(root).toLowerCase()
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

app.whenReady().then(() => {
  grantsFile = path.join(app.getPath('userData'), 'grants.json')
  let grants = loadGrants()
  const counts = { checkYes: 0, checkNo: 0, shown: 0 }
  const s = session.defaultSession
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    const grant = permission === 'fileSystem' && details.fileAccessType !== 'writable' && !!details.filePath
    if (grant && !grants.some(g => under(details.filePath, g))) {
      grants.push(details.filePath); fs.writeFileSync(grantsFile, JSON.stringify(grants))
    }
    console.log('[request]', permission, JSON.stringify({ filePath: details.filePath, isDirectory: details.isDirectory, access: details.fileAccessType }), '->', grant ? 'GRANT (saved)' : 'deny')
    callback(grant)
  })
  s.setPermissionCheckHandler((wc, permission, origin, details) => {
    if (permission !== 'fileSystem') return false
    const ok = !!(details && details.filePath) && (details.fileAccessType || 'readable') === 'readable' && grants.some(g => under(details.filePath, g))
    ok ? counts.checkYes++ : counts.checkNo++
    if (counts.shown < 5) { counts.shown++; console.log('[check]', origin, JSON.stringify(details || {}), '->', ok ? 'yes' : 'no', counts.shown === 5 ? '(further checks counted, not logged)' : '') }
    return ok
  })
  const w = new BrowserWindow({ width: 980, height: 900, webPreferences: { sandbox: true, contextIsolation: true } })
  w.loadFile(path.join(__dirname, 'spike.html'))
  console.log('electron', process.versions.electron, 'chrome', process.versions.chrome)
  console.log('saved folder grants at start:', grants.length ? grants.join(', ') : 'none')
  app.on('before-quit', () => console.log('[summary] permission checks answered yes ' + counts.checkYes + ', no ' + counts.checkNo))
})
app.on('window-all-closed', () => app.quit())
