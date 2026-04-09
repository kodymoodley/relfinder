declare module 'cytoscape-d3-force' {
  import type { Core } from 'cytoscape'
  const d3Force: (cy: Core) => void
  export default d3Force
}

// Allow importing any .ttl file as a raw string via Vite's `?raw` query.
declare module '*.ttl?raw' {
  const content: string
  export default content
}
