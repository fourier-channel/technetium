// ---------------------------------------------------------------------------
// Informed egress -- the model.
//
// The rule this implements: any time the client is about to hand the user's
// information to a surface it does not control, the user is told plainly, in
// advance, and can decline without losing the rest of the client.
//
// The security-relevant part of this file is its DEFAULTS, not its logic. Every
// ambiguous state resolves to "blocked": no record, malformed record, storage
// failure, unknown surface, stale notice version. Defaulting the other way
// would turn a corrupted JSON blob into a silent opt-in to a third-party
// connection, which is precisely the harm the feature exists to prevent.
//
// Pure, so the harness can load it (O-tp9). No React, no matrix-js-sdk.
// ---------------------------------------------------------------------------

export const EGRESS_CONSENT_EVENT = 'net.41chan.egress_consent'

export interface EgressSurface {
  id: string
  // Shown as the heading of the notice.
  title: string
  // Who receives the data. Named, because "a third party" is not informed
  // consent.
  operator: string
  // What actually leaves the device. Concrete, not reassuring.
  discloses: readonly string[]
  // What the user loses by declining, so the trade is legible.
  ifDeclined: string
  // Bumping this invalidates existing grants and re-asks. A material change to
  // what is disclosed is a DIFFERENT QUESTION from the one already answered
  // (D-eg02), so it must not inherit the old answer.
  noticeVersion: number
  // Link shown in the notice, when a policy exists to link to.
  policyUrl?: string
}

// v1 register. Everything the client can be asked to reach outside itself
// belongs here, including surfaces that predate this system -- one place the
// user can see everything beats a per-feature scattering.
export const EGRESS_SURFACES: readonly EgressSurface[] = [
  {
    id: 'gif.klipy',
    title: 'GIF and sticker search',
    operator: 'KLIPY',
    discloses: [
      'your IP address',
      'your browser and its user agent',
      'every search term you type, as you type it',
    ],
    ifDeclined: 'The GIF picker stays off. Everything else works normally.',
    noticeVersion: 1,
  },
  {
    id: 'preview.url',
    title: 'Link previews',
    // Worth naming precisely: this one does NOT expose the user directly, and
    // saying so is more useful than a blanket warning that trains people to
    // ignore the next one.
    operator: 'the 41chan homeserver, which fetches the link on your behalf',
    discloses: [
      'the URL you were sent, to the homeserver',
      'the homeserver then requests that URL, exposing ITS address, not yours',
    ],
    ifDeclined: 'Links render as plain links. Nothing else changes.',
    noticeVersion: 1,
  },
]

const SURFACE_BY_ID = new Map(EGRESS_SURFACES.map((s) => [s.id, s]))

export function egressSurface(id: string): EgressSurface | null {
  return SURFACE_BY_ID.get(id) ?? null
}

export interface ConsentRecord {
  granted: boolean
  at: number
  version: number
  readPolicy?: boolean
  // Set when the user asked not to be prompted again. Denies silently and
  // forever, and is deliberately separate from `granted: false` -- "I do not
  // want this" and "I do not want to be asked about this" are different
  // sentences (D-eg04).
  suppressed?: boolean
}

export type ConsentMap = Record<string, ConsentRecord>

export type EgressState =
  // Never asked, or the answer no longer applies. Blocked, and will prompt.
  | 'unasked'
  // Allowed. The only state in which a request may be made.
  | 'granted'
  // Refused, and will prompt again next time it is used.
  | 'denied'
  // Refused, and will not prompt again.
  | 'suppressed'

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

// Parse a stored blob defensively. Anything unrecognised is DROPPED rather than
// coerced: a half-understood record must not become a grant.
export function parseConsent(raw: unknown): ConsentMap {
  const out: ConsentMap = {}
  if (!isRecord(raw)) return out
  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    if (typeof value.granted !== 'boolean') continue
    if (typeof value.version !== 'number' || !Number.isFinite(value.version)) continue
    const at = typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0
    out[id] = {
      granted: value.granted,
      at,
      version: value.version,
      readPolicy: value.readPolicy === true,
      suppressed: value.suppressed === true,
    }
  }
  return out
}

// The whole decision, in one place.
export function egressState(consent: ConsentMap, surfaceId: string): EgressState {
  const surface = egressSurface(surfaceId)
  // An unknown surface is not a surface. Blocked, and there is nothing
  // coherent to prompt about.
  if (!surface) return 'suppressed'

  const record = consent[surfaceId]
  if (!record) return 'unasked'

  // Suppression outlives a version bump: someone who asked not to be bothered
  // has not agreed to be bothered by a new edition of the same question.
  if (record.suppressed) return 'suppressed'

  // A grant is for the notice version it was given against. A newer notice
  // means the user has not seen what is now disclosed, so the old yes does not
  // carry (D-eg02). A record from a FUTURE version (a downgraded client) is
  // equally not an answer to this notice.
  if (record.version !== surface.noticeVersion) return 'unasked'

  return record.granted ? 'granted' : 'denied'
}

// The only question the calling code should ever ask before making a request.
// Named so that reading the call site tells you what it guards.
export function mayReachOut(consent: ConsentMap, surfaceId: string): boolean {
  return egressState(consent, surfaceId) === 'granted'
}

// Should the notice be shown when the user tries to use this surface?
export function shouldPrompt(consent: ConsentMap, surfaceId: string): boolean {
  const state = egressState(consent, surfaceId)
  return state === 'unasked' || state === 'denied'
}

export function grant(
  consent: ConsentMap,
  surfaceId: string,
  now: number,
  opts: { readPolicy?: boolean } = {},
): ConsentMap {
  const surface = egressSurface(surfaceId)
  // Refuse to record a grant for a surface that does not exist: that record
  // would silently become a grant if the id were added later.
  if (!surface) return consent
  return {
    ...consent,
    [surfaceId]: {
      granted: true,
      at: now,
      version: surface.noticeVersion,
      readPolicy: opts.readPolicy === true,
    },
  }
}

export function deny(consent: ConsentMap, surfaceId: string, now: number): ConsentMap {
  const surface = egressSurface(surfaceId)
  if (!surface) return consent
  return {
    ...consent,
    [surfaceId]: { granted: false, at: now, version: surface.noticeVersion },
  }
}

// Deny AND stop asking.
export function suppress(consent: ConsentMap, surfaceId: string, now: number): ConsentMap {
  const surface = egressSurface(surfaceId)
  if (!surface) return consent
  return {
    ...consent,
    [surfaceId]: {
      granted: false,
      at: now,
      version: surface.noticeVersion,
      suppressed: true,
    },
  }
}

// Revocation resets to UNASKED rather than to denied, so the surface prompts
// again next time it is used (D-eg04). Revoking is "take this back", not
// "never again" -- the second is what suppress() is for.
export function revoke(consent: ConsentMap, surfaceId: string): ConsentMap {
  if (!(surfaceId in consent)) return consent
  const next = { ...consent }
  delete next[surfaceId]
  return next
}

export function revokeAll(): ConsentMap {
  return {}
}

// Everything the "information you have shared" view needs, in register order so
// the list is stable rather than dependent on object key order.
export interface ConsentRow {
  surface: EgressSurface
  state: EgressState
  at?: number
  readPolicy?: boolean
}

export function consentRows(consent: ConsentMap): ConsentRow[] {
  return EGRESS_SURFACES.map((surface) => {
    const record = consent[surface.id]
    return {
      surface,
      state: egressState(consent, surface.id),
      at: record?.at,
      readPolicy: record?.readPolicy,
    }
  })
}
