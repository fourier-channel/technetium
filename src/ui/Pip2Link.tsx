import { PIP2_EXPANSION, PIP2_TITLE, PIP2_URL } from '../client/pip2'

// The one link to PIP2. A new tab: it is a page of 41chan.net, not of this
// client, and leaving the client to read it should not cost the session.
// "full" spells the title out where the abbreviation would be the only word a
// newcomer sees.
export function Pip2Link({ full = false }: { full?: boolean }) {
  return (
    <a className="tc-link" href={PIP2_URL} target="_blank" rel="noopener noreferrer" title={PIP2_EXPANSION}>
      {full ? <>{PIP2_TITLE} (PIP<sup>2</sup>)</> : <>PIP<sup>2</sup></>}
    </a>
  )
}
