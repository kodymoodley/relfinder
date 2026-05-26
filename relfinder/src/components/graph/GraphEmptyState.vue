<template>
  <div class="canvas-empty">
    <div class="empty-icon-wrap">
      <i class="pi pi-share-alt empty-icon" />
    </div>
    <p class="empty-title">No graph loaded</p>
    <p class="empty-hint">Select two entities and click <strong>Find Relationships</strong></p>
  </div>
</template>

<style scoped>
.canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--rf-space-4);
  color: var(--rf-text-muted);
  text-align: center;
  padding: var(--rf-space-8);
  pointer-events: none;
}

.empty-icon-wrap {
  width: 72px;
  height: 72px;
  border-radius: var(--rf-radius-full);
  background: var(--rf-primary-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--rf-space-2);
  position: relative;
}

@keyframes icon-ring-pulse {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(1.75);
    opacity: 0;
  }
}

.empty-icon-wrap::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--rf-radius-full);
  border: 2px solid var(--rf-primary);
  animation: icon-ring-pulse 2s ease-out infinite;
}

.empty-icon {
  font-size: 2rem;
  color: var(--rf-primary);
  opacity: 0.7;
}

.empty-title {
  margin: 0;
  font-family: var(--rf-font-display);
  font-size: var(--rf-text-md);
  font-weight: var(--rf-weight-semibold);
  color: var(--rf-text);
  letter-spacing: -0.01em;
}

.empty-hint {
  margin: 0;
  font-size: var(--rf-text-sm);
  max-width: 220px;
  line-height: var(--rf-leading-relaxed);
  color: var(--rf-text-muted);
}

.empty-hint strong {
  color: var(--rf-text);
  font-weight: var(--rf-weight-semibold);
}
</style>
