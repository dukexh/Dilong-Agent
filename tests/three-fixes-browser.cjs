const {chromium}=require(process.env.DILONG_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'dilong-three-fixes-')),results=[],errors=[];
 const server=http.createServer((req,res)=>fs.readFile(path.join(root,decodeURIComponent(req.url.split('?')[0])),(err,data)=>{if(err){res.writeHead(404);res.end();return}res.setHeader('Content-Type',req.url.includes('.js')?'text/javascript':req.url.includes('.css')?'text/css':req.url.includes('.html')?'text/html':'application/octet-stream');res.end(data)}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 const nav=async name=>page.locator('nav button').filter({hasText:name}).click();
 const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS',name)};
 const run=async()=>{await page.locator('.design-config>button').click();await page.waitForFunction(()=>!document.querySelector('.design-config>button').disabled)};
 const finished=async()=>page.waitForFunction(()=>!document.querySelector('.production-compare .export-button').disabled);
 const shot=async(name)=>{await page.evaluate(async()=>{window.scrollTo(0,0);await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished));});await page.screenshot({path:path.join(out,name+'.png'),fullPage:true})};
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.evaluate(()=>window.DilongStage1.ready);await nav('设计智能体');
 await check('补全保存中/已保存禁用，失败可重试，重新生成有独立候选',async()=>{
  await page.locator('.design-mode-grid button').nth(1).click();await run();
  await page.evaluate(()=>{const S=window.DilongStage1;window.originalCandidateAnalyze=S.analyze;S.analyze=async(...args)=>{await new Promise(r=>window.resumeCandidateAnalysis=r);return window.originalCandidateAnalyze(...args)}});
  let button=page.locator('.completion-results .result-copy>button').first();await button.click();await page.waitForFunction(()=>!!window.resumeCandidateAnalysis);assert(await button.isDisabled());assert.equal(await button.innerText(),'正在保存…');
  await page.evaluate(()=>{window.DilongStage1.analyze=window.originalCandidateAnalyze;window.resumeCandidateAnalysis()});await page.waitForFunction(()=>window.DilongStage1.operations.save.state==='ready');assert(await button.isDisabled());assert.equal(await button.innerText(),'已保存候选');assert.equal(await page.evaluate(()=>window.DilongStage1.assets.length),1);
  const concurrent=await page.evaluate(async()=>{const S=window.DilongStage1,row=S.assets[0],n=S.assets.length,key=row.sourceKey;const copies=await Promise.all([S.save(row.imageUrl,row.name,row.source,row.parameters,key),S.save(row.imageUrl,row.name,row.source,row.parameters,key)]);return{n,after:S.assets.length,ids:copies.map(a=>a.id)}});assert.equal(concurrent.after,concurrent.n);assert.equal(concurrent.ids[0],concurrent.ids[1]);
  await page.evaluate(()=>{window.originalSaveTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw Error('TEST_CANDIDATE_STORAGE');return window.originalSaveTransaction.apply(this,args)}});
  button=page.locator('.completion-results .result-copy>button').nth(1);await button.click();await page.getByRole('alert').filter({hasText:'TEST_CANDIDATE_STORAGE'}).waitFor();assert(await button.isEnabled());assert.equal(await page.evaluate(()=>window.DilongStage1.assets.length),1);
  await page.evaluate(()=>IDBDatabase.prototype.transaction=window.originalSaveTransaction);await button.click();await page.waitForFunction(()=>window.DilongStage1.assets.length===2);assert(await button.isDisabled());
  await run();button=page.locator('.completion-results .result-copy>button').first();assert(await button.isEnabled());await button.click();await page.waitForFunction(()=>window.DilongStage1.assets.length===3);
 });
 await check('同候选并发保存只写一条，失败后的锁能释放',async()=>{
  const value=await page.evaluate(async()=>{const S=window.DilongStage1,n=S.assets.length,src=S.base[0].imageUrl;const rows=await Promise.all([S.save(src,'并发保存','测试',{},'same-candidate'),S.save(src,'并发保存','测试',{},'same-candidate')]);return{n,after:S.assets.length,ids:rows.map(a=>a.id)}});assert.equal(value.after,value.n+1);assert.equal(value.ids[0],value.ids[1]);
 });
 await check('孪生、检索、推荐的已保存状态与各候选独立',async()=>{
  for(const mode of [2,0,3]){await page.locator('.design-mode-grid button').nth(mode).click();await run();const buttons=page.locator('.design-results .result-copy>button');const n=await page.evaluate(()=>window.DilongStage1.assets.length);await buttons.first().click();await page.waitForFunction(n=>window.DilongStage1.assets.length===n+1,n);assert(await buttons.first().isDisabled());assert(await buttons.nth(1).isEnabled())}
 });
 await check('四模式候选均可点击放大、键盘关闭并返回焦点',async()=>{
  for(const mode of [0,1,2,3]){await page.locator('.design-mode-grid button').nth(mode).click();await run();const trigger=page.locator('.candidate-preview-trigger').first();const frame=await trigger.boundingBox(),hint=await trigger.locator('.candidate-preview-hint').boundingBox();assert(hint.width>40&&hint.x>=frame.x&&hint.x+hint.width<=frame.x+frame.width&&hint.y+hint.height<=frame.y+frame.height);await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert(await dialog.locator('img').evaluate(im=>im.complete&&im.naturalWidth>0));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(await trigger.evaluate(el=>el===document.activeElement))}
 });
 await check('生产两侧坏图都清空失败侧，报告与分析禁用，有效图后可恢复',async()=>{
  await nav('生产比对');const pc=page.locator('.production-compare');await pc.getByRole('button',{name:'载入演示样本'}).click();await page.waitForFunction(()=>!document.querySelector('.pc-run').disabled);await pc.getByRole('button',{name:'确认对齐并分析'}).click();await finished();
  for(const side of [1,0]){const label=side?'上传生产实物':'上传设计原图';await pc.getByLabel(label,{exact:true}).setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await pc.getByRole('alert').waitFor();assert((await pc.getByRole('alert').innerText()).includes('请重新选择有效图片'));assert.equal(await pc.locator('.pc-source-panel').nth(side).locator('.pc-image').count(),0);assert.equal(await pc.locator('.pc-source-panel').nth(1-side).locator('.pc-image').count(),1);assert(await pc.getByRole('button',{name:'确认对齐并分析'}).isDisabled());assert(await pc.getByRole('button',{name:'导出比对报告'}).isDisabled());
   const file=path.join(root,'demo-pair',side?'02-production-ai.png':'01-design-ai.png');await pc.getByLabel(label,{exact:true}).setInputFiles(file);await page.waitForFunction(()=>!document.querySelector('.pc-run').disabled);assert.equal(await pc.getByRole('alert').count(),0);await pc.getByRole('button',{name:'确认对齐并分析'}).click();await finished();
  }
 });
 await check('八种窗口宽度下四种设计模式和四个趋势页无横向溢出',async()=>{
  for(const width of [2560,1920,1440,1280,1100,1024,768,390]){
   await page.setViewportSize({width,height:1100});await nav('设计智能体');
   for(let i=0;i<4;i++){await page.locator('.design-mode-grid button').nth(i).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' design '+i)}
   await nav('趋势洞察');for(let i=0;i<4;i++){await page.getByRole('tab').nth(i).click();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' trend '+i)}
  }
 });
 await check('恢复原三栏布局并整体放大，两页边距一致，实际结果截图',async()=>{
  for(const width of [2560,1440,1024,390]){
   await page.setViewportSize({width,height:1100});await nav('设计智能体');await page.locator('.design-mode-grid button').nth(1).click();await run();const design=await page.locator('.design-page').boundingBox();if(width>=1440){const panels=await page.locator('.design-source,.design-config,.design-results').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));assert(panels[0].x<panels[1].x&&panels[1].x<panels[2].x);assert(panels.every(p=>Math.abs(p.y-panels[0].y)<1))}await shot('design-'+width);
   await nav('趋势洞察');await page.getByRole('tab',{name:'热点雷达'}).click();const trend=await page.locator('.trend-page').boundingBox();assert(Math.abs(design.x-trend.x)<1&&Math.abs(design.width-trend.width)<1);if(width>=1440){const panels=await page.locator('[class*="queryPanel"],[class*="radarResults"],[class*="tracePanel"]').evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));assert(panels[0].x<panels[1].x&&panels[1].x<panels[2].x);assert(panels.every(p=>Math.abs(p.y-panels[0].y)<1))}await shot('trend-radar-'+width);
   if(width===1440||width===390){await page.getByRole('tab',{name:'定向研究'}).click();await page.getByRole('button',{name:'生成趋势研究'}).click();await page.locator('[class*="reportLead"]').waitFor();await shot('trend-research-'+width);await page.getByRole('tab',{name:'趋势预测'}).click();const bars=page.locator('[class*="barChart"]>div');for(let i=0;i<await bars.count();i++){const value=await bars.nth(i).locator('b').boundingBox(),month=await bars.nth(i).locator('span').boundingBox();assert(value.y+value.height<month.y,'forecast value and month do not overlap')}await shot('trend-forecast-'+width);await page.getByRole('tab',{name:'趋势转化'}).click();await shot('trend-translate-'+width)}
  }
 });
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('DONE '+results.length+' 组通过；输出 '+out);
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
