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
