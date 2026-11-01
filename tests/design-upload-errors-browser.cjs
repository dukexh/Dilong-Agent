const {chromium}=require(process.env.DILONG_PLAYWRIGHT||'playwright');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const server=http.createServer((req,res)=>{const file=path.join(root,decodeURIComponent(req.url.split('?')[0]));fs.readFile(file,(e,b)=>{res.statusCode=e?404:200;res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(e?'':b)})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>DilongStage1.ready);
  await page.locator('nav button').filter({hasText:'设计智能体'}).click();const design=page.locator('.design-page');await design.getByRole('button',{name:'上传图片',exact:true}).click();
  const png=async size=>Buffer.from(await page.evaluate(size=>{const c=document.createElement('canvas');c.width=c.height=size;c.getContext('2d').fillRect(0,0,size,size);const data=c.toDataURL().split(',')[1];c.width=c.height=0;return data},size),'base64');
  const input=design.locator('input[type=file]');await input.setInputFiles({name:'oversize.png',mimeType:'image/png',buffer:await png(6400)});
  const notice=design.getByText(/图片尺寸 6400×6400/);await notice.waitFor();assert.match(await notice.textContent(),/4096\.00 万像素/);assert.match(await notice.textContent(),/4000万像素，单边32767像素/);assert.match(await notice.textContent(),/自行缩小原图/);assert.equal(await design.getByText(/图片读取失败/).count(),0);
  console.log('PASS 有效超限图片显示实际尺寸、像素数、限制和处理建议');
  await input.setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});await design.getByText('图片读取失败，请更换文件后重试。',{exact:true}).waitFor();assert.equal(await notice.count(),0);
  console.log('PASS 损坏图片保持读取失败提示，不误报尺寸超限');
  await input.setInputFiles({name:'valid.png',mimeType:'image/png',buffer:await png(64)});await design.getByText('平均色',{exact:true}).waitFor();assert.equal(await design.getByText(/图片读取失败|超过浏览器处理范围/).count(),0);assert.deepEqual(errors,[]);
  console.log('PASS 更换合规图片恢复正常，清除旧错误');
 }finally{await browser.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
