const {chromium}=require(process.env.DILONG_PLAYWRIGHT || 'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),os=require('node:os');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'dilong-navigation-'));
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(data);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.evaluate(()=>window.DilongStage1.ready);
 const names=await page.locator('nav button b').allTextContents();assert.deepEqual(names,['平台首页','样例库','设计智能体','配墨智能体','生产比对','趋势洞察']);
 for(const width of [1440,1101,1024,390]){
   await page.setViewportSize({width,height:1000});await page.locator('nav button').filter({hasText:'平台首页'}).click();
   assert.deepEqual(await page.locator('.capability-card h2').allTextContents(),['样例资产库','设计智能体','配墨智能体','生产比对','趋势洞察']);
   assert.deepEqual(await page.locator('.loop-flow b').allTextContents(),['样例','设计','配墨','生产比对']);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(width===1440||width===390)await page.screenshot({path:path.join(out,`homepage-${width}.png`),fullPage:true});
   await page.locator('.capability-card').filter({hasText:'生产比对'}).click();await page.getByRole('button',{name:'确认对齐并分析'}).waitFor();assert((await page.locator('.platform-topbar').innerText()).includes('生产比对'));
   await page.locator('nav button').filter({hasText:'平台首页'}).click();await page.locator('.capability-card').filter({hasText:'趋势洞察'}).click();await page.getByRole('tab',{name:'热点雷达'}).waitFor();
 }
 assert.deepEqual(errors,[]);console.log('PASS 导航顺序、首页五入口及流程说明、生产比对和趋势入口、四种宽度布局；无页面异常');console.log('截图：'+out);
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
