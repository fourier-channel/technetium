import { goneMedia, onWithheld } from './withheldMedia'
import { blockedMedia, onBlocked } from './booruBlocklist'

// ---------------------------------------------------------------------------
// Every picture a room view leaves out, for either reason:
//   - withheld: the booru will not show this reader the post (withheldMedia.ts);
//   - blocked:  the person's own booru blocklist hides it (booruBlocklist.ts).
// The two sets stay separate at their source (a withheld picture is re-asked
// on a schedule; a blocked one is the person's choice and is never re-asked),
// and every view that filters rows reads this one union, so the timeline and
// the thread panel cannot disagree about what is hidden.
// ---------------------------------------------------------------------------

let lastGone: ReadonlySet<string> | null = null
let lastBlocked: ReadonlySet<string> | null = null
let union: ReadonlySet<string> = new Set()

/** Media ids no room view shows. The same object until either source changes. */
export function hiddenMedia(): ReadonlySet<string> {
  const gone = goneMedia()
  const blocked = blockedMedia()
  if (gone === lastGone && blocked === lastBlocked) return union
  lastGone = gone
  lastBlocked = blocked
  union = blocked.size === 0 ? gone : gone.size === 0 ? blocked : new Set([...gone, ...blocked])
  return union
}

/** Called whenever hiddenMedia() may have changed. */
export function onHiddenChanged(cb: () => void): () => void {
  const offWithheld = onWithheld(cb)
  const offBlocked = onBlocked(cb)
  return () => {
    offWithheld()
    offBlocked()
  }
}
