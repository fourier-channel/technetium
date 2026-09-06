// The dead space, filled. Before a room is picked the main pane used to say
// "Select a room from the left." and nothing else. It now shows the booru
// (operator, 2026-09-06): tc.41chan.net and booru.41chan.net are one SITE,
// so the booru's cookies ride into the frame unchanged, and the booru names
// this origin in its frame-ancestors policy so the browser allows the frame
// where Rails' default X-Frame-Options would have refused it.
//
// The next action stays obvious (onboarding law): one line above the frame
// says where the rooms are. The frame is the content, not a preview of it.
const BOORU_URL = (import.meta.env.VITE_BOORU_URL as string | undefined) ?? 'https://booru.41chan.net/'

export function BooruFrame() {
  return (
    <div className="tc-booru-frame">
      <div className="tc-booru-frame-hint">
        chanbooru, while you look around -- pick a room on the left when you are ready.
      </div>
      <iframe
        className="tc-booru-frame-iframe"
        src={BOORU_URL}
        title="chanbooru"
        // Fullscreen for the lightbox; nothing else the booru needs is gated.
        allow="fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  )
}
