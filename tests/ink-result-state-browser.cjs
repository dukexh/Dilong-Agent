'use strict';
const {chromium}=require(process.env.DILONG_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(e,b)=>{res.statusCode=e?404:200;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(e?'':b)})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.evaluate(()=>DilongStage1.ready);await page.locator('nav button').filter({hasText:'配墨智能体'}).click();const ink=page.locator('.app-shell.embedded-module'),input=ink.locator('input[type=file]'),top=ink.locator('.summary-strip > div').filter({hasText:'当前合成偏差'}).locator('strong'),bottom=ink.locator('.difference-note strong');
  await page.waitForFunction(()=>DilongStage1.operations.ink?.state==='ready');
  const fixtures=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=128;c.height=64;const blank=c.toDataURL().split(',')[1],ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,128,64);const white=c.toDataURL().split(',')[1],pixels=ctx.createImageData(128,64);for(let y=0;y<64;y++)for(let x=0;x<128;x++)pixels.data.set([x*2,y*4,(x+y)%128*2,255],(y*128+x)*4);ctx.putImageData(pixels,0,0);return{blank,white,gradient:c.toDataURL().split(',')[1]}});
  const upload=(name,buffer,mimeType='image/png')=>input.setInputFiles({name,mimeType,buffer});
  const noResult=async()=>{assert.equal(await top.innerText(),'—');assert.equal(await bottom.innerText(),'当前合成偏差（白底）：—');assert(await ink.getByRole('button',{name:'导出配墨建议单',exact:true}).isDisabled())};
  await upload('empty.png',Buffer.from(fixtures.blank,'base64'));await ink.getByText('图片完全透明，没有可见内容，请更换图片。',{exact:true}).waitFor();await noResult();
  await upload('broken.png',Buffer.from('broken'));await ink.getByText('图片加载失败，请更换图片后重试',{exact:true}).waitFor();await noResult();assert.equal(await page.evaluate(()=>DilongStage1.inkRuns.length),0);
  console.log('PASS 全透明与损坏图片两处均无偏差，不能导出且不记成功历史');
  await upload('gradient.png',Buffer.from(fixtures.gradient,'base64'));await top.getByText('计算中…',{exact:true}).waitFor();await page.waitForFunction(()=>DilongStage1.inkRuns.length===1);const value=await top.innerText();assert.notEqual(value,'0 / 255');assert.equal(await bottom.innerText(),'当前合成偏差（白底）：'+value);
  await upload('oversize.png',Buffer.concat([Buffer.from(fixtures.gradient,'base64'),Buffer.alloc(12*1024*1024)]));await ink.getByText('图片不能超过 12 MB。',{exact:true}).waitFor();await noResult();
  await upload('notes.txt',Buffer.from('text'),'text/plain');await ink.getByText('仅支持 JPG、PNG、WEBP 等图片文件。',{exact:true}).waitFor();await noResult();assert.equal(await page.evaluate(()=>DilongStage1.inkRuns.length),1);
  console.log('PASS 计算中有独立状态，超限与类型错误清除旧偏差，保留旧历史');
  await upload('white.png',Buffer.from(fixtures.white,'base64'));await page.waitForFunction(()=>DilongStage1.inkRuns.length===2);assert.equal(await top.innerText(),'0 / 255');assert.equal(await bottom.innerText(),'当前合成偏差（白底）：0 / 255');assert(await ink.getByRole('button',{name:'导出配墨建议单',exact:true}).isEnabled());
  console.log('PASS 失败后正常图片恢复，真实零偏差仍显示为0');
  await page.reload();await page.evaluate(()=>DilongStage1.ready);await page.locator('nav button').filter({hasText:'平台首页'}).click();await page.getByRole('button',{name:/查看配墨操作/}).click();await page.getByRole('dialog').locator('[data-record-id]').filter({hasText:'gradient.png'}).getByRole('button',{name:'打开此次配墨',exact:true}).click();
  await ink.waitFor({state:'visible'});await top.getByText(value,{exact:true}).waitFor();assert.equal(await bottom.innerText(),'当前合成偏差（白底）：'+value);assert.deepEqual(errors,[]);
  console.log('PASS 刷新后历史可恢复有效数值，无页面异常');
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
