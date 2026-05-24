/**
 * Unit tests for useTouchBoxSelect composable.
 *
 * Tests the long-press → drag → box-select flow on touch devices.
 * Cytoscape and the container element are mocked; fake timers control the
 * LONG_PRESS_MS hold detection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Mock } from 'vitest'
import { useTouchBoxSelect, LONG_PRESS_MS, CANCEL_MOVE_PX } from '@/composables/useTouchBoxSelect'
import type { Core, NodeSingular } from 'cytoscape'

// ── jsdom Touch / TouchEvent polyfill ─────────────────────────────────────────
// jsdom does not ship Touch or TouchEvent; define minimal stubs so event
// dispatch works. The composable only reads touches[i].clientX / clientY
// and touches.length, so this covers everything it needs.

class FakeTouch {
  readonly identifier: number
  readonly target: EventTarget
  readonly clientX: number
  readonly clientY: number
  constructor(init: { identifier: number; target: EventTarget; clientX: number; clientY: number }) {
    this.identifier = init.identifier
    this.target = init.target
    this.clientX = init.clientX
    this.clientY = init.clientY
  }
}

class FakeTouchEvent extends Event {
  readonly touches: FakeTouch[]
  constructor(
    type: string,
    init: EventInit & { touches?: FakeTouch[]; cancelable?: boolean } = {},
  ) {
    super(type, { bubbles: init.bubbles ?? false, cancelable: init.cancelable ?? false })
    this.touches = init.touches ?? []
  }
}

if (typeof (globalThis as Record<string, unknown>).Touch === 'undefined') {
  ;(globalThis as Record<string, unknown>).Touch = FakeTouch
}
if (typeof (globalThis as Record<string, unknown>).TouchEvent === 'undefined') {
  ;(globalThis as Record<string, unknown>).TouchEvent = FakeTouchEvent
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeTouch(el: Element, clientX: number, clientY: number): FakeTouch {
  return new FakeTouch({ identifier: 1, target: el, clientX, clientY })
}

function touchStart(el: HTMLElement, x: number, y: number): void {
  el.dispatchEvent(
    new FakeTouchEvent('touchstart', { bubbles: true, touches: [makeTouch(el, x, y)] }),
  )
}

function touchMove(el: HTMLElement, x: number, y: number): void {
  el.dispatchEvent(
    new FakeTouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches: [makeTouch(el, x, y)],
    }),
  )
}

function touchEnd(el: HTMLElement): void {
  el.dispatchEvent(new FakeTouchEvent('touchend', { bubbles: true, touches: [] }))
}

function touchCancel(el: HTMLElement): void {
  el.dispatchEvent(new FakeTouchEvent('touchcancel', { bubbles: true, touches: [] }))
}

// ── Mock Cytoscape node factory ────────────────────────────────────────────────

interface MockNode extends NodeSingular {
  _isSelected: boolean
}

function mockNode(x: number, y: number): MockNode {
  const node = {
    _isSelected: false,
    renderedPosition: () => ({ x, y }),
    selected: () => node._isSelected,
    select: vi.fn(() => {
      node._isSelected = true
    }),
  } as unknown as MockNode
  return node
}

interface MockEdge {
  source: () => MockNode
  target: () => MockNode
  select: ReturnType<typeof vi.fn>
}

function mockEdge(src: MockNode, tgt: MockNode): MockEdge {
  return { source: () => src, target: () => tgt, select: vi.fn() }
}

/** Build a minimal mock Cytoscape Core with nodes and optional edges. */
function mockCy(nodes: MockNode[], edges: MockEdge[] = []): Core {
  return {
    nodes: () => ({ each: (fn: (n: MockNode) => void) => nodes.forEach(fn) }),
    edges: () => ({ each: (fn: (e: MockEdge) => void) => edges.forEach(fn) }),
  } as unknown as Core
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

let container: HTMLElement
let onEnterSelect: Mock<() => void>
let onExitSelect: Mock<() => void>

beforeEach(() => {
  vi.useFakeTimers()

  container = document.createElement('div')
  // getBoundingClientRect returns zeros in jsdom by default, so
  // container-relative coords equal clientX/clientY directly.
  document.body.appendChild(container)

  onEnterSelect = vi.fn()
  onExitSelect = vi.fn()
})

afterEach(() => {
  container.remove()
  vi.useRealTimers()
})

// ── Long-press detection ───────────────────────────────────────────────────────

describe('long-press detection', () => {
  it('calls onEnterSelect after holding still for LONG_PRESS_MS', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 50, 50)
    expect(onEnterSelect).not.toHaveBeenCalled()

    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(onEnterSelect).toHaveBeenCalledOnce()
  })

  it('does NOT call onEnterSelect if touchend fires before the timer', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 50, 50)
    vi.advanceTimersByTime(LONG_PRESS_MS - 1)
    touchEnd(container)

    vi.advanceTimersByTime(LONG_PRESS_MS) // let any pending timer flush
    expect(onEnterSelect).not.toHaveBeenCalled()
  })

  it(`does NOT call onEnterSelect if finger moves more than ${CANCEL_MOVE_PX}px before the timer`, () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 50, 50)
    touchMove(container, 50 + CANCEL_MOVE_PX + 1, 50) // exceeds threshold
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onEnterSelect).not.toHaveBeenCalled()
  })

  it('does NOT cancel if finger drifts within the allowed threshold', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 50, 50)
    touchMove(container, 50 + CANCEL_MOVE_PX - 1, 50) // within threshold
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onEnterSelect).toHaveBeenCalledOnce()
  })

  it('ignores multi-touch (2+ fingers)', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    const t1 = makeTouch(container, 50, 50)
    const t2 = makeTouch(container, 100, 100)
    container.dispatchEvent(new FakeTouchEvent('touchstart', { bubbles: true, touches: [t1, t2] }))
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onEnterSelect).not.toHaveBeenCalled()
  })
})

// ── Overlay ────────────────────────────────────────────────────────────────────

describe('rubber-band overlay', () => {
  it('appends an overlay element to the container on activation', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    expect(container.querySelector('.touch-select-overlay')).toBeNull()

    touchStart(container, 10, 10)
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(container.querySelector('.touch-select-overlay')).not.toBeNull()
  })

  it('updates the overlay dimensions on touchmove during active selection', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 10, 20)
    vi.advanceTimersByTime(LONG_PRESS_MS)

    touchMove(container, 90, 80)

    const el = container.querySelector('.touch-select-overlay') as HTMLElement
    expect(el.style.left).toBe('10px')
    expect(el.style.top).toBe('20px')
    expect(el.style.width).toBe('80px')
    expect(el.style.height).toBe('60px')
  })

  it('handles dragging up-left (negative direction) correctly', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 90, 80)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 10, 20)

    const el = container.querySelector('.touch-select-overlay') as HTMLElement
    expect(el.style.left).toBe('10px')
    expect(el.style.top).toBe('20px')
    expect(el.style.width).toBe('80px')
    expect(el.style.height).toBe('60px')
  })

  it('removes the overlay on touchend', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 10, 10)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(container.querySelector('.touch-select-overlay')).not.toBeNull()

    touchEnd(container)
    expect(container.querySelector('.touch-select-overlay')).toBeNull()
  })

  it('removes the overlay on touchcancel', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 10, 10)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchCancel(container)

    expect(container.querySelector('.touch-select-overlay')).toBeNull()
  })
})

// ── Node selection logic ───────────────────────────────────────────────────────

describe('node selection', () => {
  it('selects nodes whose renderedPosition is inside the rubber-band box', () => {
    const inside = mockNode(50, 50)
    const outside = mockNode(200, 200)
    const cy = mockCy([inside, outside])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    // draw box from (0,0) to (100,100) — inside node at (50,50) is within it
    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(inside.select).toHaveBeenCalledOnce()
    expect(outside.select).not.toHaveBeenCalled()
  })

  it('selects all nodes that fall within the box', () => {
    const n1 = mockNode(20, 20)
    const n2 = mockNode(80, 80)
    const n3 = mockNode(150, 150)
    const cy = mockCy([n1, n2, n3])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(n1.select).toHaveBeenCalledOnce()
    expect(n2.select).toHaveBeenCalledOnce()
    expect(n3.select).not.toHaveBeenCalled()
  })

  it('selects nodes on the box boundary (inclusive)', () => {
    const boundary = mockNode(100, 100)
    const cy = mockCy([boundary])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(boundary.select).toHaveBeenCalledOnce()
  })

  it('selects nothing when no nodes fall inside the box', () => {
    const n = mockNode(500, 500)
    const cy = mockCy([n])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 10, 10)
    touchEnd(container)

    expect(n.select).not.toHaveBeenCalled()
  })

  it('does not throw when cy is null at touchend', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(() => touchEnd(container)).not.toThrow()
  })
})

// ── Edge selection ────────────────────────────────────────────────────────────

describe('edge selection', () => {
  it('selects an edge whose both endpoints are inside the box', () => {
    const n1 = mockNode(20, 20)
    const n2 = mockNode(80, 80)
    const edge = mockEdge(n1, n2)
    const cy = mockCy([n1, n2], [edge])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(edge.select).toHaveBeenCalledOnce()
  })

  it('does NOT select an edge when only one endpoint is inside the box', () => {
    const inside = mockNode(20, 20)
    const outside = mockNode(200, 200)
    const edge = mockEdge(inside, outside)
    const cy = mockCy([inside, outside], [edge])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(inside.select).toHaveBeenCalledOnce()
    expect(outside.select).not.toHaveBeenCalled()
    expect(edge.select).not.toHaveBeenCalled()
  })

  it('does NOT select an edge when neither endpoint is inside the box', () => {
    const n1 = mockNode(200, 200)
    const n2 = mockNode(300, 300)
    const edge = mockEdge(n1, n2)
    const cy = mockCy([n1, n2], [edge])

    const { attach } = useTouchBoxSelect(
      () => cy,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchMove(container, 100, 100)
    touchEnd(container)

    expect(edge.select).not.toHaveBeenCalled()
  })
})

// ── onExitSelect callback ─────────────────────────────────────────────────────

describe('exit callback', () => {
  it('calls onExitSelect on touchend after an active selection', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchEnd(container)

    expect(onExitSelect).toHaveBeenCalledOnce()
  })

  it('calls onExitSelect on touchcancel after an active selection', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    touchCancel(container)

    expect(onExitSelect).toHaveBeenCalledOnce()
  })

  it('does NOT call onExitSelect when selection was never activated', () => {
    const { attach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    // cancel before timer fires
    touchEnd(container)

    expect(onExitSelect).not.toHaveBeenCalled()
  })
})

// ── detach ────────────────────────────────────────────────────────────────────

describe('detach', () => {
  it('stops responding to touch events after detach', () => {
    const { attach, detach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)
    detach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)

    expect(onEnterSelect).not.toHaveBeenCalled()
  })

  it('cancels an in-flight long-press timer on detach', () => {
    const { attach, detach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS / 2) // timer is halfway
    detach(container)
    vi.advanceTimersByTime(LONG_PRESS_MS) // let remaining time elapse

    expect(onEnterSelect).not.toHaveBeenCalled()
  })

  it('removes any active overlay on detach', () => {
    const { attach, detach } = useTouchBoxSelect(
      () => null,
      () => container,
      onEnterSelect,
      onExitSelect,
    )
    attach(container)

    touchStart(container, 0, 0)
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(container.querySelector('.touch-select-overlay')).not.toBeNull()

    detach(container)
    expect(container.querySelector('.touch-select-overlay')).toBeNull()
  })
})
