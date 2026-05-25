// ── Central search configuration ──────────────────────────────────────────────

export const searchConfig = {
  /** Master switch. false → all search goes through the legacy SPARQL path. */
  indexEnabled: true,

  /** Whether the prefetch worker is allowed to issue background SPARQL calls. */
  prefetchEnabled: true,
}
