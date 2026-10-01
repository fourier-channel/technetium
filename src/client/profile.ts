import type { MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W4.3 -- editing your own profile.
//
// Avatars are CHROME media (D-bf01): they upload to and load from the
// HOMESERVER, not the fourier-auth content gateway, which 403s them. The
// upload is a plain client.uploadContent -- the same call the composer makes
// -- and the resulting mxc goes straight to setAvatarUrl.
// ---------------------------------------------------------------------------

// Anything bigger is a photo someone dragged in by accident. The homeserver
// has its own limit, but failing here with a sentence beats a 413 with none.
const MAX_AVATAR_BYTES = 8 * 1024 * 1024

export function validateAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'That is not an image.'
  if (file.size > MAX_AVATAR_BYTES) return 'That image is larger than 8 MB.'
  return null
}

export async function setDisplayName(client: MatrixClient, name: string): Promise<void> {
  const trimmed = name.trim()
  // An empty display name is legal in Matrix and means "fall back to the
  // MXID", which is a real thing someone might want -- so it is allowed
  // through rather than rejected.
  await client.setDisplayName(trimmed)
}

export async function uploadAndSetAvatar(client: MatrixClient, file: File): Promise<string> {
  const problem = validateAvatarFile(file)
  if (problem) throw new Error(problem)
  const { content_uri: mxc } = await client.uploadContent(file, {
    name: file.name,
    type: file.type,
  })
  await client.setAvatarUrl(mxc)
  return mxc
}

export async function clearAvatar(client: MatrixClient): Promise<void> {
  await client.setAvatarUrl('')
}

// What a failed profile change says: what did not happen, and what to do about
// it (memory errors-must-carry-their-own-remedy). The bare status line this
// replaces -- "Not saved: HTTP 429 M_LIMIT_EXCEEDED" -- named no fix.
export type ProfileChange = 'look' | 'name' | 'picture' | 'picture-removal'

export function describeProfileError(err: unknown, what: ProfileChange): string {
  const subject = {
    look: 'Your look was not saved',
    name: 'Your name was not saved',
    picture: 'Your picture was not saved',
    'picture-removal': 'Your picture was not removed',
  }[what]
  const e = err as { errcode?: string; httpStatus?: number; message?: string; data?: { error?: unknown } } | null
  const said = typeof e?.data?.error === 'string' && e.data.error ? ` The server said: "${e.data.error}".` : ''
  if (e?.errcode === 'M_LIMIT_EXCEEDED' || e?.httpStatus === 429) {
    return `${subject}: the server is limiting how fast changes can be made. Wait a few seconds and try again.`
  }
  if (e?.errcode === 'M_TOO_LARGE' || e?.httpStatus === 413) {
    return `${subject}: it is larger than the server accepts. Choose a smaller picture.`
  }
  if (e?.errcode === 'M_FORBIDDEN' || e?.httpStatus === 403) {
    return `${subject}: the server refused it.${said} If it keeps refusing, ask an admin.`
  }
  // Our own refusals (validateAvatarFile, an unsupported server) are already
  // sentences that name their fix.
  if (err instanceof Error && e?.httpStatus === undefined && !e?.errcode && !/fetch|network/i.test(err.message)) {
    return `${subject}: ${err.message}`
  }
  if (e?.httpStatus === undefined && !e?.errcode) {
    return `${subject}: the server could not be reached. Check your connection and try again.`
  }
  return `${subject}.${said || (e?.message ? ` ${e.message}.` : '')} Try again; if it keeps failing, reload the page.`
}
