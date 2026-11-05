import type { App } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import router from '@/router'
import 'preline'
export function installPlugins(app: App) { return app.use(createPinia()).use(router).use(Antd) }
