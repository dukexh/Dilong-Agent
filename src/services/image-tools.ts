import { DesignImages } from '../core/design-images'
import { TEXTURE_VERSION, type TextureFeatures } from '../core/texture-search'
import { decodeTextureIndex, type TextureIndexManifest } from '../core/texture-index'
import { preflightExport, validateExport, type ExportSettings } from '../core/engineering-export'
import type { PixelImage, DesignOptions, DesignResult } from '../core/types'
import type { SeamlessDocument, EngineeringProject, UnitSnapshot } from '../core/seamless'
export type { UnitSnapshot } from '../core/seamless'
export type { EngineeringProject } from '../core/seamless'
import type { WorkflowAsset } from './types'

export interface ImageRegion { x: number; y: number; width: number; height: number; rotation: number }
export const fullRegion = (): ImageRegion => ({ x: 0, y: 0, width: 100, height: 100, rotation: 0 })
export interface TextureMatch { sample: WorkflowAsset; score: number }
export interface SeamlessResult extends DesignResult { document: SeamlessDocument; engineering: EngineeringProject }
export type SearchScope = 'all' | 'mine'
export interface TextureSearchOptions extends DesignOptions { scope?: SearchScope; publicIds?: string[] }
export const demoSearchUrl = () => import.meta.env.BASE_URL + 'texture-search/demo-wood033.png'
export const DEMO_SEARCH_NAME = '演示来样 · 木纹换色'

let publicFeatures: Map<string, TextureFeatures> | undefined
async function publicIndex(signal?: AbortSignal): Promise<Map<string, TextureFeatures>> {
  if (publicFeatures) return publicFeatures
  const response = await fetch(import.meta.env.BASE_URL + 'texture-search/manifest.json', { signal, cache: 'no-cache' })
  if (!response.ok) throw Error('公共纹理索引未就绪，请运行索引构建后重试，或切换“我的样例”')
  const manifest = await response.json() as TextureIndexManifest
  if (typeof manifest.file !== 'string' || !/^features-[a-f0-9]+\.bin$/.test(manifest.file)) throw Error('公共纹理索引地址无效')
  const binary = await fetch(import.meta.env.BASE_URL + 'texture-search/' + manifest.file, { signal })
  if (!binary.ok) throw Error('公共纹理索引加载失败，请重试')
  const decoded = decodeTextureIndex(manifest, await binary.arrayBuffer())
  checkCancelled(signal); publicFeatures = decoded; return decoded
}

export function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('任务已取消', 'AbortError') }
export function workerTask<T>(payload: unknown, signal?: AbortSignal): Promise<T> {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../core/image-worker.ts', import.meta.url), { type: 'module' })
    const clean = () => { worker.terminate(); signal?.removeEventListener('abort', abort) }
    const abort = () => { clean(); reject(new DOMException('任务已取消', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => { clean(); if (data.error) { const error = Error(data.error); error.name = data.name; reject(error) } else resolve(data.result as T) }
    worker.onerror = event => { const message = event.message || '图像计算模块加载失败，请刷新后重试'; clean(); reject(Error(message)) }
    try { worker.postMessage(payload) } catch (error) { clean(); reject(error) }
  })
}

export async function loadImage(src: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkCancelled(signal)
  return new Promise((resolve, reject) => {
    const image = new Image()
    const clean = () => signal?.removeEventListener('abort', abort)
    const abort = () => { clean(); image.onload = image.onerror = null; image.src = ''; reject(new DOMException('任务已取消', 'AbortError')) }
    signal?.addEventListener('abort', abort, { once: true })
    image.onload = () => { clean(); try { DesignImages.validateSize(image.naturalWidth, image.naturalHeight); resolve(image) } catch (error) { reject(error) } }
    image.onerror = () => { clean(); reject(Error('图片无法读取，请更换 PNG、JPG 或 WebP 文件')) }
    image.src = src
  })
}

export async function readPixels(src: string, region = fullRegion(), maxEdge = Infinity, signal?: AbortSignal): Promise<PixelImage> {
  const image = await loadImage(src, signal)
  checkCancelled(signal)
  if (![region.x, region.y, region.width, region.height, region.rotation].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 || region.x + region.width > 100.001 || region.y + region.height > 100.001 || ![0, 90, 180, 270].includes(region.rotation)) throw Error('裁剪范围或旋转角度无效')
  const x = Math.floor(image.naturalWidth * region.x / 100), y = Math.floor(image.naturalHeight * region.y / 100)
  const w = Math.max(1, Math.min(image.naturalWidth - x, Math.round(image.naturalWidth * region.width / 100)))
  const h = Math.max(1, Math.min(image.naturalHeight - y, Math.round(image.naturalHeight * region.height / 100)))
  const swap = region.rotation % 180 !== 0, nativeW = swap ? h : w, nativeH = swap ? w : h
  const scale = Math.min(1, maxEdge / Math.max(nativeW, nativeH)), canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(nativeW * scale)); canvas.height = Math.max(1, Math.round(nativeH * scale))
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw Error('浏览器无法分配图像内存，请缩小图片后重试')
    context.translate(canvas.width / 2, canvas.height / 2); context.rotate(region.rotation * Math.PI / 180)
    context.drawImage(image, x, y, w, h, -w * scale / 2, -h * scale / 2, w * scale, h * scale)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    if (!pixels.data.some((n, i) => i % 4 === 3 && n > 0)) throw Error('选区完全透明，没有有效图像')
    return { width: pixels.width, height: pixels.height, data: pixels.data }
  } finally { canvas.width = canvas.height = 0 }
}

export function pixelsUrl(image: PixelImage, maxEdge = Infinity): string {
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
  let preview: HTMLCanvasElement | undefined
  try {
    const context = canvas.getContext('2d'); if (!context) throw Error('无法创建图像')
    context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    let target = canvas
    if (Math.max(image.width, image.height) > maxEdge) {
      const ratio = maxEdge / Math.max(image.width, image.height); preview = document.createElement('canvas')
      preview.width = Math.max(1, Math.round(image.width * ratio)); preview.height = Math.max(1, Math.round(image.height * ratio))
      const small = preview.getContext('2d'); if (!small) throw Error('无法创建预览图'); small.drawImage(canvas, 0, 0, preview.width, preview.height); target = preview
    }
    const url = target.toDataURL('image/png'); if (!url.startsWith('data:image/png')) throw Error('图片编码失败，请缩小单元')
    return url
  } finally { canvas.width = canvas.height = 0; if (preview) preview.width = preview.height = 0 }
}

interface CachedFeatures { id: string; source: string; features: TextureFeatures }
const memory = new Map<string, CachedFeatures>()
const fingerprints = new WeakMap<WorkflowAsset, { url: string; value: string }>()
let cacheDb: Promise<IDBDatabase | null> | undefined
function featureDb(): Promise<IDBDatabase | null> {
  return cacheDb ||= new Promise(resolve => {
    try {
      const request = indexedDB.open('dilong-texture-cache', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('features', { keyPath: 'id' })
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); cacheDb = undefined }; resolve(request.result) }
      request.onerror = request.onblocked = () => { cacheDb = undefined; resolve(null) }
    } catch { cacheDb = undefined; resolve(null) }
  })
}
function fingerprint(value: string): string {
  let a = 2166136261, b = 5381
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i) }
  return `${value.length}:${a >>> 0}:${b >>> 0}:${TEXTURE_VERSION}`
}
async function cached(asset: WorkflowAsset, signal?: AbortSignal): Promise<TextureFeatures> {
  let known = fingerprints.get(asset)
  if (!known || known.url !== asset.imageUrl) { known = { url: asset.imageUrl, value: fingerprint(asset.imageUrl) }; fingerprints.set(asset, known) }
  const source = known.value, previous = memory.get(asset.id)
  if (previous?.source === source) return previous.features
  const database = await featureDb()
  const stored = database ? await new Promise<CachedFeatures | undefined>(resolve => {
    try { const request = database.transaction('features').objectStore('features').get(asset.id); request.onsuccess = () => resolve(request.result); request.onerror = () => resolve(undefined) } catch { resolve(undefined) }
  }) : undefined
  checkCancelled(signal)
  if (stored?.source === source && stored.features.version === TEXTURE_VERSION) { memory.set(asset.id, stored); return stored.features }
  const image = await readPixels(asset.imageUrl, fullRegion(), 256, signal)
  const features = await workerTask<TextureFeatures>({ kind: 'features', image }, signal), record = { id: asset.id, source, features }
  memory.set(asset.id, record)
  if (database) await new Promise<void>(resolve => {
    try { const tx = database.transaction('features', 'readwrite'); tx.objectStore('features').put(record); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => resolve() } catch { resolve() }
  })
  return features
}

export async function searchTextures(src: string, assets: WorkflowAsset[], region = fullRegion(), count = 5, options: TextureSearchOptions = {}): Promise<{ matches: TextureMatch[]; skipped: number }> {
  const unique = [...new Map(assets.map(asset => [asset.id, asset])).values()]
  const ids = new Set(unique.map(asset => asset.id)); for (const id of memory.keys()) if (!ids.has(id)) memory.delete(id)
  if (!unique.length) return { matches: [], skipped: 0 }
  const publicIds = new Set(options.publicIds || [])
  let indexed = new Map<string, TextureFeatures>()
  if (options.scope === 'all' && unique.some(a => publicIds.has(a.id))) {
    options.onProgress?.({ fraction: 0, phase: '加载公共图库结构索引' })
    indexed = await publicIndex(options.signal)
    if (unique.some(a => publicIds.has(a.id) && !indexed.has(a.id))) throw Error('公共图库与结构索引不一致，请重建索引')
  }
  options.onProgress?.({ fraction: 0, phase: '提取来样纹理结构' })
  const query = await workerTask<TextureFeatures>({ kind: 'features', image: await readPixels(src, region, 256, options.signal) }, options.signal)
  const targets: Array<{ id: string; features: TextureFeatures }> = []; let skipped = 0
  for (let i = 0; i < unique.length; i++) {
    if (i % 16 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    checkCancelled(options.signal)
    const sample = unique[i]
    options.onProgress?.({ fraction: .1 + .65 * (i + 1) / (unique.length + 1), phase: `准备纹理索引 ${i + 1}/${unique.length}` })
    try { targets.push({ id: sample.id, features: indexed.get(sample.id) || await cached(sample, options.signal) }) }
    catch (error) { if (options.signal?.aborted) throw error; skipped++ }
  }
  checkCancelled(options.signal)
  options.onProgress?.({ fraction: .8, phase: '按纹理结构排序' })
  const ranked = await workerTask<Array<{ id: string; score: number }>>({ kind: 'rank', query, targets }, options.signal)
  const lookup = new Map(unique.map(a => [a.id, a]))
  return { matches: ranked.slice(0, Math.max(1, Math.min(50, Math.trunc(count)))).map(row => ({ sample: lookup.get(row.id)!, score: row.score })), skipped }
}

export async function expandContinuousUnit(unit: UnitSnapshot, mode: string, options: DesignOptions = {}): Promise<DesignResult & { engineering: EngineeringProject }> {
  if (!['horizontal3', 'horizontal5', 'around'].includes(mode)) throw Error('不支持的连续扩展方式')
  const columns = mode === 'horizontal5' ? 5 : 3, rows = mode === 'around' ? 3 : 1
  options.onProgress?.({ fraction: .1, phase: '读取已确认连续单元' })
  const image = await readPixels(unit.url, fullRegion(), Infinity, options.signal)
  if (image.width !== unit.width || image.height !== unit.height) throw Error('单元快照尺寸不一致，请重新生成')
  options.onProgress?.({ fraction: .35, phase: '按单元周期铺排' })
  const result = await workerTask<PixelImage>({ kind: 'repeat', image, columns, rows }, options.signal)
  checkCancelled(options.signal); options.onProgress?.({ fraction: .85, phase: '编码完整扩展结果' })
  return { url: pixelsUrl(result), thumbnailUrl: pixelsUrl(result, 640), width: result.width, height: result.height,
    engineering: { ...unit.engineering, repeat: { columns, rows, unitWidth: unit.width, unitHeight: unit.height } } }
}

export async function createSeamless(src: string, overlap: number, lightBalance: boolean, region = fullRegion(), options: DesignOptions = {}): Promise<SeamlessResult> {
  options.onProgress?.({ fraction: .05, phase: '读取完整像素原图' })
  const image = await readPixels(src, region, Infinity, options.signal)
  if (image.width * image.height * 24 > 768 * 1024 * 1024) throw Error('四方连续预计超过内存预算，请裁剪更小的单元')
  options.onProgress?.({ fraction: .2, phase: '优化左右、上下接缝' })
  const document = await workerTask<SeamlessDocument>({ kind: 'seamless', image, overlap, lightBalance }, options.signal)
  checkCancelled(options.signal); options.onProgress?.({ fraction: .85, phase: '编码连续单元与修补图层' })
  const maskPixels = new Uint8ClampedArray(document.repairMask.length * 4)
  for (let i = 0; i < document.repairMask.length; i++) { const value = document.repairMask[i]; maskPixels[i * 4] = maskPixels[i * 4 + 1] = maskPixels[i * 4 + 2] = value; maskPixels[i * 4 + 3] = 255 }
  const engineering: EngineeringProject = { version: 'seamless-v1', overlap, lightBalance, baseUrl: pixelsUrl(document.base), maskUrl: pixelsUrl({ width: document.result.width, height: document.result.height, data: maskPixels }) }
  return { url: pixelsUrl(document.result), thumbnailUrl: pixelsUrl(document.result, 640), width: document.result.width, height: document.result.height, document, engineering }
}

let exporting = false
export async function inspectExport(src: string, settings: ExportSettings, project?: EngineeringProject, signal?: AbortSignal) {
  const image = await loadImage(src, signal)
  const width = image.naturalWidth, height = image.naturalHeight
  const bytes = preflightExport({width,height}, settings, settings.format === 'psd' && !!project)
  if (settings.format === 'psd' && project) {
    if (project.version !== 'seamless-v1') throw Error('不支持的工程版本')
    const repeat = project.repeat
    if (repeat && (![repeat.columns,repeat.rows,repeat.unitWidth,repeat.unitHeight].every(n=>Number.isSafeInteger(n)&&n>0) || repeat.unitWidth*repeat.columns!==width || repeat.unitHeight*repeat.rows!==height)) throw Error('工程铺排参数与图像尺寸不一致')
    for (const url of [project.baseUrl,project.maskUrl]) {
      const layer = await loadImage(url,signal)
      if(layer.naturalWidth!==(repeat?.unitWidth||width)||layer.naturalHeight!==(repeat?.unitHeight||height)) throw Error('保存的工程图层尺寸不一致，请重新生成连续单元')
    }
  }
  return {width,height,bytes}
}
export async function exportEngineering(src: string, settings: ExportSettings, project?: EngineeringProject, signal?: AbortSignal): Promise<Blob> {
  if (exporting) throw Error('另一项工程导出正在执行，请稍后重试')
  exporting = true
  try {
  const expected = await inspectExport(src,settings,project,signal)
  const image = await readPixels(src, fullRegion(), Infinity, signal)
  if(image.width!==expected.width||image.height!==expected.height) throw Error('图片尺寸发生变化，请重新导出')
  validateExport(image, settings, !!project)
  let document: SeamlessDocument | undefined
  if (settings.format === 'psd' && project?.version === 'seamless-v1') {
    let base = await readPixels(project.baseUrl, fullRegion(), Infinity, signal), mask = await readPixels(project.maskUrl, fullRegion(), Infinity, signal)
    if (project.repeat) {
      const { columns, rows, unitWidth, unitHeight } = project.repeat
      if (base.width !== unitWidth || base.height !== unitHeight || mask.width !== unitWidth || mask.height !== unitHeight || image.width !== unitWidth * columns || image.height !== unitHeight * rows) throw Error('工程铺排参数与图像尺寸不一致')
      base = await workerTask<PixelImage>({ kind: 'repeat', image: base, columns, rows }, signal)
      mask = await workerTask<PixelImage>({ kind: 'repeat', image: mask, columns, rows }, signal)
    }
    if (base.width !== image.width || base.height !== image.height || mask.width !== image.width || mask.height !== image.height) throw Error('保存的工程图层尺寸不一致，请重新生成连续单元')
    document = { version: 'seamless-v1', base, result: image, repairMask: Uint8Array.from({ length: image.width * image.height }, (_, i) => mask.data[i * 4]), overlap: project.overlap, lightBalance: project.lightBalance }
  }
  checkCancelled(signal)
  const bytes = await workerTask<Uint8Array<ArrayBuffer>>({ kind: 'export', image, ...settings, document }, signal)
  return new Blob([bytes], { type: settings.format === 'tif' ? 'image/tiff' : 'image/vnd.adobe.photoshop' })
  } finally { exporting = false }
}
