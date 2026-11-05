/* Test the built site at browser-provided HTTP/HTTPS origins without real external requests. */
const { chromium } = require('playwright')
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path')
const root = path.resolve(__dirname,'../..'), dist = path.join(root,'dist')
async function records(page, store) {
  return page.evaluate(async store => {
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dilong-workflows',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
    try{return await new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}
  },store)
}
async function until(page,store,predicate) { for(let i=0;i<100;i++){const rows=await records(page,store);if(predicate(rows))return rows;await page.waitForTimeout(100)}throw Error('Records not ready: '+store) }
async function serve(context) {
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url()), pathname=decodeURIComponent(url.pathname)
    let file=path.resolve(dist,'.'+pathname)
    if(!file.startsWith(dist+path.sep)&&file!==dist){await route.fulfill({status:404,body:''});return}
    if(!path.extname(pathname)||pathname.endsWith('/index.html'))file=path.join(dist,'index.html')
    try{const body=await fs.readFile(file);const contentType=({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream';await route.fulfill({status:200,body,contentType})}catch{await route.fulfill({status:404,body:''})}
  })
}
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 try{for(const scenario of [{name:'普通HTTP IP',origin:'http://192.0.2.1:8004',secure:false},{name:'HTTPS',origin:'https://192.0.2.1:8004',secure:true},{name:'本机HTTP',origin:'http://127.0.0.1:48004',secure:true}]){
  const context=await browser.newContext();try{
   await serve(context);await context.addInitScript(()=>{window.nativeUUIDBeforeStartup=crypto.randomUUID})
   const page=await context.newPage(),errors=[],failed=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url())});page.setDefaultTimeout(15000)
   await page.goto(scenario.origin+'/index.html',{waitUntil:'networkidle'});await page.locator('h1').waitFor()
   const runtime=await page.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID,locks:typeof navigator.locks,unchanged:crypto.randomUUID===window.nativeUUIDBeforeStartup}))
   assert.equal(runtime.secure,scenario.secure);assert.equal(runtime.uuid,scenario.secure?'function':'undefined');assert(runtime.unchanged)
   if(!scenario.secure){
    assert.equal(runtime.locks,'undefined');await page.locator('.text-navigation a[href="/design"]').click();await page.getByRole('button',{name:'开始相似检索',exact:true}).click();let tasks=await until(page,'tasks',rows=>rows.length===1&&rows[0].status==='已处理');const taskId=tasks[0].id
    await page.getByRole('button',{name:'保存候选方案',exact:true}).first().click();await page.getByText('已将候选内容保存到样例库中',{exact:true}).first().waitFor();const assets=await until(page,'assets',rows=>rows.length===1)
    const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    tasks=await until(page,'tasks',rows=>rows[0].resultIds.length===1);for(const key of ['id','ownerId','runKey'])assert(uuid.test(tasks[0][key]));assert(uuid.test(assets[0].id.slice(6)))
    await page.locator('.text-navigation a[href="/samples"]').click();await page.getByRole('button',{name:/^我的样例/}).click();await page.locator('.texture-image').first().click();await page.getByRole('button',{name:'查看完整样例档案',exact:false}).click();await page.getByRole('dialog').getByRole('button',{name:'用于配墨',exact:true}).click();const ink=await until(page,'inkRuns',rows=>rows.length===1);assert(ink[0].snapshot.imageUrl.startsWith('data:image/'))
    await page.reload({waitUntil:'networkidle'});assert.equal((await records(page,'assets'))[0].id,assets[0].id);assert.equal((await records(page,'tasks'))[0].id,taskId);assert.equal((await records(page,'inkRuns'))[0].id,ink[0].id)
    await page.evaluate(async id=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('dilong-workflows',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});await new Promise((resolve,reject)=>{const tx=db.transaction('tasks','readwrite'),store=tx.objectStore('tasks'),r=store.get(id);r.onsuccess=()=>store.put({...r.result,status:'处理中'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()},taskId)
    await page.goto(scenario.origin+'/',{waitUntil:'networkidle'});await page.getByRole('button',{name:/查看设计任务/}).click();await page.getByRole('dialog').getByText('状态待确认',{exact:true}).waitFor();assert.equal((await records(page,'tasks'))[0].status,'处理中')
   }
   assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);console.log('PASS '+scenario.name+'：构建页面启动、原生安全上下文与资源加载'+(!scenario.secure?'、候选/任务/配墨持久化及保守中断恢复':''))
  }finally{await context.close()}
 }
 for(const scenario of ['read-denied','write-denied','storage-denied']){
  const context=await browser.newContext();try{
   await serve(context)
   await context.addInitScript(scenario=>{
    if(scenario==='read-denied')Storage.prototype.getItem=()=>{throw new DOMException('Test storage blocked','SecurityError')}
    else if(scenario==='write-denied'){localStorage.setItem('dilong-theme','dark');Storage.prototype.setItem=()=>{throw new DOMException('Test quota','QuotaExceededError')}}
    else Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('Test storage getter blocked','SecurityError')}})
   },scenario)
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
   await page.goto('http://127.0.0.1:48004/',{waitUntil:'networkidle'});await page.locator('.app-shell').waitFor()
   const dark=scenario==='write-denied';assert.equal(await page.locator('html').getAttribute('data-theme'),dark?'dark':'light')
   await page.getByRole('button',{name:dark?'切换浅色':'切换深色',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),dark?'light':'dark')
   await page.locator('.text-navigation a[href="/samples"]').click();await page.locator('.sample-card').first().waitFor();assert.deepEqual(errors,[])
   console.log('PASS 构建页面主题存储受限：'+scenario+'，启动、默认/已有主题、切换与样例页面可用')
  }finally{await context.close()}
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
