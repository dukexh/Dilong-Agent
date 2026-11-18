const {settled}=require('../helpers/inks.cjs')
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const base = process.env.DILONG_URL || process.env.DILONG_TEST_BASE || 'http://127.0.0.1:51458'

// migrationRegressions: 独立浏览器上下文，沿用原有场景和断言。
async function migrationRegressions() {
const output = path.resolve('verification/migration-fixes'), results = []
fs.mkdirSync(output, { recursive: true })
let browser
async function service(page) { await page.evaluate(async () => { const { S } = await import('/src/services/workflows.ts'); await S.ready; window.__S = S }) }
async function open(page, id = 'fix-a') {
  await page.evaluate(id => window.__S.openInkRun(window.__S.inkRuns.find(run => run.id === id)), id)
  await page.waitForFunction(id => document.querySelector('.ink-run-info strong')?.textContent === '当前配墨记录：' + id + '.png', id)
}
async function seed(page) {
  await page.goto(base + '/ink'); await service(page); await page.locator('.layer-card').first().waitFor()
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#bb9955'; ctx.fillRect(0, 0, 64, 48); ctx.fillStyle = '#332211'; ctx.fillRect(24, 0, 20, 48)
    const image = new Image(); image.src = canvas.toDataURL(); await image.decode()
    const result = window.__S.analyzeFull(image)
    for (const [id, weight] of [['fix-a', 10], ['fix-b', 20]]) await window.__S.recordInkRun({ id, inputName: id + '.png', source: '回归测试', layerCount: result.layers.length, difference: result.difference,
      snapshot: { version: 1, imageUrl: image.src, layers: result.layers, renderModel: result.renderModel, settings: { weight, enabled: result.layers.map(() => true), selectedLayer: 0, tab: 'overview' } } })
  })
  await open(page)
}
async function check(name, action, init) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  // External font availability is unrelated to these application regressions.
  await context.route('https://fonts.googleapis.com/**', route => route.abort())
  if (init) await context.addInitScript(init)
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message))
  try { await action(page); assert.deepEqual(errors, []); results.push(name); console.log('PASS ' + name) }
  catch (error) { console.error({ name, errors }); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error }
  finally { await context.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results }, null, 2)) }
}

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    await check('确认保存完成后刷新，连续三次均恢复最后值且不新增历史', async page => {
      await seed(page)
      for (const weight of ['13.5', '18', '27.5']) {
        await page.locator('#ink-weight').fill(weight); await page.getByRole('button', { name: '确认组合并更新配方', exact: true }).click(); await settled(page); await page.reload(); await service(page); await page.locator('.layer-card').first().waitFor(); await open(page)
        assert.equal(await page.locator('#ink-weight').inputValue(), weight)
        assert.equal(await page.evaluate(() => window.__S.inkRuns.length), 2)
      }
    })
    await check('色层开关、选中色层和详情页立即刷新后保留', async page => {
      await seed(page); await page.locator('.layer-switch input').nth(1).uncheck(); await page.locator('.layer-select').last().click(); await page.getByRole('tab', { name: '单层配方详情', exact: true }).click()
      await settled(page); await page.reload(); await service(page); await page.locator('.layer-card').first().waitFor(); await open(page)
      assert.equal(await page.locator('.layer-switch input').nth(1).isChecked(), false)
      assert.equal(await page.getByRole('tab', { name: '单层配方详情', exact: true }).getAttribute('aria-selected'), 'true')
      assert(await page.evaluate(() => window.__S.inkRuns.find(run => run.id === 'fix-a').snapshot.settings.selectedLayer > 0))
    })
    await check('修改后立即切换历史，各记录参数独立保存', async page => {
      await seed(page); await page.locator('#ink-weight').fill('13.5'); await page.getByRole('button', { name: '确认组合并更新配方', exact: true }).click(); await open(page, 'fix-b')
      assert.equal(await page.locator('#ink-weight').inputValue(), '20')
      assert.equal(await page.evaluate(() => window.__S.inkRuns.find(run => run.id === 'fix-a').snapshot.settings.weight), 13.5)
      assert.equal(await page.evaluate(() => window.__S.inkRuns.length), 2)
    })
    await check('慢保存显示进行中，连续修改最终保存最后值', async page => {
      await seed(page)
      await page.evaluate(() => { const update = window.__S.updateInkRunSettings; window.__S.updateInkRunSettings = async (...args) => { await new Promise(resolve => setTimeout(resolve, 350)); return update(...args) } })
      await page.locator('#ink-weight').fill('31'); await page.getByRole('button', { name: '确认组合并更新配方', exact: true }).click(); await page.locator('.ink-run-info').getByText('正在保存…', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.__S.inkRuns.find(run => run.id === 'fix-a').snapshot.settings.weight), 10)
      assert(await page.locator('#ink-weight').isDisabled());await settled(page);await page.locator('#ink-weight').fill('32'); await page.getByRole('button', { name: '确认组合并更新配方', exact: true }).click()
      await page.waitForFunction(() => window.__S.inkRuns.find(run => run.id === 'fix-a').snapshot.settings.weight === 32 && !document.querySelector('.ink-run-info')?.textContent.includes('正在保存'))
    })
    await check('恢复当前样例保留原图、重量和记录，仅恢复色层及预览', async page => {
      await seed(page); const original = await page.locator('.image-pair figure').first().locator('img').getAttribute('src')
      await page.locator('#ink-weight').fill('17.5'); await page.getByRole('button', { name: '确认组合并更新配方', exact: true }).click(); await page.locator('.layer-switch input').nth(1).uncheck(); await page.locator('.layer-select').last().click(); await page.getByRole('tab', { name: '当前色层', exact: true }).click()
      await page.getByRole('button', { name: '恢复当前样例', exact: true }).click()
      assert.equal(await page.locator('.image-pair figure').first().locator('img').getAttribute('src'), original)
      assert.equal(await page.locator('#ink-weight').inputValue(), '17.5'); assert.equal(await page.locator('.layer-switch input:not(:checked)').count(), 0)
      assert.equal(await page.getByRole('tab', { name: '全部色层总览', exact: true }).getAttribute('aria-selected'), 'true')
      assert.equal(await page.getByRole('tab', { name: '原图与合成', exact: true }).getAttribute('aria-selected'), 'true')
      await page.waitForFunction(() => { const s = window.__S.inkRuns.find(run => run.id === 'fix-a').snapshot.settings; return s.weight === 17.5 && s.enabled.every(Boolean) && s.selectedLayer === 0 && s.tab === 'overview' })
      assert.equal(await page.locator('.ink-run-info strong').innerText(), '当前配墨记录：fix-a.png'); assert.equal(await page.evaluate(() => window.__S.inkRuns.length), 2)
    })
    await check('综合色值与原版固定样本一致，选择和开关不改变原图综合色', async page => {
      await seed(page); assert.equal(await page.locator('.aggregate-color .hex-value').innerText(), '#917440')
      const representative = await page.locator('.layer-row.active .current-layer-hex').innerText()
      await page.locator('.layer-select').last().click(); assert.notEqual(await page.locator('.layer-row.active .current-layer-hex').innerText(), representative)
      await page.locator('.layer-switch input').nth(1).uncheck(); assert.equal(await page.locator('.aggregate-color .hex-value').innerText(), '#917440')
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        await page.evaluate(() => scrollTo(0, 0))
        await page.waitForFunction(() => scrollY === 0)
        await page.screenshot({ path: path.join(output, 'ink-' + width + '.png') })
      }
    })
    await check('图片分析失败后综合色值清空，不残留旧结果', async page => {
      await seed(page); await page.getByLabel('上传配墨图片').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
      await page.getByRole('alert').filter({ hasText: '加载失败' }).waitFor(); assert.equal(await page.locator('.aggregate-color .hex-value').innerText(), '—'); assert.equal(await page.evaluate(() => window.__S.inkRuns.length), 2)
    })
    async function checkTheme(page, initial) {
      await page.goto(base); await page.locator('.app-shell').waitFor(); assert.equal(await page.locator('html').getAttribute('data-theme'), initial)
      await page.getByRole('button', { name: initial === 'light' ? '切换深色' : '切换浅色', exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('data-theme'), initial === 'light' ? 'dark' : 'light')
      await page.locator('.text-navigation a[href="/samples"]').click(); await page.locator('.sample-card').first().waitFor()
    }
    await check('模拟主题读取被拒绝时使用默认主题，页面和切换仍可用', page => checkTheme(page, 'light'), () => { Storage.prototype.getItem = () => { throw new DOMException('Test storage blocked', 'SecurityError') } })
    await check('模拟主题写入超额时仍读取已有深色并可切换', page => checkTheme(page, 'dark'), () => { localStorage.setItem('dilong-theme', 'dark'); Storage.prototype.setItem = () => { throw new DOMException('Test quota', 'QuotaExceededError') } })
    await check('模拟localStorage本身不可访问时页面仍可使用', page => checkTheme(page, 'light'), () => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Test storage getter blocked', 'SecurityError') } }) })
    console.log('Migration fixes: ' + results.length + ' groups passed.')
  } finally { await browser.close() }

}

// legacyHistory: 独立浏览器上下文，沿用原有场景和断言。
async function legacyHistory() {
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/legacy-v2.json'),'utf8'))
const { records } = require('../helpers/database.cjs')

 const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext()
 try{
  await context.route(base+'/__legacy_seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Seed compatible IndexedDB</title>'}))
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/__legacy_seed')
  await page.evaluate(async data=>{
   const types={Uint8Array,Uint8ClampedArray,Float32Array,Float64Array,Int32Array}
   const decoded=JSON.parse(JSON.stringify(data),(_,value)=>value&&value.__typedArray?new types[value.__typedArray](value.values):value)
   const db=await new Promise((res,rej)=>{const r=indexedDB.open('dilong-workflows',2);r.onupgradeneeded=()=>{for(const key of ['assets','tasks','inkRuns'])r.result.createObjectStore(key,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})
   await new Promise((res,rej)=>{const tx=db.transaction(['assets','tasks','inkRuns'],'readwrite');for(const key of ['assets','tasks','inkRuns'])for(const row of decoded[key])tx.objectStore(key).put(row);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close()
  },fixture)
  await page.goto(base+'/',{waitUntil:'networkidle'});await page.getByRole('button',{name:'查看设计任务，1项',exact:true}).waitFor()
  assert.equal((await records(page,'assets'))[0].id,fixture.assets[0].id);assert.equal((await records(page,'tasks'))[0].resultIds[0],fixture.assets[0].id)
  await page.getByRole('button',{name:'查看设计任务，1项',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'打开任务',exact:true}).click();await page.waitForURL('**/design');await page.locator('.saved-results article').waitFor()
  assert.equal(await page.locator('.source-tabs button.active').textContent(),'上传图片');assert.equal(await page.locator('.saved-results article').count(),1);assert.match(await page.locator('.upload-box small').textContent(),/旧版兼容输入/)
  assert.match(await page.locator('.mode-card.active').textContent(),/小样联想补全/);assert.equal(await page.getByLabel('补全扩展方式',{exact:true}).inputValue(),'horizontal3');assert(await page.locator('.completion-run-button').isDisabled())
  assert.equal(await page.getByLabel('候选评价',{exact:true}).inputValue(),'adjust');assert.equal((await records(page,'tasks')).length,1)
  console.log('PASS 实际React旧版v2数据：候选、评价、上传输入、完整任务参数与关联恢复')
  await page.locator('.text-navigation a[href="/"]').click();await page.getByRole('button',{name:'查看配墨操作，1项',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'打开此次配墨',exact:true}).click();await page.waitForURL('**/ink');await page.locator('.ink-run-info strong').waitFor()
  assert.match(await page.locator('.ink-run-info strong').textContent(),/旧版保存的候选/);assert.equal(await page.locator('.weight-input input').inputValue(),'77')
  const saved=await records(page,'inkRuns');assert.equal(saved.length,1);assert.equal(saved[0].id,fixture.inkRuns[0].id);assert(saved[0].snapshot.renderModel.assignments instanceof Uint8Array);assert(saved[0].snapshot.renderModel.original instanceof Uint8ClampedArray)
  assert.deepEqual(saved[0].snapshot.settings,fixture.inkRuns[0].snapshot.settings);assert.equal(saved[0].snapshot.imageUrl,fixture.inkRuns[0].snapshot.imageUrl)
  assert.deepEqual(errors,[]);console.log('PASS 实际React旧版配墨：TypedArray完整快照、原图和77kg参数恢复，不重算或增加历史')
 }finally{await context.close();await browser.close()}

}

;(async () => {
  await migrationRegressions()
  await legacyHistory()
})().catch(error => { console.error(error); process.exitCode = 1 })
