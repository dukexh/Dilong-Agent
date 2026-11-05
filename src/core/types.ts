export interface RGB { r: number; g: number; b: number }
export interface ImageSummary { averageRgb: RGB; brightness: number; textureDensity: number }
export interface InkRecipe { red: number; yellow: number; blue: number; black: number; thinner: number }
export interface InkLayer { name: string; role: string; rgb: RGB; hex: string; share: number; recipe: InkRecipe; maskUrl: string }
export interface InkRenderModel { width: number; height: number; assignments: Uint8Array; colours: RGB[]; original: Uint8ClampedArray; alphaThreshold?: number }
export interface InkResult { layers: InkLayer[]; renderModel: InkRenderModel; reconstructionUrl: string; difference: number }
export interface PixelImage { width: number; height: number; data: Uint8ClampedArray }
export interface Point { x: number; y: number }
export interface Bounds { left: number; top: number; width: number; height: number }
export interface Progress { fraction: number; phase: string; completed?: number; total?: number }
export interface DesignOptions { signal?: AbortSignal; onProgress?: (progress: Progress) => void }
export interface DesignResult { url: string; thumbnailUrl: string; width: number; height: number; similarity?: number | null; similarityError?: string }
export interface CompareOptions { threshold?: number; blockRows?: number; shouldCancel?: () => boolean; signal?: AbortSignal; yieldTask?: () => Promise<unknown>; onProgress?: (progress: Progress) => void }
export interface SimilarityOptions { signal?: AbortSignal; yieldTask?: () => Promise<unknown>; onProgress?: (fraction: number) => void }
export interface ComparisonMetrics { width: number; height: number; meanDeltaE: number; meanRgbDifference: number; p95DeltaE: number; ssim: number; ssimWindowCount: number; deltaL: number; deltaA: number; deltaB: number; deltaMap: Float32Array; validMask: Uint8Array; validCount: number; areaPercent: number }
export interface ComparisonResult extends ComparisonMetrics { bounds: Bounds; reference: PixelImage; actual: PixelImage; previewDeltaMap: Float32Array; previewValidMask: Uint8Array }
