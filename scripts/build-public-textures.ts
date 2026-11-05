/** Development tool: copy web derivatives and compute their real Vue app image features. */
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
import { chromium, type Browser } from 'playwright'
import type { ImageSummary } from '../src/core/types'
import type { PublicTexture } from '../src/core/sample-library'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
export interface TextureInput {
  id: string; name: string; category: string; tags: string[]; source: string; source_id: string
  imageUrl: string; thumbnail: string; width: number; height: number; source_url: string; license: string; license_url: string
}
export interface BuildOptions { input: string; output: string; catalog: string }
interface BuildResult { input: number; existingSkipped: number; added: number }
interface AnalyzerWindow extends Window { __textureAnalyze: (source: string) => Promise<ImageSummary> }

export function parseArgs(args: string[]): BuildOptions {
  let input: string | undefined, output = path.join(projectRoot, 'public/public-textures'), catalog = path.join(projectRoot, 'src/data/public-catalog.json')
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--output' || argument === '--catalog') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw Error(argument + ' requires a path')
      if (argument === '--output') output = path.resolve(value); else catalog = path.resolve(value)
    } else if (argument.startsWith('--') || input) throw Error('Usage: build-public-textures <input-directory> [--output directory] [--catalog file]')
    else input = path.resolve(argument)
  }
  if (!input) throw Error('Usage: build-public-textures <input-directory> [--output directory] [--catalog file]')
  return { input, output, catalog }
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function readRows(value: unknown): TextureInput[] {
  if (!Array.isArray(value)) throw Error('manifest.json must contain an array')
  return value.map((item: unknown, index): TextureInput => {
    if (!record(item)) throw Error('Invalid texture record ' + (index + 1))
    for (const key of ['id', 'name', 'category', 'source', 'source_id', 'imageUrl', 'thumbnail', 'source_url', 'license', 'license_url']) if (typeof item[key] !== 'string' || !String(item[key]).trim()) throw Error('Invalid ' + key + ' at record ' + (index + 1))
    if (!/^[\w.-]+$/.test(String(item.id)) || item.id === '.' || item.id === '..') throw Error('Invalid texture id at record ' + (index + 1))
    if (!Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string')) throw Error('Invalid tags at record ' + (index + 1))
    if (!Number.isInteger(item.width) || Number(item.width) < 1 || !Number.isInteger(item.height) || Number(item.height) < 1) throw Error('Invalid dimensions at record ' + (index + 1))
    return item as unknown as TextureInput
  })
}
export function selectRows(rows: TextureInput[], base: Array<{ id?: string; assetId?: string }>): TextureInput[] {
  const existing = new Set(base.map(asset => asset.assetId)), ids = new Set<string>(), sources = new Set<string>()
  return rows.filter(row => {
    const source = row.source + ':' + row.source_id
    if (row.source === 'polyhaven' && existing.has(row.source_id) || ids.has(row.id) || sources.has(source)) return false
    ids.add(row.id); sources.add(source); return true
  })
}
function inputFile(input: string, relative: string): string {
  const file = path.resolve(input, relative), within = path.relative(input, file)
  if (!within || within.startsWith('..' + path.sep) || within === '..' || path.isAbsolute(within)) throw Error('Texture file must be inside the input directory: ' + relative)
  return file
}
function imagePath(output: string, id: string, directory: 'images' | 'thumbnails'): string {
  const relative = path.relative(path.join(projectRoot, 'public'), path.join(output, directory, id + '.webp'))
  return !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ? './' + relative.split(path.sep).join('/') : './public-textures/' + directory + '/' + id + '.webp'
}
export async function buildPublicTextures(options: BuildOptions): Promise<BuildResult> {
  const input = path.resolve(options.input), output = path.resolve(options.output), catalog = path.resolve(options.catalog)
  try { await fs.access(output); throw Error('Refusing to overwrite ' + output) } catch (failure) { if (!(failure instanceof Error) || !('code' in failure) || failure.code !== 'ENOENT') throw failure }
  const rows = readRows(JSON.parse(await fs.readFile(path.join(input, 'manifest.json'), 'utf8')) as unknown)
  const base = JSON.parse(await fs.readFile(path.join(projectRoot, 'src/data/base-samples.json'), 'utf8')) as Array<{ assetId?: string }>
  const selected = selectRows(rows, base), images = new Map<string, string>()
  for (const row of selected) {
    const image = inputFile(input, row.imageUrl), thumbnail = inputFile(input, row.thumbnail)
    await Promise.all([fs.access(image), fs.access(thumbnail)]); images.set(row.id, image)
  }
  const records: PublicTexture[] = []
  if (selected.length) {
    // This tool must not invalidate the running application's optimizer cache.
    const temporaryRoot = path.resolve(os.tmpdir()), cachePrefix = 'dilong-texture-cache-'
    const cacheDir = await fs.mkdtemp(path.join(temporaryRoot, cachePrefix))
    try {
      const vite = await createServer({ root: projectRoot, configFile: false, cacheDir, optimizeDeps: { noDiscovery: true }, appType: 'custom', logLevel: 'error', server: { middlewareMode: true } })
      const server = http.createServer((request, response) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<!doctype html><html><body><script type="module">import { analyzeSummary } from "/src/core/color-analysis.ts"; window.__textureAnalyze=analyzeSummary;</script></body></html>'); return }
        if (url.pathname.startsWith('/__textures/')) {
          let file: string | undefined
          try { file = images.get(decodeURIComponent(url.pathname.slice('/__textures/'.length))) } catch { /* Invalid URLs have no matching input file. */ }
          if (!file) { response.writeHead(404); response.end(); return }
          void fs.readFile(file).then(bytes => { response.setHeader('Content-Type', 'application/octet-stream'); response.end(bytes) }).catch(() => { response.writeHead(404); response.end() }); return
        }
        vite.middlewares(request, response, () => { response.writeHead(404); response.end() })
      })
      let browser: Browser | undefined
      try {
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
        const executablePath = process.env.DILONG_CHROMIUM_PATH
        browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }) })
        const context = await browser.newContext(), page = await context.newPage(), address = server.address()
        if (!address || typeof address === 'string') throw Error('Local analysis server did not start')
        await page.goto('http://127.0.0.1:' + address.port + '/'); await page.waitForFunction('typeof window.__textureAnalyze === "function"')
        for (let index = 0; index < selected.length; index += 16) {
          const batch = selected.slice(index, index + 16)
          const features = await page.evaluate(async batch => Promise.all(batch.map(row => (window as unknown as AnalyzerWindow).__textureAnalyze('/__textures/' + encodeURIComponent(row.id)))), batch.map(row => ({ id: row.id })))
          for (const [offset, row] of batch.entries()) records.push({ id: 'TX-' + row.id, assetId: row.id, name: row.name, category: row.category, tags: row.tags, source: row.source, sourceId: row.source_id,
            imageUrl: imagePath(output, row.id, 'images'), thumbnailUrl: imagePath(output, row.id, 'thumbnails'), width: row.width, height: row.height, sourceUrl: row.source_url, license: row.license, licenseUrl: row.license_url, features: features[offset] })
          if (index % 160 === 0) console.log('FEATURES ' + Math.min(index + 16, selected.length) + '/' + selected.length)
        }
      } finally {
        await Promise.all([browser?.close(), vite.close(), new Promise<void>((resolve, reject) => { if (!server.listening) resolve(); else server.close(failure => failure ? reject(failure) : resolve()) })])
      }
    } finally {
      const target = path.resolve(cacheDir)
      if (path.dirname(target) !== temporaryRoot || !target.startsWith(path.join(temporaryRoot, cachePrefix))) throw Error('Unexpected temporary cache cleanup target: ' + target)
      await fs.rm(target, { recursive: true, force: true })
    }
  }
  await fs.mkdir(output) // Atomic final no-overwrite check, including concurrent invocations.
  await fs.mkdir(path.join(output, 'images')); await fs.mkdir(path.join(output, 'thumbnails'))
  for (const row of selected) { await fs.copyFile(inputFile(input, row.imageUrl), path.join(output, 'images', row.id + '.webp')); await fs.copyFile(inputFile(input, row.thumbnail), path.join(output, 'thumbnails', row.id + '.webp')) }
  await fs.writeFile(path.join(output, 'catalog.js'), '// Generated by scripts/build-public-textures.ts; features use the app image algorithm.\nwindow.DilongPublicTextureData=' + JSON.stringify({ version: 1, records }) + ';\n')
  await fs.writeFile(path.join(output, 'sources.json'), JSON.stringify(Object.fromEntries(rows.map(row => [row.source, { license: row.license, licenseUrl: row.license_url }])), null, 2))
  await fs.mkdir(path.dirname(catalog), { recursive: true }); await fs.writeFile(catalog, JSON.stringify(records))
  return { input: rows.length, existingSkipped: rows.length - records.length, added: records.length }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void Promise.resolve().then(() => buildPublicTextures(parseArgs(process.argv.slice(2)))).then(result => console.log(JSON.stringify(result))).catch(failure => { console.error(failure instanceof Error ? failure.message : failure); process.exitCode = 1 })
}
