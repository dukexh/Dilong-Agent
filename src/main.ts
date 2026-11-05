import { createApp, nextTick } from 'vue'
import { installPlugins } from './plugins'
import { initializeDevtools } from './plugins/devtools'
import App from './App.vue'
import router from './router'
import { initializeWorkflows, S } from './services/workflows'
import type { WorkflowAsset, TrendRecord } from './services/types'
import { merge, assetUrl } from './core/sample-library'
import baseSamples from './data/base-samples.json'
import publicCatalog from './data/public-catalog.json'
import trends from './data/trends.json'
import './assets/css/style.css'

const samples = merge(baseSamples as WorkflowAsset[], publicCatalog)
for (const sample of samples) { sample.imageUrl = assetUrl(sample.imageUrl); if (sample.thumbnailUrl) sample.thumbnailUrl = assetUrl(sample.thumbnailUrl) }
S.originalTrends = trends as TrendRecord[]
const pages = { home: '/', samples: '/samples', design: '/design', color: '/ink', production: '/production', trends: '/trends' }
S.navigate = async page => { await router.push(pages[page]); await nextTick() }
initializeWorkflows(samples)
installPlugins(createApp(App)).mount('#app')
void initializeDevtools()
