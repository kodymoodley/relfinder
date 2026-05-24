import { onMounted, onUnmounted } from 'vue'

export interface CanvasShortcuts {
  zoomIn?: () => void
  zoomOut?: () => void
  fit?: () => void
  layout?: () => void
  toggleLabels?: () => void
  help?: () => void
}

function isInputFocused(): boolean {
  const el = document.activeElement
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  )
}

/**
 * Registers global keyboard shortcuts for graph canvas views.
 * All shortcuts are no-ops when an input element is focused.
 *
 * Keys:
 *   +/=   zoom in          -   zoom out
 *   f     fit to screen    r   re-run layout
 *   l     toggle labels    ?   show help modal
 */
export function useKeyboardShortcuts(actions: CanvasShortcuts): void {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (isInputFocused()) return

    switch (e.key) {
      case '+':
      case '=':
        actions.zoomIn?.()
        break
      case '-':
        actions.zoomOut?.()
        break
      case 'f':
      case 'F':
        actions.fit?.()
        break
      case 'r':
      case 'R':
        actions.layout?.()
        break
      case 'l':
      case 'L':
        actions.toggleLabels?.()
        break
      case '?':
        actions.help?.()
        break
    }
  }

  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
}
