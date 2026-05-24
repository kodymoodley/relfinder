<template>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <!-- RouterView fills the full viewport; each view manages its own layout -->
  <RouterView />
  <Toast position="bottom-right" />
</template>

<script setup lang="ts">
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
</script>
