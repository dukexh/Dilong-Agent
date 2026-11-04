'use strict';
const {chromium}=require(process.env.DILONG_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(e,b)=>{res.statusCode=e?404:200;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(e?'':b)})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.evaluate(()=>DilongStage1.ready);
  await page.locator('nav button').filter({hasText:'设计智能体'}).click();const design=page.locator('.design-page');await design.getByRole('button',{name:'上传图片',exact:true}).click();
  const fixture=async(alpha,sparse=false)=>Buffer.from(await page.evaluate(({alpha,sparse})=>{
   const c=document.createElement('canvas');c.width=c.height=sparse?1024:64;const ctx=c.getContext('2d'),pixels=ctx.createImageData(c.width,c.height);
   if(sparse)pixels.data.set([255,0,0,alpha],(c.width+1)*4);else for(let k=0;k<pixels.data.length;k+=4)pixels.data.set([255,0,0,alpha],k);
   ctx.putImageData(pixels,0,0);return c.toDataURL().split(',')[1];
  },{alpha,sparse}),'base64');
  const upload=async(buffer,name)=>design.locator('input[type=file]').setInputFiles({name,mimeType:'image/png',buffer});
  await upload(await fixture(0),'empty.png');await design.getByText('图片完全透明，没有可见内容，请更换图片。',{exact:true}).waitFor();assert.equal(await design.getByText('平均色',{exact:true}).count(),0);
  console.log('PASS 全透明原图给出明确提示，不误报文件损坏');
  for(const [alpha,sparse] of [[128,false],[1,false],[255,true],[1,true],[255,false]]){
   const buffer=await fixture(alpha,sparse);await upload(buffer,`alpha-${alpha}-${sparse}.png`);await design.getByText('平均色',{exact:true}).waitFor();assert.equal(await design.locator('.source-error').count(),0);
   const result=await page.evaluate(async base64=>{
    const im=new Image();im.src='data:image/png;base64,'+base64;await im.decode();const S=DilongStage1,summary=await S.analyze(im),result=S.analyzeFull(im);
    const image=new Image();image.src=result.reconstructionUrl;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let visible=0,maxAlpha=0;for(let k=3;k<pixels.length;k+=4){if(pixels[k]>0)visible++;maxAlpha=Math.max(maxAlpha,pixels[k])}
    let sourceAlpha=0;for(let k=3;k<result.renderModel.original.length;k+=4)sourceAlpha=Math.max(sourceAlpha,result.renderModel.original[k]);
    return {summary:summary.averageRgb,visible,maxAlpha,sourceAlpha,difference:S.layerDifference(result.renderModel,result.layers.map(()=>true)),share:result.layers.reduce((n,l)=>n+l.share,0)};
   },buffer.toString('base64'));
   assert(result.visible>0);assert.equal(result.maxAlpha,result.sourceAlpha);assert(result.maxAlpha<=alpha);assert.equal(result.difference,0);assert.equal(result.share,100);assert.deepEqual(result.summary,{r:255,g:0,b:0});
   console.log(`PASS Alpha=${alpha}，${sparse?'原图单个可见像素':'整图'}：上传及两种颜色分析成功，透明度保留`);
  }
  await upload(await fixture(128),'semi.png');await design.getByText('平均色',{exact:true}).waitFor();await design.locator('.design-mode-grid button').nth(2).click();await design.getByRole('button',{name:'生成风格孪生',exact:true}).click();await design.locator('.twin-results article').first().waitFor();await design.getByRole('button',{name:'保存候选方案',exact:true}).first().click();await page.waitForFunction(()=>DilongStage1.assets.length===1);
  await page.reload();await page.evaluate(()=>DilongStage1.ready);assert.equal(await page.evaluate(()=>DilongStage1.assets.length),1);
  console.log('PASS 半透明图片生成风格候选、保存及刷新恢复成功');
  const sparse=await fixture(1,true);
  const saved=await page.evaluate(async base64=>{
   const record=await DilongStage1.save('data:image/png;base64,'+base64,'微小可见内容','test',{},'sparse-visible');
   return {id:record.id,colour:record.analysis.averageRgb};
  },sparse.toString('base64'));
  assert.deepEqual(saved.colour,{r:255,g:0,b:0});
  const legacy=await page.evaluate(()=>{
   const model={original:[255,255,255,128,0,0,0,255],assignments:[0,0],colours:[{r:0,g:0,b:0}]};
   return {old:DilongStage1.layerDifference(model,[true]),current:DilongStage1.layerDifference({...model,alphaThreshold:0},[true])};
  });
  assert.deepEqual(legacy,{old:0,current:127.5});
  console.log('PASS 单个Alpha=1像素可保存入库，旧历史保留原透明度分析规则');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e);process.exitCode=1});
