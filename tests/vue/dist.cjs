const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
const routes=['','samples','design','ink','production','color-compare','trends']
const output=path.join(root,'verification/dist-smoke');fs.mkdirSync(output,{recursive:true})
async function serve(directory,prefix){
 const server=http.createServer((request,response)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname)}catch{response.writeHead(400);response.end();return}
  if(!pathname.startsWith(prefix)){response.writeHead(404);response.end();return}
  let file=path.resolve(directory,'.'+pathname.slice(prefix.length-1));if(!file.startsWith(directory+path.sep)&&file!==directory){response.writeHead(404);response.end();return}
  if(!path.extname(pathname)||pathname.endsWith('/index.html'))file=path.join(directory,'index.html')
  fs.readFile(file,(error,body)=>{if(error){response.writeHead(404);response.end();return}response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');response.end(body)})
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return{server,base:'http://127.0.0.1:'+server.address().port+prefix}
}
async function check(browser,directory,prefix){
 const{server,base}=await serve(directory,prefix),context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],failed=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)failed.push(response.status()+' '+response.url())})
 try{
  for(const route of routes){
   await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(await page.locator('h1').count(),1);assert.equal(await page.evaluate(()=>typeof window.React),'undefined')
   await page.locator('main img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())))
   if(route==='samples')assert.equal(await page.locator('.sample-card').count(),24)
   if(route==='ink')await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('导出配墨建议单'))?.disabled)
   await page.screenshot({path:path.join(output,(prefix==='/'?'root':'subpath')+'-'+(route||'home')+'.png')})
  }
  await page.goto(base+'design',{waitUntil:'networkidle'});await page.locator('.source-panel dl').waitFor();await page.locator('.run-button').click();await page.waitForFunction(()=>document.querySelectorAll('.candidate-card').length===5);assert.match(await page.locator('.candidate-grid').innerText(),/Wood 033/);console.log('PASS 独立dist '+prefix+'：预置演示来样通过离线结构索引检索到Wood033')
  await page.locator('[data-design-mode="complete"]').click();await page.getByRole('button',{name:'上传图片',exact:true}).click()
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=96;const x=c.getContext('2d');x.fillStyle='#a48662';x.fillRect(0,0,128,96);x.fillStyle='#63513b';for(let i=0;i<128;i+=11)x.fillRect(i,0,3,96);return c.toDataURL().split(',')[1]})
  await page.locator('.source-panel input[type=file]').setInputFiles({name:'dist-unit.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.locator('.source-panel[data-input-ready="true"]').waitFor();await page.locator('.unit-dimensions').waitFor();await page.waitForFunction(()=>document.querySelector('.confirm-unit-button')&&!document.querySelector('.confirm-unit-button').disabled);assert.equal(await page.locator('.single-unit-preview .big-image-trigger').count(),1);assert.equal(await page.locator('[data-tile-preview]').count(),0)
  await page.locator('.unit-panel .engineering-export-button').click();const dialog=page.getByRole('dialog');await dialog.getByText('109 × 82',{exact:true}).waitFor()
  for(const format of ['tif','psd']){await dialog.getByLabel('工程文件格式').selectOption(format);const pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载工程文件',exact:true}).click();const download=await pending,target=path.join(output,(prefix==='/'?'root':'subpath')+'-unit.'+format);await download.saveAs(target);const bytes=fs.readFileSync(target);assert.equal(bytes.toString('ascii',0,format==='tif'?2:4),format==='tif'?'II':'8BPS')}
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.locator('.confirm-unit-button').click();await page.waitForFunction(()=>!document.querySelector('.completion-run-button').disabled);await page.locator('.completion-run-button').click();await page.locator('.completion-result').waitFor();assert.match(await page.locator('.completion-output .image-dimensions').innerText(),/327 × 82/);console.log('PASS 独立dist '+prefix+'：四方连续Worker、300ppi TIF和分层PSD下载')
  await page.goto(base+'production',{waitUntil:'networkidle'});await page.locator('.source-frame img').nth(1).waitFor();await page.getByRole('button',{name:'确认对齐并分析',exact:true}).click();await page.getByRole('button',{name:'导出比对报告',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent===' 导出比对报告')?.disabled&&document.querySelector('.comparison-metric strong')?.textContent!=='—')
  await page.getByRole('button',{name:'导出比对报告',exact:true}).click({trial:true})
  await page.setViewportSize({width:390,height:844});for(const route of routes){await page.goto(base+route,{waitUntil:'networkidle'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);console.log('PASS 独立dist '+prefix+'：'+routes.length+'路由直接刷新、真实图片/配墨/生产计算、390px布局、无React/资源错误')
  return{prefix,routes:routes.length,errors,failed}
 }finally{await context.close();await new Promise(resolve=>server.close(resolve))}
}
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true}),results=[]
 try{
  results.push(await check(browser,path.join(root,'dist'),'/'))
  const out=path.resolve(root,'verification/dist-subpath');assert(out.startsWith(path.resolve(root,'verification')+path.sep))
  const{build}=await import('vite');await build({root,configFile:path.join(root,'vite.config.ts'),base:'/dilong/',logLevel:'error',build:{outDir:out,emptyOutDir:true}})
  results.push(await check(browser,out,'/dilong/'))
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2))
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
