const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
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
  for(const route of ['','samples','design','ink','production','trends']){
   await page.goto(base+route,{waitUntil:'networkidle'});assert.equal(await page.locator('h1').count(),1);assert.equal(await page.evaluate(()=>typeof window.React),'undefined')
   await page.locator('main img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())))
   if(route==='samples')assert.equal(await page.locator('.sample-card').count(),24)
   if(route==='ink')await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('导出配墨建议单'))?.disabled)
   await page.screenshot({path:path.join(output,(prefix==='/'?'root':'subpath')+'-'+(route||'home')+'.png')})
  }
  await page.goto(base+'production',{waitUntil:'networkidle'});await page.locator('.source-frame img').nth(1).waitFor();await page.getByRole('button',{name:'确认对齐并分析',exact:true}).click();await page.getByRole('button',{name:'导出比对报告',exact:true}).waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent===' 导出比对报告')?.disabled&&document.querySelector('.comparison-metric strong')?.textContent!=='—')
  await page.getByRole('button',{name:'导出比对报告',exact:true}).click({trial:true})
  await page.setViewportSize({width:390,height:844});for(const route of ['','samples','design','ink','production','trends']){await page.goto(base+route,{waitUntil:'networkidle'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))}
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);console.log('PASS 独立dist '+prefix+'：6路由直接刷新、真实图片/配墨/生产计算、390px布局、无React/资源错误')
  return{prefix,routes:6,errors,failed}
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
