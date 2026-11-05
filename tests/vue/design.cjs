/* Runs against the real Vue route in isolated browser contexts. No daily browser data is used. */
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const url = process.env.DILONG_URL || 'http://127.0.0.1:51458'
const output = path.resolve(process.env.DILONG_TEST_OUTPUT || 'verification/vue-design')
fs.mkdirSync(output, { recursive: true })
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function records(page, store) {
  return page.evaluate(async store => {
    const database = await new Promise((resolve, reject) => { const request = indexedDB.open('dilong-workflows', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise((resolve, reject) => { const request = database.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    finally { database.close() }
  }, store)
}
async function untilRecords(page, store, predicate) {
  for (let attempt = 0; attempt < 120; attempt++) { const rows = await records(page, store); if (predicate(rows)) return rows; await wait(100) }
  throw Error(`等待 ${store} 状态超时`)
}
async function run(page) { const button = page.locator('.run-button'); await button.click(); await page.waitForFunction(() => !document.querySelector('.run-button')?.disabled); return records(page, 'tasks') }
async function mode(page, label) { const key = { '小样补全':'complete', '风格迁移':'twin', '候选推荐':'generate' }[label]; await page.locator(`[data-design-mode="${key}"]`).click() }
async function png(page, { width = 96, height = 64, alpha = 1, empty = false, colour = '#a78c60' } = {}) {
  return Buffer.from(await page.evaluate(({ width, height, alpha, empty, colour }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d')
    if (!empty) { context.globalAlpha = alpha; context.fillStyle = colour; context.fillRect(0, 0, width, height); context.fillStyle = '#554c3e'; for (let y = 0; y < height; y += 7) context.fillRect(0, y, width, 2) }
    return canvas.toDataURL().split(',')[1]
  }, { width, height, alpha, empty, colour }), 'base64')
}
async function upload(page, options = {}, name = '真实纹理.png') {
  await page.getByRole('button', { name: '上传图片', exact: true }).click()
  await page.locator('.source-panel input[type=file]').setInputFiles({ name, mimeType: 'image/png', buffer: await png(page, options) })
  await page.locator('.source-panel dl').waitFor()
}
async function openTask(page, id) { await page.evaluate(async id => { const { S } = await import('/src/services/workflows.ts'); await S.openTask(S.tasks.find(task => task.id === id)) }, id); await page.locator('.saved-results,.saved-empty').waitFor() }

;(async () => {
  const browser = await chromium.launch({ channel: process.env.DILONG_BROWSER_CHANNEL || 'chrome', headless: true })
  const results = [], errors = []
  async function check(name, action) {
    const context = await browser.newContext({ viewport: { width: 1480, height: 1100 }, acceptDownloads: true })
    const page = await context.newPage(); page.setDefaultTimeout(20000)
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`))
    try {
      await page.goto(`${url}/design`)
      await page.locator('.design-page').waitFor()
      await page.waitForFunction(() => document.querySelector('.source-panel select')?.options.length > 100)
      await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.ready)
      await action(page)
      results.push(name); console.log(`PASS ${name}`)
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2))
    } catch (error) { await page.screenshot({ path: path.join(output, `failure-${results.length + 1}.png`), fullPage: true }); throw error }
    finally { await context.close() }
  }
  try {
    await check('相似检索保持原组件取整与权重，任务保留完整参数', async page => {
      const expected = await page.evaluate(async () => {
        const { S } = await import('/src/services/workflows.ts'), source = S.base[0], input = source.analysis
        const clamp = value => Math.max(0, Math.min(100, value))
        return S.all().filter(sample => sample.id !== source.id && sample.analysis).map(sample => {
          const target = sample.analysis
          const colour = Math.round(clamp(100 - Math.hypot(input.averageRgb.r - target.averageRgb.r, input.averageRgb.g - target.averageRgb.g, input.averageRgb.b - target.averageRgb.b) / 441.67 * 100))
          const texture = Math.round(clamp(100 - Math.abs(input.textureDensity - target.textureDensity) * 2.3))
          const brightness = Math.round(clamp(100 - Math.abs(input.brightness - target.brightness) / 255 * 100))
          return { name: sample.name, score: Math.round(colour * .5 + texture * .32 + brightness * .18) }
        }).sort((a, b) => b.score - a.score).slice(0, 5)
      })
      const tasks = await run(page); assert.equal(tasks.length, 1); assert.equal(tasks[0].status, '已处理')
      assert.equal(tasks[0].input.kind, 'library'); assert.deepEqual(tasks[0].parameters, { sorting: 'balanced', limit: 5, completion: 'horizontal3', style: 'smoked', strength: 78, direction: '浅色自然橡木', candidateCount: 3 })
      const actual = await page.locator('.candidate-title').evaluateAll(nodes => nodes.map(node => ({ name: node.querySelector('strong').textContent, score: Number(node.querySelector('em').textContent.match(/\d+/)[0]) })))
      assert.deepEqual(actual, expected)
    })
    await check('保存失败无成功提示，成功后toast、跨任务关联去重和评价持久化', async page => {
      await run(page)
      await page.evaluate(() => { window.designNativePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (this.name === 'assets') throw Error('TEST_SAVE_FAILURE'); return window.designNativePut.apply(this, args) } })
      await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click(); await page.locator('.save-error').waitFor()
      assert.equal((await records(page, 'assets')).length, 0); assert.equal(await page.getByText('已将候选内容保存到样例库中', { exact: true }).count(), 0)
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.designNativePut })
      await page.getByRole('button', { name: '保存失败，点击重试', exact: true }).click()
      await page.getByText('已将候选内容保存到样例库中', { exact: true }).waitFor()
      const assets = await untilRecords(page, 'assets', rows => rows.length === 1), originalTasks = await records(page, 'tasks')
      const tasks = await run(page); assert.equal(tasks.length, 2); assert.notEqual(tasks[0].id, tasks[1].id)
      await page.getByRole('button', { name: '关联到当前任务', exact: true }).first().click()
      const linked = await untilRecords(page, 'tasks', rows => rows.length === 2 && rows.every(task => task.resultIds.includes(assets[0].id)))
      assert.equal((await records(page, 'assets')).length, 1)
      await page.getByLabel('候选评价', { exact: true }).selectOption('accepted')
      await untilRecords(page, 'tasks', rows => rows.every(task => task.status === '已评价'))
      assert.equal((await records(page, 'assets'))[0].candidateReview.status, 'accepted')
      await openTask(page, originalTasks[0].id); assert.equal(await page.locator('.saved-results article').count(), 1)
      assert.equal(await page.getByLabel('候选评价', { exact: true }).inputValue(), 'accepted'); assert.equal(linked.length, 2)
    })
    await check('上传输入快照与参数恢复，小样补全保留像素和PNG', async page => {
      await upload(page, { width: 96, height: 64 }); await mode(page, '小样补全')
      await page.locator('.config-panel select').selectOption('horizontal5')
      const tasks = await run(page); assert.equal(tasks[0].input.kind, 'upload'); assert.equal(tasks[0].parameters.completion, 'horizontal5')
      assert.equal(await page.locator('.candidate-card').count(), 3)
      const sizes = await page.locator('.image-dimensions').allTextContents(); assert(sizes.every(value => value.includes('480 × 64') && value.includes('PNG')))
      const savedUrl = await page.locator('.candidate-image .big-image-trigger img').first().getAttribute('src'); assert(savedUrl.startsWith('data:image/'))
      await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click()
      const assets = await untilRecords(page, 'assets', rows => rows.length === 1); assert(assets[0].imageUrl.startsWith('data:image/png'))
      const dimensions = await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight] }, assets[0].imageUrl); assert.deepEqual(dimensions, [480, 64])
      await page.locator('.candidate-image .big-image-trigger').first().click(); await page.getByRole('dialog').getByRole('button', { name: '100%', exact: true }).click()
      await page.getByRole('dialog').getByText('480 × 64 · 100%', { exact: true }).waitFor()
      const download = page.waitForEvent('download'); await page.getByRole('link', { name: '下载完整图片' }).click(); assert((await download).suggestedFilename().endsWith('.png'))
      await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
      await openTask(page, tasks[0].id); assert.equal(await page.locator('.config-panel select').inputValue(), 'horizontal5'); assert.equal(await page.locator('.saved-results article').count(), 1)
      assert.equal(await page.locator('.source-panel .upload-box small').textContent(), '真实纹理.png')
      const restored = await page.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); const input = S.tasks[0].input; return JSON.stringify(await S.analyze(input.imageUrl)) === JSON.stringify(input.summary) }); assert(restored)
    })
    await check('风格迁移保留尺寸，真实SSIM与计算失败不显示虚假百分比', async page => {
      await upload(page, { width: 120, height: 80 }); await mode(page, '风格迁移'); await run(page)
      assert.equal(await page.locator('.candidate-card').count(), 3)
      assert((await page.locator('.image-dimensions').allTextContents()).every(text => text.includes('120 × 80')))
      const scores = await page.locator('.similarity').allTextContents(); assert(scores.every(text => /结构相似度 \d+\.\d%/.test(text)))
      await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click(); const assets = await untilRecords(page, 'assets', rows => rows.length === 1)
      assert.equal(typeof assets[0].parameters.structureSimilarity, 'number'); assert(Number.isFinite(assets[0].parameters.structureSimilarity))
      await page.evaluate(async () => { const { DesignImages } = await import('/src/core/design-images.ts'); const original = DesignImages.twin; DesignImages.twin = async (...args) => (await original(...args)).map(result => ({ ...result, similarity: null, similarityError: 'TEST_SSIM_UNAVAILABLE' })) })
      await run(page); assert((await page.locator('.similarity').allTextContents()).every(text => text === '结构相似度：暂无法计算'))
    })
    await check('候选推荐遵守全部已识别关键词，无匹配不填充无关图片', async page => {
      await mode(page, '候选推荐'); await run(page); const tasks = await records(page, 'tasks'); assert.equal(tasks[0].mode, 'generate')
      assert(await page.locator('.candidate-card').count() > 0)
      await page.locator('.config-panel textarea').fill('完全不存在的外星材质'); const empty = await run(page); assert.equal(empty.at(-1).status, '无匹配结果'); assert.equal(empty.at(-1).outputCount, 0)
      assert.equal(await page.locator('.candidate-card').count(), 0); await page.getByText(/没有匹配样例；支持材质/).waitFor()
    })
    await check('取消可重试复用任务，完成后的再次执行创建新任务', async page => {
      await page.evaluate(() => { const original = window.setTimeout; window.setTimeout = (fn, delay, ...args) => original(fn, delay === 420 ? 1200 : delay, ...args) })
      await page.locator('.run-button').click(); await page.getByRole('button', { name: '取消任务', exact: true }).click()
      const cancelled = await untilRecords(page, 'tasks', rows => rows.length === 1 && rows[0].status === '已取消')
      await page.waitForFunction(() => !document.querySelector('.run-button').disabled)
      assert.equal(await page.locator('.run-button').textContent(), '重新执行')
      const retried = await run(page); assert.equal(retried.length, 1); assert.equal(retried[0].id, cancelled[0].id); assert.equal(retried[0].attempts, 2); assert.equal(retried[0].status, '已处理')
      assert.equal((await run(page)).length, 2)
    })
    await check('快速连续上传、坏图、全透明和半透明输入状态正确', async page => {
      await page.getByRole('button', { name: '上传图片', exact: true }).click()
      await page.evaluate(() => {
        const Native = window.Image, descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src'); let first = true
        window.Image = function (...args) { const image = new Native(...args); Object.defineProperty(image, 'src', { get() { return descriptor.get.call(image) }, set(value) { if (first && value.startsWith('blob:')) { first = false; setTimeout(() => descriptor.set.call(image, value), 700) } else descriptor.set.call(image, value) } }); return image }
      })
      const input = page.locator('.source-panel input[type=file]'), first = await png(page, { colour: '#443322' }), second = await png(page, { colour: '#cbaa99' })
      await input.setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: first }); await input.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: second })
      await page.locator('.source-panel dl').waitFor(); await wait(900); assert.equal(await page.locator('.upload-box small').textContent(), 'second.png'); assert.equal(await page.locator('.source-panel .design-error').count(), 0)
      const tasks = await run(page); assert.equal(tasks[0].input.name, 'second.png')
      assert(await page.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); return JSON.stringify(await S.analyze(S.tasks[0].input.imageUrl)) === JSON.stringify(S.tasks[0].input.summary) }))
      await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('broken') }); await page.getByText('图片读取失败，请更换文件后重试。', { exact: true }).waitFor(); assert.equal(await page.locator('.source-panel dl').count(), 0)
      await input.setInputFiles({ name: 'transparent.png', mimeType: 'image/png', buffer: await png(page, { empty: true }) }); await page.locator('.source-panel .design-error').waitFor(); assert.match(await page.locator('.source-panel .design-error').textContent(), /完全透明/)
      await input.setInputFiles({ name: 'semi.png', mimeType: 'image/png', buffer: await png(page, { alpha: .01 }) }); await page.locator('.source-panel dl').waitFor(); assert.equal(await page.locator('.source-panel .design-error').count(), 0); assert.equal(await input.inputValue(), '')
    })
    await check('切换输入后旧任务完成不覆盖新页面，失败任务可正常重试', async page => {
      await page.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); const original = S.beginDesignTask; let first = true; S.beginDesignTask = async request => { if (first) { first = false; await new Promise(resolve => setTimeout(resolve, 900)) } return original(request) } })
      await page.locator('.run-button').click()
      const selectedId = await page.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); const next = S.base[4]; await S.open('design', next); return next.id })
      await page.waitForFunction(id => document.querySelector('.source-panel select')?.value === id, selectedId)
      await run(page)
      const tasks = await untilRecords(page, 'tasks', rows => rows.length === 2 && rows.every(task => task.status === '已处理'))
      const current = await page.evaluate(async () => (await import('/src/services/workflows.ts')).S.activeTask)
      assert.equal(tasks.find(task => task.id === current).sampleId, selectedId); assert.equal(await page.locator('.candidate-card').count(), 5)
      await page.evaluate(async () => { const { DesignImages } = await import('/src/core/design-images.ts'); window.designNativeTwin = DesignImages.twin; DesignImages.twin = async () => { throw Error('TEST_TWIN_FAILURE') } })
      await mode(page, '风格迁移'); await run(page); const failed = await records(page, 'tasks'); const failedTask = failed.find(task => task.status === '执行失败'); assert(failedTask)
      await page.evaluate(async () => { (await import('/src/core/design-images.ts')).DesignImages.twin = window.designNativeTwin })
      await run(page); const restored = await records(page, 'tasks'); assert.equal(restored.length, failed.length); assert.equal(restored.find(task => task.id === failedTask.id).attempts, 2)
    })
    await check('源样例删除后历史候选可查看评价，重试必须更换输入', async page => {
      await run(page); await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click(); const assets = await untilRecords(page, 'assets', rows => rows.length === 1)
      await page.locator('.source-panel select').selectOption(assets[0].id); await run(page); await page.getByRole('button', { name: '保存候选方案', exact: true }).first().click()
      const tasks = await untilRecords(page, 'tasks', rows => rows.length === 2 && rows.some(task => task.sampleId === assets[0].id && task.resultIds.length === 1)); const target = tasks.find(task => task.sampleId === assets[0].id)
      await page.evaluate(async id => { await (await import('/src/services/workflows.ts')).S.deleteAsset(id) }, assets[0].id)
      await openTask(page, target.id); assert.equal(await page.locator('.saved-results article').count(), 1); assert(await page.locator('.run-button').isDisabled()); assert.equal(await page.locator('.run-button').textContent(), '请先选择新输入')
      await page.getByLabel('候选评价', { exact: true }).selectOption('adjust'); await untilRecords(page, 'assets', rows => rows.some(asset => asset.candidateReview?.status === 'adjust'))
      await page.screenshot({ path: path.join(output, 'deleted-source.png'), fullPage: true })
    })
    await check('桌面与移动布局、大图适应窗口和100%查看', async page => {
      for (const width of [1480, 1024, 390]) { await page.setViewportSize({ width, height: 1000 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: path.join(output, `design-${width}.png`), fullPage: true }) }
      await page.locator('.source-image .big-image-trigger').click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '100%', exact: true }).click(); await dialog.getByText(/· 100%/).waitFor(); await dialog.getByRole('button', { name: '缩小图片' }).click(); await dialog.getByText(/· 80%/).waitFor(); await dialog.getByRole('button', { name: '适应窗口', exact: true }).click(); await dialog.getByRole('button', { name: '关闭大图' }).click()
    })
    assert.deepEqual(errors, []); console.log(`DONE ${results.length} design groups; output=${output}`)
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
