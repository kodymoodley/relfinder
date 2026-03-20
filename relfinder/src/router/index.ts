import { createRouter, createWebHistory } from 'vue-router'
import { useConnectionStore } from '@/stores/connection'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'connection',
      component: () => import('@/views/ConnectionView.vue'),
    },
    {
      path: '/graph',
      name: 'graph',
      component: () => import('@/views/GraphView.vue'),
      // Marked as requiring an active connection — guard enforces this below
      meta: { requiresConnection: true },
    },
  ],
})

/**
 * Navigation guard: redirect to the connection screen if the user tries to
 * access the graph view without an active source configured.
 */
router.beforeEach((to) => {
  if (to.meta.requiresConnection) {
    const connectionStore = useConnectionStore()
    if (!connectionStore.isConnected) {
      return { name: 'connection' }
    }
  }
})

export default router
