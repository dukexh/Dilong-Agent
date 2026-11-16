import { textureFeatures, textureScore, type TextureFeatures } from './texture-search'
import { seamless, repeatTile } from './seamless'
import { encodeTiff, encodePsd } from './engineering-export'
import type { PixelImage } from './types'
import type { SeamlessDocument } from './seamless'

type Request = { kind: 'features'; image: PixelImage; rotations?: boolean } | { kind: 'rank'; query: TextureFeatures; targets: Array<{ id: string; features: TextureFeatures }> } | { kind: 'repeat'; image: PixelImage; columns: number; rows: number } | { kind: 'seamless'; image: PixelImage; overlap: number; lightBalance: boolean } | { kind: 'export'; image: PixelImage; format: 'tif' | 'psd'; ppi: number; document?: SeamlessDocument }
const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage: (value: unknown) => void }
scope.onmessage = async ({ data }) => {
  try {
    let result: unknown
    if (data.kind === 'features') result = textureFeatures(data.image, data.rotations)
    else if (data.kind === 'rank') result = data.targets.map(t => ({ id: t.id, score: textureScore(data.query, t.features) })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    else if (data.kind === 'repeat') result = repeatTile(data.image, data.columns, data.rows)
    else if (data.kind === 'seamless') result = seamless(data.image, data.overlap, data.lightBalance)
    else result = data.format === 'tif' ? encodeTiff(data.image, data.ppi) : await encodePsd(data.image, data.ppi, data.document)
    scope.postMessage({ result })
  } catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : 'Error' }) }
}
