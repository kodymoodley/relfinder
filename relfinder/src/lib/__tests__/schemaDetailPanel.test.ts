/**
 * Unit tests for SchemaDetailPanel derived display data.
 *
 * The panel's header, object-property list, incoming-connection list, and
 * label resolution are pure derivations from props. These tests protect those
 * transformations without needing to render PrimeVue Drawer in jsdom.
 *
 * Covers:
 *   - panelHeader: node label / "A → B" edge / "Details" fallback
 *   - resolveLabel: labelMap lookup with IRI-fragment fallback
 *   - objectProps: edges filtered by selectedNode as source
 *   - incoming: edges filtered by selectedNode as target
 */

import { describe, it, expect } from 'vitest'
import type { SchemaNode, SchemaEdge } from '@/lib/sparql/types'

// ── Logic mirrors (must stay in sync with SchemaDetailPanel.vue) ──────────────

function buildLabelMap(allNodes: SchemaNode[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of allNodes) m.set(n.iri, n.label)
  return m
}

function resolveLabel(labelMap: Map<string, string>, iri: string): string {
  return labelMap.get(iri) ?? iri.split(/[/#]/).pop() ?? iri
}

function panelHeader(
  selectedNode: SchemaNode | null,
  selectedEdge: SchemaEdge | null,
  allNodes: SchemaNode[],
): string {
  if (selectedNode) return selectedNode.label
  if (selectedEdge) {
    const map = buildLabelMap(allNodes)
    return `${resolveLabel(map, selectedEdge.sourceIri)} → ${resolveLabel(map, selectedEdge.targetIri)}`
  }
  return 'Details'
}

function objectProps(
  selectedNode: SchemaNode | null,
  allEdges: SchemaEdge[],
  allNodes: SchemaNode[],
): Array<{ propIri: string; propLabel: string; rangeIri: string; rangeLabel: string }> {
  if (!selectedNode) return []
  const map = buildLabelMap(allNodes)
  return allEdges
    .filter((e) => e.sourceIri === selectedNode.iri)
    .flatMap((e) =>
      e.props.map((p) => ({
        propIri: p.iri,
        propLabel: p.label,
        rangeIri: e.targetIri,
        rangeLabel: resolveLabel(map, e.targetIri),
      })),
    )
}

function incoming(
  selectedNode: SchemaNode | null,
  allEdges: SchemaEdge[],
  allNodes: SchemaNode[],
): Array<{ sourceIri: string; sourceLabel: string; dominantProp: string }> {
  if (!selectedNode) return []
  const map = buildLabelMap(allNodes)
  return allEdges
    .filter((e) => e.targetIri === selectedNode.iri)
    .map((e) => ({
      sourceIri: e.sourceIri,
      sourceLabel: resolveLabel(map, e.sourceIri),
      dominantProp: e.props[0]?.label ?? '',
    }))
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const personNode: SchemaNode = { iri: 'http://e.org/Person', label: 'Person' }
const orgNode: SchemaNode = { iri: 'http://e.org/Org', label: 'Organisation' }
const allNodes = [personNode, orgNode]

const knowsEdge: SchemaEdge = {
  sourceIri: 'http://e.org/Person',
  targetIri: 'http://e.org/Org',
  props: [
    { iri: 'http://e.org/memberOf', label: 'memberOf', count: 10 },
    { iri: 'http://e.org/worksAt', label: 'worksAt', count: 5 },
  ],
  totalCount: 15,
}

const reverseEdge: SchemaEdge = {
  sourceIri: 'http://e.org/Org',
  targetIri: 'http://e.org/Person',
  props: [{ iri: 'http://e.org/employs', label: 'employs', count: 8 }],
  totalCount: 8,
}

// ── panelHeader ───────────────────────────────────────────────────────────────

describe('panelHeader', () => {
  it('returns the node label when a node is selected', () => {
    expect(panelHeader(personNode, null, allNodes)).toBe('Person')
  })

  it('returns "Details" when nothing is selected', () => {
    expect(panelHeader(null, null, allNodes)).toBe('Details')
  })

  it('returns "Source → Target" format for an edge selection', () => {
    expect(panelHeader(null, knowsEdge, allNodes)).toBe('Person → Organisation')
  })

  it('resolves edge endpoints via labelMap when labels are available', () => {
    const header = panelHeader(null, knowsEdge, allNodes)
    expect(header).toContain('Person')
    expect(header).toContain('Organisation')
    expect(header).toContain('→')
  })

  it('falls back to IRI fragment when endpoint has no label in allNodes', () => {
    const header = panelHeader(null, knowsEdge, []) // empty allNodes → no labelMap entries
    expect(header).toContain('Person') // fragment of http://e.org/Person
    expect(header).toContain('Org') // fragment of http://e.org/Org
  })
})

// ── resolveLabel ──────────────────────────────────────────────────────────────

describe('resolveLabel', () => {
  it('returns the mapped label when the IRI is in the labelMap', () => {
    const map = buildLabelMap(allNodes)
    expect(resolveLabel(map, 'http://e.org/Person')).toBe('Person')
  })

  it('falls back to the fragment after # when not in the map', () => {
    const map = buildLabelMap([])
    expect(resolveLabel(map, 'http://e.org/SomeClass')).toBe('SomeClass')
  })

  it('falls back to the fragment after / when no # present', () => {
    const map = buildLabelMap([])
    expect(resolveLabel(map, 'http://e.org/ns/Thing')).toBe('Thing')
  })

  it('returns the full IRI when it has no # or / fragment', () => {
    const map = buildLabelMap([])
    expect(resolveLabel(map, 'urn:example')).toBe('urn:example')
  })
})

// ── objectProps ───────────────────────────────────────────────────────────────

describe('objectProps', () => {
  it('returns empty array when no node is selected', () => {
    expect(objectProps(null, [knowsEdge], allNodes)).toEqual([])
  })

  it('returns props for outgoing edges of the selected node', () => {
    const result = objectProps(personNode, [knowsEdge, reverseEdge], allNodes)
    expect(result).toHaveLength(2) // knowsEdge has 2 props
    expect(result.map((p) => p.propLabel)).toEqual(['memberOf', 'worksAt'])
  })

  it('excludes edges where the selected node is the target', () => {
    const result = objectProps(personNode, [reverseEdge], allNodes)
    expect(result).toHaveLength(0)
  })

  it('resolves rangeLabel from allNodes', () => {
    const result = objectProps(personNode, [knowsEdge], allNodes)
    expect(result[0]?.rangeLabel).toBe('Organisation')
  })

  it('returns empty array when node has no outgoing edges', () => {
    expect(objectProps(personNode, [], allNodes)).toEqual([])
  })
})

// ── incoming ─────────────────────────────────────────────────────────────────

describe('incoming', () => {
  it('returns empty array when no node is selected', () => {
    expect(incoming(null, [reverseEdge], allNodes)).toEqual([])
  })

  it('returns connections where the selected node is the target', () => {
    const result = incoming(personNode, [reverseEdge, knowsEdge], allNodes)
    expect(result).toHaveLength(1)
    expect(result[0]?.sourceLabel).toBe('Organisation')
    expect(result[0]?.dominantProp).toBe('employs')
  })

  it('excludes edges where the selected node is the source', () => {
    const result = incoming(personNode, [knowsEdge], allNodes)
    expect(result).toHaveLength(0)
  })

  it('uses the first prop label as dominantProp', () => {
    const result = incoming(orgNode, [knowsEdge], allNodes)
    expect(result[0]?.dominantProp).toBe('memberOf')
  })

  it('returns empty string for dominantProp when edge has no props', () => {
    const emptyPropsEdge: SchemaEdge = {
      sourceIri: 'http://e.org/Org',
      targetIri: 'http://e.org/Person',
      props: [],
      totalCount: 0,
    }
    const result = incoming(personNode, [emptyPropsEdge], allNodes)
    expect(result[0]?.dominantProp).toBe('')
  })
})
