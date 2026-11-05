import type { WorkflowAsset } from '../services/types'
import type { ImageSummary } from './types'
import { normalize } from './sample-metadata'

export interface PublicTexture {
  id: string; assetId: string; name: string; category: string; tags: string[]; source: string; sourceId: string
  imageUrl: string; thumbnailUrl: string; width: number; height: number; sourceUrl: string; license: string; licenseUrl: string; features: ImageSummary
}
export const categories = ['全部', '我的样例', '木纹', '橡木', '胡桃木', '其他木纹', '石纹', '织物 / 皮革', '涂层 / 混凝土']
export const group = (asset: Partial<WorkflowAsset>): string => asset.category || (asset.wood === '石纹' ? 'stone' : ['织物纹', '皮革纹'].includes(asset.wood || '') ? 'fabric' : asset.wood === '艺术涂层' ? 'coating' : /木|wood/i.test(asset.wood || '') ? 'wood' : 'other')
const material = (row: PublicTexture): string => row.category === 'wood' ? (/walnut/i.test(row.assetId) ? '胡桃木' : /oak/i.test(row.assetId) ? '橡木' : '木纹') : row.category === 'stone' ? '石纹' : row.category === 'fabric' ? (/leather/i.test(row.assetId) ? '皮革纹' : '织物纹') : '艺术涂层'
export function merge(base: WorkflowAsset[], records: PublicTexture[], metadata = { normalize }): WorkflowAsset[] {
  const ids = new Set(base.map(asset => asset.id)), assets = new Set(base.map(asset => asset.assetId)), sources = new Set<string>()
  const added: WorkflowAsset[] = []
  for (const row of records) {
    const key = row.source + ':' + row.sourceId
    if (ids.has(row.id) || sources.has(key) || (row.source === 'polyhaven' && assets.has(row.sourceId))) continue
    ids.add(row.id); sources.add(key)
    const wood = material(row), label = ({ wood: '木纹', stone: '石纹', fabric: '织物 / 皮革', coating: '涂层 / 混凝土' } as Record<string, string>)[row.category]
    const defaults = metadata.normalize({ name: label + ' · ' + row.name, wood, style: '未标注', tone: '未标注', source: '公共纹理 · ' + row.source })
    const rgb = row.features.averageRgb
    added.push({ ...defaults, ...row, name: defaults.name, wood, source: defaults.source, sourceName: row.source,
      schemaVersion: 1, recordKind: 'sample', isPublicTexture: true, status: '公共纹理', date: '', layers: null,
      analysis: { ...row.features, layerCount: null, averageHex: '#' + [rgb.r, rgb.g, rgb.b].map(value => value.toString(16).padStart(2, '0')).join(''), layers: [], algorithmVersion: '图像特征摘要', reconstructionDifference: null } })
  }
  return [...base, ...added]
}
export function filter(samples: WorkflowAsset[], query: string, category: string, mine: WorkflowAsset[] = []): WorkflowAsset[] {
  const owned = new Set(mine.map(asset => asset.id)), q = query.trim().toLocaleLowerCase()
  return samples.filter(asset => {
    const kind = group(asset), match = category === '全部' || category === '我的样例' && owned.has(asset.id) || category === '木纹' && kind === 'wood' || category === '其他木纹' && kind === 'wood' && !['橡木', '胡桃木'].includes(asset.wood) || category === '石纹' && kind === 'stone' || category === '织物 / 皮革' && kind === 'fabric' || category === '涂层 / 混凝土' && kind === 'coating' || ['橡木', '胡桃木'].includes(category) && asset.wood === category
    return match && (!q || [asset.id, asset.name, asset.assetId, asset.wood, asset.style, asset.tone, asset.source, ...(asset.tags || [])].join(' ').toLocaleLowerCase().includes(q))
  })
}
export function page(rows: WorkflowAsset[], value: number, size = 24) {
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.max(1, Math.min(value, pages))
  return { current, pages, rows: rows.slice((current - 1) * size, current * size) }
}
export function assetUrl(src: string): string {
  return /^(?:data:|blob:|https?:)/i.test(src) ? src : import.meta.env.BASE_URL + src.replace(/^\/+/, '')
}
