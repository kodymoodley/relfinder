<template>
  <Transition name="tip">
    <div v-if="visible" class="first-run-tip" role="status" aria-live="polite">
      <i class="pi pi-keyboard tip-icon" aria-hidden="true" />
      <span class="tip-text">Press <kbd>?</kbd> for keyboard shortcuts</span>
      <button class="tip-dismiss" aria-label="Dismiss tip" @click="dismiss">
        <i class="pi pi-times" aria-hidden="true" />
      </button>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const STORAGE_KEY = 'rf:shortcuts-tip-dismissed'
const visible = ref(localStorage.getItem(STORAGE_KEY) !== 'true')

function dismiss() {
  localStorage.setItem(STORAGE_KEY, 'true')
  visible.value = false
}
</script>

<style scoped>
.first-run-tip {
  position: absolute;
  bottom: calc(var(--rf-space-4) + 52px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--rf-space-3);
  padding: var(--rf-space-2) var(--rf-space-2) var(--rf-space-2) var(--rf-space-4);
  background: var(--rf-surface);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-full);
  box-shadow: var(--rf-shadow-md);
  white-space: nowrap;
  z-index: 6;
  pointer-events: auto;
}

.tip-icon {
  font-size: var(--rf-text-sm);
  color: var(--rf-primary);
}

.tip-text {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
}

.tip-text kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 var(--rf-space-1);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border-strong);
  border-bottom-width: 2px;
  border-radius: var(--rf-radius-sm);
  font-family: var(--rf-font-mono);
  font-size: var(--rf-text-xs);
  color: var(--rf-text);
  box-shadow: var(--rf-shadow-xs);
}

.tip-dismiss {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: none;
  border-radius: var(--rf-radius-full);
  color: var(--rf-text-subtle);
  cursor: pointer;
  font-size: 0.65rem;
  transition: background var(--rf-duration-fast) var(--rf-ease-out);
  flex-shrink: 0;
}

.tip-dismiss:hover {
  background: var(--rf-surface-raised);
  color: var(--rf-text);
}

.tip-enter-active {
  transition:
    opacity var(--rf-duration-base) var(--rf-ease-out),
    transform var(--rf-duration-base) var(--rf-ease-out);
}
.tip-leave-active {
  transition:
    opacity var(--rf-duration-fast) var(--rf-ease-out),
    transform var(--rf-duration-fast) var(--rf-ease-out);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
