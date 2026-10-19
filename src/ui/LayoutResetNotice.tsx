// What `?preset=default` just did, said once and in place (SpaceProvider).
// Fixed over the screen rather than in a panel: the layout it replaces may
// have had no panel to put it in, and an overlay pushes nothing aside.
export function LayoutResetNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="tc-layout-reset-notice" role="status">
      <span>{text}</span>
      <button type="button" className="tc-pill" onClick={onDismiss}>OK</button>
    </div>
  )
}
