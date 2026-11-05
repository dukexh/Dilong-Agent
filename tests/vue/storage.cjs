/** Real IndexedDB/BroadcastChannel/Web Locks checks, in a fresh temporary browser context. */
const { chromium } = require(process.env.DILONG_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const url = process.env.DILONG_TEST_URL || 'http://127.0.0.1:51458/'
const installed = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/chromium-1234/chrome-win64/chrome.exe')
const executablePath = process.env.DILONG_CHROMIUM_PATH || (fs.existsSync(installed) ? installed : undefined)
const ready = async page => { await page.goto(url); await page.evaluate(async () => { const module = await import('/src/services/workflows.ts'); window.__workflow = module.S; await module.S.ready }) }
const pass = message => console.log('PASS ' + message)

;(async () => {
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: 'chrome' }) })
  const context = await browser.newContext()
  try {
    const a = await context.newPage(), b = await context.newPage()
    await ready(a); await ready(b)
    assert.equal(await a.evaluate(() => window.__workflow.assets.length + window.__workflow.tasks.length + window.__workflow.inkRuns.length), 0)
    const fixture = await a.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24
      const context = canvas.getContext('2d'); context.fillStyle = '#c6ac89'; context.fillRect(0, 0, 32, 24)
      context.fillStyle = '#544536'; context.fillRect(4, 0, 5, 24); context.fillStyle = '#99724e'; context.fillRect(18, 0, 5, 24)
      context.clearRect(31, 23, 1, 1)
      return canvas.toDataURL('image/png')
    })
    const tasks = await a.evaluate(async () => {
      const S = window.__workflow, input = { kind: 'library', sampleId: S.base[0].id, name: S.base[0].name }
      const first = await S.beginDesignTask({ mode: 'compare', runKey: 'storage-first', input, parameters: { sorting: 'balanced', limit: 3 } })
      const second = await S.beginDesignTask({ mode: 'compare', runKey: 'storage-second', input, parameters: { sorting: 'texture', limit: 3 } })
      await S.updateTask(first.id, { status: '已处理', outputCount: 1 }); await S.updateTask(second.id, { status: '已处理', outputCount: 1 })
      return [first.id, second.id]
    })
    await a.evaluate(async ({ fixture, taskId }) => {
      const S = window.__workflow, original = IDBObjectStore.prototype.put
      let fail = true
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'tasks' && fail) { fail = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError') } return original.apply(this, args) }
      try { let rejected = false; try { await S.save(fixture, '失败候选', 'completion', {}, 'atomic-failure', taskId) } catch { rejected = true }; if (!rejected || S.assets.length || S.tasks.find(task => task.id === taskId).resultIds.length) throw Error('候选与任务事务没有完全回滚') }
      finally { IDBObjectStore.prototype.put = original }
    }, { fixture, taskId: tasks[0] })
    pass('候选写入失败时样例与关联任务共同回滚，可继续重试')
    const assetId = await a.evaluate(async ({ fixture, tasks }) => {
      const S = window.__workflow
      const results = await Promise.all(tasks.map(taskId => S.save(fixture, '同一个候选', 'completion', { wood: '橡木' }, 'same-key', taskId)))
      if (results[0].id !== results[1].id || S.assets.length !== 1 || tasks.some(id => S.tasks.find(task => task.id === id).resultIds.length !== 1)) throw Error('候选去重或双任务关联失败')
      return results[0].id
    }, { fixture, tasks })
    await b.waitForFunction(id => window.__workflow.assets.some(asset => asset.id === id), assetId)
    pass('并发保存同一候选只增加一条样例，分别关联两条任务，并自动同步另一标签页')
    await a.evaluate(id => window.__workflow.reviewCandidate(id, 'accepted'), assetId)
    await b.waitForFunction(id => window.__workflow.assets.find(asset => asset.id === id)?.candidateReview?.status === 'accepted' && window.__workflow.tasks.filter(task => task.resultIds.includes(id)).every(task => task.status === '已评价'), assetId)
    await b.evaluate(id => { window.__staleAsset = structuredClone(window.__workflow.assets.find(asset => asset.id === id)) }, assetId)
    await a.evaluate(id => window.__workflow.updateAsset(id, { name: 'A页面的新名称' }), assetId)
    await b.waitForFunction(id => window.__workflow.assets.find(asset => asset.id === id)?.name === 'A页面的新名称', assetId)
    const staleError = await b.evaluate(async id => { try { await window.__workflow.updateAsset(id, { name: '不应覆盖' }, window.__staleAsset); return '' } catch (error) { return error.code + ':' + error.message } }, assetId)
    assert.match(staleError, /DATA_CONFLICT/)
    assert.equal(await a.evaluate(id => window.__workflow.assets.find(asset => asset.id === id).name, assetId), 'A页面的新名称')
    pass('候选评价更新所有关联任务；带旧revision的编辑被真实事务拒绝')
    const imported = await a.evaluate(async ({ fixture, assetId }) => {
      const S = window.__workflow, metadata = await import('/src/core/sample-metadata.ts'), original = S.assets.find(asset => asset.id === assetId)
      const bytes = new Uint8Array(await (await fetch(fixture)).arrayBuffer())
      const manifest = { schemaVersion: 1, samples: [{ id: 'ZIP-ROUNDTRIP', ...metadata.normalize(original), image: 'images/original.png' }] }
      const blob = S.zip([['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))], ['images/original.png', bytes]])
      const rows = await S.previewPackage(blob)
      if (rows.length !== 1 || rows[0].state !== '有效') throw Error(JSON.stringify(rows.map(row => row.state)))
      await S.commitPackage(rows)
      const saved = S.assets.find(asset => asset.id === 'ZIP-ROUNDTRIP'), image = new Image(); image.src = saved.imageUrl; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      const alpha = context.getImageData(31, 23, 1, 1).data[3]
      const repeated = await S.previewPackage(blob)
      return { width: image.naturalWidth, height: image.naturalHeight, alpha, repeat: repeated[0].state, review: saved.candidateReview.status }
    }, { fixture, assetId })
    assert.deepEqual(imported, { width: 32, height: 24, alpha: 0, repeat: '重复：跳过', review: 'accepted' })
    pass('ZIP往返保留原尺寸、透明像素、业务资料与评价；重复编号跳过')
    const runId = await a.evaluate(async ({ fixture, assetId }) => {
      const S = window.__workflow, image = new Image(); image.src = fixture; await image.decode()
      const result = S.analyzeFull(image), record = { id: 'ink-storage', inputName: '原图.png', sampleId: assetId, source: '专项测试', layerCount: result.layers.length, difference: result.difference,
        snapshot: { version: 1, imageUrl: S.captureInkImage(image), layers: result.layers, renderModel: result.renderModel, settings: { weight: 10, enabled: result.layers.map(() => true), selectedLayer: 0, tab: 'overview' } } }
      const original = IDBObjectStore.prototype.put; let fail = true
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'inkRuns' && fail) { fail = false; throw new DOMException('TEST_QUOTA', 'QuotaExceededError') } return original.apply(this, args) }
      try { let rejected = false; try { await S.recordInkRun(record) } catch { rejected = true }; if (!rejected || S.inkRuns.length) throw Error('首次保存失败未正确保留未保存状态') }
      finally { IDBObjectStore.prototype.put = original }
      await S.updateInkRunSettings(record.id, { ...record.snapshot.settings, weight: 27.5 })
      if (S.inkRuns.length !== 1 || S.inkRuns[0].snapshot.settings.weight !== 27.5) throw Error('未保存记录重试失败')
      return record.id
    }, { fixture, assetId })
    await b.waitForFunction(id => window.__workflow.inkRuns.some(run => run.id === id), runId)
    await ready(b)
    const restored = await b.evaluate(async id => {
      const S = window.__workflow, run = S.inkRuns.find(record => record.id === id); S.navigate = () => Promise.resolve()
      const event = new Promise(resolve => window.addEventListener('dilong-ink-open', event => resolve(event.detail.run), { once: true }))
      await S.openInkRun(run); const snapshot = await event
      return { restorable: S.canRestoreInkRun(snapshot), typed: snapshot.snapshot.renderModel.original instanceof Uint8ClampedArray, weight: snapshot.snapshot.settings.weight, count: S.inkRuns.length }
    }, runId)
    assert.deepEqual(restored, { restorable: true, typed: true, weight: 27.5, count: 1 })
    pass('首次配墨持久化失败可重试；重载后恢复完整TypedArray快照与参数，不增加历史')
    await a.evaluate(id => { const S = window.__workflow, run = S.inkRuns.find(record => record.id === id); return S.updateInkRunSettings(id, { ...run.snapshot.settings, weight: 30 }) }, runId)
    await b.waitForFunction(id => window.__workflow.inkRuns.find(run => run.id === id)?.snapshot.settings.weight === 30 && window.__workflow.hasInkConflict(id), runId)
    const conflicted = await b.evaluate(async id => { const S = window.__workflow, run = S.inkRuns.find(record => record.id === id); await S.updateInkRunSettings(id, { ...run.snapshot.settings, weight: 88 }); return { weight: S.inkRuns.find(record => record.id === id).snapshot.settings.weight, message: S.inkRecordStatus.message } }, runId)
    assert.equal(conflicted.weight, 30); assert.match(conflicted.message, /重新加载/)
    await b.evaluate(async id => { const S = window.__workflow; await S.openInkRun(S.inkRuns.find(record => record.id === id)); const run = S.inkRuns.find(record => record.id === id); await S.updateInkRunSettings(id, { ...run.snapshot.settings, weight: 35 }) }, runId)
    await a.waitForFunction(id => window.__workflow.inkRuns.find(run => run.id === id)?.snapshot.settings.weight === 35, runId)
    pass('跨标签修改配墨后阻止旧预览覆盖；显式重载最新版后允许继续调整')
    await a.evaluate(id => window.__workflow.deleteHistory('inkRuns', [id]), runId)
    await b.waitForFunction(id => window.__workflow.deletedHistory.inkRuns.has(id), runId)
    await b.evaluate(id => window.__workflow.updateInkRunSettings(id, { weight: 99, enabled: [], selectedLayer: 0, tab: 'overview' }), runId)
    assert.equal(await b.evaluate(() => window.__workflow.inkRuns.length), 0)
    await a.evaluate(id => window.__workflow.deleteAsset(id), assetId)
    await b.waitForFunction(id => !window.__workflow.assets.some(asset => asset.id === id), assetId)
    assert.equal(await b.evaluate(ids => ids.every(id => window.__workflow.tasks.find(task => task.id === id).resultIds.length === 0), tasks), true)
    pass('删除历史后参数变化不复活记录；删除候选同步清理全部任务关联')
    const activeId = await a.evaluate(async () => {
      const S = window.__workflow, task = await S.beginDesignTask({ mode: 'compare', runKey: 'active-owner', input: { kind: 'library', sampleId: S.base[0].id, name: S.base[0].name }, parameters: { sorting: 'balanced', limit: 3 } })
      let rejected = false; try { await S.deleteHistory('tasks', [task.id]) } catch (error) { rejected = /正在执行/.test(error.message) }; if (!rejected) throw Error('活动任务可被清理')
      return task.id
    })
    await ready(b)
    assert.equal(await b.evaluate(id => window.__workflow.tasks.find(task => task.id === id).status, activeId), '处理中')
    await a.close()
    const c = await context.newPage(); await ready(c)
    assert.equal(await c.evaluate(id => window.__workflow.tasks.find(task => task.id === id).status, activeId), '已中断')
    const retried = await c.evaluate(async id => {
      const S = window.__workflow, task = S.tasks.find(task => task.id === id)
      const retry = await S.beginDesignTask({ taskId: id, mode: task.mode, runKey: 'retry-owner', input: task.input, parameters: task.parameters })
      await S.updateTask(retry.id, { status: '已处理' })
      const next = await S.beginDesignTask({ taskId: id, mode: task.mode, runKey: 'new-after-completion', input: task.input, parameters: task.parameters })
      await S.updateTask(next.id, { status: '已取消' })
      return { reuse: retry.id === id, attempts: retry.attempts, newAfterCompletion: next.id !== id }
    }, activeId)
    assert.deepEqual(retried, { reuse: true, attempts: 2, newAfterCompletion: true })
    pass('Web Locks识别其他窗口仍在运行与已关闭任务；中断重试复用，完成后执行创建新任务')
    const result = await c.evaluate(async () => {
      const S = window.__workflow, ids = S.tasks.map(task => task.id); await S.deleteHistory('tasks', ids)
      const database = await new Promise((resolve, reject) => { const request = indexedDB.open('dilong-workflows', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const names = [...database.objectStoreNames]; database.close()
      return { tasks: S.tasks.length, assets: S.assets.length, stores: names }
    })
    assert.equal(result.tasks, 0); assert.equal(result.assets, 1); assert.deepEqual(result.stores, ['assets', 'inkRuns', 'tasks'])
    pass('历史清理保留样例库，数据库仍为原名v2与三个原store')
    console.log('Storage workflow checks passed in an isolated browser context.')
  } finally { await context.close(); await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
