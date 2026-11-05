// Vue SFC setup/template and the exported report API replace the old React-hook-order fixture.
const test = require('node:test'), assert = require('node:assert/strict')
const core = require('../../src/core/production-compare-core.ts')
const { createProductionReport } = require('../../src/core/production-report.ts')
const { loadVue, findNode, textContent } = require('./vue-fixture.cjs')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQZkAAAAASUVORK5CYII='
const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
const crop = [{ x: .1, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .6 }, { x: .1, y: .6 }]
const normalized = value => JSON.parse(JSON.stringify(value))
const buttonNamed = (tree, name) => findNode(tree, node => node.type === 'button' && textContent(node).trim() === name)
const inputNamed = (tree, id) => findNode(tree, node => node.type === 'input' && node.props.id === id)
function image(actual) {
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const rgb = !actual ? [120, 120, 120] : x >= 6 && x < 10 && y >= 6 && y < 10 ? [210, 60, 40] : [123, 121, 119]
    data.set([...rgb, 255], (y * 16 + x) * 4)
  }
  return { width: 16, height: 16, data }
}
function fixture({ hasResult = true, example = false, decodedWidth = 16, decodedHeight = 16 } = {}) {
  const reference = image(false), actual = image(true), metrics = core.analyze(reference, actual, 1)
  const result = hasResult ? { ...metrics, reference, actual, bounds: { left: 0, top: 0, width: 16, height: 16 }, previewDeltaMap: metrics.deltaMap, previewValidMask: metrics.validMask, referenceUrl: PNG, actualUrl: PNG, createdAt: '2026-10-19T14:37:00.000Z', quads: [quad.map(p => ({ ...p })), quad.map(p => ({ ...p }))] } : null
  const sample = '木纹 <img src=x onerror=alert(1)> & "样品"\' A/B', batch = '批次 <B>&"2026"'
  const notes = '第一行 <script>window.pwned=1</script>\n第二行 & "引号" 和 \'单引号\'', review = '需要调整', threshold = 7.5
  const sources = [{ name: '设计<A>&"图纸".png', width: 1600, height: 1600, pixels: reference, originalUrl: PNG, preview: PNG, example }, { name: '实物<B>&"照片".png', width: 2048, height: 2048, pixels: actual, originalUrl: PNG, preview: PNG, example }]
  const blobs = [], anchors = [], timers = [], canvases = [], appended = []
  const globals = {
    document: { body: { appendChild(node) { appended.push(node) } }, createElement(tag) {
      if (tag === 'a') { const anchor = { href: '', download: '', clicked: false, click() { this.clicked = true } }; anchors.push(anchor); return anchor }
      if (tag !== 'canvas') throw Error('Unexpected element ' + tag)
      const canvas = { width: 0, height: 0, data: null, getContext() { return { putImageData(value) { canvas.data = value }, drawImage() {}, fillRect() {}, getImageData() { const data = new Uint8ClampedArray(canvas.width * canvas.height * 4); for (let i = 0; i < data.length; i += 4) data.set([120, 120, 120, 255], i); return { width: canvas.width, height: canvas.height, data } } } }, toDataURL() { return PNG } }
      canvases.push(canvas); return canvas
    } },
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:report-fixture/' + blobs.length }, revokeObjectURL() {} },
    Image: class Image { constructor() { this.naturalWidth = decodedWidth; this.naturalHeight = decodedHeight } set src(value) { this.url = value; Promise.resolve().then(() => this.onload()) } },
    ImageData: class ImageData { constructor(data, width, height) { assert.equal(data.length, width * height * 4); this.data = data; this.width = width; this.height = height } },
    setTimeout(fn, milliseconds) { if (milliseconds < 100) { fn(); return 0 }; timers.push({ fn, milliseconds }); return timers.length },
  }
  const component = loadVue('src/pages/ProductionView.vue', globals).setup(), state = component.state
  state.sources.value = sources; state.result.value = result; state.sampleName.value = sample; state.batch.value = batch; state.review.value = review; state.notes.value = notes; state.threshold.value = threshold
  const sourceModule = loadVue('src/components/ProductionSource.vue', globals)
  const source = side => {
    const props = { side, asset: state.sources.value[side], quad: state.quad.value, busy: state.selectionBlocked.value, loading: state.loading.value[side] }
    return sourceModule.setup(props, (name, value) => { if (name === 'quad') state.changeQuad(value); if (name === 'file') void state.upload(value, side) })
  }
  return { state, render: component.render, source, blobs, anchors, appended, timers, canvases, result, sources, threshold, sample, batch, notes, review }
}

test('production report generation embeds actual metrics, current threshold, metadata and escaped text', async () => {
  const f = fixture()
  assert.equal(buttonNamed(f.render(), '导出比对报告').props.disabled, false)
  f.state.exportResult()
  assert.equal(f.blobs.length, 1); assert.equal(f.blobs[0].type, 'text/html;charset=utf-8')
  const html = await f.blobs[0].text(), row = (label, value) => assert.ok(html.includes('<td>' + label + '</td><td>' + value + '</td>'), label + ' must preserve precision')
  assert.match(html, /^<!doctype html><html lang="zh-CN">/); assert.match(html, /<meta charset="utf-8">/); assert.ok(html.endsWith('</body></html>'))
  assert.match(html, /帝龙装饰纸 · 生产比对报告/); assert.match(html, /北京时间/); assert.match(html, /22:37:00/)
  row('平均图像色差 ΔE00', f.result.meanDeltaE.toFixed(2)); row('RGB 平均偏差', f.result.meanRgbDifference.toFixed(2) + ' / 255')
  assert.match(html, /RGB 平均偏差 = 有效像素的 sqrt/); row('色差第95百分位 ΔE00', f.result.p95DeltaE.toFixed(2))
  row('纹理结构 SSIM', f.result.ssim.toFixed(4) + '（' + (f.result.ssim * 100).toFixed(1) + '%）'); row('人工结论', f.review)
  const currentArea = core.thresholdStats(f.result.deltaMap, f.result.validMask, f.threshold)
  assert.notEqual(currentArea, f.result.areaPercent); row('超阈值区域占比', currentArea.toFixed(1) + '%')
  assert.match(html, /图像色差 &gt; 7\.5/); assert.match(html, /黄色 7\.5 → 红色 ≥ 15\.0 ΔE00/)
  assert.match(html, /木纹 &lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;样品&quot;&#39; A\/B/); assert.match(html, /批次 &lt;B&gt;&amp;&quot;2026&quot;/)
  assert.match(html, /第一行 &lt;script&gt;window\.pwned=1&lt;\/script&gt;\n第二行 &amp; &quot;引号&quot; 和 &#39;单引号&#39;/)
  assert.match(html, /设计&lt;A&gt;&amp;&quot;图纸&quot;\.png（1600×1600）/); assert.match(html, /实物&lt;B&gt;&amp;&quot;照片&quot;\.png（2048×2048）/)
  for (const text of ['计算分辨率：16×16；覆盖像素位置：256；有效像素：256', '报告图片仅为缩略预览', 'sRGB / D65 → CIELAB；CIEDE2000', '7×7窗口，K1=0.01，K2=0.03，data_range=255', '设计选区按原始整数像素取样', '尺寸不同时采用双线性重采样', '未经测色校准的图像比较', '归一化选区坐标（左上、右上、右下、左下）']) assert.ok(html.includes(text), text)
  assert.match(html, /&quot;x&quot;: 1/); assert.match(html, /&quot;y&quot;: 0/)
  const imageSources = [...html.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]); assert.equal(imageSources.length, 3); imageSources.forEach(src => assert.equal(src, PNG))
  assert.doesNotMatch(html, /<script\b/i); assert.doesNotMatch(html, /<link\b/i); assert.doesNotMatch(html, /(?:src|href)=["'](?:https?:)?\/\//i)
  assert.doesNotMatch(html, /演示样本：实物图由原图模拟/)
  assert.equal(f.canvases.length, 1); assert.equal(f.canvases[0].data.width, 16); assert.equal(f.canvases[0].data.height, 16)
  assert.equal(f.anchors[0].href, 'blob:report-fixture/1'); assert.equal(f.anchors[0].clicked, true); assert.equal(f.appended.length, 0, 'Detached download anchor does not leave a DOM node')
  assert.match(f.anchors[0].download, /_比对报告\.html$/); assert.doesNotMatch(f.anchors[0].download, /[<>:"/\\|?*\x00-\x1f]/); assert.equal(f.timers[0].milliseconds, 30000)
  const direct = createProductionReport({ result: f.result, sources: f.sources, sample: f.sample, batch: f.batch, review: f.review, notes: f.notes, threshold: f.threshold, area: currentArea, heatUrl: PNG })
  assert.equal(html, direct, 'Vue export uses the standalone typed report API without changing metrics or escaping')
})
test('demonstration report explicitly identifies its simulated sample origin', async () => {
  const f = fixture({ example: true }); f.state.exportResult(); const html = await f.blobs[0].text()
  assert.match(html, /本次包含演示样本/); assert.match(html, /模拟生产图含人为偏色与局部变化/); assert.match(html, /指标均根据当前两图实际计算/)
})
test('report export stays disabled and produces no Blob until a current analysis exists', () => {
  const f = fixture({ hasResult: false }); assert.equal(buttonNamed(f.render(), '导出比对报告').props.disabled, true); f.state.exportResult()
  assert.equal(f.blobs.length, 0); assert.equal(f.anchors.length, 0); assert.equal(f.canvases.length, 0)
})
test('upload rejects unsupported extensions and oversized files with visible errors and invalidates old results', async () => {
  const unsupported = fixture(); await unsupported.state.upload({ name: '原图.pdf', size: 100 }, 0)
  assert.match(unsupported.state.error.value, /请选择 JPG、PNG 或 WebP 图片/); assert.equal(unsupported.state.result.value, null); assert.equal(unsupported.state.review.value, '未判定'); assert.deepEqual(normalized(unsupported.state.loading.value), [false, false])
  const oversized = fixture(); await oversized.state.upload({ name: '实物.png', size: 30 * 1024 * 1024 + 1 }, 1)
  assert.match(oversized.state.error.value, /图片超过\s*30 MB/); assert.equal(oversized.state.result.value, null); assert.deepEqual(normalized(oversized.state.loading.value), [false, false])
})
test('accepted local image follows Image/canvas upload flow and resets both selections', async () => {
  const f = fixture(), previousActual = f.state.sources.value[1]; await f.state.upload({ name: '新的设计.png', size: 128 }, 0)
  assert.equal(f.state.sources.value[0].name, '新的设计.png'); assert.equal(f.state.sources.value[0].example, false)
  assert.equal(f.state.sources.value[0].pixels.width, 16); assert.equal(f.state.sources.value[0].pixels.height, 16)
  assert.equal(f.state.sources.value[1], previousActual); assert.equal(f.state.result.value, null); assert.equal(f.state.error.value, '')
  assert.deepEqual(normalized(f.state.loading.value), [false, false]); assert.deepEqual(normalized(f.state.quad.value), quad)
})
test('upload preserves decoded original pixels above 2048 instead of replacing them with its preview', async () => {
  const f = fixture({ decodedWidth: 3000, decodedHeight: 32 }); await f.state.upload({ name: '原始分辨率.png', size: 1024 }, 0)
  const source = f.state.sources.value[0]; assert.equal(source.width, 3000); assert.equal(source.pixels.width, 3000); assert.equal(source.pixels.height, 32); assert.equal(source.pixels.data.length, 3000 * 32 * 4)
})
test('analysis and report use complete reference dimensions above the former 512 limit', async () => {
  const f = fixture({ hasResult: false }), pixels = { width: 2600, height: 32, data: new Uint8ClampedArray(2600 * 32 * 4) }
  for (let index = 0; index < pixels.data.length; index += 4) pixels.data.set([120, 120, 120, 255], index)
  f.state.sources.value = f.state.sources.value.map(source => ({ ...source, width: 2600, height: 32, pixels }))
  await f.state.analyze()
  assert.equal(f.state.error.value, ''); assert.equal(f.state.result.value.width, 2600); assert.equal(f.state.result.value.height, 32); assert.equal(f.state.result.value.validCount, 83200); assert.equal(f.state.busy.value, false); assert.equal(f.state.controller, null)
  f.state.exportResult(); const html = await f.blobs[0].text(); assert.match(html, /计算分辨率：2600×32/); assert.match(html, /有效像素：83200/)
  assert.notEqual(f.state.result.value.quads[0], f.state.result.value.quads[1]); assert.notEqual(f.state.result.value.quads[0][0], f.state.result.value.quads[1][0])
})
test('reference crop and coordinate editing synchronize normalized positions across different image sizes', () => {
  const f = fixture(); f.state.sources.value[1] = { ...f.state.sources.value[1], width: 2400, height: 1200, pixels: { width: 64, height: 32 } }
  f.state.changeQuad(crop)
  assert.deepEqual(normalized(f.source(0).state.props.quad), crop); assert.deepEqual(normalized(f.source(1).state.props.quad), crop)
  assert.notEqual(f.state.quad.value[0], crop[0], 'User input points are copied'); assert.equal(f.state.result.value, null); assert.equal(f.state.review.value, '未判定')
  f.source(0).state.coordinate(0, 'x', { target: { value: '25' } }); assert.equal(f.state.quad.value[0].x, .25)
  assert.deepEqual(normalized(f.source(0).state.props.quad), normalized(f.source(1).state.props.quad))
  buttonNamed(f.source(0).render(), '使用整张图片').props.onClick(); assert.deepEqual(normalized(f.state.quad.value), quad)
})
test('actual selection is always read-only with no manual selection controls or unlink switch', () => {
  const f = fixture(); f.state.local.value = { x: 5, y: 5, value: 1, count: 0 }; const source = f.source(1), right = source.render()
  assert.equal(findNode(right, node => node.type === 'input' && node.props.type === 'number'), null)
  for (const name of ['使用整张图片', '手动调整实物区域', '重新选四角']) assert.equal(buttonNamed(right, name), null)
  assert.equal(findNode(f.render(), node => node.props?.role === 'switch'), null); assert.ok(buttonNamed(right, '更换图片'))
  source.state.coordinate(0, 'x', { target: { value: '30' } }); source.state.down({}); source.state.move({})
  assert.deepEqual(normalized(f.state.quad.value), quad); assert.equal(f.state.result.value, f.result); assert.equal(f.state.local.value.value, 1)
  assert.equal(findNode(right, node => node.type === 'svg').props['aria-disabled'], true)
  f.state.changeQuad(crop); assert.deepEqual(normalized(f.state.quad.value), crop); assert.equal(f.state.result.value, null); assert.equal(f.state.local.value, null); assert.equal(f.state.review.value, '未判定')
})
test('reset and source replacement restore both full images and keep synchronization active', async () => {
  const f = fixture(); f.state.quad.value = crop; f.state.resetQuads(); assert.deepEqual(normalized(f.state.quad.value), quad)
  f.state.quad.value = crop; await f.state.upload({ name: 'replacement.png', size: 100 }, 1)
  assert.deepEqual(normalized(f.state.quad.value), quad); assert.equal(f.state.result.value, null); assert.equal(buttonNamed(f.render(), '载入演示样本'), null); assert.equal(f.state.sources.value[1].name, 'replacement.png')
  f.state.changeQuad(crop); assert.deepEqual(normalized(f.source(1).state.props.quad), crop)
})
test('loading either image or analyzing blocks selection edits and image replacement on both sides', async () => {
  for (const calculating of [false, true]) {
    const f = fixture(); if (calculating) f.state.busy.value = true; else f.state.loading.value = [true, false]
    f.state.changeQuad(crop); f.state.resetQuads(); await f.state.upload({ name: 'blocked.png', size: 100 }, 1)
    assert.deepEqual(normalized(f.state.quad.value), quad); assert.equal(f.state.sources.value[1].name, f.sources[1].name)
    for (const side of [0, 1]) {
      const panel = f.source(side).render()
      if (side === 0) { assert.equal(buttonNamed(panel, '使用整张图片').props.disabled, true); assert.equal(findNode(panel, node => node.type === 'input' && node.props.type === 'number').props.disabled, true) }
      assert.equal(findNode(panel, node => node.type === 'svg').props['aria-disabled'], true); assert.equal(buttonNamed(panel, '更换图片').props.disabled, true)
    }
  }
})
test('mode-specific sliders keep values, selections, metrics and review across tab changes', () => {
  const f = fixture(), selections = f.state.quad.value, result = f.state.result.value
  const selectTab = title => findNode(f.render(), node => node.type === 'button' && node.props?.title === title).props.onClick()
  assert.equal(inputNamed(f.render(), 'overlay-opacity'), null); assert.equal(inputNamed(f.render(), 'heat-threshold'), null)
  selectTab('透明叠加'); assert.ok(inputNamed(f.render(), 'overlay-opacity')); assert.equal(f.state.opacity.value, 50); assert.equal(inputNamed(f.render(), 'heat-threshold'), null)
  inputNamed(f.render(), 'overlay-opacity').props['onUpdate:modelValue'](80)
  selectTab('色差热图'); assert.equal(inputNamed(f.render(), 'overlay-opacity'), null)
  const threshold = inputNamed(f.render(), 'heat-threshold'); assert.equal(Number(threshold.props.min), 1); assert.equal(Number(threshold.props.max), 20); assert.equal(Number(threshold.props.step), .5)
  threshold.props['onUpdate:modelValue'](2.5)
  const biasCard = findNode(f.render(), node => node.type === 'button' && node.props?.['aria-label'] === '查看平均偏色方向的公式与本次结果')
  assert.ok(textContent(biasCard).includes(f.state.bias.value)); assert.ok(textContent(biasCard).includes('平均偏色方向'))
  selectTab('并排对照'); selectTab('透明叠加'); assert.equal(f.state.opacity.value, 80)
  selectTab('色差热图'); assert.equal(f.state.threshold.value, 2.5); assert.equal(f.state.result.value, result); assert.equal(f.state.quad.value, selections); assert.equal(f.state.review.value, '需要调整')
})
