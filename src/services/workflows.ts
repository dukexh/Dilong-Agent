/** Local workflow service. IndexedDB names and record schemas remain compatible with v0.3. */
import { analyzeInk, analyzeSummary } from '../core/color-analysis'
import { DesignImages } from '../core/design-images'
import * as metadata from '../core/sample-metadata'
import type { InkLayer, InkRenderModel } from '../core/types'
import type {
  BeginDesignTaskRequest, CandidateStatus, DesignMode, DesignParameters, DesignRun, DesignRunOptions,
  DesignTask, DesignTaskStatus, HistoryStore, InkRecordStatus, InkRun, InkSettings, OperationState,
  OperationStatus, PackageRow, PageKey, RestorableInkRun, Revisioned, SampleMetadata, TaskInput,
  TrendRecord, TrendResearch, TrendTaskSource, WorkflowAsset, ZipFiles,
} from './types'

export type * from './types'
type StoreName = 'assets' | 'tasks' | 'inkRuns'
interface Collections { assets: WorkflowAsset[]; tasks: DesignTask[]; inkRuns: InkRun[] }
type DatabaseRecord = WorkflowAsset | DesignTask | InkRun
type TransactionRecords = Partial<Record<StoreName, DatabaseRecord[]>>
interface ConflictError extends Error { code: 'DATA_CONFLICT' }
const storeNames: StoreName[] = ['assets', 'tasks', 'inkRuns']
const candidateSources = ['相似检索', 'completion', 'twin', '示例推荐']
const savedMessage = '已将候选内容保存到样例库中'
const encoder = new TextEncoder(), decoder = new TextDecoder()
const candidateSaves = new Map<string, Promise<WorkflowAsset>>()
const unsavedInkRuns = new Map<string, InkRun>()
const inkConflicts = new Set<string>()
let dbPromise: Promise<IDBDatabase> | undefined
let channel: BroadcastChannel | null = null
let initialized = false
let taskOwner = ''
let ownerReady: Promise<void> = Promise.resolve()
let dataWrites: Promise<unknown> = Promise.resolve()

export const S = {
  assets: [] as WorkflowAsset[], tasks: [] as DesignTask[], inkRuns: [] as InkRun[], base: [] as WorkflowAsset[],
  operations: {} as Record<string, OperationStatus>, listeners: new Set<() => void>(),
  designRuns: new Map<string, DesignRun>(),
  deletedHistory: { tasks: new Set<string>(), inkRuns: new Set<string>() },
  designModeLabels: { compare: '相似检索', complete: '小样补全', twin: '风格迁移', generate: '示例候选推荐' } as Record<DesignMode, string>,
  statsSession: 0, statsView: null as string | null, statsTrigger: null as HTMLElement | null,
  activeTask: null as string | null, editingAssetId: null as string | null,
  editingAssetSnapshot: undefined as WorkflowAsset | undefined, editSession: 0,
  lastImportIds: [] as string[], packageOpen: false, savingCandidateKey: undefined as string | undefined,
  originalTrends: [] as TrendRecord[], inkRecordStatus: undefined as InkRecordStatus | undefined,
  ready: Promise.resolve(),
  navigate: (_page: PageKey): void | Promise<unknown> => {},
  analyze: analyzeSummary, analyzeFull: analyzeInk,
  status, subscribe, createId, startDesignRun, checkDesignCancelled, finishDesignRun,
  isCandidate, stats, showStats, closeStats, all, deleteAsset, confirmDelete, startEdit, closeEdit,
  updateAsset, librarySamples, showImported, save, updateTask, reviewCandidate, captureInkImage,
  canRestoreInkRun, recordInkRun, updateInkRunSettings, openInkRun, deleteHistory, beginDesignTask,
  createTask, openTask, open, recommend, layerDifference, zip, unzip, exportPackage, previewPackage,
  commitPackage, filterOriginal, emptyTrend, matchOriginal, researchOriginal,
  hasInkConflict: (runId: string): boolean => inkConflicts.has(runId),
  inkWarnings: (layers: InkLayer[]): string[] => {
    const warnings: string[] = []
    if (layers.some(layer => layer.share === 0)) warnings.push('检测到占比为0%的色层，请人工复核，不能据此确定印刷层数。')
    if (new Set(layers.map(layer => layer.hex)).size < layers.length) warnings.push('检测到重复色层，当前分析可能未充分区分纹理颜色。')
    return warnings
  },
  showPackage: (): void => { S.packageOpen = true; emit() },
}

function emit(): void { S.listeners.forEach(listener => listener()) }
function status(key: string, state: OperationState, message = ''): void { S.operations[key] = { state, message }; emit() }
function subscribe(listener: () => void): () => void { S.listeners.add(listener); return () => { S.listeners.delete(listener) } }
export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw Error('浏览器不支持安全随机数，请使用较新的 Chrome 或 Edge。')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}
function startDesignRun(key: string): DesignRunOptions {
  const controller = new AbortController(), run: DesignRun = { controller, fraction: 0, phase: '准备任务' }
  S.designRuns.set(key, run); emit()
  return { signal: controller.signal, onProgress: progress => {
    if (!controller.signal.aborted) { run.fraction = Math.max(run.fraction, Math.min(.99, progress.fraction)); run.phase = progress.phase; emit() }
  } }
}
function checkDesignCancelled(options: Pick<DesignRunOptions, 'signal'>): void {
  if (options.signal.aborted) throw new DOMException('已取消执行', 'AbortError')
}
function finishDesignRun(key: string): void { S.designRuns.delete(key); emit() }
function withDataWrite<T>(action: () => Promise<T>): Promise<T> {
  const pending = dataWrites.then(action); dataWrites = pending.catch(() => {}); return pending
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function isConflict(error: unknown): error is ConflictError { return metadata.isRecord(error) && error.code === 'DATA_CONFLICT' }
function conflict(deleted: boolean): ConflictError {
  return Object.assign(Error(deleted ? '该记录已在其他页面删除，不能保存旧内容。' : '该记录已在其他页面修改，请重新加载最新内容后核对。'), { code: 'DATA_CONFLICT' as const })
}
function revision(record: Revisioned | undefined): number { return record?._revision || 0 }
function chronological(a: Revisioned, b: Revisioned): number { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id) }
function candidateStatus(asset: WorkflowAsset): CandidateStatus { return asset.candidateReview?.status || 'pending' }
function isCandidate(asset: WorkflowAsset): boolean {
  return asset.recordKind === 'design-candidate' || (!asset.importedAt && (asset.status === '本地保存' || (asset.status !== '本地导入' && candidateSources.includes(asset.source))))
}
function resultStatus(resultIds: string[], assets = S.assets): DesignTaskStatus {
  return resultIds.some(key => assets.some(asset => asset.id === key && candidateStatus(asset) === 'pending')) ? '已保存候选' : '已评价'
}
function stats(): { assets: number; designTasks: number; pendingCandidates: number; inkRuns: number } {
  return { assets: S.all().length, designTasks: S.tasks.length, pendingCandidates: S.assets.filter(asset => S.isCandidate(asset) && candidateStatus(asset) === 'pending').length, inkRuns: S.inkRuns.length }
}
function showStats(kind: string, trigger: HTMLElement | null = null): void { S.statsSession++; S.statsView = kind; S.statsTrigger = trigger; emit() }
function closeStats(session?: number): void { if (session !== undefined && session !== S.statsSession) return; S.statsView = null; emit() }
function all(): WorkflowAsset[] { return [...S.base, ...S.assets] }

/** Call once at application startup. Repeated calls may replace the public catalog without reopening storage. */
export function initializeWorkflows(base: WorkflowAsset[]): Promise<void> {
  S.base = base
  if (initialized) { emit(); return S.ready }
  initialized = true
  taskOwner = createId()
  if (navigator.locks) ownerReady = new Promise<void>(resolve => {
    void navigator.locks.request('dilong-design-owner-' + taskOwner, () => { resolve(); return new Promise<void>(() => {}) }).catch(() => resolve())
  })
  try { channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('dilong-data-updates') : null } catch { channel = null }
  if (channel) channel.onmessage = () => { void refreshFromDatabase() }
  else window.addEventListener('focus', () => { void refreshFromDatabase() })
  S.ready = Promise.all([read('assets'), read('tasks'), read('inkRuns')]).then(async ([assets, tasks, inkRuns]) => {
    S.assets = assets.map(asset => S.isCandidate(asset) ? { ...asset, recordKind: 'design-candidate' } : asset)
    S.tasks = (await recoverTasks(tasks)).sort(chronological); S.inkRuns = inkRuns.sort(chronological); emit()
  }).catch(error => { S.status('storage', 'error', '本地数据读取失败：' + errorMessage(error)) })
  return S.ready
}
function db(): Promise<IDBDatabase> {
  return dbPromise ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('dilong-workflows', 2)
    request.onupgradeneeded = () => { for (const name of storeNames) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }) }
    request.onblocked = () => S.status('storage', 'error', '本地记录升级被旧标签页占用，请关闭本网站其他标签页后刷新。')
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); S.status('storage', 'ready'); resolve(request.result) }
    request.onerror = () => reject(request.error)
  }).catch(error => { dbPromise = undefined; throw error })
}
function notify(): void { try { channel?.postMessage('changed') } catch { /* Storage remains authoritative. */ } }
async function read<K extends StoreName>(store: K): Promise<Collections[K]> {
  const database = await db()
  return new Promise<Collections[K]>((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).getAll()
    request.onsuccess = () => resolve(request.result as Collections[K]); request.onerror = () => reject(request.error)
  })
}
async function write(store: StoreName, records: DatabaseRecord[]): Promise<void> { await writeLinked({ [store]: records }) }
/** Revision comparison and all related writes occur in the same transaction. */
async function writeLinked(records: TransactionRecords, checks: TransactionRecords = {}): Promise<void> {
  const database = await db(), names = storeNames.filter(name => records[name]?.length || checks[name]?.length)
  if (!names.length) return
  const committed: Array<[DatabaseRecord, number]> = []
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(names, 'readwrite'); let reason: unknown
    tx.oncomplete = () => { committed.forEach(([record, version]) => { record._revision = version }); notify(); resolve() }
    tx.onerror = () => reject(reason || tx.error)
    tx.onabort = () => { if (isConflict(reason)) void refreshFromDatabase(); reject(reason || tx.error || Error('保存事务取消')) }
    const check = (name: StoreName, record: DatabaseRecord, save: boolean): void => {
      const store = tx.objectStore(name), request = store.get(record.id)
      const expected = revision(record), mustExist = !save || record._revision !== undefined || S[name].some(item => item.id === record.id)
      request.onsuccess = () => {
        try {
          const current = request.result as DatabaseRecord | undefined
          if ((!current && mustExist) || (current && revision(current) !== expected)) { reason = conflict(!current); tx.abort(); return }
          if (save) { const version = revision(current) + 1; store.put({ ...record, _revision: version }); committed.push([record, version]) }
        } catch (error) { reason = error; tx.abort() }
      }
    }
    try { for (const name of names) { (checks[name] || []).forEach(record => check(name, record, false)); (records[name] || []).forEach(record => check(name, record, true)) } }
    catch (error) { reason = error; tx.abort() }
  })
}
async function recoverTasks(tasks: DesignTask[]): Promise<DesignTask[]> {
  await ownerReady
  const locks = navigator.locks ? await navigator.locks.query() : null
  const live = new Set((locks?.held || []).map(lock => lock.name)), changed: DesignTask[] = []
  const recovered = tasks.map((task): DesignTask => {
    if (task.status !== '处理中' || (task.ownerId && live.has('dilong-design-owner-' + task.ownerId))) return task
    const confirmed = !!locks && !!task.ownerId
    const next: DesignTask = { ...task, status: confirmed ? '已中断' : '状态待确认', error: confirmed ? '上次执行已停止，输入和已保存候选仍保留，可重新执行。' : '无法确认上次任务是否仍在其他窗口执行，请确认后再重试。', updatedAt: new Date().toISOString() }
    if (confirmed) changed.push(next)
    return next
  })
  if (changed.length) try { await write('tasks', changed) } catch (error) { if (isConflict(error)) return read('tasks'); throw error }
  return recovered
}
function refreshFromDatabase(): Promise<void> {
  return withDataWrite(async () => {
    await S.ready
    const database = await db()
    const latest = await new Promise<Collections>((resolve, reject) => {
      const tx = database.transaction(storeNames, 'readonly'), values = {} as Collections
      for (const name of storeNames) {
        const request = tx.objectStore(name).getAll()
        request.onsuccess = () => { Object.assign(values, { [name]: request.result }) }
      }
      tx.oncomplete = () => resolve(values); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
    })
    const previous = S.assets
    for (const name of ['tasks', 'inkRuns'] as const) for (const old of S[name]) {
      const current = latest[name].find(item => item.id === old.id)
      if (!current) { S.deletedHistory[name].add(old.id); if (name === 'inkRuns') unsavedInkRuns.delete(old.id) }
      else if (name === 'inkRuns' && revision(current) !== revision(old)) inkConflicts.add(old.id)
    }
    S.assets = latest.assets.sort(chronological); S.tasks = latest.tasks.sort(chronological); S.inkRuns = latest.inkRuns.sort(chronological); emit()
    for (const old of previous) if (!S.assets.some(item => item.id === old.id)) dispatchAsset('dilong-asset-deleted', old)
    for (const asset of S.assets) if (revision(asset) !== revision(previous.find(item => item.id === asset.id))) dispatchAsset('dilong-asset-updated', asset)
  }).catch(error => { S.status('sync', 'error', '同步失败：' + errorMessage(error)) })
}
function dispatchAsset(name: 'dilong-asset-updated' | 'dilong-asset-deleted', asset: WorkflowAsset): void { window.dispatchEvent(new CustomEvent(name, { detail: { asset } })) }

async function deleteAsset(assetId: string): Promise<void> {
  return withDataWrite(async () => {
    await S.ready
    const asset = S.assets.find(item => item.id === assetId)
    if (!asset) throw Error('只能删除自己导入或保存的样例。')
    S.status('delete', 'busy')
    try {
      let changed: DesignTask[] = []
      const database = await db()
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['assets', 'tasks'], 'readwrite'); let reason: unknown
        tx.oncomplete = () => { notify(); resolve() }; tx.onerror = () => reject(reason || tx.error)
        tx.onabort = () => { if (isConflict(reason)) void refreshFromDatabase(); reject(reason || tx.error || Error('删除事务取消')) }
        const request = tx.objectStore('assets').get(assetId)
        request.onsuccess = () => {
          try {
            const current = request.result as WorkflowAsset | undefined
            if (!current || revision(current) !== revision(asset)) { reason = conflict(!current); tx.abort(); return }
            const tasks = tx.objectStore('tasks').getAll()
            tasks.onsuccess = () => {
              try {
                changed = (tasks.result as DesignTask[]).filter(task => task.sampleId === assetId || (task.resultIds || []).includes(assetId)).map(task => {
                  const resultIds = (task.resultIds || []).filter(key => key !== assetId)
                  const nextStatus = task.sampleId === assetId ? '源样例已删除' : ['已保存候选', '已评价'].includes(task.status) ? (resultIds.length ? resultStatus(resultIds) : '已处理') : task.status
                  return { ...task, resultIds, status: nextStatus, _revision: revision(task) + 1, updatedAt: new Date().toISOString() }
                })
                tx.objectStore('assets').delete(assetId); changed.forEach(task => tx.objectStore('tasks').put(task))
              } catch (error) { reason = error; tx.abort() }
            }
          } catch (error) { reason = error; tx.abort() }
        }
      })
      S.assets = S.assets.filter(item => item.id !== assetId); S.tasks = S.tasks.map(task => changed.find(next => next.id === task.id) || task)
      S.lastImportIds = S.lastImportIds.filter(key => key !== assetId)
      if (S.editingAssetId === assetId) S.editingAssetId = null
      if (S.tasks.some(task => task.id === S.activeTask && task.sampleId === assetId)) S.activeTask = null
      S.status('delete', 'ready', '样例已删除'); dispatchAsset('dilong-asset-deleted', asset)
    } catch (error) { S.status('delete', 'error', '删除失败：' + errorMessage(error)); throw error }
  })
}
async function confirmDelete(asset: WorkflowAsset): Promise<void> {
  if (S.operations.delete?.state === 'busy' || !S.assets.some(item => item.id === asset.id)) return
  if (!window.confirm('确定删除“' + asset.name + '”（' + asset.id + '）？\n这会从当前浏览器的样例库移除该图片与分析数据，关联任务将更新。已导出的 ZIP 文件不受影响。')) return
  try { await S.deleteAsset(asset.id) } catch { /* Operation state displays the failure. */ }
}
function startEdit(asset: WorkflowAsset): void { if (!S.assets.some(item => item.id === asset.id)) return; S.editingAssetId = asset.id; S.editingAssetSnapshot = asset; S.editSession++; emit() }
function closeEdit(): void { if (S.operations.edit?.state === 'busy') return; S.editingAssetId = null; S.status('edit', 'ready') }
function updateAsset(assetId: string, patch: Partial<SampleMetadata>, baseline?: WorkflowAsset): Promise<WorkflowAsset> {
  return withDataWrite(async () => {
    await S.ready
    const previous = baseline || S.assets.find(asset => asset.id === assetId)
    if (!previous) throw Error('只能编辑自己导入或保存的样例。')
    S.status('edit', 'busy')
    try {
      const info = metadata.normalize({ ...previous, ...patch }), now = new Date()
      const next: WorkflowAsset = { ...previous, ...info, updatedAt: now.toISOString(), history: [...info.history, { date: now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), title: '样例信息更新', description: '用户补充或修改样例资料。', status: '已保存' }] }
      await write('assets', [next]); S.assets = S.assets.map(asset => asset.id === assetId ? next : asset)
      S.status('edit', 'ready', '样例信息已保存'); dispatchAsset('dilong-asset-updated', next); return next
    } catch (error) { S.status('edit', 'error', '保存失败：' + errorMessage(error)); throw error }
  })
}
function librarySamples(samples: WorkflowAsset[]): WorkflowAsset[] {
  const mine = new Set(S.assets.map(asset => asset.id))
  return [...samples].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || (mine.has(a.id) && mine.has(b.id) ? String(b.importedAt || b.createdAt || b.date || '').localeCompare(String(a.importedAt || a.createdAt || a.date || '')) : 0))
}
async function showImported(ids: string[]): Promise<void> {
  S.packageOpen = false; emit(); await S.navigate('samples')
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('dilong-library-imported', { detail: { ids } }))))
}

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(Error('图片损坏或无法读取')); element.src = url })
}
function imagePNG(element: HTMLImageElement, maxEdge = Infinity): string {
  const scale = Math.min(1, maxEdge / Math.max(element.naturalWidth, element.naturalHeight)), canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(element.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(element.naturalHeight * scale))
  try {
    const context = canvas.getContext('2d')
    if (!context) throw Error('无法读取图片')
    context.drawImage(element, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/png')
    if (!url.startsWith('data:image/png')) throw Error('浏览器无法保存这张图片，请使用尺寸更小的图片。')
    return url
  } finally { canvas.width = 0; canvas.height = 0 }
}
async function dataURL(source: string | HTMLImageElement): Promise<string> { return imagePNG(typeof source === 'string' ? await image(source) : source) }
async function pngBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const png = /^data:image\/png;base64,/i.test(url) ? url : await dataURL(url)
  const bytes = new Uint8Array(await (await fetch(png)).arrayBuffer())
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) throw Error('图片损坏或无法读取')
  return bytes
}
async function analyzedRecord(input: Partial<WorkflowAsset> & { id: string; name: string }, url: string): Promise<WorkflowAsset> {
  const element = await image(url), summary = await S.analyze(element), result = S.analyzeFull(element)
  if (!result) throw Error('图片没有可分析的有效颜色')
  const { r, g, b } = summary.averageRgb
  let thumbnailUrl = url
  if (Math.max(element.naturalWidth, element.naturalHeight) > 640) try { thumbnailUrl = await DesignImages.thumbnail(element) }
  catch { /* A preview failure must not prevent saving the validated original. */ }
  return {
    ...input, ...metadata.normalize(input), schemaVersion: 1, imageUrl: url, thumbnailUrl, layers: result.layers.length,
    sourceUrl: '', license: '用户提供', date: new Date().toISOString().slice(0, 10),
    analysis: { ...summary, algorithmVersion: 'dilong-color-v0.3', analysedAt: new Date().toISOString(), layerCount: result.layers.length,
      averageHex: '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join(''), reconstructionDifference: result.difference,
      layers: result.layers.map((layer, index) => ({ order: index + 1, name: layer.name, hex: layer.hex, rgb: layer.rgb, coverage: layer.share, recipe: layer.recipe })),
    },
  }
}
function persistCandidate(sample: WorkflowAsset, taskId: string | null | undefined, isNew: boolean): Promise<WorkflowAsset> {
  return withDataWrite(async () => {
    const task = S.tasks.find(item => item.id === taskId), resultIds = task ? [...new Set([...(task.resultIds || []), sample.id])] : []
    const assets = isNew ? [...S.assets, sample] : S.assets
    const nextTask: DesignTask | null = task ? { ...task, resultIds, status: resultStatus(resultIds, assets), updatedAt: new Date().toISOString() } : null
    await writeLinked({ assets: isNew ? [sample] : [], tasks: nextTask ? [nextTask] : [] }, isNew ? {} : { assets: [sample] })
    if (isNew) S.assets.push(sample)
    if (nextTask) S.tasks = S.tasks.map(item => item.id === taskId ? nextTask : item)
    emit(); return sample
  })
}
function save(src: string | HTMLImageElement, name: string, source: string, parameters: DesignParameters = {}, sourceKey?: string, taskId: string | null | undefined = S.activeTask): Promise<WorkflowAsset> {
  const existing = sourceKey ? candidateSaves.get(sourceKey) : undefined
  if (existing) return existing.then(async sample => {
    if (!taskId || S.tasks.find(task => task.id === taskId)?.resultIds?.includes(sample.id)) return sample
    S.status('save', 'busy')
    try { await persistCandidate(sample, taskId, false); S.status('save', 'ready', savedMessage); return sample }
    catch (error) { S.status('save', 'error', '关联失败：' + errorMessage(error)); throw error }
  })
  const pending = (async (): Promise<WorkflowAsset> => {
    S.savingCandidateKey = sourceKey; S.status('save', 'busy')
    try {
      await S.ready
      const old = S.assets.find(asset => sourceKey && asset.sourceKey === sourceKey)
      if (old) { await persistCandidate(old, taskId, false); S.status('save', 'ready', savedMessage); return old }
      const url = await dataURL(src)
      const sample = await analyzedRecord({ id: 'LOCAL-' + createId(), schemaVersion: 1, name, source, sourceKey,
        wood: parameters.wood || '自建样例', style: parameters.style || '本地设计', tone: parameters.tone || '自定义',
        customer: '未填写', orderNo: '未填写', status: '本地保存', recordKind: 'design-candidate', candidateReview: { status: 'pending' }, parameters, createdAt: new Date().toISOString(),
      }, url)
      await persistCandidate(sample, taskId, true); S.status('save', 'ready', savedMessage); return sample
    } catch (error) { S.status('save', 'error', '保存失败：' + errorMessage(error)); throw error }
  })()
  if (sourceKey) candidateSaves.set(sourceKey, pending)
  return pending.finally(() => { if (sourceKey) candidateSaves.delete(sourceKey) })
}
function updateTask(taskId: string, patch: Partial<DesignTask>): Promise<void> {
  return withDataWrite(async () => {
    const old = S.tasks.find(task => task.id === taskId)
    if (!old) return
    const next = { ...old, ...patch, updatedAt: new Date().toISOString() }
    await write('tasks', [next]); S.tasks = S.tasks.map(task => task.id === taskId ? next : task); emit()
  })
}
function reviewCandidate(assetId: string, reviewStatus: CandidateStatus): Promise<WorkflowAsset> {
  return withDataWrite(async () => {
    if (!['pending', 'accepted', 'adjust', 'rejected'].includes(reviewStatus)) throw Error('请选择有效的评价状态')
    const old = S.assets.find(asset => asset.id === assetId)
    if (!old || !S.isCandidate(old)) throw Error('只能评价自己保存的设计候选')
    S.status('review', 'busy')
    try {
      const now = new Date().toISOString(), next: WorkflowAsset = { ...old, recordKind: 'design-candidate', candidateReview: { status: reviewStatus, updatedAt: now }, updatedAt: now }
      const assets = S.assets.map(asset => asset.id === assetId ? next : asset)
      const tasks: DesignTask[] = S.tasks.filter(task => (task.resultIds || []).includes(assetId)).map(task => ({ ...task, status: task.status === '源样例已删除' ? task.status : resultStatus(task.resultIds, assets), updatedAt: now }))
      await writeLinked({ assets: [next], tasks }); S.assets = assets; S.tasks = S.tasks.map(task => tasks.find(item => item.id === task.id) || task)
      S.status('review', 'ready'); dispatchAsset('dilong-asset-updated', next); return next
    } catch (error) { S.status('review', 'error', '评价保存失败：' + errorMessage(error)); throw error }
  })
}
function setInkRecordStatus(id: string, state: OperationState, message = ''): void { S.inkRecordStatus = { id, state, message }; S.status('ink-record', state, message) }
async function persistInkRun(next: InkRun): Promise<void> {
  setInkRecordStatus(next.id, 'busy')
  try {
    await write('inkRuns', [next]); S.inkRuns = S.inkRuns.some(run => run.id === next.id) ? S.inkRuns.map(run => run.id === next.id ? next : run) : [...S.inkRuns, next]
    unsavedInkRuns.delete(next.id); setInkRecordStatus(next.id, 'ready')
  } catch (error) {
    if (isConflict(error)) inkConflicts.add(next.id); else unsavedInkRuns.set(next.id, next)
    setInkRecordStatus(next.id, 'error', '配墨记录保存失败：' + errorMessage(error)); throw error
  }
}
function captureInkImage(element: HTMLImageElement): string { return imagePNG(element) }
function canRestoreInkRun(run: InkRun | undefined): run is RestorableInkRun {
  const snapshot = run?.snapshot, model = snapshot?.renderModel
  return !!(snapshot?.version === 1 && typeof snapshot.imageUrl === 'string' && snapshot.imageUrl.startsWith('data:image/') && snapshot.layers?.length > 0 && model && model.width > 0 && model.height > 0 && model.assignments?.length === model.width * model.height && model.original?.length === model.width * model.height * 4 && model.colours?.length === snapshot.layers.length)
}
function recordInkRun(record: InkRun): Promise<void> {
  return withDataWrite(async () => {
    await S.ready
    if (S.inkRuns.some(run => run.id === record.id)) return
    const next = { ...record, schemaVersion: record.snapshot ? 2 : 1, createdAt: record.createdAt || new Date().toISOString() }
    await persistInkRun(next)
  })
}
function updateInkRunSettings(runId: string, settings: InkSettings): Promise<void> {
  return withDataWrite(async () => {
    await S.ready
    if (S.deletedHistory.inkRuns.has(runId)) return
    if (inkConflicts.has(runId)) { setInkRecordStatus(runId, 'error', '此记录已在其他页面修改，请重新加载最新记录后再调整。'); return }
    const old = unsavedInkRuns.get(runId) || S.inkRuns.find(run => run.id === runId)
    if (!S.canRestoreInkRun(old)) return
    if (!unsavedInkRuns.has(runId) && JSON.stringify(old.snapshot.settings) === JSON.stringify(settings)) return
    const next: InkRun = { ...old, updatedAt: new Date().toISOString(), difference: S.layerDifference(old.snapshot.renderModel, settings.enabled), snapshot: { ...old.snapshot, settings: structuredClone(settings) } }
    await persistInkRun(next)
  })
}
async function openInkRun(record: InkRun): Promise<void> {
  await dataWrites
  const run = S.inkRuns.find(item => item.id === record.id)
  if (!S.canRestoreInkRun(run)) { S.status('ink-restore', 'error', '此旧记录没有完整快照，无法恢复当次配墨；可选择来源样例重新分析。'); return }
  inkConflicts.delete(run.id); unsavedInkRuns.delete(run.id); S.status('ink-restore', 'ready'); await S.navigate('color')
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('dilong-ink-open', { detail: { run: structuredClone(run) } }))))
}
function deleteHistory(store: HistoryStore, ids: string[]): Promise<number> {
  return withDataWrite(async () => {
    await S.ready
    if (!['tasks', 'inkRuns'].includes(store)) throw Error('不支持清理此类记录')
    const keys = [...new Set(ids)]
    if (!keys.length) return 0
    S.status('history-delete', 'busy')
    try {
      const database = await db()
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(store, 'readwrite'), records = tx.objectStore(store); let reason: unknown
        tx.oncomplete = () => { notify(); resolve() }; tx.onerror = () => reject(reason || tx.error)
        tx.onabort = () => { if (isConflict(reason)) void refreshFromDatabase(); reject(reason || tx.error || Error('清理事务取消')) }
        const request = records.getAll()
        request.onsuccess = () => {
          const currentRecords = request.result as Array<DesignTask | InkRun>
          if (store === 'tasks' && (currentRecords as DesignTask[]).some(record => keys.includes(record.id) && (record.status === '处理中' || record.status === '状态待确认'))) {
            reason = Error('包含正在执行或运行状态未确认的任务，请先取消或确认任务结束后再清理。'); tx.abort(); return
          }
          try {
            for (const current of currentRecords.filter(record => keys.includes(record.id))) { const expected = S[store].find(record => record.id === current.id); if (!expected || revision(expected) !== revision(current)) throw conflict(false) }
            keys.forEach(key => records.delete(key))
          } catch (error) { reason = error; tx.abort() }
        }
      })
      if (store === 'tasks') S.tasks = S.tasks.filter(record => !keys.includes(record.id)); else S.inkRuns = S.inkRuns.filter(record => !keys.includes(record.id))
      keys.forEach(key => { S.deletedHistory[store].add(key); if (store === 'inkRuns') unsavedInkRuns.delete(key) })
      if (store === 'tasks' && S.activeTask && keys.includes(S.activeTask)) S.activeTask = null
      S.status('history-delete', 'ready', '已删除 ' + keys.length + ' 条记录'); return keys.length
    } catch (error) { S.status('history-delete', 'error', '清理失败：' + errorMessage(error)); throw error }
  })
}
function describeConditions(mode: DesignMode, parameters: DesignParameters): string {
  const sorting: Record<string, string> = { balanced: '综合色彩与纹理', texture: '优先纹理', color: '优先色彩' }
  const completion: Record<string, string> = { horizontal3: '横向扩展3倍', horizontal5: '横向扩展5倍', around: '四周扩展' }
  const styles: Record<string, string> = { smoked: '烟熏胡桃', warmGrey: '暖灰中古', lightNatural: '浅米自然', redBrown: '红棕复古' }
  if (mode === 'compare') return sorting[parameters.sorting || 'balanced'] + '；返回 ' + parameters.limit + ' 条'
  if (mode === 'complete') return completion[parameters.completion || 'horizontal3']
  if (mode === 'twin') return styles[parameters.style || 'smoked'] + '；强度 ' + parameters.strength + '%'
  return parameters.direction || ''
}
async function beginDesignTask(request: BeginDesignTaskRequest): Promise<DesignTask> {
  await S.ready
  const input: TaskInput = request.input.kind === 'upload' ? { kind: 'upload', name: request.input.name, imageUrl: await dataURL(request.input.src), summary: request.input.summary } : { kind: 'library', sampleId: request.input.sampleId, name: request.input.name }
  if (input.kind === 'library' && !S.all().some(asset => asset.id === input.sampleId)) throw Error('任务输入样例已不存在，请重新选择')
  return withDataWrite(async () => {
    const previous = S.tasks.find(task => task.id === request.taskId), reuse = previous && ['待处理', '执行失败', '已中断', '状态待确认', '已取消'].includes(previous.status), now = new Date().toISOString()
    const next: DesignTask = { ...(reuse ? previous : {}), schemaVersion: 2, id: reuse ? previous.id : createId(), source: reuse ? previous.source : '设计智能体', sourceId: reuse ? previous.sourceId : 'design-' + request.runKey,
      sampleId: input.kind === 'library' ? input.sampleId : null, title: reuse ? previous.title : input.name + ' · ' + S.designModeLabels[request.mode], mode: request.mode, input, parameters: request.parameters,
      conditions: describeConditions(request.mode, request.parameters), status: '处理中', resultIds: reuse ? (previous.resultIds || []) : [], attempts: (reuse ? previous.attempts || 0 : 0) + 1,
      createdAt: reuse ? previous.createdAt : now, updatedAt: now, runKey: request.runKey, error: '', ownerId: taskOwner,
    }
    await write('tasks', [next]); S.tasks = S.tasks.some(task => task.id === next.id) ? S.tasks.map(task => task.id === next.id ? next : task) : [...S.tasks, next]
    S.status('task', 'ready'); return next
  })
}
function createTask(record: TrendTaskSource, sample: WorkflowAsset): Promise<DesignTask> {
  return withDataWrite(async () => {
    await S.ready
    let task = S.tasks.find(item => item.sourceId === record.id && item.sampleId === sample.id)
    if (!task) {
      task = { schemaVersion: 1, id: createId(), source: '演示趋势资料', sourceId: record.id, sampleId: sample.id, title: record.title, conditions: record.keywords.join('，'), status: '待处理', resultIds: [], createdAt: new Date().toISOString() }
      await write('tasks', [task]); S.tasks.push(task); emit()
    }
    S.openTask(task); return task
  })
}
function openTask(task: DesignTask): void {
  let sample: WorkflowAsset | undefined = task.input?.kind === 'upload' ? {
    ...(S.base[0] || { wood: '自建样例', style: '本地设计', tone: '自定义', source: '用户上传' }), id: 'UPLOAD-' + task.id, name: task.input.name, imageUrl: task.input.imageUrl,
    analysis: { ...S.base[0]?.analysis, ...task.input.summary },
  } : S.all().find(asset => asset.id === task.sampleId)
  const missing = !sample
  if (!sample) sample = { id: task.sampleId || 'missing-source', name: task.input?.name || '源样例已删除', imageUrl: '', missing: true, wood: '未记录', style: '未记录', tone: '未记录', source: '未记录', analysis: { averageRgb: { r: 0, g: 0, b: 0 }, brightness: 0, textureDensity: 0 } }
  S.status('task', 'ready'); S.activeTask = task.id
  if (!missing && task.status === '源样例已删除') void S.updateTask(task.id, { status: '待处理' }).catch(error => S.status('task', 'error', errorMessage(error)))
  void S.open('design', sample, task).catch(error => S.status('task', 'error', errorMessage(error)))
}
async function open(page: PageKey, sample: WorkflowAsset, task?: DesignTask): Promise<void> {
  if (page === 'design') S.activeTask = task?.id || null
  await S.navigate(page)
  requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('dilong-open', { detail: { page, sample, task } }))))
}
function recommend(query: string, count: number, samples = S.all()): WorkflowAsset[] {
  const groups = [['橡木', '橡木'], ['胡桃', '胡桃'], ['木纹', '木'], ['石纹', '石'], ['大理石', '石'], ['织物', '织物'], ['皮革', '皮革'], ['浅色', '浅'], ['浅灰', '灰'], ['黑色', '黑'], ['暖灰', '灰'], ['灰色', '灰'], ['自然', '自然'], ['现代', '现代'], ['深色', '深'], ['米色', '米'], ['红棕', '棕']]
  const terms = [...new Set(groups.filter(([term]) => query.includes(term)).map(([, term]) => term))]
  if (!terms.length) return []
  return samples.filter(asset => terms.every(term => `${asset.name} ${asset.wood} ${asset.style} ${asset.tone}`.includes(term))).slice(0, count)
}
function layerDifference(model: InkRenderModel | null | undefined, enabled: boolean[]): number {
  if (!model?.original) return 0
  let sum = 0, count = 0
  for (let index = 0; index < model.assignments.length; index++) {
    if (model.original[index * 4 + 3] <= (model.alphaThreshold ?? 220)) continue
    count++
    let layer = model.assignments[index]; while (layer >= 0 && !enabled[layer]) layer--
    const rgb = layer < 0 ? { r: 255, g: 255, b: 255 } : model.colours[layer]
    sum += Math.hypot(model.original[index * 4] - rgb.r, model.original[index * 4 + 1] - rgb.g, model.original[index * 4 + 2] - rgb.b) / Math.sqrt(3)
  }
  return count ? Math.round(sum / count * 100) / 100 : 0
}

function crc(bytes: Uint8Array): number {
  let value = -1
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)) }
  return (value ^ -1) >>> 0
}
function header(size: number, fields: Array<[number, number, number]>): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer)
  fields.forEach(([position, length, value]) => length === 2 ? view.setUint16(position, value, true) : view.setUint32(position, value, true))
  return bytes
}
function zip(files: ZipFiles): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [], central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0, total = 0
  for (const [name, bytes] of files) {
    const encoded = encoder.encode(name), checksum = crc(bytes)
    const local = header(30, [[0, 4, 0x04034b50], [4, 2, 20], [6, 2, 0x800], [14, 4, checksum], [18, 4, bytes.length], [22, 4, bytes.length], [26, 2, encoded.length]])
    parts.push(local, encoded, bytes)
    const entry = header(46, [[0, 4, 0x02014b50], [4, 2, 20], [6, 2, 20], [8, 2, 0x800], [16, 4, checksum], [20, 4, bytes.length], [24, 4, bytes.length], [28, 2, encoded.length], [42, 4, offset]])
    central.push(entry, encoded); total += entry.length + encoded.length; offset += local.length + encoded.length + bytes.length
  }
  return new Blob([...parts, ...central, header(22, [[0, 4, 0x06054b50], [8, 2, files.length], [10, 2, files.length], [12, 4, total], [16, 4, offset]])], { type: 'application/zip' })
}
async function unzip(buffer: ArrayBuffer): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer), files = new Map<string, Uint8Array<ArrayBuffer>>()
  let end = bytes.length - 22
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0 || end < Math.max(0, bytes.length - 65557)) throw Error('不是有效的 ZIP 文件')
  let position = view.getUint32(end + 16, true), size = 0
  const count = view.getUint16(end + 10, true)
  for (let index = 0; index < count; index++) {
    if (view.getUint32(position, true) !== 0x02014b50) throw Error('ZIP 目录损坏')
    const method = view.getUint16(position + 10, true), packed = view.getUint32(position + 20, true), length = view.getUint32(position + 24, true)
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true), offset = view.getUint32(position + 42, true)
    size += length
    if (size > 150 * 1024 * 1024) throw Error('解压内容超过150MB')
    const name = decoder.decode(bytes.slice(position + 46, position + 46 + nameLength))
    if (files.has(name)) throw Error('ZIP 包含重复路径')
    if (view.getUint16(position + 8, true) & 1) throw Error('不支持加密 ZIP')
    if (view.getUint32(offset, true) !== 0x04034b50) throw Error('ZIP 图片条目损坏')
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
    let content = bytes.slice(start, start + packed)
    if (method === 8) content = new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
    else if (method !== 0) throw Error('不支持该 ZIP 压缩方式')
    if (content.length !== length || crc(content) !== view.getUint32(position + 16, true)) throw Error('文件校验失败：' + name)
    files.set(name, content); position += 46 + nameLength + extraLength + commentLength
  }
  return files
}
function download(blob: Blob, name: string): void {
  const anchor = document.createElement('a'), url = URL.createObjectURL(blob)
  anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function exportPackage(): Promise<void> {
  S.status('package', 'busy')
  try {
    const samples = S.assets, files: ZipFiles = [], records: Array<SampleMetadata & { id: string; image: string }> = []
    if (!samples.length) throw Error('暂无本地样例，请先保存或导入样例。')
    for (const [index, sample] of samples.entries()) {
      const path = `images/${index}.png`, bytes = await pngBytes(sample.imageUrl)
      files.push([path, bytes]); records.push({ id: sample.id, ...metadata.normalize(sample), image: path })
    }
    files.unshift(['manifest.json', encoder.encode(JSON.stringify({ schemaVersion: 1, samples: records }, null, 2))])
    download(S.zip(files), '帝龙样例包.zip'); S.status('package', 'ready', '已导出样例包')
  } catch (error) { S.status('package', 'error', errorMessage(error)) }
}
async function previewPackage(file: File | Blob): Promise<PackageRow[]> {
  if (file.size > 100 * 1024 * 1024) throw Error('ZIP 不能超过100MB')
  const files = await S.unzip(await file.arrayBuffer()), manifest: unknown = JSON.parse(decoder.decode(files.get('manifest.json') || new Uint8Array()))
  if (!metadata.isRecord(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.samples)) throw Error('不支持的样例包版本或清单格式')
  const seen = new Set(S.all().map(sample => sample.id)), rows: PackageRow[] = []
  for (const input of manifest.samples as unknown[]) {
    let record: Partial<WorkflowAsset> = {}
    try {
      if (!metadata.isRecord(input)) throw Error('缺少有效编号或名称')
      record = input as Partial<WorkflowAsset>
      if (typeof input.id !== 'string' || !input.id.trim() || typeof input.name !== 'string' || !input.name.trim()) throw Error('缺少有效编号或名称')
      if (['wood', 'style', 'tone', 'source'].some(key => input[key] !== undefined && typeof input[key] !== 'string')) throw Error('材质、风格、色系和来源必须为文字')
      if (seen.has(input.id)) { rows.push({ record, state: '重复：跳过' }); continue }
      metadata.normalize(input)
      if (typeof input.image !== 'string' || !files.has(input.image)) throw Error('图片文件不存在')
      const bytes = files.get(input.image)!
      if (bytes.length > 30 * 1024 * 1024) throw Error('图片超过30MB')
      const url = URL.createObjectURL(new Blob([bytes])); let encoded: string
      try { const element = await image(url); if (element.naturalWidth * element.naturalHeight > 40000000) throw Error('图片超过4000万像素'); encoded = await dataURL(element) } finally { URL.revokeObjectURL(url) }
      const analyzed = await analyzedRecord({ ...record, id: input.id, name: input.name, status: '本地导入' }, encoded)
      rows.push({ record: analyzed, state: '有效' }); seen.add(input.id)
    } catch (error) { rows.push({ record, state: '错误：' + errorMessage(error) }) }
  }
  return rows
}
function commitPackage(rows: PackageRow[]): Promise<number> {
  return withDataWrite(async () => {
    await S.ready
    const now = new Date().toISOString()
    const records = rows.filter(row => row.state === '有效').map(row => ({ ...row.record, importedAt: now, createdAt: row.record.createdAt || now }) as WorkflowAsset).filter(record => !S.all().some(asset => asset.id === record.id))
    await write('assets', records); S.assets.push(...records); S.lastImportIds = records.map(record => record.id); emit(); return records.length
  })
}
function filterOriginal(platform: string, period: string, space: string): TrendRecord[] {
  const periods: Record<string, number> = { '近7天': 7, '近30天': 30, '近90天': 90, '近半年': 180 }, days = periods[period] || 90
  const ages = [[3, 18, 20], [20, 65, 70], [5, 30, 40], [85, 90, 120]], spaces = [['客厅', '卧室', '厨房与柜体'], ['客厅', '商业空间'], ['卧室', '厨房与柜体'], ['商业空间']]
  return S.originalTrends.map((record, index) => ({ ...record, sources: record.sources.filter((source, sourceIndex) => (platform === '全平台' || source.platform === platform) && (ages[index]?.[sourceIndex] ?? Infinity) <= days) })).filter((record, index) => record.sources.length && (space === '全屋空间' || spaces[index]?.includes(space)))
}
function emptyTrend(base: TrendRecord): TrendRecord {
  return { ...base, id: 'empty', name: '暂无匹配资料', stage: '无数据', heat: 0, growth: 0, confidence: 0, saturation: 0, signals: [], sources: [], matches: [], palette: [], material: '—', texture: '—', layers: '—', forecast: '请调整筛选条件' }
}
function matchOriginal(record: TrendRecord): WorkflowAsset[] {
  const assets = S.all(), exact = (record.matches || []).map(name => assets.find(asset => asset.name === name)).filter((asset): asset is WorkflowAsset => !!asset)
  if (exact.length) return exact
  return assets.filter(asset => record.material?.split(' / ').some(material => asset.wood.includes(material) || asset.name.includes(material))).slice(0, 3)
}
function researchOriginal(query: string, platforms: string[], matchLibrary: boolean): TrendResearch {
  const synonyms = [['浅木纹', '奶油原木'], ['浅色', '奶油原木'], ['浅木', '奶油原木'], ['胡桃', '烟熏橡木'], ['门墙柜', '暖灰中古'], ['红棕', '深红棕复古']]
  const list = S.originalTrends.filter(record => record.sources.some(source => platforms.includes(source.platform)) && ([record.name, ...record.tags, ...record.material.split(' / ')].some(term => query.includes(term)) || synonyms.some(([key, target]) => query.includes(key) && record.name === target)))
  const sources = list.flatMap(record => record.sources.filter(source => platforms.includes(source.platform)))
  return {
    summary: list.length ? list.map(record => record.name + '：' + record.desc).join('；') : '所选演示资料中没有相关内容，请调整研究主题或来源。',
    change: list.map(record => record.name + ' · ' + record.stage).join('；') || '—', palette: list.flatMap(record => record.palette).join('、') || '—', material: list.map(record => record.material).join('；') || '—',
    risk: list.length ? '以上为演示资料汇总，实际需求需人工核对。' : '暂无依据，不能形成结论',
    evidence: '匹配演示方向 ' + list.length + ' 项，来源记录 ' + sources.reduce((sum, source) => sum + source.count, 0) + ' 条',
    growth: matchLibrary ? '关联样例 ' + new Set(list.flatMap(record => S.matchOriginal(record).map(asset => asset.id))).size + ' 条' : '样例库匹配已关闭', confidence: '已选择来源：' + (platforms.join('、') || '无'),
  }
}
