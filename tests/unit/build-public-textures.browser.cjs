/** Explicit integration check: node tests/unit/build-public-textures.browser.cjs. Uses only a temporary directory/context. */
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), zlib = require('node:zlib')
const { tsImport } = require('tsx/esm/api')
const { chromium } = require('playwright')
function crc(bytes) { let value = -1; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)) }; return (value ^ -1) >>> 0 }
function png(pixel, width = 32, height = 24) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from([...pixel(x, y), 255]).copy(scanlines, y * (width * 4 + 1) + 1 + x * 4)
  const chunk = (name, data) => { const tag = Buffer.from(name), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, checksum]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))])
}
;(async () => {
  const { buildPublicTextures } = await tsImport('../../scripts/build-public-textures.ts', __filename)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dilong-textures-browser-')), root = path.resolve(__dirname, '../..')
  const before = await fs.readFile(path.join(root, 'src/data/public-catalog.json'))
  const previousCaches = new Set((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('dilong-texture-cache-')))
  let mainBrowser, mainPage
  const dependencyUrls = new Set(), dependencyFailures = []
  try {
    if (process.env.DILONG_MAIN_TEST_URL) {
      const executablePath = process.env.DILONG_CHROMIUM_PATH
      mainBrowser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }) })
      mainPage = await mainBrowser.newPage()
      mainPage.on('response', response => { if (response.url().includes('/node_modules/.vite/deps/') && /\.js(?:\?|$)/.test(response.url())) { dependencyUrls.add(response.url()); if (response.status() !== 200) dependencyFailures.push([response.url(), response.status()]) } })
      await mainPage.goto(process.env.DILONG_MAIN_TEST_URL)
      await mainPage.waitForFunction(() => Boolean(document.querySelector('#app')?.children.length))
      assert.ok(dependencyUrls.size > 0, 'The concurrent application test must load actual Vite-optimized dependencies')
    }
    const input = path.join(directory, 'input'), output = path.join(directory, 'output'), catalog = path.join(directory, 'public-catalog.json')
    await fs.mkdir(input)
    // analyzeSummary intentionally draws onto 120×90. Match that exact grid for
    // the half-black/half-white oracle: browser interpolation of a 32×24 source
    // quantizes transition pixels and does not preserve its raw 127.5 average.
    const solid = png(() => [180, 90, 45]), patterned = png(x => x < 60 ? [0, 0, 0] : [255, 255, 255], 120, 90)
    await fs.writeFile(path.join(input, 'solid.png'), solid); await fs.writeFile(path.join(input, 'patterned.png'), patterned)
    const row = (id, imageUrl, patch = {}) => ({ id, name: id, category: 'wood', tags: ['wood'], source: 'fixture', source_id: id, imageUrl, thumbnail: imageUrl, width: 32, height: 24, source_url: 'https://example.invalid/' + id, license: 'CC0', license_url: 'https://example.invalid/license', ...patch })
    const base = JSON.parse(await fs.readFile(path.join(root, 'src/data/base-samples.json'), 'utf8'))
    const rows = [row('solid', 'solid.png'), row('patterned', 'patterned.png', { width: 120, height: 90 }), row('duplicate-source', 'solid.png', { source_id: 'solid' }), row('solid', 'solid.png', { source_id: 'different-id' }), row('existing', 'not-present.png', { source: 'polyhaven', source_id: base[0].assetId })]
    await fs.writeFile(path.join(input, 'manifest.json'), JSON.stringify(rows))
    const [result] = await Promise.all([buildPublicTextures({ input, output, catalog }), mainPage ? mainPage.reload() : Promise.resolve()])
    assert.deepEqual(result, { input: 5, existingSkipped: 3, added: 2 })
    const records = JSON.parse(await fs.readFile(catalog, 'utf8'))
    assert.deepEqual(records.map(row => row.id), ['TX-solid', 'TX-patterned'])
    assert.deepEqual(records[0].features, { averageRgb: { r: 180, g: 90, b: 45 }, brightness: 105, textureDensity: 0 })
    // One vertical edge: 90 changed neighbor pairs among 119*90 + 120*89.
    const expectedTextureDensity = Math.round(90 / (119 * 90 + 120 * 89) * 520)
    assert.deepEqual(records[1].features, { averageRgb: { r: 128, g: 128, b: 128 }, brightness: 128, textureDensity: expectedTextureDensity })
    assert.deepEqual(await fs.readFile(path.join(output, 'images/solid.webp')), solid); assert.deepEqual(await fs.readFile(path.join(output, 'thumbnails/patterned.webp')), patterned)
    const sandbox = { window: {} }; vm.runInNewContext(await fs.readFile(path.join(output, 'catalog.js'), 'utf8'), sandbox)
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.DilongPublicTextureData)), { version: 1, records })
    await assert.rejects(() => buildPublicTextures({ input, output, catalog }), /Refusing to overwrite/)
    assert.deepEqual(await fs.readFile(path.join(root, 'src/data/public-catalog.json')), before)
    assert.deepEqual((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('dilong-texture-cache-') && !previousCaches.has(name)), [], 'The private Vite cache is removed after analysis')
    if (mainPage) {
      for (const url of dependencyUrls) { const response = await mainPage.request.get(url); assert.equal(response.status(), 200, 'The original optimized dependency URL must remain valid: ' + url); await response.dispose() }
      await mainPage.reload(); await mainPage.waitForFunction(() => Boolean(document.querySelector('#app')?.children.length))
      assert.deepEqual(dependencyFailures, [], 'The running main Vite service must not serve outdated optimizer dependencies')
      console.log('PASS Concurrent main Vite application stayed mounted; all original optimized dependency URLs stayed HTTP 200.')
    }
    console.log('PASS Texture builder: real browser image features, copied derivatives, source/ID/base deduplication, two catalog formats, overwrite refusal, production index unchanged.')
  } finally {
    await mainBrowser?.close()
    const target = path.resolve(directory), parent = path.resolve(os.tmpdir()) + path.sep
    if (!target.startsWith(parent)) throw Error('Unexpected cleanup target')
    await fs.rm(target, { recursive: true, force: true })
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
