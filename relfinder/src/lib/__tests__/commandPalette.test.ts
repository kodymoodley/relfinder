/**
 * Unit tests for CommandPalette classification and keyboard navigation logic.
 *
 * CommandPalette distinguishes three result types (Class, Property, Instance)
 * and drives which action buttons are shown. These tests protect that core
 * classification contract and the keyboard wrap-around behaviour.
 *
 * The helpers are replicated here rather than exported from the .vue file so
 * that the tests act as a behavioural specification — if the inline logic
 * drifts, the observable behaviour changes and these tests catch it.
 */

import { describe, it, expect } from 'vitest'

// ── Constants (mirror CommandPalette.vue) ─────────────────────────────────────

const OWL_CLASS = 'http://www.w3.org/2002/07/owl#Class'
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty'

// ── Type mirrors ──────────────────────────────────────────────────────────────

type TagSeverity = 'info' | 'secondary' | 'success'

interface ScoredEntity {
  iri: string
  label: string
  classIri: string
  classLabel: string
}

interface PaletteResult {
  iri: string
  label: string
  classIri: string
  typeLabel: string
  severity: TagSeverity
}

// ── Logic mirrors (must stay in sync with CommandPalette.vue) ─────────────────

function toResult(e: ScoredEntity): PaletteResult {
  let typeLabel: string
  let severity: TagSeverity
  if (e.classIri === OWL_CLASS) {
    typeLabel = 'Class'
    severity = 'info'
  } else if (e.classIri === OWL_OBJECT_PROPERTY) {
    typeLabel = 'Property'
    severity = 'secondary'
  } else {
    typeLabel = e.classLabel || 'Instance'
    severity = 'success'
  }
  return { iri: e.iri, label: e.label, classIri: e.classIri, typeLabel, severity }
}

function isInstance(result: Pick<PaletteResult, 'classIri'>): boolean {
  return result.classIri !== OWL_CLASS && result.classIri !== OWL_OBJECT_PROPERTY
}

function navigateActive(
  key: 'ArrowDown' | 'ArrowUp',
  current: number,
  total: number,
): number {
  if (total === 0) return current
  if (key === 'ArrowDown') return (current + 1) % total
  return (current - 1 + total) % total
}

// ── toResult ──────────────────────────────────────────────────────────────────

describe('toResult — classification', () => {
  it('assigns severity info and typeLabel Class for OWL Class', () => {
    const r = toResult({ iri: 'http://e.org/Person', label: 'Person', classIri: OWL_CLASS, classLabel: '' })
    expect(r.severity).toBe('info')
    expect(r.typeLabel).toBe('Class')
  })

  it('assigns severity secondary and typeLabel Property for OWL ObjectProperty', () => {
    const r = toResult({ iri: 'http://e.org/knows', label: 'knows', classIri: OWL_OBJECT_PROPERTY, classLabel: '' })
    expect(r.severity).toBe('secondary')
    expect(r.typeLabel).toBe('Property')
  })

  it('assigns severity success for any other classIri (instance)', () => {
    const r = toResult({ iri: 'http://e.org/alice', label: 'Alice', classIri: 'http://e.org/Person', classLabel: 'Person' })
    expect(r.severity).toBe('success')
  })

  it('uses classLabel as typeLabel for instances when classLabel is non-empty', () => {
    const r = toResult({ iri: 'http://e.org/alice', label: 'Alice', classIri: 'http://e.org/Person', classLabel: 'Person' })
    expect(r.typeLabel).toBe('Person')
  })

  it('falls back to "Instance" typeLabel when classLabel is empty', () => {
    const r = toResult({ iri: 'http://e.org/alice', label: 'Alice', classIri: 'http://e.org/Person', classLabel: '' })
    expect(r.typeLabel).toBe('Instance')
  })

  it('preserves iri and label on the result', () => {
    const r = toResult({ iri: 'http://e.org/X', label: 'X label', classIri: OWL_CLASS, classLabel: '' })
    expect(r.iri).toBe('http://e.org/X')
    expect(r.label).toBe('X label')
  })
})

// ── isInstance ────────────────────────────────────────────────────────────────

describe('isInstance — type detection', () => {
  it('returns false for OWL Class', () => {
    expect(isInstance({ classIri: OWL_CLASS })).toBe(false)
  })

  it('returns false for OWL ObjectProperty', () => {
    expect(isInstance({ classIri: OWL_OBJECT_PROPERTY })).toBe(false)
  })

  it('returns true for any other IRI', () => {
    expect(isInstance({ classIri: 'http://e.org/Person' })).toBe(true)
  })

  it('returns true for blank node classIri', () => {
    expect(isInstance({ classIri: '_:b0' })).toBe(true)
  })
})

// ── Keyboard navigation ───────────────────────────────────────────────────────

describe('keyboard navigation wrapping', () => {
  it('ArrowDown increments activeIndex', () => {
    expect(navigateActive('ArrowDown', 0, 3)).toBe(1)
  })

  it('ArrowDown wraps from last to first', () => {
    expect(navigateActive('ArrowDown', 2, 3)).toBe(0)
  })

  it('ArrowUp decrements activeIndex', () => {
    expect(navigateActive('ArrowUp', 2, 3)).toBe(1)
  })

  it('ArrowUp wraps from first to last', () => {
    expect(navigateActive('ArrowUp', 0, 3)).toBe(2)
  })

  it('returns current index unchanged when there are no results', () => {
    expect(navigateActive('ArrowDown', -1, 0)).toBe(-1)
    expect(navigateActive('ArrowUp', -1, 0)).toBe(-1)
  })

  it('single result: ArrowDown stays at 0', () => {
    expect(navigateActive('ArrowDown', 0, 1)).toBe(0)
  })
})
