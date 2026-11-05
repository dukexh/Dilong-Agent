/* Fixture was produced by the actual React 4920f0e application in an isolated context. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const base=process.env.DILONG_URL||'http://127.0.0.1:51458',fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../fixtures/legacy-v2.json'),'utf8'))
async function records(page,store){return page.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('dilong-workflows',2);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});try{return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}finally{db.close()}},store)}
;(async()=>{
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
  assert.match(await page.locator('.mode-card.active').textContent(),/小样联想补全/);assert.equal(await page.locator('.config-panel select').inputValue(),'horizontal3')
  assert.equal(await page.getByLabel('候选评价',{exact:true}).inputValue(),'adjust');assert.equal((await records(page,'tasks')).length,1)
  console.log('PASS 实际React旧版v2数据：候选、评价、上传输入、完整任务参数与关联恢复')
  await page.locator('.text-navigation a[href="/"]').click();await page.getByRole('button',{name:'查看配墨操作，1项',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'打开此次配墨',exact:true}).click();await page.waitForURL('**/ink');await page.locator('.ink-run-info strong').waitFor()
  assert.match(await page.locator('.ink-run-info strong').textContent(),/旧版保存的候选/);assert.equal(await page.locator('.weight-input input').inputValue(),'77')
  const saved=await records(page,'inkRuns');assert.equal(saved.length,1);assert.equal(saved[0].id,fixture.inkRuns[0].id);assert(saved[0].snapshot.renderModel.assignments instanceof Uint8Array);assert(saved[0].snapshot.renderModel.original instanceof Uint8ClampedArray)
  assert.deepEqual(saved[0].snapshot.settings,fixture.inkRuns[0].snapshot.settings);assert.equal(saved[0].snapshot.imageUrl,fixture.inkRuns[0].snapshot.imageUrl)
  assert.deepEqual(errors,[]);console.log('PASS 实际React旧版配墨：TypedArray完整快照、原图和77kg参数恢复，不重算或增加历史')
 }finally{await context.close();await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
