import type { RouteRecordRaw } from 'vue-router'
import { sidebarItems } from '../../data/sidebar'
const components = [
  () => import('../../pages/HomeView.vue'), () => import('../../pages/LibraryView.vue'),
  () => import('../../pages/DesignView.vue'), () => import('../../pages/InkView.vue'),
  () => import('../../pages/ProductionView.vue'), () => import('../../pages/TrendsView.vue'),
]
export const workspaceRoutes: RouteRecordRaw[] = [
  ...sidebarItems.map((item, index): RouteRecordRaw => ({ path: item.to, component: components[index]!, meta: { layout: 'default', title: item.title, subtitle: item.subtitle } })),
  { path: '/index.html', redirect: '/' },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]
