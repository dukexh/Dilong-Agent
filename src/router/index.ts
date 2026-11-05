import { createRouter, createWebHistory } from 'vue-router'
import { workspaceRoutes } from './routes/workspace'
import { nextTick } from 'vue'
import 'preline'

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: workspaceRoutes, scrollBehavior: () => ({ top: 0 }) })
router.afterEach(async to => {
  document.title = String(to.meta.title || '工作台') + ' · 帝龙智能体'
  await nextTick()
  window.HSStaticMethods?.autoInit()
})
export default router
