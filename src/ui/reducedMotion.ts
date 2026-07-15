import { useEffect, useState } from 'react'

// Shared prefers-reduced-motion helpers for the room list (and future UI). A
// non-reactive check for imperative code, and a hook that re-renders on change.

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
