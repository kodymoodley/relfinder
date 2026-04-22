import { ref, watchEffect } from 'vue'

const STORAGE_KEY = 'rf-color-scheme'

// Module-level so all components share one instance
const dark = ref(
  localStorage.getItem(STORAGE_KEY) === 'dark' ||
  (!localStorage.getItem(STORAGE_KEY) && window.matchMedia('(prefers-color-scheme: dark)').matches),
)

watchEffect(() => {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem(STORAGE_KEY, dark.value ? 'dark' : 'light')
})

export function useDarkMode() {
  return {
    dark,
    toggle: () => { dark.value = !dark.value },
  }
}
