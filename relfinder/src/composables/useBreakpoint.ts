import { ref, computed, onMounted, onUnmounted } from 'vue'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

// Canonical breakpoint thresholds — matches the documented values in tokens.css.
// Import these constants in any component that needs a numeric comparison.
export const BP_MD = 768 // tablet and above
export const BP_LG = 1280 // desktop and above

function currentBreakpoint(): Breakpoint {
  if (window.matchMedia(`(min-width: ${BP_LG}px)`).matches) return 'desktop'
  if (window.matchMedia(`(min-width: ${BP_MD}px)`).matches) return 'tablet'
  return 'mobile'
}

/**
 * Reactive viewport breakpoint.
 *
 * Returns a single `breakpoint` ref plus three convenience booleans.
 * Backed by `window.matchMedia` change events — zero polling, zero ResizeObserver
 * overhead. All responsive layout decisions in components must flow from this
 * composable; never read `window.innerWidth` directly in component code.
 *
 * Breakpoints (mobile-first, min-width):
 *   mobile   < 768 px
 *   tablet  >= 768 px
 *   desktop >= 1280 px
 */
export function useBreakpoint() {
  const breakpoint = ref<Breakpoint>(currentBreakpoint())

  const mdQuery = window.matchMedia(`(min-width: ${BP_MD}px)`)
  const lgQuery = window.matchMedia(`(min-width: ${BP_LG}px)`)

  function update() {
    breakpoint.value = currentBreakpoint()
  }

  onMounted(() => {
    mdQuery.addEventListener('change', update)
    lgQuery.addEventListener('change', update)
  })

  onUnmounted(() => {
    mdQuery.removeEventListener('change', update)
    lgQuery.removeEventListener('change', update)
  })

  return {
    breakpoint,
    isMobile: computed(() => breakpoint.value === 'mobile'),
    isTablet: computed(() => breakpoint.value === 'tablet'),
    isDesktop: computed(() => breakpoint.value === 'desktop'),
  }
}
