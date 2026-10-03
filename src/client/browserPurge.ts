import { E2EE_OPT_IN_KEY } from './e2eeOptIn'
import { CRYPTO_STORE_PREFIX } from './storeNames'

// ---------------------------------------------------------------------------
// Purge: what it deletes from this browser, and the one thing it does not.
//
// Operator, 2026-10-03: "a convenient browser purge option and a
// force-hard-refresh button on every possible surface". Rulings the same day:
// purge signs you out of the site it is on and deletes what that site stored
// -- and in Technetium, "Keys only via the reset": the encryption keys stay.
//
// Why the keys are the exception. They are this device's keys to your
// encrypted direct messages. No sign-out in this client has ever deleted them
// (sessionEnd.ts, deleteCryptoStore: never), because without them messages
// already received cannot be read here again unless restored from a recovery
// key; deleting them is the separately gated reset in Settings > Encryption.
// Purge keeps them, and keeps the per-browser encryption opt-in that uses
// them -- clearing that would switch encryption off and strand the kept keys.
// Everything else goes: the sync cache, every other database, local and
// session storage, the Cache API.
//
// Pure apart from the window handed to executePurge, so the checks drive it.
// ---------------------------------------------------------------------------

export function keepsDatabase(name: string): boolean {
  return name.startsWith(CRYPTO_STORE_PREFIX)
}

export function keepsLocalKey(key: string): boolean {
  return key === E2EE_OPT_IN_KEY
}

export interface BrowserPurgePlan {
  deleteDatabases: string[]
  keepDatabases: string[]
  removeLocalKeys: string[]
  keepLocalKeys: string[]
}

export function browserPurgePlan(databases: readonly string[], localKeys: readonly string[]): BrowserPurgePlan {
  return {
    deleteDatabases: databases.filter((d) => d && !keepsDatabase(d)),
    keepDatabases: databases.filter((d) => d && keepsDatabase(d)),
    removeLocalKeys: localKeys.filter((k) => !keepsLocalKey(k)),
    keepLocalKeys: localKeys.filter((k) => keepsLocalKey(k)),
  }
}

// What purge touches, as a window: the real one in the app, a stand-in in the
// checks.
export interface PurgeWindow {
  localStorage: { length: number; key(i: number): string | null; removeItem(k: string): void }
  sessionStorage: { clear(): void }
  indexedDB?: { databases?: () => Promise<{ name?: string }[]>; deleteDatabase(name: string): unknown }
  caches?: { keys(): Promise<string[]>; delete(k: string): Promise<boolean> }
}

// Runs the plan. Returns what it could NOT do, in words, so the caller says so
// rather than reporting a clean purge it did not make.
export async function executePurge(win: PurgeWindow): Promise<{ plan: BrowserPurgePlan; failed: string[] }> {
  const failed: string[] = []
  let databases: string[] = []
  try {
    databases = win.indexedDB?.databases
      ? (await win.indexedDB.databases()).map((d) => d.name ?? '').filter(Boolean)
      : []
  } catch {
    failed.push('the list of browser databases')
  }
  const localKeys: string[] = []
  try {
    for (let i = 0; i < win.localStorage.length; i++) {
      const k = win.localStorage.key(i)
      if (k !== null) localKeys.push(k)
    }
  } catch {
    failed.push('local storage')
  }
  const plan = browserPurgePlan(databases, localKeys)
  for (const k of plan.removeLocalKeys) {
    try { win.localStorage.removeItem(k) } catch { failed.push(`local storage entry ${k}`) }
  }
  try { win.sessionStorage.clear() } catch { failed.push('session storage') }
  for (const d of plan.deleteDatabases) {
    try { win.indexedDB?.deleteDatabase(d) } catch { failed.push(`database ${d}`) }
  }
  try {
    if (win.caches) await Promise.all((await win.caches.keys()).map((k) => win.caches!.delete(k)))
  } catch {
    failed.push('cached files')
  }
  return { plan, failed }
}

// The files a hard refresh refetches past the cache: the page and every
// same-origin resource it loaded. A lookalike host that merely starts with
// this origin's letters is not this origin.
export function refreshUrls(pageUrl: string, entries: readonly { name: string }[], origin: string): string[] {
  return [pageUrl, ...entries.map((e) => e.name).filter((n) => n.startsWith(`${origin}/`))]
}

// The question every surface asks before a purge, in the operator's words.
export const PURGE_QUESTION =
  "Are you sure you want to do this? While we're confident that our services are configured to work properly " +
  'regardless of the age of your access token, that token itself is unique, and you are performing an ' +
  'irreversible action.'
