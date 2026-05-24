<template>
  <Dialog
    v-model:visible="visible"
    header="Keyboard Shortcuts"
    modal
    :draggable="false"
    :style="{ width: '340px' }"
    class="shortcuts-dialog"
  >
    <div class="shortcuts-list">
      <div v-for="group in SHORTCUT_GROUPS" :key="group.label" class="shortcut-group">
        <p class="group-label">{{ group.label }}</p>
        <div v-for="s in group.shortcuts" :key="s.desc" class="shortcut-row">
          <div class="shortcut-keys">
            <kbd v-for="k in s.keys" :key="k" class="shortcut-key">{{ k }}</kbd>
          </div>
          <span class="shortcut-desc">{{ s.desc }}</span>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'

const visible = defineModel<boolean>('visible', { required: true })

const SHORTCUT_GROUPS = [
  {
    label: 'Viewport',
    shortcuts: [
      { keys: ['+', '='], desc: 'Zoom in' },
      { keys: ['-'], desc: 'Zoom out' },
      { keys: ['F'], desc: 'Fit graph to screen' },
      { keys: ['R'], desc: 'Re-run layout' },
      { keys: ['L'], desc: 'Toggle edge labels' },
    ],
  },
  {
    label: 'Help',
    shortcuts: [{ keys: ['?'], desc: 'Show this dialog' }],
  },
]
</script>

<style scoped>
.shortcuts-list {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-5);
  padding: var(--rf-space-5) var(--rf-space-6);
}


.shortcut-group {
  display: flex;
  flex-direction: column;
  gap: var(--rf-space-2);
}

.group-label {
  margin: 0 0 var(--rf-space-1);
  font-size: var(--rf-text-xs);
  font-weight: var(--rf-weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rf-text-subtle);
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rf-space-4);
}

.shortcut-keys {
  display: flex;
  gap: var(--rf-space-1);
  flex-shrink: 0;
}

.shortcut-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 22px;
  padding: 0 var(--rf-space-2);
  background: var(--rf-surface-raised);
  border: 1px solid var(--rf-border-strong);
  border-bottom-width: 2px;
  border-radius: var(--rf-radius-sm);
  font-family: var(--rf-font-mono);
  font-size: var(--rf-text-xs);
  font-style: normal;
  color: var(--rf-text);
  box-shadow: var(--rf-shadow-xs);
}

.shortcut-desc {
  font-size: var(--rf-text-sm);
  color: var(--rf-text-muted);
}
</style>

<style>
.shortcuts-dialog .p-dialog-header {
  padding-top: var(--rf-space-5);
  padding-left: var(--rf-space-6);
}
</style>
