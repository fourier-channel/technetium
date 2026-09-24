// A pushpin, drawn rather than typed: an emoji pin depends on the viewer's
// font and renders as a box where there is none. currentColor, so it takes
// the colour of whatever it sits in.
export function PushpinIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      className="tc-pushpin"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M10.3 1.2a1 1 0 0 1 1.4 0l3.1 3.1a1 1 0 0 1 0 1.4l-.9.9a1 1 0 0 1-1.1.2l-2.3 2.3.4 2.9a1 1 0 0 1-.3.8l-.8.8a1 1 0 0 1-1.4 0L6.2 11.4l-3.5 3.5a.7.7 0 0 1-1-1l3.5-3.5-2.2-2.2a1 1 0 0 1 0-1.4l.8-.8a1 1 0 0 1 .8-.3l2.9.4 2.3-2.3a1 1 0 0 1 .2-1.1z"
      />
    </svg>
  )
}
