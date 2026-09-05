// The launch-alpha notice: a permanent strip in the shell header. Rich text,
// no dismiss -- an alpha notice that can be closed is an alpha notice that
// was closed. The last sentence is the operator's, nearly verbatim, because
// the feedback it invites ("I'm not sure what I should be clicking on") is
// the exact signal the onboarding-ux law runs on, and users need to be TOLD
// that confusion is a report worth sending, or they sit on it.
export function AlphaBanner() {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: '5px 14px',
        fontSize: 12.5,
        lineHeight: 1.4,
        borderBottom: '1px solid rgba(214, 72, 59, 0.35)',
        background: 'rgba(214, 72, 59, 0.08)',
        color: 'var(--cpd-color-text-primary)',
      }}
      role="note"
      aria-label="Alpha notice"
    >
      <strong style={{ color: 'var(--cpd-color-text-critical-primary, #d6483b)', letterSpacing: '0.04em' }}>
        TECHNETIUM ALPHA
      </strong>
      {' '}&mdash; things <strong>will</strong> be broken. Message{' '}
      <strong>@saber:41chan.net</strong> with any issue you hit &mdash; and{' '}
      <em>&ldquo;I&rsquo;m not sure what I should be clicking on&rdquo;</em> is not only a valid
      issue, it is the single most valuable piece of feedback you can send.
    </div>
  )
}
