import { useEffect, useState } from 'react'
import type { MatrixClient } from 'matrix-js-sdk'
import { fetchPreview, type UrlPreview } from '../client/urlPreview'
import { AuthedImage } from './AuthedImage'

// W5.2 -- a compact preview card under a message.
//
// Renders NOTHING unless the server actually returned something useful: no
// skeleton, no "loading preview", no empty frame. A card that appears and then
// collapses would shove the timeline around for every link anyone posts, which
// is the no-forced-reflow rule.

export function LinkPreview({
  client,
  url,
  enabled,
}: {
  client: MatrixClient | null
  url: string
  enabled: boolean
}) {
  const [preview, setPreview] = useState<UrlPreview | null>(null)

  useEffect(() => {
    if (!client || !enabled) return
    let cancelled = false
    void fetchPreview(client, url).then((p) => {
      if (!cancelled) setPreview(p)
    })
    return () => {
      cancelled = true
    }
  }, [client, url, enabled])

  if (!enabled || !preview) return null

  return (
    <a className="tc-link-preview" href={preview.url} target="_blank" rel="noreferrer noopener">
      {preview.imageMxc && (
        <span className="tc-link-preview-img">
          <AuthedImage mxc={preview.imageMxc} width={180} fill transparentLoading alt="" />
        </span>
      )}
      <span className="tc-link-preview-text">
        {preview.title && <span className="tc-link-preview-title">{preview.title}</span>}
        {preview.description && (
          <span className="tc-link-preview-desc">{preview.description}</span>
        )}
      </span>
    </a>
  )
}
