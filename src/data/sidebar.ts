import { Home, Database, Sparkles, FlaskConical, Images, ChartColumn } from 'lucide-vue-next'
import type { WorkspaceSidebarItem } from '../types/sidebar'
export const sidebarItems: WorkspaceSidebarItem[] = [
  { to: '/', title: '平台首页', subtitle: '任务与资产总览', icon: Home },
  { to: '/samples', title: '样例库', subtitle: '历史样例数据中枢', icon: Database },
  { to: '/design', title: '设计智能体', subtitle: '比对、补全与生成', icon: Sparkles },
  { to: '/ink', title: '配墨智能体', subtitle: '分色、还原与配方', icon: FlaskConical },
  { to: '/production', title: '生产比对', subtitle: '设计与实物还原评估', icon: Images },
  { to: '/trends', title: '趋势洞察', subtitle: '市场风格与色彩趋势', icon: ChartColumn },
]
