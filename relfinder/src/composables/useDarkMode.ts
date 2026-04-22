import { ref, watchEffect, type Ref } from 'vue'

const STORAGE_KEY = 'rf-color-scheme'

// Module-level singleton — all components share one reactive ref so toggling
// in the sidebar header immediately updates every consumer.
const dark = ref(
  localStorage.getItem(STORAGE_KEY) === 'dark' ||
    (!localStorage.getItem(STORAGE_KEY) &&
      window.matchMedia('(prefers-color-scheme: dark)').matches),
)

watchEffect(() => {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem(STORAGE_KEY, dark.value ? 'dark' : 'light')
})

/**
 * Returns the shared dark-mode state and a toggle function.
 *
 * `dark` is a module-level singleton ref, so calling this composable from
 * multiple components always refers to the same reactive value.
 */
export function useDarkMode(): { dark: Ref<boolean>; toggle: () => void } {
  return {
    dark,
    toggle: () => {
      dark.value = !dark.value
    },
  }
}
