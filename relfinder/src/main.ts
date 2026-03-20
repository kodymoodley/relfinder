import './assets/main.css'
import 'primeicons/primeicons.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PrimeVue, {
  // Aura is PrimeVue's default design system — clean, neutral, easy to customise
  // via the `theme.options.cssLayer` and CSS variable overrides in main.css
  theme: {
    preset: Aura,
    options: {
      // Emit PrimeVue styles into a CSS layer so our own styles always win
      // without needing !important
      cssLayer: { name: 'primevue', order: 'primevue, app' },
      darkModeSelector: '.dark',
    },
  },
})

app.mount('#app')
