// ---------------------------------------------------------------------------
// Where a member sends a bug report (tc.149). Read by the beta notice
// (ui/BetaBanner.tsx) and by Fourier-chan's release sign-off
// (tools/release/announcement.ts).
//
// Operator, 2026-11-02: "Bug reports are directed to /horizon/" and "Bug
// reports and feature requests are handled via the /horizon/ page". The page
// is 41chan.net/horizon/; its "Talk to Fourier" section (#intake) is a short
// conversation with Fourier-chan, who files the report into the same queue
// `coherence bugs` works. It needs no sign-in and no room, so a member who
// reads the notice can follow it the moment they read it.
//
// It replaces "!bugreport in matrix help or a DM with her" (f82e351). That
// path still files, but it is no longer where the client sends anyone, and it
// asked a fresh member to find and join a room first.
//
// `url` is the one address. The notice links it; the sign-off may NOT (a bot
// never posts an address, memory bots-never-post-addresses), so it names the
// page and the section in words, `page` and `section`, as the page itself
// shows them. checks/bugReport.check.ts holds `url` and `section` against the
// page's source in fourier-domain, so a renamed section or a moved anchor
// fails the gate instead of sending members to a heading that is not there.
//
// Pure, so the harness can load it (O-tp9).
// ---------------------------------------------------------------------------

export const BUG_REPORT = {
  url: 'https://41chan.net/horizon/#intake',
  // The page as a member would say it, and the section heading on it.
  page: 'the horizon page',
  section: 'Talk to Fourier',
} as const
