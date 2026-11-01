const {chromium}=require(process.env.DILONG_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..'),out=fs.mkdtempSync(path.join(os.tmpdir(),'dilong-trial-fixes-'));
  const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(error,data)=>{res.statusCode=error?404:200;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(error?'':data)})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)};
  try{
    await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>window.DilongStage1.ready);
    await page.waitForFunction(()=>window.DilongStage1.operations.ink?.state==='ready');
    await page.evaluate(()=>{
      window.fixture=(width,height,alpha=false)=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');for(let y=0;y<height;y++){ctx.fillStyle=`rgb(${80+y%120},${60+y%100},${40+y%70})`;ctx.fillRect(0,y,alpha?width/2:width,1)}return c.toDataURL()};
      window.decode=async src=>{const im=new Image();im.src=src;await im.decode();const c=document.createElement('canvas');c.width=im.naturalWidth;c.height=im.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return ctx.getImageData(0,0,c.width,c.height)};
    });
    await check('风格迁移保留宽图、竖图和方图的原分辨率，预览独立缩小，SSIM逐图实算',async()=>{
      const data=await page.evaluate(async()=>{
        const list=[];for(const [w,h] of [[1200,200],[80,240],[96,96]]){const src=fixture(w,h),outputs=await DilongDesignImages.twin(src,'smoked',78);for(const o of outputs){const full=await decode(o.url),thumb=await decode(o.thumbnailUrl),expected=await DilongCompareCore.structureSimilarity(await decode(src),full);list.push({w,h,width:full.width,height:full.height,preview:Math.max(thumb.width,thumb.height),value:o.similarity,expected})}if(w===1200)window.wideResults=outputs}return list;
      });for(const r of data){assert.equal(r.width,r.w);assert.equal(r.height,r.h);assert(r.preview<=640);assert(Math.abs(r.value-r.expected)<1e-12)}
      assert(new Set(data.map(x=>x.value.toFixed(6))).size>3);
    });
    await check('三倍、五倍、四周补全尺寸准确，中心原图逐像素保留',async()=>{
      const results=await page.evaluate(async()=>{const src=fixture(360,60),original=await decode(src),rows=[];for(const mode of ['horizontal3','horizontal5','around']){const out=await DilongDesignImages.complete(src,mode),cols=mode==='horizontal5'?5:3;for(const o of out){const pixels=await decode(o.url);let exact=true;for(let y=0;y<60;y++)for(let x=0;x<360;x++)for(let c=0;c<4;c++){const at=((y+(mode==='around'?60:0))*pixels.width+x+Math.floor(cols/2)*360)*4+c;if(pixels.data[at]!==original.data[(y*360+x)*4+c])exact=false}rows.push({mode,w:pixels.width,h:pixels.height,exact})}}return rows});
      for(const r of results){assert.equal(r.w,r.mode==='horizontal5'?1800:1080);assert.equal(r.h,r.mode==='around'?180:60);assert(r.exact)}
    });
    await check('不透明原图的九种补全结果全部不透明，生产比对覆盖所有像素',async()=>{
      const results=await page.evaluate(async()=>{const rows=[];for(const mode of ['horizontal3','horizontal5','around'])for(const output of await DilongDesignImages.complete(fixture(300,100),mode)){const pixels=await decode(output.url);let transparent=0;for(let i=3;i<pixels.data.length;i+=4)if(pixels.data[i]!==255)transparent++;const comparison=await DilongCompareCore.compareRegions(pixels,pixels,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);rows.push({transparent,total:pixels.width*pixels.height,valid:comparison.validCount})}const source=await decode(fixture(30,20,true)),output=await decode((await DilongDesignImages.complete(fixture(30,20,true),'around'))[0].url);let centerMatches=true;for(let y=0;y<20;y++)for(let x=0;x<30;x++)for(let c=0;c<4;c++)if(source.data[(y*30+x)*4+c]!==output.data[((y+20)*90+x+30)*4+c])centerMatches=false;return{rows,centerMatches}});
      for(const r of results.rows){assert.equal(r.transparent,0);assert.equal(r.valid,r.total)}assert(results.centerMatches);
    });
    await check('超限任务明确拒绝，SSIM不可用时不伪造分数',async()=>{
      const r=await page.evaluate(async()=>{let error='';try{await DilongDesignImages.complete(fixture(3000,3000),'horizontal5')}catch(e){error=e.message}const tiny=await DilongDesignImages.twin(fixture(6,6),'smoked',78);return {error,labels:tiny.map(o=>DilongDesignImages.scoreLabel(o.similarity)),negative:DilongDesignImages.scoreLabel(-.5)}});
      assert.match(r.error,/不会自动降低分辨率/);assert(r.labels.every(x=>x.includes('暂无法计算')));assert.equal(r.negative,'结构相似度 0.0%');
    });
    await check('透明区不计入配墨覆盖率和偏差，还原及色层保留透明，全透明拒绝',async()=>{
      const r=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,50,100);const im=new Image();im.src=c.toDataURL();await im.decode();const S=DilongStage1,result=S.analyzeFull(im),pixels=await decode(result.reconstructionUrl),mask=await decode(result.layers[0].maskUrl),summary=await S.analyze(im.src);const disabled=S.layerDifference(result.renderModel,result.layers.map(()=>false)),enabled=S.layerDifference(result.renderModel,result.layers.map(()=>true));const blank=new Image();ctx.clearRect(0,0,100,100);blank.src=c.toDataURL();await blank.decode();return{initial:result.difference,enabled,disabled,share:result.layers.reduce((sum,l)=>sum+l.share,0),alpha:pixels.data[(50*100+75)*4+3],maskAlpha:mask.data[(50*100+75)*4+3],summary:summary.averageRgb,blank:S.analyzeFull(blank)}});
      assert.equal(r.initial,0);assert.equal(r.enabled,0);assert.equal(r.disabled,0);assert.equal(r.share,100);assert.equal(r.alpha,0);assert.equal(r.maskAlpha,0);assert.deepEqual(r.summary,{r:255,g:255,b:255});assert.equal(r.blank,null);
    });
    await page.locator('nav button').filter({hasText:'设计智能体'}).click();const design=page.locator('.design-page');
    await design.getByRole('button',{name:'上传图片',exact:true}).click();
    const url=await page.evaluate(()=>fixture(1200,200));await design.locator('input[type=file]').setInputFiles({name:'wide.png',mimeType:'image/png',buffer:Buffer.from(url.split(',')[1],'base64')});await design.getByText('平均色',{exact:true}).waitFor();await design.getByRole('button',{name:'风格迁移孪生'}).click();
    await check('上传原图点击完整查看和下载保持尺寸，文件编码确为PNG',async()=>{
      await design.locator('.source-preview .candidate-preview-trigger').click();const dialog=page.getByRole('dialog');await dialog.getByText(/1200 × 200/).waitFor();const pending=page.waitForEvent('download');await dialog.getByRole('link',{name:'下载完整图片'}).click();const file=await pending;await file.saveAs(path.join(out,'source.png'));const bytes=fs.readFileSync(path.join(out,'source.png'));assert.equal(bytes.toString('ascii',1,4),'PNG');assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),200);await page.keyboard.press('Escape');
    });
    await check('Canvas异常结束任务并恢复按钮，同任务可以成功重试',async()=>{
      await page.evaluate(()=>{window.nativeGetImageData=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(...args){if(this.canvas.width===1200)throw Error('TEST_TWIN_CANVAS');return nativeGetImageData.apply(this,args)}});
      await design.getByRole('button',{name:'生成风格孪生',exact:true}).click();await design.getByText('任务执行失败：TEST_TWIN_CANVAS',{exact:true}).waitFor();assert(await design.getByRole('button',{name:'生成风格孪生',exact:true}).isEnabled());
      const id=await page.evaluate(()=>DilongStage1.tasks.at(-1).id);assert.equal(await page.evaluate(()=>DilongStage1.tasks.at(-1).status),'执行失败');
      await page.evaluate(()=>CanvasRenderingContext2D.prototype.getImageData=window.nativeGetImageData);await design.getByRole('button',{name:'生成风格孪生',exact:true}).click();await design.locator('.twin-results img').first().waitFor();assert.equal(await page.evaluate(()=>DilongStage1.tasks.at(-1).id),id);
    });
    await check('界面显示实算百分比，保存后原分辨率和质量数据保留',async()=>{
      const labels=await design.locator('.twin-results em').allTextContents();const expected=await page.evaluate(()=>wideResults.map(o=>DilongDesignImages.scoreLabel(o.similarity)));assert.deepEqual(labels,expected);assert(!labels.some(x=>x.includes('纹理保留')));
      await design.getByRole('button',{name:'保存候选方案'}).first().click();await page.waitForFunction(()=>DilongStage1.assets.length===1);
      const r=await page.evaluate(async()=>{const a=DilongStage1.assets[0],im=await decode(a.imageUrl),thumb=await decode(a.thumbnailUrl);return{w:im.width,h:im.height,thumb:thumb.width,score:a.parameters.structureSimilarity}});assert.equal(r.w,1200);assert.equal(r.h,200);assert(r.thumb<=640);assert(Number.isFinite(r.score));
    });
    await check('点击大图支持100%缩放拖动、完整PNG下载和窄屏布局',async()=>{
      await design.locator('.twin-results .candidate-preview-trigger').first().click();const dialog=page.getByRole('dialog');await dialog.getByText(/1200 × 200/).waitFor();await dialog.getByRole('button',{name:'100%',exact:true}).click();
      assert.equal(await dialog.locator('.candidate-image-viewport img').evaluate(im=>im.getBoundingClientRect().width),1200);
      const area=dialog.locator('.candidate-image-viewport'),box=await area.boundingBox();await page.mouse.move(box.x+250,box.y+60);await page.mouse.down();await page.mouse.move(box.x+100,box.y+60);await page.mouse.up();assert(await area.evaluate(e=>e.scrollLeft>0));
      await dialog.getByRole('button',{name:'放大图片',exact:true}).click();assert.equal(await area.locator('img').evaluate(im=>im.getBoundingClientRect().width),1500);
      const pending=page.waitForEvent('download');await dialog.getByRole('link',{name:'下载完整图片'}).click();const d=await pending;await d.saveAs(path.join(out,'full.png'));const bytes=fs.readFileSync(path.join(out,'full.png'));assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),200);
      await page.setViewportSize({width:390,height:850});await dialog.getByRole('button',{name:'适应窗口'}).click();await page.screenshot({path:path.join(out,'viewer-mobile.png')});assert(await dialog.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
    });
    await check('大图适应模式随宽高和方向变化自动更新，100%模式保持比例，重开正常',async()=>{
      await design.locator('.twin-results .candidate-preview-trigger').first().click();const dialog=page.getByRole('dialog'),area=dialog.locator('.candidate-image-viewport');await dialog.getByText(/1200 × 200/).waitFor();
      for(const [width,height] of [[390,850],[850,390],[1440,1000]]){await page.setViewportSize({width,height});await page.waitForFunction(()=>{const el=document.querySelector('.candidate-image-viewport'),im=el?.querySelector('img');return im&&Math.abs(im.getBoundingClientRect().width-Math.min(1,el.clientWidth/im.naturalWidth,el.clientHeight/im.naturalHeight)*im.naturalWidth)<1});assert(await area.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1))}
      await dialog.getByRole('button',{name:'100%',exact:true}).click();await page.setViewportSize({width:390,height:850});assert.equal(await area.locator('img').evaluate(im=>im.getBoundingClientRect().width),1200);await dialog.getByRole('button',{name:'适应窗口'}).click();await page.waitForFunction(()=>{const el=document.querySelector('.candidate-image-viewport');return el.scrollWidth<=el.clientWidth+1});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await design.locator('.twin-results .candidate-preview-trigger').first().click();await dialog.getByText(/1200 × 200/).waitFor();assert(await area.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(out,'auto-fit-mobile.png'),animations:'disabled'});await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:1000});
    });
    await check('透明图配墨历史刷新恢复后仍保留透明模型及正确偏差',async()=>{
      await page.locator('nav button').filter({hasText:'配墨智能体'}).click();const ink=page.locator('.app-shell.embedded-module');const png=await page.evaluate(()=>fixture(120,80,true));await ink.locator('input[type=file]').setInputFiles({name:'transparent.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await page.waitForFunction(()=>DilongStage1.inkRuns.length===1);const old=await page.evaluate(()=>({id:DilongStage1.inkRuns[0].id,diff:DilongStage1.inkRuns[0].difference}));await page.reload();await page.evaluate(()=>DilongStage1.ready);await page.evaluate(id=>DilongStage1.openInkRun(DilongStage1.inkRuns.find(r=>r.id===id)),old.id);await ink.waitFor({state:'visible'});const restored=await page.evaluate(()=>{const r=DilongStage1.inkRuns[0];return{diff:r.difference,alpha:r.snapshot.renderModel.original[119*4+3]}});assert.equal(restored.diff,old.diff);assert.equal(restored.alpha,0);
    });
    assert.deepEqual(errors,[]);console.log(`DONE ${passed} groups; ${out}`);
  }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
