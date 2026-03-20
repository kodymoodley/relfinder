declare module 'cytoscape-d3-force' {
  import type { Core } from 'cytoscape'
  const d3Force: (cy: Core) => void
  export default d3Force
}
