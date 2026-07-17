import { Component, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Silent-null boundary (CD-9). Any subtree that throws while rendering is
// replaced by NOTHING -- no error card, no fallback chrome, no layout shift.
// A glitchy or missing element just isn't there; the surrounding UI is
// unaffected. Never use this to hide a bug you can fix -- use it so a flaky
// piece of data can't take the whole screen down with it.
// ---------------------------------------------------------------------------

export class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    // Deliberately swallowed: CD-9 says a failed element leaves emptiness, not
    // an error message. (A real categorical failure surfaces elsewhere.)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
