// ---------------------------------------------------------------------------
// E11 -- the destructive reset. The ONE file allowed to name an SDK call that
// can destroy a key (the source guard in cryptoIdentity.check.ts enforces it).
//
// It REFUSES ON ITS OWN. The gate is re-checked here, not just in the dialog,
// because a gate that lives only in the component is a gate that a future
// caller walks around without noticing. Everything in this file is irreversible
// and there is no support path that undoes it -- see G-e1 -- so the check being
// duplicated is the point rather than a smell.
//
// Order matters and is not arbitrary:
//   1. export first, always, even when the caller says they already did
//      -- the cheapest possible insurance against the next two steps;
//   2. cross-signing second, which costs trust and no messages;
//   3. the key backup last, because that is the step that is forever.
// A failure part-way leaves the user better off than the reverse order would.
// ---------------------------------------------------------------------------

import type { MatrixClient } from 'matrix-js-sdk'
import { gateBlockers, type ResetGate, type ResetPlan } from './resetPlan'

export type ResetOutcome =
  | { ok: true; exportedBytes: number }
  | { ok: false; reason: 'refused-by-gate'; blockers: string[] }
  | { ok: false; reason: 'no-crypto' }
  | { ok: false; reason: 'failed'; step: 'cross-signing' | 'key-backup'; detail: string }

// Room keys as JSON, for the user to save before anything is destroyed. Kept
// separate from the reset so the export can be taken -- and re-taken -- without
// committing to anything.
export async function exportRoomKeys(client: MatrixClient): Promise<string | null> {
  const crypto = client.getCrypto()
  if (!crypto) return null
  try {
    return await crypto.exportRoomKeysAsJson()
  } catch (err) {
    console.error('[reset] key export failed', err)
    return null
  }
}

// Restore an export taken before a reset. The other half of D-e2: an export
// nobody can import is a placebo.
export async function importRoomKeys(client: MatrixClient, json: string): Promise<boolean> {
  const crypto = client.getCrypto()
  if (!crypto) return false
  try {
    await crypto.importRoomKeysAsJson(json)
    return true
  } catch (err) {
    console.error('[reset] key import failed', err)
    return false
  }
}

export async function performReset(
  client: MatrixClient,
  gate: ResetGate,
  plan: ResetPlan,
  userId: string,
): Promise<ResetOutcome> {
  const blockers = gateBlockers(gate, userId, plan)
  if (blockers.length > 0) return { ok: false, reason: 'refused-by-gate', blockers }
  const crypto = client.getCrypto()
  if (!crypto) return { ok: false, reason: 'no-crypto' }

  // Step 1. Always, regardless of what the caller believes they saved.
  const exported = (await exportRoomKeys(client)) ?? ''

  // Step 2. Replace the cross-signing identity. This is the call the source
  // guard exists for. It costs device trust and no messages (G-e2).
  try {
    await crypto.bootstrapCrossSigning({ setupNewCrossSigning: true })
  } catch (err) {
    return { ok: false, reason: 'failed', step: 'cross-signing', detail: String(err) }
  }

  // Step 3. Last, because it is the irreversible one. resetKeyBackup REPLACES
  // the version, and replacing deletes the keys in the old one -- Synapse's
  // docstring claims otherwise and is wrong (G-e1).
  if (plan.destroysKeyBackup) {
    try {
      await crypto.resetKeyBackup()
    } catch (err) {
      // The identity is already replaced. Say which step failed rather than
      // reporting a clean failure over a half-done reset.
      return { ok: false, reason: 'failed', step: 'key-backup', detail: String(err) }
    }
  }
  return { ok: true, exportedBytes: exported.length }
}
