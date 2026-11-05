const { chromium } = require('playwright')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..'), base = process.env.DILONG_TEST_BASE || 'http://127.0.0.1:51458'
const output = process.env.DILONG_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'dilong-vue-ink-production-'))
fs.mkdirSync(output, { recursive: true })
const results = [], errors = []
let browser, context, page, activeGroup = ''
async function service(target = page) { await target.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); await S.ready; window.__S = S }) }
async function waitSaved(id) { await page.waitForFunction(id => window.__S.inkRecordStatus?.id === id && window.__S.inkRecordStatus?.state === 'ready', id) }
async function count() { return page.evaluate(() => window.__S.inkRuns.length) }
async function open(id, target = page) { await target.evaluate(id => window.__S.openInkRun(window.__S.inkRuns.find(run => run.id === id)), id); await target.locator('.ink-run-info strong').waitFor(); await target.waitForFunction(id => window.__S.inkRuns.find(run => run.id === id)?.inputName === document.querySelector('.ink-run-info strong')?.textContent.replace('当前配墨记录：', ''), id) }
async function check(name, action) {
  activeGroup = name
  await action(); results.push(name); console.log('PASS ' + name)
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
}
async function fixture(target = page) { return target.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; const ctx = c.getContext('2d')
  const transparent = c.toDataURL().split(',')[1], data = ctx.createImageData(96, 64)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) data.data.set([x * 2, y * 3, (x + y) % 128 * 2, 255], (y * 96 + x) * 4)
  ctx.putImageData(data, 0, 0); const gradient = c.toDataURL().split(',')[1]
  for (let i = 3; i < data.data.length; i += 4) data.data[i] = 1
  ctx.putImageData(data, 0, 0); const faint = c.toDataURL().split(',')[1]
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 96, 64); const white = c.toDataURL().split(',')[1]
  c.width = 192; c.height = 128; ctx.fillStyle = 'rgb(120,80,40)'; ctx.fillRect(0, 0, c.width, c.height); const solidLarge = c.toDataURL().split(',')[1]
  c.width = 96; c.height = 64; ctx.fillStyle = 'rgb(120,80,40)'; ctx.fillRect(0, 0, c.width, c.height); const solid = c.toDataURL().split(',')[1]
  return { transparent, gradient, faint, white, solid, solidLarge }
}) }
const uploadInk = (name, data, mimeType = 'image/png') => page.getByLabel('上传配墨图片').setInputFiles({ name, mimeType, buffer: Buffer.from(data, 'base64') })
async function doneProduction() { await page.waitForFunction(() => document.querySelector('.comparison-metric strong')?.textContent !== '—' && !document.querySelector('.calculation-progress')); assert(await page.getByRole('button', { name: '导出比对报告', exact: true }).isEnabled()) }
async function runProduction() { await page.getByRole('button', { name: '确认对齐并分析', exact: true }).click(); await doneProduction() }
async function fileProduction(side, name, data) { await page.getByLabel(side === 0 ? '上传设计原图' : '上传生产实物', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }); await page.waitForFunction(() => !document.querySelector('.source-card .spin')) }
;(async () => {
 console.log('OUTPUT ' + output)
 browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
 context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
 await context.addInitScript(() => { Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined }) })
 page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message))
 await page.goto(base + '/ink'); await service(); await page.locator('.layer-card').first().waitFor()
 const images = await fixture(); let firstId, secondId
 await check('配墨初始演示不计入历史，真实色层与合成偏差可用', async () => { assert.equal(await count(), 0); assert(await page.locator('.layer-card').count() >= 2); assert.notEqual(await page.locator('.ink-metric').filter({ hasText: '合成偏差' }).locator('strong').innerText(), '—') })
 await check('上传保存完整原图、typed array模型、色层及参数，自动更新同次快照', async () => {
  await uploadInk('gradient.png', images.gradient); await page.waitForFunction(() => window.__S.inkRuns.length === 1); firstId = await page.evaluate(() => window.__S.inkRuns[0].id); assert.match(firstId, /^ink-[0-9a-f-]{36}-\d+$/)
  assert(await page.evaluate(() => { const run = window.__S.inkRuns[0]; return window.__S.canRestoreInkRun(run) && run.snapshot.renderModel.original instanceof Uint8ClampedArray && run.snapshot.renderModel.assignments instanceof Uint8Array && run.snapshot.layers.every(layer => layer.maskUrl.startsWith('data:image/')) }))
  await page.locator('#ink-weight').fill('27.5'); await page.locator('.layer-switch input').nth(1).uncheck(); await page.locator('.layer-select').last().click(); await page.getByRole('tab', { name: '单层配方详情', exact: true }).click()
  await page.waitForFunction(id => { const s = window.__S.inkRuns.find(run => run.id === id).snapshot.settings; return s.weight === 27.5 && !s.enabled[1] && s.selectedLayer >= 1 && s.tab === 'detail' }, firstId)
  assert.equal(await count(), 1)
 })
 await check('第二次上传后恢复历史不重算，恢复原图、开关、重量、色层和tab', async () => {
  await uploadInk('white.png', images.white); await page.waitForFunction(() => window.__S.inkRuns.length === 2); secondId = await page.evaluate(() => window.__S.inkRuns.find(run => run.inputName === 'white.png').id)
  await page.evaluate(() => { window.__getImageData = CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData = () => { throw Error('HISTORY_MUST_NOT_REANALYZE') } })
  await open(firstId); assert.equal(await page.locator('#ink-weight').inputValue(), '27.5'); assert.equal(await page.locator('.layer-switch input:not(:checked)').count(), 1); assert.equal(await page.getByRole('tab', { name: '单层配方详情' }).getAttribute('aria-selected'), 'true'); assert.equal(await count(), 2)
  await page.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = window.__getImageData })
 })
 await check('历史导出绑定当次图片、分析时间、重量和真实配方', async () => {
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出配墨建议单', exact: true }).click(); const download = await pending, destination = path.join(output, download.suggestedFilename()); await download.saveAs(destination)
  const text = fs.readFileSync(destination, 'utf8'); assert(text.includes('gradient.png')); assert(text.includes('27.5 kg')); assert(text.includes(await page.evaluate(id => new Date(window.__S.inkRuns.find(run => run.id === id).createdAt).toLocaleString('zh-CN'), firstId))); assert(text.includes('当前合成偏差（白底）'))
 })
 await check('参数修改后刷新仍能恢复，打开历史不新增计数', async () => {
  await page.locator('#ink-weight').fill('32.5'); await page.getByRole('button', { name: '全部开启', exact: true }).click(); await page.getByRole('tab', { name: '全部色层总览' }).click(); await page.waitForFunction(id => { const s = window.__S.inkRuns.find(run => run.id === id).snapshot.settings; return s.weight === 32.5 && s.enabled.every(Boolean) && s.tab === 'overview' }, firstId)
  await page.reload(); await service(); await open(firstId); assert.equal(await page.locator('#ink-weight').inputValue(), '32.5'); assert.equal(await count(), 2)
 })
 await check('保存失败保留持久值，重试保存不重算不重复计数', async () => {
  await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'inkRuns') throw Error('TEST_HISTORY_SAVE'); return window.__put.apply(this, args) } })
  await page.locator('#ink-weight').fill('38'); await page.getByRole('button', { name: '重试保存', exact: true }).waitFor(); assert.equal(await page.evaluate(id => window.__S.inkRuns.find(run => run.id === id).snapshot.settings.weight, firstId), 32.5)
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put }); await page.getByRole('button', { name: '重试保存', exact: true }).click(); await page.waitForFunction(id => window.__S.inkRuns.find(run => run.id === id).snapshot.settings.weight === 38, firstId); assert.equal(await count(), 2)
 })
 await check('首次记录失败可从当前预览重试，成功后才新增历史', async () => {
  await page.evaluate(() => { window.__put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'inkRuns') throw Error('TEST_FIRST_SAVE'); return window.__put.apply(this, args) } })
  await uploadInk('retry-first.png', images.gradient); await page.getByRole('button', { name: '重试保存', exact: true }).waitFor(); assert.equal(await count(), 2)
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put }); await page.getByRole('button', { name: '重试保存', exact: true }).click(); await page.waitForFunction(() => window.__S.inkRuns.length === 3)
 })
 await check('删历史后当前预览可导出，修改参数不会复活已删记录', async () => {
  await page.evaluate(async () => { const run = window.__S.inkRuns.find(run => run.inputName === 'retry-first.png'); window.__deletedRun = run.id; await window.__S.deleteHistory('inkRuns', [run.id]) }); await page.getByText('此次历史已删除。', { exact: false }).waitFor(); await page.locator('#ink-weight').fill('41'); await page.waitForTimeout(250)
  assert(await page.evaluate(() => !window.__S.inkRuns.some(run => run.id === window.__deletedRun))); assert(await page.getByRole('button', { name: '导出配墨建议单', exact: true }).isEnabled())
 })
 await check('跨标签修改冲突保留预览、阻止覆盖，显式重载后恢复保存', async () => {
  await open(firstId); const other = await context.newPage(); other.on('pageerror', error => errors.push(error.message)); await other.goto(base + '/ink'); await service(other); await open(firstId, other)
  await other.locator('#ink-weight').fill('17'); await other.waitForFunction(id => window.__S.inkRuns.find(run => run.id === id).snapshot.settings.weight === 17, firstId)
  await page.getByRole('button', { name: '重新加载最新记录', exact: true }).waitFor(); assert.equal(await page.locator('#ink-weight').inputValue(), '38'); await page.locator('#ink-weight').fill('11'); await page.waitForTimeout(250); assert.equal(await other.evaluate(id => window.__S.inkRuns.find(run => run.id === id).snapshot.settings.weight, firstId), 17)
  await page.getByRole('button', { name: '重新加载最新记录', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#ink-weight')?.value === '17'); await other.close()
 })
 await check('仅完全透明拒绝，极低透明图片仍可分析，失败清除旧结果', async () => {
  const before = await count(); await uploadInk('transparent.png', images.transparent); await page.getByRole('alert').filter({ hasText: '完全透明' }).waitFor(); assert.equal(await page.locator('.layer-card').count(), 0); assert(await page.getByRole('button', { name: '导出配墨建议单', exact: true }).isDisabled()); assert.equal(await count(), before)
  await uploadInk('faint.png', images.faint); await page.waitForFunction(before => window.__S.inkRuns.length === before + 1, before); assert(await page.getByRole('button', { name: '导出配墨建议单', exact: true }).isEnabled())
  await page.getByLabel('上传配墨图片').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }); await page.getByRole('alert').filter({ hasText: '加载失败' }).waitFor(); assert.equal(await page.locator('.layer-card').count(), 0); assert.equal(await page.locator('.ink-metric').filter({ hasText: '合成偏差' }).locator('strong').innerText(), '—')
  await uploadInk('white-true-zero.png', images.white); await page.locator('.layer-card').first().waitFor(); assert.match(await page.locator('.ink-metric').filter({ hasText: '合成偏差' }).locator('strong').innerText(), /^0\.00/)
 })
 await check('类型与大小校验清空旧结果，失败不新增成功历史', async () => {
  const before = await count()
  await page.getByLabel('上传配墨图片').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('text') }); await page.getByRole('alert').filter({ hasText: '仅支持' }).waitFor(); assert.equal(await page.locator('.layer-card').count(), 0)
  await page.getByLabel('上传配墨图片').setInputFiles({ name: 'oversize.png', mimeType: 'image/png', buffer: Buffer.concat([Buffer.from(images.gradient, 'base64'), Buffer.alloc(12 * 1024 * 1024)]) }); await page.getByRole('alert').filter({ hasText: '12 MB' }).waitFor(); assert.equal(await page.locator('.layer-card').count(), 0); assert.equal(await count(), before)
  await open(firstId)
 })
 await check('打开历史会取消晚到的新图分析，不覆盖历史或新增计数', async () => {
  const before = await count()
  await page.evaluate(() => { window.__timeout = window.setTimeout; window.setTimeout = (fn, delay, ...args) => window.__timeout(fn, delay === 40 ? 1200 : delay, ...args) })
  await uploadInk('late-analysis.png', images.gradient); await open(firstId); await page.waitForTimeout(1400); assert.equal(await page.locator('#ink-weight').inputValue(), '17'); assert.equal(await count(), before)
  await page.evaluate(() => { window.setTimeout = window.__timeout })
 })
 await check('配墨无效重量阻止导出，图像点击可打开原尺寸大图', async () => {
  await page.locator('#ink-weight').fill('0'); assert(await page.getByRole('button', { name: '导出配墨建议单', exact: true }).isDisabled()); await page.locator('#ink-weight').fill('10')
  const thumbnail = page.locator('.image-stage').first().locator('button').first(); await thumbnail.click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
 })
 await check('生产演示自动载入，初始不冒充已完成分析', async () => { await page.goto(base + '/production'); await page.locator('.source-frame img').nth(1).waitFor(); await page.waitForFunction(() => !document.querySelector('.source-card .spin')); assert.equal(await page.locator('.source-frame img').count(), 2); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '—'); assert.equal(await page.getByRole('button', { name: '载入演示样本', exact: true }).count(), 0); await runProduction() })
 await check('四项指标公式与实际结果弹窗可打开、Escape关闭', async () => { for (const kind of ['ΔE00', 'RGB', 'SSIM', '偏色']) { const card = page.locator('.comparison-metric').filter({ hasText: kind }).first(); await card.click(); await page.locator('.metric-dialog[open]').waitFor(); assert((await page.locator('.metric-dialog').innerText()).includes('有效像素')); assert(await page.locator('.metric-dialog pre').count() >= 1); await page.keyboard.press('Escape'); await page.locator('.metric-dialog').waitFor({ state: 'hidden' }) } })
 await check('矩形ROI拖动与四角百分比编辑同步右侧只读选区，按原像素计算', async () => {
  const selection = page.getByLabel('拖动框选原图区域'); await selection.scrollIntoViewIfNeeded(); const box = await selection.boundingBox(); await page.mouse.move(box.x + box.width * .15, box.y + box.height * .2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height * .85); await page.mouse.up()
  assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '—'); const before = await page.locator('.selection polygon').evaluateAll(elements => elements.map(element => element.getAttribute('points'))); assert.equal(before[0], before[1]); assert.equal(await page.getByLabel('实物选区随原图同步，只读').getAttribute('aria-disabled'), 'true')
  await page.locator('.source-tools summary').click(); for (const [label, value] of [['原图角点1X百分比', '20'], ['原图角点1Y百分比', '10'], ['原图角点3X百分比', '80'], ['原图角点3Y百分比', '90']]) { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).dispatchEvent('change') }
  await runProduction(); const expected = await page.evaluate(async () => { const { CompareCore } = await import('/src/core/production-compare-core.ts'); const image = document.querySelector('.source-frame img'); const canvas = document.createElement('canvas'); const source = new Image(); source.src = image.src; await source.decode(); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight; canvas.getContext('2d').drawImage(source, 0, 0); return CompareCore.comparisonBounds({ width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data }, [{x:.2,y:.1},{x:.8,y:.1},{x:.8,y:.9},{x:.2,y:.9}]) }); assert((await page.locator('.visual-footer').innerText()).includes(expected.width.toLocaleString() + ' × ' + expected.height.toLocaleString()))
  const readonly = page.getByLabel('实物选区随原图同步，只读'); await readonly.scrollIntoViewIfNeeded(); const right = await readonly.boundingBox(); await page.mouse.move(right.x + 5, right.y + 5); await page.mouse.down(); await page.mouse.move(right.x + 50, right.y + 70); await page.mouse.up(); assert(await page.getByRole('button', { name: '导出比对报告', exact: true }).isEnabled())
 })
 await check('局部查看使用原始像素，显示对应RGB、Lab与平均色差', async () => { const target = page.locator('.inspect-image').first(); const box = await target.boundingBox(); await target.click({ position: { x: box.width * .5, y: box.height * .5 } }); const text = await page.locator('.local-inspection').innerText(); for (const label of ['局部平均色差', '设计 RGB', '实物 RGB', '设计 Lab', '实物 Lab', '225 个有效像素']) assert(text.includes(label)) })
 await check('透明叠加、热图、阈值调整不篡改指标，重置选区清空过期结果', async () => {
  const metrics = await page.locator('.comparison-metric strong').allTextContents(); await page.getByTitle('透明叠加', { exact: true }).click(); await page.locator('#overlay-opacity').evaluate(field => { field.value = '27'; field.dispatchEvent(new Event('input', { bubbles: true })) }); assert((await page.locator('.stage-badge').innerText()).includes('27%'))
  await page.getByTitle('色差热图', { exact: true }).click(); const before = await page.locator('.heat-stage img').getAttribute('src'); await page.locator('#heat-threshold').evaluate(field => { field.value = '12.5'; field.dispatchEvent(new Event('input', { bubbles: true })) }); assert.notEqual(await page.locator('.heat-stage img').getAttribute('src'), before); assert.deepEqual(await page.locator('.comparison-metric strong').allTextContents(), metrics)
  await page.getByRole('button', { name: '重置两侧选区', exact: true }).click(); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '—'); assert.equal(await page.locator('.local-inspection').count(), 0); await runProduction()
 })
 await check('HTML报告内嵌三张图、真实指标和选区，人工文本转义且离线可打开', async () => {
  await page.getByPlaceholder('输入样品名称').fill('样品 <真实>'); await page.getByPlaceholder('填写实际批次（可选）').fill('B-001'); await page.locator('.review-form textarea').fill('<script>alert("unsafe")</script>\n人工备注'); await page.locator('.review-form select').selectOption('需要调整')
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出比对报告', exact: true }).click(); const download = await pending, destination = path.join(output, download.suggestedFilename()); await download.saveAs(destination)
  const html = fs.readFileSync(destination, 'utf8'); assert(html.includes('&lt;真实&gt;')); assert(html.includes('&lt;script&gt;')); assert(!html.includes('<script>')); assert.equal((html.match(/<img src="data:image\/png/g) || []).length, 3); assert(html.includes('B-001')); assert(html.includes('12.5')); assert(html.includes('归一化选区坐标'))
  const report = await context.newPage(); await report.goto(require('node:url').pathToFileURL(destination).href); assert.equal(await report.locator('img').count(), 3); assert(await report.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))); assert((await report.locator('body').innerText()).includes('<script>alert("unsafe")</script>')); await report.close()
 })
 await check('不同尺寸实物双线性映射原图网格，局部RGB/Lab数值正确', async () => {
  await fileProduction(0, 'solid.png', images.solid); await fileProduction(1, 'solid-large.png', images.solidLarge); await runProduction(); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '0.00'); assert.equal(await page.locator('.comparison-metric strong').nth(2).innerText(), '100.0%'); assert((await page.locator('.visual-footer').innerText()).includes('96 × 64'))
  await page.locator('.inspect-image').first().click(); const text = await page.locator('.local-inspection').innerText(); assert(text.includes('120.0 / 80.0 / 40.0')); assert(text.includes('0.00 ΔE00'))
 })
 await check('生产坏图清空旧指标、不能导出，有效图片后恢复；窄小选区有明确错误', async () => {
  await page.getByLabel('上传生产实物', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '—'); assert(await page.getByRole('button', { name: '导出比对报告', exact: true }).isDisabled()); await fileProduction(1, 'solid-large.png', images.solidLarge)
  const detail = page.locator('.source-tools details'); if (!(await detail.getAttribute('open'))) await detail.locator('summary').click(); for (const [label, value] of [['原图角点1X百分比', '0'], ['原图角点1Y百分比', '0'], ['原图角点3X百分比', '1'], ['原图角点3Y百分比', '1']]) { await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).dispatchEvent('change') }
  await page.getByRole('button', { name: '确认对齐并分析', exact: true }).click(); await page.getByRole('alert').waitFor(); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '—'); await page.getByRole('button', { name: '重置两侧选区', exact: true }).click(); await runProduction()
 })
 await check('原始大图计算可取消，恢复后完整原始像素参与计算', async () => {
  await page.getByLabel('上传设计原图', { exact: true }).setInputFiles(path.join(root, 'public/demo-pair/01-design-ai.png')); await page.waitForFunction(() => !document.querySelector('.source-card .spin')); await page.getByLabel('上传生产实物', { exact: true }).setInputFiles(path.join(root, 'public/demo-pair/02-production-ai.png')); await page.waitForFunction(() => !document.querySelector('.source-card .spin'))
  await page.getByRole('button', { name: '确认对齐并分析', exact: true }).click(); await page.getByRole('button', { name: '取消计算', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '计算已取消' }).waitFor(); await runProduction(); assert((await page.locator('.visual-footer').innerText()).includes('1,254 × 1,254')); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '16.19')
 })
 await check('切换模块保留配墨参数、生产结果和人工字段，桌面与390均无横溢', async () => {
  await service(); await open(firstId); await page.locator('#ink-weight').fill('21.5'); await page.waitForFunction(id => window.__S.inkRuns.find(run=>run.id===id).snapshot.settings.weight===21.5,firstId); await page.evaluate(() => window.__S.navigate('production')); await page.getByRole('button', { name: '导出比对报告', exact: true }).waitFor(); assert.equal(await page.getByPlaceholder('输入样品名称').inputValue(), '样品 <真实>'); assert.equal(await page.locator('.comparison-metric strong').first().innerText(), '16.19')
  for (const width of [1440, 1024, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: path.join(output, 'production-' + width + '.png'), fullPage: true, animations: 'disabled' }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.evaluate(() => window.__S.navigate('color')); await page.locator('#ink-weight').waitFor(); assert.equal(await page.locator('#ink-weight').inputValue(), '21.5'); await page.screenshot({ path: path.join(output, 'ink-' + width + '.png'), fullPage: true, animations: 'disabled' }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.evaluate(() => window.__S.navigate('production')); await page.locator('.metric-grid').waitFor() }
  assert.deepEqual(errors, [])
 })
 console.log('DONE ' + results.length + ' groups; ' + output)
})().catch(async error => { console.error('FAILED ' + activeGroup, error); if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, failed: activeGroup, failure: String(error) }, null, 2)); process.exitCode = 1 }).finally(async () => { if (context) await context.close(); if (browser) await browser.close() })
