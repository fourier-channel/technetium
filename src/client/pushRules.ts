import { PushRuleActionName, type MatrixClient } from 'matrix-js-sdk'

// ---------------------------------------------------------------------------
// W3.5 -- server-backed room mute (O-tp2).
//
// A local mute only silences THIS browser. A push rule silences the account:
// other clients, and push notifications to a phone. So the push rule is the
// source of truth, and the local setting survives only as a read-fallback for
// rooms muted before this existed.
//
// SNOOZE STAYS LOCAL by design. A push rule has no expiry, so "mute for 8
// hours" would need a timer to remove it -- and a timer in a browser tab that
// may be closed is a promise the client cannot keep. A snooze that silently
// became permanent is worse than one that only applies here.
//
// The sdk's setRoomMutePushRule already carries the SYN-590 workaround
// (delete-then-add, because updating a rule in place fails), so this wraps it
// rather than hand-rolling addPushRule.
// ---------------------------------------------------------------------------

export function isRoomMutedOnServer(client: MatrixClient | null, roomId: string): boolean {
  if (!client) return false
  try {
    const rule = client.getRoomPushRule('global', roomId)
    return !!rule?.actions?.includes(PushRuleActionName.DontNotify)
  } catch {
    // A client without push rules loaded yet -- not muted as far as we know.
    return false
  }
}

// Every room muted by a push rule right now. Read in one pass so the nav can
// ask about many rooms without re-walking the rule list per row.
export function serverMutedRooms(client: MatrixClient | null): Set<string> {
  const out = new Set<string>()
  if (!client) return out
  const rules = client.pushRules?.global?.room
  if (!Array.isArray(rules)) return out
  for (const rule of rules) {
    if (rule?.actions?.includes(PushRuleActionName.DontNotify) && typeof rule.rule_id === 'string') {
      out.add(rule.rule_id)
    }
  }
  return out
}

export async function setRoomMutedOnServer(
  client: MatrixClient,
  roomId: string,
  mute: boolean,
): Promise<void> {
  // Returns undefined when there is nothing to do (already in that state).
  await client.setRoomMutePushRule('global', roomId, mute)
}
