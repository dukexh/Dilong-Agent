import type { ImageSummary, InkLayer, InkRenderModel, RGB } from '../core/types'

export type DesignMode = 'compare' | 'complete' | 'twin' | 'generate'
export type CandidateStatus = 'pending' | 'accepted' | 'adjust' | 'rejected'
export type PageKey = 'home' | 'color' | 'design' | 'samples' | 'trends' | 'production'
export type OperationState = 'idle' | 'ready' | 'busy' | 'error'
export interface OperationStatus { state: OperationState; message: string }
export interface Revisioned { id: string; _revision?: number; createdAt?: string; updatedAt?: string }
export type MetadataKey = 'name' | 'wood' | 'style' | 'tone' | 'source' | 'customer' | 'customerCode' | 'orderNo' | 'substrate' | 'inkSeries' | 'machine'
export type StaffKey = 'designer' | 'colorist' | 'operator' | 'reviewer'
export type ProductionKey = 'batchNo' | 'stage' | 'date' | 'equipment' | 'quantity' | 'substrate' | 'deltaE' | 'result' | 'operator'
export type Staff = Record<StaffKey, string>
export type ProductionRecord = Record<ProductionKey, string>
export interface SampleHistory { date: string; title: string; description: string; status: string }
export interface CandidateReview { status: CandidateStatus; updatedAt?: string }
export interface DesignParameters {
  sorting?: string; limit?: number; completion?: string; style?: string; strength?: number
  direction?: string; wood?: string; tone?: string; candidateCount?: number
  [key: string]: unknown
}
export type SampleMetadata = Record<MetadataKey, string> & {
  feedback: string; staff: Staff; productionRecords: ProductionRecord[]; history: SampleHistory[]
  parameters: DesignParameters; recordKind?: 'sample' | 'design-candidate'; candidateReview?: CandidateReview
}
export interface AssetAnalysis extends ImageSummary {
  algorithmVersion?: string; analysedAt?: string; layerCount?: number | null; averageHex?: string
  reconstructionDifference?: number | null
  layers?: Array<{ order: number; name: string; hex: string; rgb: RGB; coverage: number; recipe: InkLayer['recipe'] }>
}
export interface WorkflowAsset extends Revisioned, Partial<SampleMetadata> {
  name: string; imageUrl: string; wood: string; style: string; tone: string; source: string
  schemaVersion?: number; thumbnailUrl?: string; analysis?: AssetAnalysis; layers?: number | null; assetId?: string
  status?: string; date?: string; sourceKey?: string; sourceUrl?: string; license?: string
  importedAt?: string; missing?: boolean; materialCategory?: string; category?: string
  originalSource?: string; originalId?: string; isPublicTexture?: boolean; sourceName?: string; sourceId?: string
  tags?: string[]; width?: number; height?: number; licenseUrl?: string; galleryUrl?: string
}
export type DesignTaskStatus = '待处理' | '处理中' | '已中断' | '状态待确认' | '已取消' | '执行失败' | '已处理' | '已保存候选' | '已评价' | '源样例已删除' | '无匹配结果'
export type TaskInput = { kind: 'library'; sampleId: string; name: string } | { kind: 'upload'; name: string; imageUrl: string; summary: ImageSummary }
export interface DesignTask extends Revisioned {
  schemaVersion: number; source: string; sourceId: string; sampleId: string | null; title: string
  conditions: string; status: DesignTaskStatus; resultIds: string[]; mode?: DesignMode; input?: TaskInput
  parameters?: DesignParameters; attempts?: number; runKey?: string; ownerId?: string; error?: string; outputCount?: number; completedAt?: string
}
export interface BeginDesignTaskRequest {
  mode: DesignMode; runKey: string; taskId?: string | null; parameters: DesignParameters
  input: { kind: 'library'; sampleId: string; name: string } | { kind: 'upload'; name: string; src: string | HTMLImageElement; summary: ImageSummary }
}
export interface InkSettings { weight: number; enabled: boolean[]; selectedLayer: number; tab: 'overview' | 'detail' }
export interface InkSnapshot { version: 1; imageUrl: string; layers: InkLayer[]; renderModel: InkRenderModel; settings: InkSettings }
export interface InkRun extends Revisioned {
  schemaVersion?: number; inputName: string; sampleId?: string | null; source?: string
  layerCount: number; difference: number; snapshot?: InkSnapshot
}
export type RestorableInkRun = InkRun & { snapshot: InkSnapshot }
export interface InkRecordStatus extends OperationStatus { id: string }
export interface DesignProgress { fraction: number; phase: string }
export interface DesignRun extends DesignProgress { controller: AbortController }
export interface DesignRunOptions { signal: AbortSignal; onProgress: (progress: DesignProgress) => void }
export type HistoryStore = 'tasks' | 'inkRuns'
export interface TrendSource { platform: string; count: number; change: string }
export interface TrendRecord {
  id: string; name: string; stage: string; heat: number; growth: number; confidence: number; saturation: number
  color: string; palette: string[]; material: string; texture: string; layers: string; forecast: string; desc: string
  tags: string[]; signals: number[]; sources: TrendSource[]; matches: string[]
}
export interface TrendTaskSource { id: string; title: string; keywords: string[] }
export interface TrendResearch { summary: string; change: string; palette: string; material: string; risk: string; evidence: string; growth: string; confidence: string }
export interface PackageRow { record: Partial<WorkflowAsset>; state: string }
export type ZipFiles = Array<[string, Uint8Array<ArrayBuffer>]>
export interface WorkflowOpenDetail { page: PageKey; sample: WorkflowAsset; task?: DesignTask }
