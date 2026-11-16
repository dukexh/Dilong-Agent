/** Build public search descriptors and an explicitly labelled demo query. Runs locally, never at site startup. */
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { merge, type PublicTexture } from '../src/core/sample-library'
import { TEXTURE_VERSION, TEXTURE_PATCH_COUNT, TEXTURE_VECTOR_LENGTH, type TextureFeatures } from '../src/core/texture-search'
import type { WorkflowAsset } from '../src/services/types'
import type { TextureIndexManifest } from '../src/core/texture-index'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.join(root, 'public/texture-search')
const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'dilong-index-'))
const base = JSON.parse(await fs.readFile(path.join(root, 'src/data/base-samples.json'), 'utf8')) as WorkflowAsset[]
const catalog = JSON.parse(await fs.readFile(path.join(root, 'src/data/public-catalog.json'), 'utf8')) as PublicTexture[]
const samples = merge(base, catalog)
const images = new Map(samples.map(a => [a.id, path.resolve(root, 'public', a.imageUrl.replace(/^\.\//, ''))]))
for (const file of images.values()) {
  if (!file.startsWith(path.join(root, 'public') + path.sep)) throw Error('图片必须位于 public 目录')
  await fs.access(file)
}
const vite = await createServer({ root, cacheDir: cache, server: { middlewareMode: true }, appType: 'custom' })
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><script type="module">
import {textureFeatures} from '/src/core/texture-search.ts';
async function decode(id,max=256){const image=new Image();image.src='/__catalog/'+encodeURIComponent(id);await image.decode();const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(image.naturalWidth*scale));c.height=Math.max(1,Math.round(image.naturalHeight*scale));const ctx=c.getContext('2d');ctx.drawImage(image,0,0,c.width,c.height);return{c,ctx,pixels:ctx.getImageData(0,0,c.width,c.height)}}
window.analyse=async ids=>Promise.all(ids.map(async id=>{const{c,pixels}=await decode(id);const features=textureFeatures(pixels);c.width=c.height=0;return features}));
window.demo=async id=>{const{c,ctx,pixels}=await decode(id,Infinity);for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=pixels.data[i]*.92+7;pixels.data[i+1]=pixels.data[i+1]*.97+3;pixels.data[i+2]=pixels.data[i+2]*1.03+1}ctx.putImageData(pixels,0,0);return c.toDataURL('image/png').split(',')[1]};
</script>`); return
  }
  if (url.pathname.startsWith('/__catalog/')) {
    const file = images.get(decodeURIComponent(url.pathname.slice('/__catalog/'.length)))
    if (!file) { res.writeHead(404); res.end(); return }
    void fs.readFile(file).then(bytes => { res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'image/webp'); res.end(bytes) }).catch(() => { res.writeHead(404); res.end() }); return
  }
  vite.middlewares(req, res, () => { res.writeHead(404); res.end() })
})
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw Error('索引服务未启动')
  browser = await chromium.launch({ headless: true, ...(process.env.DILONG_CHROMIUM_PATH ? { executablePath: process.env.DILONG_CHROMIUM_PATH } : { channel: 'chrome' }) })
  const context = await browser.newContext(), page = await context.newPage()
  await page.goto('http://127.0.0.1:' + address.port); await page.waitForFunction('typeof window.analyse === "function"')
  const vectors = new Float32Array(samples.length * TEXTURE_PATCH_COUNT * TEXTURE_VECTOR_LENGTH)
  for (let i = 0; i < samples.length; i += 32) {
    const batch = samples.slice(i, i + 32)
    const features = await page.evaluate(async ids => (window as unknown as { analyse: (ids: string[]) => Promise<TextureFeatures[]> }).analyse(ids), batch.map(a => a.id))
    features.forEach((f, j) => { if (f.version !== TEXTURE_VERSION || f.patches.length !== TEXTURE_PATCH_COUNT) throw Error('特征版本不一致'); f.patches.forEach((p, k) => vectors.set(Array.from(p), ((i + j) * TEXTURE_PATCH_COUNT + k) * TEXTURE_VECTOR_LENGTH)) })
    if (i % 256 === 0) console.log('INDEX ' + Math.min(i + 32, samples.length) + '/' + samples.length)
  }
  const bytes = Buffer.from(vectors.buffer), hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12), file = 'features-' + hash + '.bin'
  const manifest: TextureIndexManifest = { algorithm: TEXTURE_VERSION, patchCount: TEXTURE_PATCH_COUNT, vectorLength: TEXTURE_VECTOR_LENGTH, ids: samples.map(a => a.id), file, byteLength: bytes.length }
  const demo = await page.evaluate(async () => (window as unknown as { demo: (id: string) => Promise<string> }).demo('TX-ambientcg--Wood033'))
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, file), bytes)
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(output, 'demo-wood033.png'), Buffer.from(demo, 'base64'))
  await fs.writeFile(path.join(output, 'demo-source.json'), JSON.stringify({ sampleId: 'TX-ambientcg--Wood033', label: '演示来样 · 木纹换色', source: 'https://ambientcg.com/a/Wood033', license: 'CC0-1.0', changes: '轻微色调与曝光变化；检索不使用已知来源信息' }, null, 2))
  console.log(JSON.stringify({ records: samples.length, file, bytes: bytes.length }))
} finally {
  await browser?.close(); await vite.close(); await new Promise<void>(resolve => server.close(() => resolve()))
  const resolved = path.resolve(cache)
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('dilong-index-')) await fs.rm(resolved, { recursive: true, force: true })
}
