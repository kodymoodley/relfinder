/**
 * Returns true if the user has requested reduced motion in their OS settings.
 * Read at call-site rather than reactively — callers (Cytoscape layout init)
 * already run in response to user actions so a live ref is not needed.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
