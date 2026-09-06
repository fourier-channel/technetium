import { useEffect, useRef, useState } from 'react'

// The dead space, filled. Before a room is picked the main pane used to say
// "Select a room from the left." and nothing else. It now shows the booru
// (operator, 2026-09-06): tc.41chan.net and booru.41chan.net are one SITE,
// so the booru's cookies ride into the frame unchanged, and the booru names
// this origin in its frame-ancestors policy so the browser allows the frame
// where Rails' default X-Frame-Options would have refused it.
//
// SIGNING IN cannot happen inside the frame: the booru's sign-in is an OIDC
// hop through auth.41chan.net, which refuses to be framed. So the hint bar
// offers it TOP-LEVEL -- a new tab, same site, so the session cookie it sets
// is visible to the frame -- and the frame reloads when this window regains
// focus. The full answer is the queued login merge (one identity, no second
// sign-in); this is the honest bridge until then.
//
// The next action stays obvious (onboarding law): one line above the frame
// says where the rooms are. The frame is the content, not a preview of it.
const BOORU_URL = (import.meta.env.VITE_BOORU_URL as string | undefined) ?? 'https://booru.41chan.net/'
const BOORU_LOGIN_URL = (import.meta.env.VITE_BOORU_LOGIN_URL as string | undefined) ?? 'https://booru.41chan.net/fourier/login'

export function BooruFrame() {
  // Bumped to reload the frame after a top-level sign-in.
  const [generation, setGeneration] = useState(0)
  const awaitingReturn = useRef(false)

  useEffect(() => {
    const onFocus = () => {
      if (!awaitingReturn.current) return
      awaitingReturn.current = false
      setGeneration((g) => g + 1)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const signIn = () => {
    awaitingReturn.current = true
    window.open(BOORU_LOGIN_URL, '_blank', 'noopener')
  }

  return (
    <div className="tc-booru-frame">
      <div className="tc-booru-frame-hint">
        <span>chanbooru, while you look around -- pick a room on the left when you are ready.</span>
        <button type="button" className="tc-booru-frame-signin" onClick={signIn} data-testid="booru-signin">
          Sign in to see the pictures
        </button>
      </div>
      <iframe
        key={generation}
        className="tc-booru-frame-iframe"
        src={BOORU_URL}
        title="chanbooru"
        allow="fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
