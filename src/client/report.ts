// ---------------------------------------------------------------------------
// Reporting for failures we deliberately continue past.
//
// Some operations genuinely should not abort the app when they fail: a
// localStorage write when storage is disabled, a pointer-capture call on a
// pointer that already released, a capability probe against a server that does
// not implement the endpoint. Swallowing those is a reasonable decision.
//
// Swallowing them SILENTLY is not. An evening was lost to exactly that: a
// state write that returned 200, an event that existed on the server, and a
// client that could not see it -- with no error, no warning, and nothing in
// any log to point at. The only visible symptom belonged to something else
// entirely, which actively misled the diagnosis.
//
// So: continuing past a failure is a choice, and the choice gets recorded.
// Every deliberate swallow calls through here, which makes two things true --
// the failure is greppable in the console, and the call site has to name what
// it was doing, which is the part that makes a log line useful a month later.
//
// Deduped per scope. A localStorage write that fails once will fail every time,
// and a drag that loses pointer capture does so many times a second; neither
// should flood the console. First occurrence per scope is what carries the
// information.
// ---------------------------------------------------------------------------

const reported = new Set<string>()

function detail(err: unknown): string {
  if (err instanceof Error) return err.message
  const e = err as { errcode?: string; httpStatus?: number; message?: string } | null
  if (e && typeof e === 'object') {
    const parts = [
      e.httpStatus !== undefined ? `HTTP ${e.httpStatus}` : '',
      e.errcode ?? '',
      e.message ?? '',
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(' ')
  }
  return String(err)
}

// A failure we intend to continue past. `scope` should say what was being
// attempted, e.g. 'settings: save room list' -- not just the function name.
export function reportIgnored(scope: string, err: unknown): void {
  if (reported.has(scope)) return
  reported.add(scope)
  console.warn(`[tc] ignored failure -- ${scope}: ${detail(err)}`)
}

// A failure that recurs meaningfully and should be seen each time (a send that
// the user initiated, say). Rare by design; prefer reportIgnored.
export function reportAlways(scope: string, err: unknown): void {
  console.warn(`[tc] failure -- ${scope}: ${detail(err)}`)
}

// Test seam: lets a check assert dedupe behaviour without leaking state
// between cases.
export function resetReportedScopes(): void {
  reported.clear()
}
