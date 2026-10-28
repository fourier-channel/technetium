// ---------------------------------------------------------------------------
// Where a member sends a bug report (tc.149). Read by the beta notice
// (ui/BetaBanner.tsx), which is the one place the client tells anyone.
//
// Fourier-chan takes reports filed with !bugreport in the help rooms and in a
// DM with her; anywhere else she answers with where to go instead. Her room
// list is fourier-coherence coherence.bugs.yaml `rooms` (her heartbeat is RED
// unless she is joined to exactly those). The notice used to name
// #botsbotsbots, which is not one of them, so a member who followed it filed a
// report nobody collected.
//
// `room` is the room's NAME as the room list shows it, not an alias: the help
// rooms have none, so "#matrix help" would name nothing a member could find.
// It must equal one of the intake's labels; checks/bugReport.check.ts holds
// the two together, so a rename on either side fails the gate instead of
// sending reports into a room she is not listening in.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export const BUG_REPORT = {
  // The command she answers to, as typed.
  command: '!bugreport',
  // The help room for the chat client itself (the booru has its own,
  // "booru help"), and the space it sits under in the room list.
  room: 'matrix help',
  space: 'get help',
  // Who to DM instead: her display name, as the member list shows it.
  guide: 'Fourier-chan',
} as const
