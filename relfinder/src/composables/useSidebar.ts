import { ref, watch } from 'vue'
import { useDarkMode } from './useDarkMode'
import { useBreakpoint } from './useBreakpoint'

/** Shared sidebar state: collapsed toggle, dark mode, mobile breakpoint, Esc key handler. */
export function useSidebar() {
  const { dark, toggle: toggleDark } = useDarkMode()
  const { isMobile } = useBreakpoint()
  const sidebarCollapsed = ref(isMobile.value)

  watch(isMobile, (mobile) => {
    if (mobile) sidebarCollapsed.value = true
  })

  function onEscKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && isMobile.value && !sidebarCollapsed.value) {
      sidebarCollapsed.value = true
    }
  }

  return { sidebarCollapsed, dark, toggleDark, isMobile, onEscKey }
}
