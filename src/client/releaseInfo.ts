// Which build this is, for the beta notice -- so a bug report can say which
// version it is about. deploy.sh writes /release.json into every release dir:
// version null when the build is published to the preview, the CalVer when it
// is promoted (operator, 2026-10-10). The same bytes serve both, so the build
// cannot know its version at build time; it asks the release it is served from.
//
// Every state renders as itself. A build whose release.json is missing or
// malformed says so; it never passes for a versioned one.

export type ReleaseInfo = { release: string; commit: string; version: string | null }

export type ReleaseState = ReleaseInfo | 'dev' | 'checking' | 'unreadable'

const VERSION = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/

/** release.json as served, or null when it is not one. */
export function parseReleaseInfo(x: unknown): ReleaseInfo | null {
  if (typeof x !== 'object' || x === null) return null
  const o = x as Record<string, unknown>
  if (typeof o.release !== 'string' || typeof o.commit !== 'string') return null
  if (o.version !== null && !(typeof o.version === 'string' && VERSION.test(o.version))) return null
  return { release: o.release, commit: o.commit, version: o.version }
}

export function releaseLabel(s: ReleaseState): string {
  if (s === 'dev') return 'Development build'
  if (s === 'checking') return 'Build: checking'
  if (s === 'unreadable') return 'Build unknown: this release carries no release.json'
  return s.version === null ? `Preview build ${s.commit} (not yet a release)` : `Version ${s.version} (${s.commit})`
}
