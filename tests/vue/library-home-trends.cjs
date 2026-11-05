/* Formal routes and real UI, with an isolated IndexedDB per browser context. */
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const origin = process.env.DILONG_URL || 'http://127.0.0.1:51458'
const filter = process.env.DILONG_TEST_FILTER || ''
const output = path.resolve(process.env.DILONG_TEST_OUTPUT || 'verification/vue-library-home-trends')
fs.mkdirSync(output, { recursive: true })
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function ready(page, route = '/') {
  await page.goto(origin + route)
  await page.locator('.app-shell').waitFor()
  await page.locator('main h1').waitFor()
  await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.ready)
  await page.waitForFunction(async () => (await import('/src/services/workflows.ts')).S.base.length === 2990)
}
async function navigate(page, route) { await page.locator(`.text-navigation a[href="${route}"]`).click(); await page.waitForURL(origin + route) }
async function records(page, store) {
  return page.evaluate(async store => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('dilong-workflows', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise((resolve, reject) => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    finally { database.close() }
  }, store)
}
async function untilRecords(page, store, predicate) {
  for (let attempt = 0; attempt < 100; attempt++) { const rows = await records(page, store); if (predicate(rows)) return rows; await delay(100) }
  throw Error(`等待 ${store} 状态超时`)
}
async function closeModal(page) { await page.locator('.ant-modal:visible .ant-modal-close').last().click(); await page.waitForFunction(() => !document.querySelector('.ant-modal-wrap:not([style*="display: none"]) .ant-modal')) }
async function openArchive(page, id) {
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await page.getByLabel('搜索样例', { exact: true }).fill(id)
  await page.locator(`.sample-card[data-sample-id="${id}"] .texture-name`).click(); await page.getByRole('button', { name: '查看完整样例档案', exact: false }).click()
  await page.locator(`.sample-archive[data-sample-id="${id}"]`).waitFor()
}
async function packageBuffer(page, samples) {
  return Buffer.from(await page.evaluate(async samples => {
    const { S } = await import('/src/services/workflows.ts')
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 40; const context = canvas.getContext('2d')
    context.fillStyle = '#bda57e'; context.fillRect(0, 0, 64, 40); context.fillStyle = '#62503b'; for (let y = 0; y < 40; y += 5) context.fillRect(0, y, 64, 1)
    const image = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), char => char.charCodeAt(0)), encoder = new TextEncoder()
    const rows = samples.map((sample, index) => ({ ...sample, image: `images/${index}.png` })); const files = [['manifest.json', encoder.encode(JSON.stringify({ schemaVersion: 1, samples: rows }))]]
    for (const [index, sample] of samples.entries()) files.push([`images/${index}.png`, sample.broken ? encoder.encode('invalid image') : image])
    return Array.from(new Uint8Array(await S.zip(files).arrayBuffer()))
  }, samples))
}
async function importPackage(page, bytes, name = '真实样例包.zip') {
  await page.getByRole('button', { name: '导入样例文件包', exact: true }).click()
  await page.locator('.package-manager input[type=file]').setInputFiles({ name, mimeType: 'application/zip', buffer: bytes })
  await page.locator('.import-preview').waitFor()
}
function unzip(bytes) {
  const files = new Map(); let position = 0
  while (position + 30 <= bytes.length && bytes.readUInt32LE(position) === 0x04034b50) {
    const flags = bytes.readUInt16LE(position + 6), method = bytes.readUInt16LE(position + 8), compressedSize = bytes.readUInt32LE(position + 18), length = bytes.readUInt16LE(position + 26), extra = bytes.readUInt16LE(position + 28)
    assert.equal(flags & 8, 0, '导出的ZIP应明确记录文件长度')
    const filename = bytes.subarray(position + 30, position + 30 + length).toString('utf8'), start = position + 30 + length + extra
    const body = bytes.subarray(start, start + compressedSize)
    files.set(filename, method === 0 ? body : method === 8 ? zlib.inflateRawSync(body) : assert.fail(`不支持的ZIP压缩方法 ${method}`))
    position = start + compressedSize
  }
  assert(files.has('manifest.json')); return files
}
async function ownSample(page, name = '双页同步纹理') {
  return page.evaluate(async name => {
    const { S } = await import('/src/services/workflows.ts'), canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d'); context.fillStyle = '#bc9971'; context.fillRect(0, 0, 32, 32)
    return (await S.save(canvas.toDataURL(), name, '测试准备', {}, 'ui-own-sample', null)).id
  }, name)
}
async function prepareHome(page) {
  return page.evaluate(async () => {
    const { S } = await import('/src/services/workflows.ts'), { analyzeInk } = await import('/src/core/color-analysis.ts')
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; const context = canvas.getContext('2d')
    context.fillStyle = '#d8bc8d'; context.fillRect(0, 0, 64, 48); context.fillStyle = '#6e5745'; for (let y = 0; y < 48; y += 7) context.fillRect(0, y, 64, 2)
    const imageUrl = canvas.toDataURL(), taskIds = [], assetIds = [], inkIds = []
    for (let index = 0; index < 4; index++) {
      const sample = S.base[index], task = await S.beginDesignTask({ mode: 'compare', runKey: S.createId(), input: { kind: 'library', sampleId: sample.id, name: `统计任务${index + 1}` }, parameters: { sorting: 'balanced', limit: 5 } })
      taskIds.push(task.id)
      if (index < 3) await S.updateTask(task.id, { status: '已处理', outputCount: 5, completedAt: new Date().toISOString() })
      if (index < 2) { const asset = await S.save(imageUrl, `统计候选${index + 1}`, '相似检索', {}, `home-candidate-${index}`, task.id); assetIds.push(asset.id); if (index === 1) await S.reviewCandidate(asset.id, 'accepted') }
    }
    const image = new Image(); image.src = imageUrl; await image.decode(); const analysis = analyzeInk(image)
    for (let index = 0; index < 3; index++) {
      const id = S.createId(), enabled = analysis.layers.map(() => true)
      await S.recordInkRun({ id, createdAt: new Date(Date.now() + index * 1000).toISOString(), inputName: `统计配墨${index + 1}.png`, source: '测试准备', sampleId: S.base[0].id, layerCount: analysis.layers.length, difference: S.layerDifference(analysis.renderModel, enabled), snapshot: { version: 1, imageUrl, layers: analysis.layers, renderModel: analysis.renderModel, settings: { weight: 12 + index, enabled, selectedLayer: 0, tab: 'overview' } } })
      inkIds.push(id)
    }
    return { taskIds, assetIds, inkIds }
  })
}
function stat(page, label) { return page.locator('.dashboard-stat-button').filter({ hasText: label }) }

;(async () => {
  const browser = await chromium.launch({ channel: process.env.DILONG_BROWSER_CHANNEL || 'chrome', headless: true })
  const results = [], errors = []
  async function check(name, route, action) {
    if (filter && !name.includes(filter)) return
    const context = await browser.newContext({ viewport: { width: 1480, height: 1100 }, acceptDownloads: true }), page = await context.newPage()
    page.setDefaultTimeout(20000); page.on('pageerror', reason => errors.push(`${name}: ${reason.message}`))
    try {
      await ready(page, route); await action(page, context); results.push(name); console.log(`PASS ${name}`)
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
    } catch (reason) {
      await page.screenshot({ path: path.join(output, `failure-${results.length + 1}.png`), fullPage: true })
      fs.writeFileSync(path.join(output, `failure-${results.length + 1}.json`), JSON.stringify(await page.evaluate(async () => {
        const { S } = await import('/src/services/workflows.ts')
        return { url: location.href, activeElement: document.activeElement?.outerHTML.slice(0, 500), statsView: S.statsView, dialogs: Array.from(document.querySelectorAll('.ant-modal')).map(element => ({ text: element.textContent.slice(0, 500), display: getComputedStyle(element.closest('.ant-modal-wrap')).display })) }
      }), null, 2))
      throw reason
    }
    finally { await context.close() }
  }
  try {
    await check('2990默认样例、24分页尾页14、跳页、分类搜索组合与懒加载', '/samples', async page => {
      assert.equal(await page.locator('.sample-card').count(), 24)
      assert.equal(await page.locator('.library-count b').textContent(), '2990')
      assert.equal(await page.getByLabel('跳转到页').locator('option').count(), 125)
      const initialImages = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.initiatorType === 'img').map(entry => entry.name))
      assert(initialImages.length <= 30, `首屏不应请求整个图库，实际图片请求 ${initialImages.length}`)
      await page.getByLabel('跳转到页').selectOption('125'); assert.equal(await page.locator('.sample-card').count(), 14); assert(await page.getByRole('button', { name: '下一页', exact: true }).isDisabled())
      await page.getByRole('button', { name: '上一页', exact: true }).click(); assert.equal(await page.locator('.sample-card').count(), 24); assert.equal(await page.getByLabel('跳转到页').inputValue(), '124')
      for (const category of ['木纹', '橡木', '胡桃木', '其他木纹', '石纹', '织物 / 皮革', '涂层 / 混凝土']) {
        await page.getByRole('button', { name: category, exact: true }).click(); assert.equal(await page.getByLabel('跳转到页').inputValue(), '1'); assert(await page.locator('.sample-card').count() > 0)
        const displayed = await page.locator('.sample-card-body>p').allTextContents(); assert(displayed.length > 0)
        if (category === '石纹') assert(displayed.every(text => text.includes('石纹')))
        if (category === '橡木' || category === '胡桃木') assert(displayed.every(text => text.startsWith(category)))
      }
      await page.getByRole('button', { name: '全部', exact: true }).click()
      const id = await page.locator('.sample-card').first().getAttribute('data-sample-id'); await page.getByLabel('搜索样例', { exact: true }).fill(id.toUpperCase()); assert.equal(await page.locator('.sample-card').count(), 1)
      await page.getByLabel('搜索样例', { exact: true }).fill('不存在的纹理-UNIQUE-3094'); await page.getByText('没有匹配的样例', { exact: true }).waitFor(); assert.equal(await page.locator('.sample-card').count(), 0)
      await page.getByLabel('搜索样例', { exact: true }).fill(''); await page.getByRole('button', { name: '全部', exact: true }).click(); await page.locator('.library-categories').getByRole('button', { name: /^我的样例/ }).click(); assert.equal(await page.locator('.sample-card').count(), 0)
    })
    await check('公共纹理档案来源与许可可追溯，业务空值不伪造且无编辑删除入口', '/samples', async page => {
      const publicSample = await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.base.find(sample => sample.isPublicTexture))
      await openArchive(page, publicSample.id); const archive = page.locator('.sample-archive')
      await archive.getByText('公开纹理素材不附带客户、生产配方或生产记录。', { exact: true }).waitFor()
      assert.equal(await archive.getByRole('button', { name: '编辑信息', exact: true }).count(), 0); assert.equal(await archive.getByRole('button', { name: '删除样例', exact: true }).count(), 0)
      assert.equal(await archive.getByRole('link', { name: '查看来源', exact: false }).getAttribute('href'), publicSample.sourceUrl)
      assert.equal(await archive.getByRole('link', { name: '查看许可说明', exact: true }).getAttribute('href'), publicSample.licenseUrl)
      assert((await archive.textContent()).includes('尚未提供生产记录。')); assert((await archive.textContent()).includes('未填写'))
      const image = archive.locator('.big-image-trigger img'); assert(image); assert.equal(await image.evaluate(element => getComputedStyle(element).objectFit), 'contain')
      await closeModal(page); await page.getByLabel('搜索样例', { exact: true }).fill(publicSample.id); assert.equal(await page.locator('.sample-card').count(), 1)
    })
    await check('ZIP预检区分有效重复坏图，导入后只计个人样例', '/samples', async page => {
      const baseId = await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.base[0].id)
      const bytes = await packageBuffer(page, [{ id: 'UI-IMPORT-001', name: '自有橡木来样', wood: '橡木', style: '自然', tone: '浅色', source: '自有拍摄' }, { id: baseId, name: '重复示例' }, { id: 'UI-BROKEN', name: '损坏图片', broken: true }])
      await importPackage(page, bytes); await page.getByText('有效 1 · 重复 1 · 错误 1', { exact: true }).waitFor()
      assert.match(await page.locator('.import-rows').textContent(), /UI-BROKEN.*错误/); assert.equal((await records(page, 'assets')).length, 0)
      await page.getByRole('button', { name: '确认导入有效记录', exact: true }).click(); await page.getByText('已导入 1 条样例', { exact: true }).waitFor()
      const assets = await untilRecords(page, 'assets', rows => rows.length === 1); assert.equal(assets[0].id, 'UI-IMPORT-001'); assert.equal(assets[0].staff.designer, '未填写'); assert.equal(assets[0].productionRecords.length, 0)
      await page.getByRole('button', { name: '查看导入样例', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.package-manager')); assert.equal(await page.locator('.sample-card').count(), 1)
      assert.equal(await page.getByLabel('搜索样例', { exact: true }).inputValue(), 'UI-IMPORT-001'); assert.equal(await page.locator('.library-categories .active').textContent(), '我的样例')
      await page.getByRole('button', { name: '导入样例文件包', exact: true }).click(); await page.locator('.package-manager input[type=file]').setInputFiles({ name: 'again.zip', mimeType: 'application/zip', buffer: bytes }); await page.getByText('有效 0 · 重复 2 · 错误 1', { exact: true }).waitFor(); assert(await page.getByRole('button', { name: '确认导入有效记录', exact: true }).isDisabled())
    })
    await check('全部业务人员生产历史字段可编辑、校验并在ZIP清单往返保留', '/samples', async (page, context) => {
      const bytes = await packageBuffer(page, [{ id: 'UI-META', name: '完整资料测试', wood: '橡木', style: '自然', tone: '浅色', source: '自有拍摄' }]); await importPackage(page, bytes)
      await page.getByRole('button', { name: '确认导入有效记录', exact: true }).click(); await page.getByRole('button', { name: '查看导入样例', exact: true }).click(); await openArchive(page, 'UI-META')
      await page.locator('.sample-archive').getByRole('button', { name: '编辑信息', exact: true }).click(); const form = page.locator('.metadata-form')
      const basic = { name: '客户A橡木新版', wood: '白橡木', style: '自然中古', tone: '暖米色', source: '客户提供原图', customer: '客户A / 客厅', customerCode: 'CUST-07', orderNo: 'ORDER-202611', substrate: '70g原纸', inkSeries: 'INK-WB-02', machine: '帝龙机台3' }
      const staff = { designer: '设计张三', colorist: '调墨李四', operator: '生产王五', reviewer: '审核赵六' }
      const fields = await page.evaluate(async () => { const metadata = await import('/src/core/sample-metadata.ts'); return { basic: metadata.groups.flatMap(group => group.fields), staff: metadata.staffFields, production: metadata.productionFields } })
      for (const [key, label] of fields.basic) await form.getByLabel(label, { exact: true }).fill(basic[key])
      for (const [key, label] of fields.staff) await form.getByLabel(label, { exact: true }).fill(staff[key])
      await form.getByRole('button', { name: '添加生产记录', exact: true }).click()
      await form.getByLabel('生产记录1阶段', { exact: true }).fill('中试'); await form.getByRole('button', { name: '保存信息', exact: true }).click(); await form.getByRole('alert').filter({ hasText: /请填写批次编号/ }).waitFor()
      const production = { batchNo: 'BATCH-026', stage: '中试', date: '2026-11-03', equipment: '印刷机P3', quantity: '500米', substrate: '70g进口原纸', deltaE: '1.25', result: '客户确认', operator: '生产王五' }
      for (const [key, label] of fields.production) await form.getByLabel(`生产记录1${label}`, { exact: true }).fill(production[key])
      await form.getByLabel('生产记录1实测色差', { exact: true }).fill('-1'); await form.getByRole('button', { name: '保存信息', exact: true }).click(); await form.getByRole('alert').filter({ hasText: /实测色差必须/ }).waitFor(); await form.getByLabel('生产记录1实测色差', { exact: true }).fill(production.deltaE)
      await form.getByRole('button', { name: '添加历史记录', exact: true }).click(); await form.getByLabel('历史记录1日期', { exact: true }).fill('2026-11-02'); await form.getByLabel('历史记录1标题', { exact: true }).fill('客户初样确认'); await form.getByLabel('历史记录1状态', { exact: true }).fill('已确认'); await form.getByLabel('历史记录1描述', { exact: true }).fill('保留原图，进入生产验证。')
      await form.getByLabel('反馈说明', { exact: true }).fill('客户建议综合色略暖。\n需再做第二轮试印。'); await form.getByRole('button', { name: '保存信息', exact: true }).click(); await form.waitFor({ state: 'detached' })
      const asset = (await records(page, 'assets'))[0]; for (const [key, value] of Object.entries(basic)) assert.equal(asset[key], value); assert.deepEqual(asset.staff, staff); assert.deepEqual(asset.productionRecords, [production]); assert.equal(asset.history[0].title, '客户初样确认'); assert.equal(asset.history.at(-1).title, '样例信息更新'); assert(asset.feedback.includes('\n'))
      assert((await page.locator('.sample-archive').textContent()).includes('客户A / 客厅')); assert((await page.locator('.sample-archive').textContent()).includes('BATCH-026')); await closeModal(page)
      const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '导出本地样例包', exact: true }).click(); const download = await pending, filename = path.join(output, 'metadata-roundtrip.zip'); await download.saveAs(filename)
      const exported = fs.readFileSync(filename), files = unzip(exported), manifest = JSON.parse(files.get('manifest.json').toString('utf8')); assert.equal(manifest.samples.length, 1); const row = manifest.samples[0]
      for (const [key, value] of Object.entries(basic)) assert.equal(row[key], value); assert.deepEqual(row.staff, staff); assert.deepEqual(row.productionRecords, [production]); assert.deepEqual(row.history, asset.history); assert.equal(row.feedback, asset.feedback); assert(files.has(row.image))
      const second = await browser.newContext({ viewport: { width: 1480, height: 1100 } }), restored = await second.newPage(); restored.on('pageerror', reason => errors.push(`ZIP往返: ${reason.message}`))
      try { await ready(restored, '/samples'); await importPackage(restored, exported, 'metadata-roundtrip.zip'); await restored.getByRole('button', { name: '确认导入有效记录', exact: true }).click(); const rows = await untilRecords(restored, 'assets', rows => rows.length === 1); assert.deepEqual(rows[0].staff, staff); assert.deepEqual(rows[0].productionRecords, [production]); assert.deepEqual(rows[0].history, asset.history); assert.equal(rows[0].feedback, asset.feedback) } finally { await second.close() }
    })
    await check('跨标签编辑冲突保留草稿、确认重载和来源删除保护', '/samples', async (page, context) => {
      const id = await ownSample(page); await openArchive(page, id); await page.locator('.sample-archive').getByRole('button', { name: '编辑信息', exact: true }).click(); const form = page.locator('.metadata-form'); await form.getByLabel('样例名称', { exact: true }).fill('A尚未保存的草稿')
      const other = await context.newPage(); other.setDefaultTimeout(20000); other.on('pageerror', reason => errors.push(`跨标签: ${reason.message}`)); await ready(other, '/samples'); await openArchive(other, id); await other.locator('.sample-archive').getByRole('button', { name: '编辑信息', exact: true }).click(); await other.locator('.metadata-form').getByLabel('样例名称', { exact: true }).fill('B已保存的新版本'); await other.locator('.metadata-form').getByRole('button', { name: '保存信息', exact: true }).click(); await other.locator('.metadata-form').waitFor({ state: 'detached' })
      await form.locator('.conflict-notice').waitFor(); assert.equal(await form.getByLabel('样例名称', { exact: true }).inputValue(), 'A尚未保存的草稿'); assert(await form.getByRole('button', { name: '保存信息', exact: true }).isDisabled())
      page.once('dialog', dialog => dialog.dismiss()); await form.getByRole('button', { name: '重新加载最新内容', exact: true }).click(); assert.equal(await form.getByLabel('样例名称', { exact: true }).inputValue(), 'A尚未保存的草稿')
      page.once('dialog', dialog => dialog.accept()); await form.getByRole('button', { name: '重新加载最新内容', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.metadata-form input[aria-label="样例名称"]')?.value === 'B已保存的新版本'); assert(await form.getByRole('button', { name: '保存信息', exact: true }).isEnabled())
      await form.getByLabel('样例名称', { exact: true }).fill('删除后仍保留的A草稿'); other.once('dialog', dialog => dialog.accept()); await other.locator('.sample-archive').getByRole('button', { name: '删除样例', exact: true }).click(); await untilRecords(page, 'assets', rows => rows.length === 0)
      await form.getByText('该记录已在其他页面删除。当前填写内容已保留，但不能继续保存。', { exact: true }).waitFor(); assert.equal(await form.getByLabel('样例名称', { exact: true }).inputValue(), '删除后仍保留的A草稿'); assert(await form.getByRole('button', { name: '保存信息', exact: true }).isDisabled()); assert.equal(await form.getByRole('button', { name: '重新加载最新内容', exact: true }).count(), 0)
      await page.screenshot({ path: path.join(output, 'cross-tab-deleted-draft.png'), fullPage: true })
    })
    await check('首页真实统计、任务待评价配墨明细和打开历史不重复计数', '/', async page => {
      const prepared = await prepareHome(page)
      for (const [label, expected] of [['样例资产', '2992'], ['设计任务', '4'], ['待评价方案', '1'], ['配墨操作', '3']]) assert.equal(await stat(page, label).locator('strong').textContent(), expected)
      await stat(page, '设计任务').focus(); await page.keyboard.press('Enter'); await page.locator('.history-dialog').waitFor(); assert.equal(await page.locator('.history-dialog .summary-record').count(), 4)
      const taskRow = page.locator(`.history-dialog .summary-record[data-record-id="${prepared.taskIds[0]}"]`); assert((await taskRow.textContent()).includes('统计任务1')); assert((await taskRow.textContent()).includes('5 个结果；已保存 1 个候选'))
      await taskRow.getByRole('button', { name: '打开任务', exact: true }).click(); await page.locator('.design-page .saved-results').waitFor(); assert.equal((await records(page, 'tasks')).length, 4)
      await navigate(page, '/'); await stat(page, '待评价方案').click(); await page.locator('.history-dialog .summary-candidate').waitFor(); assert.equal(await page.locator('.summary-candidate').count(), 1); assert.equal(await page.locator('.history-dialog').getByRole('button', { name: /删除记录|删除所选/ }).count(), 0)
      await page.getByLabel('候选评价', { exact: true }).selectOption('accepted'); await page.getByText('暂无待评价方案', { exact: true }).waitFor(); assert.equal((await records(page, 'assets')).length, 2)
      await page.keyboard.press('Escape'); await page.locator('.history-dialog').waitFor({ state: 'detached' }); await page.waitForFunction(() => document.activeElement?.classList.contains('dashboard-stat-button')); assert(await stat(page, '待评价方案').evaluate(element => element === document.activeElement)); assert.equal(await stat(page, '待评价方案').locator('strong').textContent(), '0')
      await stat(page, '配墨操作').click(); assert.equal(await page.locator('.history-dialog .summary-record').count(), 3)
      await page.locator(`.summary-record[data-record-id="${prepared.inkIds[0]}"]`).getByRole('button', { name: '打开此次配墨', exact: true }).click(); await page.locator('.ink-run-info').waitFor(); assert.equal(await page.getByLabel('单层配墨重量', { exact: true }).inputValue(), '12'); assert.equal((await records(page, 'inkRuns')).length, 3)
      await navigate(page, '/'); assert.equal(await stat(page, '配墨操作').locator('strong').textContent(), '3'); assert.equal(await stat(page, '设计任务').locator('strong').textContent(), '4')
      await stat(page, '样例资产').click(); await page.waitForURL(origin + '/samples'); assert.equal(await page.locator('.sample-card').count(), 24)
    })
    await check('首页历史单条批量清理，处理中禁删，事务失败不部分删除', '/', async page => {
      const prepared = await prepareHome(page); await stat(page, '设计任务').click(); const history = page.locator('.history-dialog'), protectedRow = history.locator(`[data-record-id="${prepared.taskIds[3]}"]`)
      assert(await protectedRow.getByRole('button', { name: '删除记录', exact: true }).isDisabled()); assert(await protectedRow.getByRole('checkbox').isDisabled())
      const target = history.locator(`[data-record-id="${prepared.taskIds[2]}"]`); page.once('dialog', dialog => dialog.dismiss()); await target.getByRole('button', { name: '删除记录', exact: true }).click(); assert.equal((await records(page, 'tasks')).length, 4)
      await page.evaluate(() => { window.historyNativeDelete = IDBObjectStore.prototype.delete; IDBObjectStore.prototype.delete = function (...args) { if (this.name === 'tasks') throw Error('TEST_HISTORY_DELETE'); return window.historyNativeDelete.apply(this, args) } })
      page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '删除记录', exact: true }).click(); await history.locator('[role=status]').filter({ hasText: /TEST_HISTORY_DELETE/ }).waitFor(); assert.equal((await records(page, 'tasks')).length, 4); assert.equal(await history.locator('.summary-record').count(), 4)
      await page.evaluate(() => { IDBObjectStore.prototype.delete = window.historyNativeDelete }); page.once('dialog', dialog => dialog.accept()); await target.getByRole('button', { name: '删除记录', exact: true }).click(); await untilRecords(page, 'tasks', rows => rows.length === 3)
      await history.getByRole('button', { name: '全选可清理记录', exact: true }).click(); const batch = history.getByRole('button', { name: '删除所选（2）', exact: true }); assert(await batch.isEnabled()); page.once('dialog', dialog => dialog.accept()); await batch.click(); const remaining = await untilRecords(page, 'tasks', rows => rows.length === 1); assert.equal(remaining[0].id, prepared.taskIds[3]); assert.equal((await records(page, 'assets')).length, 2)
      await page.keyboard.press('Escape'); assert.equal(await stat(page, '设计任务').locator('strong').textContent(), '1'); await stat(page, '配墨操作').click()
      const inkRow = page.locator(`.history-dialog [data-record-id="${prepared.inkIds[0]}"]`); page.once('dialog', dialog => dialog.accept()); await inkRow.getByRole('button', { name: '删除记录', exact: true }).click(); await untilRecords(page, 'inkRuns', rows => rows.length === 2)
      await history.getByRole('button', { name: '全选可清理记录', exact: true }).click(); page.once('dialog', dialog => dialog.accept()); await history.getByRole('button', { name: '删除所选（2）', exact: true }).click(); await untilRecords(page, 'inkRuns', rows => rows.length === 0); await page.getByText('暂无配墨操作记录', { exact: true }).waitFor(); assert.equal((await records(page, 'assets')).length, 2)
    })
    await check('趋势雷达平台周期空间与搜索组合、来源和色板可操作', '/trends', async page => {
      assert.equal(await page.getByRole('tab').count(), 4); assert.equal(await page.locator('.trend-card').count(), 4)
      await page.getByRole('button', { name: '抖音', exact: true }).click(); await page.getByLabel('观察周期', { exact: true }).selectOption('近7天'); await page.locator('.empty-state').getByText('暂无匹配资料', { exact: true }).waitFor(); assert.equal(await page.locator('.trend-card').count(), 0)
      await page.getByRole('button', { name: '小红书', exact: true }).click(); assert.equal(await page.locator('.trend-card').count(), 2); assert.deepEqual((await page.locator('.trend-card h3').allTextContents()).sort(), ['奶油原木', '暖灰中古'].sort())
      await page.getByLabel('应用空间', { exact: true }).selectOption('商业空间'); assert.equal(await page.locator('.trend-card').count(), 0)
      await page.getByLabel('观察周期', { exact: true }).selectOption('近30天'); await page.getByLabel('应用空间', { exact: true }).selectOption('客厅'); assert.equal(await page.locator('.trend-card').count(), 2)
      await page.getByRole('button', { name: '检索热门趋势', exact: true }).click(); assert(await page.getByRole('button', { name: '正在整理信号…', exact: true }).isDisabled()); await page.getByRole('button', { name: '检索热门趋势', exact: true }).waitFor()
      await page.getByRole('button', { name: '全平台', exact: true }).click(); await page.getByLabel('观察周期', { exact: true }).selectOption('近90天'); await page.getByLabel('应用空间', { exact: true }).selectOption('全屋空间'); await page.locator('.trend-extra-search summary').click(); await page.getByLabel('搜索趋势', { exact: true }).fill('红棕'); assert.equal(await page.locator('.trend-card').count(), 1); assert.equal(await page.locator('.direction-hero strong').textContent(), '深红棕复古')
      assert.equal(await page.locator('.source-row').count(), 2); await page.locator('.direction-extra summary').click(); const colour = page.getByRole('button', { name: /选择色值/ }).nth(1), label = await colour.getAttribute('aria-label'); await colour.click(); assert.equal(await page.locator('.selected-hex').textContent(), label.replace('选择色值', ''))
      await page.getByLabel('搜索趋势', { exact: true }).fill('不存在的演示方向'); assert.equal(await page.locator('.trend-card').count(), 0); await page.getByText('请先调整筛选条件。', { exact: true }).waitFor()
    })
    await check('定向研究来源开关、匹配关闭、空主题与研究反馈均生效', '/trends', async page => {
      await page.getByRole('tab', { name: '定向研究', exact: true }).click(); await page.getByLabel('抖音信号', { exact: true }).uncheck(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).click(); await page.getByText('正在聚类关键词与案例信号…', { exact: true }).waitFor(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).waitFor()
      const source = page.locator('.research-results>div').filter({ has: page.locator('dt', { hasText: /^来源$/ }) }).locator('dd'); assert.equal(await source.textContent(), '已选择来源：小红书')
      await page.getByLabel('匹配样例库', { exact: true }).uncheck(); await page.getByText('样例库匹配已关闭', { exact: true }).waitFor()
      await page.getByLabel('小红书信号', { exact: true }).uncheck(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).click(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).waitFor(); await page.getByText('所选演示资料中没有相关内容，请调整研究主题或来源。', { exact: true }).waitFor(); await page.getByText('匹配演示方向 0 项，来源记录 0 条', { exact: true }).waitFor(); assert.equal(await source.textContent(), '已选择来源：无')
      await page.getByLabel('研究主题', { exact: true }).fill('   '); assert(await page.getByRole('button', { name: '生成趋势研究', exact: true }).isDisabled()); await page.getByRole('button', { name: '胡桃木与烟熏色系的变化', exact: true }).click(); await page.getByLabel('小红书信号', { exact: true }).check(); await page.getByLabel('抖音信号', { exact: true }).check(); await page.getByLabel('匹配样例库', { exact: true }).check(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).click(); await page.getByRole('button', { name: '生成趋势研究', exact: true }).waitFor(); assert((await page.locator('.research-results').textContent()).includes('关联样例')); assert((await page.locator('.direction-description').textContent()).includes('烟熏橡木'))
    })
    await check('趋势预测对象切换更新真实演示序列与四项指标', '/trends', async page => {
      await page.getByRole('tab', { name: '趋势预测', exact: true }).click(); const expected = await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.originalTrends.find(row => row.id === 'red-brown'))
      await page.getByLabel('选择预测对象', { exact: true }).selectOption(expected.id); assert.equal(await page.locator('[class*="_forecastText_"] small').textContent(), expected.forecast)
      assert.deepEqual(await page.locator('.trend-overview strong').allTextContents(), [String(expected.heat), `${expected.growth}%`, `${expected.saturation}%`, `${expected.confidence}%`]); assert.deepEqual((await page.locator('.bar-column>span').allTextContents()).map(Number), expected.signals)
      await page.getByLabel('选择预测对象', { exact: true }).selectOption('cream-wood'); assert.equal(await page.locator('.trend-overview strong').first().textContent(), '82'); assert.notDeepEqual((await page.locator('.bar-column>span').allTextContents()).map(Number), expected.signals)
    })
    await check('趋势转化匹配档案、创建失败反馈、创建真实任务与再次打开去重', '/trends', async page => {
      await page.getByRole('tab', { name: '趋势转化', exact: true }).click(); assert(await page.locator('.match-card').count() > 0); const name = await page.locator('.match-card span').first().textContent(); await page.locator('.match-card').first().click(); await page.waitForURL(origin + '/samples'); await page.locator('.sample-archive').waitFor(); assert((await page.locator('.sample-archive').textContent()).includes(name)); await closeModal(page)
      await navigate(page, '/trends'); await page.getByRole('tab', { name: '趋势转化', exact: true }).click(); await page.getByLabel('选择趋势方向', { exact: true }).selectOption('warm-grey')
      await page.evaluate(() => { window.trendNativePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'tasks') throw Error('TEST_TREND_TASK_SAVE'); return window.trendNativePut.apply(this, args) } })
      await page.getByRole('button', { name: '创建装饰纸设计任务', exact: true }).click(); await page.locator('.trends-view [role=alert]').filter({ hasText: /TEST_TREND_TASK_SAVE/ }).waitFor(); assert.equal((await records(page, 'tasks')).length, 0)
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.trendNativePut }); await page.getByRole('button', { name: '创建装饰纸设计任务', exact: true }).click(); await page.waitForURL(origin + '/design'); await page.locator('.design-page .task-info').waitFor(); const tasks = await records(page, 'tasks'); assert.equal(tasks.length, 1); assert.equal(tasks[0].sourceId, 'warm-grey'); assert.equal(tasks[0].status, '待处理'); assert(tasks[0].sampleId); assert.equal(await page.locator('.mode-card.active strong').textContent(), '样例自动设计')
      await navigate(page, '/trends'); await page.getByRole('tab', { name: '趋势转化', exact: true }).click(); await page.getByRole('button', { name: '打开已有设计任务', exact: true }).click(); await page.waitForURL(origin + '/design'); assert.equal((await records(page, 'tasks')).length, 1); const active = await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.activeTask); assert.equal(active, tasks[0].id)
    })
    await check('390px与暗色页面无横向溢出，弹窗键盘关闭返回焦点', '/', async page => {
      await prepareHome(page); const trigger = stat(page, '设计任务'); await trigger.focus(); await page.keyboard.press('Enter'); await page.locator('.history-dialog').waitFor(); await page.keyboard.press('Tab'); assert(await page.evaluate(() => { const dialog = document.querySelector('.ant-modal:has(.history-dialog)'); return !!dialog?.contains(document.activeElement) })); await page.keyboard.press('Escape'); await page.locator('.history-dialog').waitFor({ state: 'detached' }); await page.waitForFunction(() => document.activeElement?.classList.contains('dashboard-stat-button')); assert(await trigger.evaluate(element => element === document.activeElement))
      await page.getByRole('button', { name: '切换深色', exact: true }).click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); await page.setViewportSize({ width: 390, height: 900 })
      for (const [route, name] of [['/', 'home'], ['/samples', 'library'], ['/trends', 'trends']]) { await ready(page, route); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, `${name}-390-dark.png`), fullPage: true }) }
      await page.getByRole('tab', { name: '趋势预测', exact: true }).click(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'forecast-390-dark.png'), fullPage: true })
      await ready(page, '/samples'); await page.getByRole('button', { name: '石纹', exact: true }).focus(); await page.keyboard.press('Enter'); assert(await page.getByRole('button', { name: '石纹', exact: true }).evaluate(element => element.classList.contains('active')))
      await page.locator('.sample-card .texture-name').first().click(); await page.getByRole('button', { name: '查看完整样例档案', exact: false }).click(); await page.locator('.sample-archive').waitFor(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, 'archive-390-dark.png'), fullPage: true }); await page.keyboard.press('Escape')
    })
    assert.deepEqual(errors, []); console.log(`DONE ${results.length} library/home/trends groups; output=${output}`)
  } finally { await browser.close() }
})().catch(reason => { console.error(reason); process.exitCode = 1 })
