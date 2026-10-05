import { useClient } from '../client/clientContextValue'
import { SIGN_OUT_DONE, SIGN_OUT_RUNNING } from '../client/signOut'

// ---------------------------------------------------------------------------
// The server-side half of a sign-out, said on the signed-out screen: that it
// is running, then that it finished -- or what did not happen and how to
// finish it by hand (client/signOut.ts).
//
// OUT OF FLOW, fixed to the bottom of the window: it arrives after the screen
// has drawn and changes length when it lands, and the landing's column is
// centred, so anything in flow would move the doors (memory
// no-forced-reflow-law). It stays until dismissed or until the next sign-in:
// a failure that faded on a timer would be a failure nobody read.
// ---------------------------------------------------------------------------

export function SignOutStatus() {
  const { signOut, dismissSignOut } = useClient()
  if (!signOut) return null
  const failures = signOut.phase === 'done' ? signOut.failures : []
  const tone = signOut.phase === 'running' ? 'active' : failures.length > 0 ? 'warn' : 'ok'
  return (
    <div className="tc-signout-status" role="status" aria-live="polite" data-tone={tone}>
      {signOut.phase === 'running' ? (
        <p>{SIGN_OUT_RUNNING}</p>
      ) : failures.length === 0 ? (
        <p>{SIGN_OUT_DONE}</p>
      ) : (
        <>
          <p>You are signed out of Technetium. Not everything else confirmed it:</p>
          <ul>
            {failures.map((f) => (
              <li key={f.step}>
                {f.text}
                {f.href && (
                  <>
                    {' '}
                    <a href={f.href} target="_blank" rel="noopener noreferrer">Open it</a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {signOut.phase === 'done' && (
        <button type="button" className="tc-pill" onClick={dismissSignOut}>Dismiss</button>
      )}
    </div>
  )
}
