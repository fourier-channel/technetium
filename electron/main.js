'use strict'

// ---------------------------------------------------------------------------
// Technetium desktop shell.
//
// Wrapper A: this window loads the DEPLOYED client rather than bundled assets.
// That is not laziness, it is what keeps the login path untouched -- the client
// derives its OIDC redirect_uri from window.location.origin, so serving the
// same origin means the registered MAS client, the redirect and the CORS
// allow-list all keep working with no production change. It also means a
// deploy updates the product without shipping a new installer.
//
// The cost, recorded so nobody rediscovers it: the shell needs the network at
// launch, and it inherits the browser cache. The cache half is handled at the
// origin (Cache-Control on the deployed shell) and again by the Reload
// Ignoring Cache item in the View menu.
// ---------------------------------------------------------------------------

const path = require('node:path')
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron')
const settings = require('./settings')
const quickqueue = require('./quickqueue')

const APP_ORIGIN = process.env.TECHNETIUM_ORIGIN || 'https://tc.41chan.net'

const log = (...a) => console.log(...a)

let mainWindow = null
let consentWindow = null

// --- single instance -------------------------------------------------------
// The whole QuickQueue design rests on this: a shell verb invoking the exe
// while it is already running must hand its selection to the LIVE window, not
// boot a second copy. Electron gives the lock holder the second instance's
// argv; the second process exits before it paints anything.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = quickqueue.parseArgv(argv)
    if (files.length) {
      log(`[qq] second-instance delivered ${files.length} path(s):`)
      files.forEach((f) => log(`      ${f}`))
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(start)
}

function start() {
  const s = settings.read()

  const first = quickqueue.parseArgv(process.argv)
  if (first.length) {
    log(`[qq] first-instance launched with ${first.length} path(s):`)
    first.forEach((f) => log(`      ${f}`))
  }

  quickqueue.applyIntegrations(s, log)

  createWindow(s)
  buildMenu()

  // Consent is shown once, after the main window exists, so the first thing a
  // new user sees is the app rather than a permissions dialog in front of a
  // void. Never shown again unless reopened from the menu -- an opt-out that
  // asks again next launch is not an opt-out.
  if (!s.consentShown) openConsent()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.read())
  })
}

function createWindow(s) {
  mainWindow = new BrowserWindow({
    width: s.window.width,
    height: s.window.height,
    x: s.window.x,
    y: s.window.y,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#101317', // Compound canvas -- no white flash before paint
    autoHideMenuBar: true,
    webPreferences: {
      // Remote content in this window. The three flags below are the whole
      // security posture and none of them is optional: no Node in the renderer,
      // an isolated context so the preload's bridge cannot be reached or
      // rewritten by page script, and Chromium's sandbox on.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (s.window.maximized) mainWindow.maximize()

  mainWindow.loadURL(APP_ORIGIN)

  // Anything that is not our origin opens in the user's real browser. Without
  // this a link in a message would navigate the app window away from the
  // client, and the user would have no address bar to get back with.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Same rule for in-page navigation, with the identity provider allowed
  // through: MAS sign-in is a full-page redirect off-origin and back, so
  // blocking it outright would block login itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isNavigable(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  const remember = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const maximized = mainWindow.isMaximized()
    const b = mainWindow.getNormalBounds()
    settings.update({ window: { width: b.width, height: b.height, x: b.x, y: b.y, maximized } })
  }
  mainWindow.on('close', remember)
  mainWindow.on('closed', () => { mainWindow = null })
}

// Our origin plus the homeserver that hosts the identity provider. Compared on
// the parsed origin, never by string prefix -- `https://tc.41chan.net.evil.tld`
// starts with our origin as text and is a different site.
function isNavigable(url) {
  try {
    const u = new URL(url)
    const allowed = new Set([new URL(APP_ORIGIN).origin, 'https://41chan.net', 'https://matrix.41chan.net'])
    return allowed.has(u.origin)
  } catch {
    return false
  }
}

function openConsent() {
  if (consentWindow && !consentWindow.isDestroyed()) {
    consentWindow.focus()
    return
  }
  consentWindow = new BrowserWindow({
    width: 620,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: mainWindow || undefined,
    modal: false,
    title: 'QuickQueue',
    backgroundColor: '#101317',
    autoHideMenuBar: true,
    webPreferences: {
      // LOCAL page, and it stays local. It never shares a window, and never
      // shares an origin, with the remote client -- privileged UI that can flip
      // an OS integration must not sit in the same origin as remote content.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  consentWindow.loadFile(path.join(__dirname, 'consent', 'consent.html'))
  consentWindow.on('closed', () => { consentWindow = null })
}

// --- IPC: the consent screen's entire surface -------------------------------
// Two channels, both narrow. The renderer can read the two booleans and write
// the two booleans. It cannot reach the filesystem, the registry, or anything
// else, because nothing else is exposed.
ipcMain.handle('qq:get', () => settings.read().quickQueue)

ipcMain.handle('qq:set', (_e, next) => {
  const clean = {
    contextMenu: next?.contextMenu === true,
    keybind: next?.keybind === true,
  }
  const s = settings.update({ consentShown: true, quickQueue: clean })
  quickqueue.applyIntegrations(s, log)
  return s.quickQueue
})

ipcMain.on('qq:close', () => {
  if (consentWindow && !consentWindow.isDestroyed()) consentWindow.close()
})

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        // The reason this item exists: a wrapper inherits Chromium's HTTP
        // cache, and there is no Ctrl+Shift+R reflex in an app window.
        { role: 'forceReload', label: 'Reload Ignoring Cache' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'QuickQueue',
      submenu: [{ label: 'Integration settings...', click: openConsent }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
