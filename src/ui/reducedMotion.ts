import { useEffect, useState } from 'react'

// The one reading of prefers-reduced-motion in script: a non-reactive check for
// imperative code (flip, pop, drags) and a hook that re-renders on change (any
// component that animates from script). CSS honours the same preference in its
// own @media blocks; checks/reducedMotionAudit.check.ts proves that every
// infinite animation is answered by one or the other.

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-reduced-motion: reduce)')
}

export function prefersReducedMotion(): boolean {
  return query()?.matches ?? false
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => query()?.matches ?? false)
  useEffect(() => {
    const m = query()
    if (!m) return
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}
