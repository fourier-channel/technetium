// Which of an account's sessions a batch sign-out would end.
//
// MAS is the authority on sessions (MSC3861: Synapse's own device endpoints
// answer M_UNRECOGNIZED here), and the crypto layer is the authority on which
// of those sessions is a verified device. The join is made here, pure, so the
// two counts the buttons show are the two lists the buttons act on and a
// check can hold them to it.
//
// The one invariant that matters: THIS session is never in either list. A
// purge that signs itself out mid-purge leaves the rest un-ended and the user
// on the login screen wondering what happened.

export interface PurgeableSession {
  // MAS's id for the session: the handle the end-session mutation takes.
  id: string
  kind: 'compat' | 'oauth'
  // The Matrix device id, when the session carries one. An OAuth session
  // without a device scope cannot hold keys and cannot be a verified device.
  deviceId: string | null
  // What MAS knows to call it, for the confirmation list.
  label: string
  lastActiveAt: string | null
}

export interface PurgePlan {
  // Not this session, and not a cross-signing-verified device.
  unverified: PurgeableSession[]
  // Everything but this session.
  others: PurgeableSession[]
}

export function purgePlan(
  sessions: readonly PurgeableSession[],
  thisDeviceId: string | null,
  verifiedDeviceIds: ReadonlySet<string>,
): PurgePlan {
  const others = sessions.filter((s) => !(thisDeviceId && s.deviceId === thisDeviceId))
  const unverified = others.filter((s) => !(s.deviceId && verifiedDeviceIds.has(s.deviceId)))
  return { unverified, others }
}

// A short, honest list for the confirmation box. Whole when it fits; a
// prefix and a count when it does not, so the button's number and the list
// never disagree.
export function describeSessions(list: readonly PurgeableSession[], max = 12): string[] {
  const lines = list.slice(0, max).map((s) => `${s.label}${s.deviceId ? ' ' + s.deviceId : ''}`)
  if (list.length > max) lines.push(`and ${list.length - max} more`)
  return lines
}
