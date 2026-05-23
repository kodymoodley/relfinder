// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useBreakpoint, BP_MD, BP_LG } from '../useBreakpoint'

// ── matchMedia mock factory ───────────────────────────────────────────────────

type ChangeListener = (e: { matches: boolean }) => void

interface MockQuery {
  matches: boolean
  listeners: ChangeListener[]
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  /** Simulate the viewport crossing the breakpoint */
  fire(matches: boolean): void
}

function mockMatchMedia(viewportWidth: number): Record<string, MockQuery> {
  const queries: Record<string, MockQuery> = {}

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string): MockQuery => {
      if (!queries[query]) {
        const minWidth = parseInt(query.match(/(\d+)/)?.[1] ?? '0', 10)
        const q: MockQuery = {
          matches: viewportWidth >= minWidth,
          listeners: [],
          addEventListener: vi.fn((_: string, fn: ChangeListener) => q.listeners.push(fn)),
          removeEventListener: vi.fn((_: string, fn: ChangeListener) => {
            q.listeners = q.listeners.filter((l) => l !== fn)
          }),
          fire(matches: boolean) {
            q.matches = matches
            q.listeners.forEach((l) => l({ matches }))
          },
        }
        queries[query] = q
      }
      return queries[query]!
    }),
  })

  return queries
}

// ── Wrapper component ─────────────────────────────────────────────────────────

const TestComp = defineComponent({
  setup() {
    return useBreakpoint()
  },
  template: '<div>{{ breakpoint }}</div>',
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useBreakpoint — initial value', () => {
  it('returns mobile at 375 px', () => {
    mockMatchMedia(375)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('mobile')
    expect(w.vm.isMobile).toBe(true)
    expect(w.vm.isTablet).toBe(false)
    expect(w.vm.isDesktop).toBe(false)
  })

  it('returns tablet at the MD breakpoint (768 px)', () => {
    mockMatchMedia(BP_MD)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('tablet')
    expect(w.vm.isMobile).toBe(false)
    expect(w.vm.isTablet).toBe(true)
    expect(w.vm.isDesktop).toBe(false)
  })

  it('returns desktop at the LG breakpoint (1280 px)', () => {
    mockMatchMedia(BP_LG)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('desktop')
    expect(w.vm.isMobile).toBe(false)
    expect(w.vm.isTablet).toBe(false)
    expect(w.vm.isDesktop).toBe(true)
  })

  it('returns tablet for a mid-range width (1024 px)', () => {
    mockMatchMedia(1024)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('tablet')
  })
})

describe('useBreakpoint — reactive updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates from mobile to tablet when matchMedia fires the MD query', async () => {
    const queries = mockMatchMedia(375)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('mobile')

    const mdKey = Object.keys(queries).find((k) => k.includes(String(BP_MD)))!
    queries[mdKey]!.fire(true)
    await w.vm.$nextTick()

    expect(w.vm.breakpoint).toBe('tablet')
    expect(w.vm.isMobile).toBe(false)
    expect(w.vm.isTablet).toBe(true)
  })

  it('updates from tablet to desktop when matchMedia fires the LG query', async () => {
    const queries = mockMatchMedia(BP_MD)
    const w = mount(TestComp)
    expect(w.vm.breakpoint).toBe('tablet')

    const lgKey = Object.keys(queries).find((k) => k.includes(String(BP_LG)))!
    queries[lgKey]!.fire(true)
    await w.vm.$nextTick()

    expect(w.vm.breakpoint).toBe('desktop')
  })

  it('removes event listeners when the component unmounts', () => {
    const queries = mockMatchMedia(BP_LG)
    const w = mount(TestComp)

    const removeSpies = Object.values(queries).map((q) => q.removeEventListener)
    w.unmount()

    for (const spy of removeSpies) {
      expect(spy).toHaveBeenCalled()
    }
  })
})
