import type { Core } from 'cytoscape'

/** How long (ms) a finger must be held still before the selection drag activates. */
export const LONG_PRESS_MS = 500

/** How far (px) the finger may drift during the hold before we treat it as a pan. */
export const CANCEL_MOVE_PX = 10

/**
 * Adds long-press → drag box-selection to a Cytoscape canvas element.
 *
 * Cytoscape's built-in boxSelectionEnabled only responds to mouse drag, not
 * touch drag. This composable bridges the gap by:
 *   1. Listening for a LONG_PRESS_MS hold with no significant movement.
 *   2. Calling onEnterSelect (caller should disable cy panning / enable cy box
 *      selection) and drawing a DOM rubber-band overlay.
 *   3. On touchend, computing which nodes' renderedPositions fall inside the
 *      rubber band, selecting them directly, removing the overlay, and calling
 *      onExitSelect (caller should re-enable panning).
 *
 * Usage:
 *   const { attach, detach } = useTouchBoxSelect(() => cy, () => el, onIn, onOut)
 *   onMounted(() => { if (el) attach(el) })
 *   onUnmounted(() => { if (el) detach(el) })
 */
export function useTouchBoxSelect(
  getCy: () => Core | null,
  getContainer: () => HTMLElement | null,
  onEnterSelect: () => void,
  onExitSelect: () => void,
) {
  let overlay: HTMLDivElement | null = null
  let pressTimer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let currentX = 0
  let currentY = 0
  let active = false

  // ── Overlay helpers ────────────────────────────────────────────────────────

  function createOverlay(container: HTMLElement): void {
    overlay = document.createElement('div')
    overlay.className = 'touch-select-overlay'
    Object.assign(overlay.style, {
      position: 'absolute',
      border: '2px dashed var(--rf-primary, #0891b2)',
      background: 'rgb(8 145 178 / 0.12)',
      pointerEvents: 'none',
      borderRadius: '4px',
      zIndex: '50',
    })
    container.appendChild(overlay)
  }

  function updateOverlay(): void {
    if (!overlay) return
    overlay.style.left = `${Math.min(startX, currentX)}px`
    overlay.style.top = `${Math.min(startY, currentY)}px`
    overlay.style.width = `${Math.abs(currentX - startX)}px`
    overlay.style.height = `${Math.abs(currentY - startY)}px`
  }

  function removeOverlay(): void {
    overlay?.remove()
    overlay = null
  }

  // ── Selection logic ────────────────────────────────────────────────────────

  function selectNodesInBox(): void {
    const cy = getCy()
    if (!cy) return
    const left = Math.min(startX, currentX)
    const top = Math.min(startY, currentY)
    const right = Math.max(startX, currentX)
    const bottom = Math.max(startY, currentY)
    cy.nodes().each((node) => {
      const pos = node.renderedPosition()
      if (pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom) {
        node.select()
      }
    })
    // Select edges whose both endpoints are within the box — mirrors Cytoscape's
    // desktop box-selection so that crop retains connecting edges.
    cy.edges().each((edge) => {
      if (edge.source().selected() && edge.target().selected()) {
        edge.select()
      }
    })
  }

  // ── Long-press timer ───────────────────────────────────────────────────────

  function cancelPress(): void {
    if (pressTimer !== null) {
      clearTimeout(pressTimer)
      pressTimer = null
    }
  }

  // ── Touch handlers ────────────────────────────────────────────────────────

  function onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return
    const container = getContainer()
    if (!container) return
    const touch = e.touches[0]
    if (!touch) return

    const rect = container.getBoundingClientRect()
    startX = touch.clientX - rect.left
    startY = touch.clientY - rect.top
    currentX = startX
    currentY = startY

    cancelPress()
    pressTimer = setTimeout(() => {
      pressTimer = null
      active = true
      createOverlay(container)
      updateOverlay()
      onEnterSelect()
    }, LONG_PRESS_MS)
  }

  function onTouchMove(e: TouchEvent): void {
    if (e.touches.length !== 1) return
    const container = getContainer()
    if (!container) return
    const touch = e.touches[0]
    if (!touch) return

    const rect = container.getBoundingClientRect()
    currentX = touch.clientX - rect.left
    currentY = touch.clientY - rect.top

    if (!active) {
      if (Math.hypot(currentX - startX, currentY - startY) > CANCEL_MOVE_PX) {
        cancelPress()
      }
      return
    }

    e.preventDefault()
    updateOverlay()
  }

  function endTouch(): void {
    cancelPress()
    if (!active) return
    active = false
    selectNodesInBox()
    removeOverlay()
    onExitSelect()
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function attach(el: HTMLElement): void {
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', endTouch)
    el.addEventListener('touchcancel', endTouch)
  }

  function detach(el: HTMLElement): void {
    el.removeEventListener('touchstart', onTouchStart)
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', endTouch)
    el.removeEventListener('touchcancel', endTouch)
    cancelPress()
    removeOverlay()
    active = false
  }

  return { attach, detach }
}
