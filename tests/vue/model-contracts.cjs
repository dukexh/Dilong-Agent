const {chromium}=require('playwright'),assert=require('node:assert/strict')
const base=process.env.DILONG_URL||'http://127.0.0.1:51458'
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true})
 async function scenario(name,decide,action){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),calls=[],jobs=new Map()
  page.setDefaultTimeout(30000)
  await context.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname,send=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
   if(path.endsWith('/model/tasks')){
    const body=req.postDataJSON();calls.push(body);const id=String(calls.length)
    const usage={id:'fixture-'+id,model:'fixture',kind:body.kind,status:'succeeded',inputTokens:100,outputTokens:20}
    const result=body.kind==='terms'?{terms:[body.query,'wood'],usage}:body.kind==='rank'?{matches:body.candidates.map(c=>({id:c.id,reason:'fixture'})),usage}:{images:[png],model:'fixture',usage}
    jobs.set(id,decide?.(body,calls)||{state:'succeeded',phase:'fixture',result});return send({id})
   }
   if(req.method()==='DELETE'||path.endsWith('/cancel'))return send({ok:true})
   if(path.includes('/jobs/'))return send(jobs.get(path.split('/').pop()))
   return send({configured:true,available:true})
  })
  try{await page.goto(base+'/design');await page.locator('.source-panel[data-input-ready="true"]').waitFor();await action(page,calls);console.log('PASS '+name)}finally{await context.close()}
 }
 async function run(page){await page.locator('.run-button').click();await page.waitForFunction(()=>document.querySelector('.run-button')?.disabled===false)}
 try{
  await scenario('图片排序省略候选时仍返回所选数量，图像读取失败有明确提示',(body)=>body.kind==='rank'?{state:'succeeded',phase:'fixture',result:{matches:[{id:body.candidates[0].id,reason:'fixture'}]}}:null,async(page,calls)=>{
   await page.goto(base+'/samples');await page.getByRole('button',{name:'以图搜图',exact:true}).click()
   await page.locator('.search-submit').click();await page.waitForFunction(()=>!document.querySelector('.search-submit').disabled)
   assert.equal(await page.locator('.search-match').count(),5)
   assert.equal(calls[0].rank_policy,'all');assert.equal(calls[0].has_reference,true)
   await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');const a=S.base.find(a=>a.id.includes('Wood033'));a.imageUrl=a.thumbnailUrl='/review-unreadable.jpg';S.status('review','ready')})
   await page.route('**/review-unreadable.jpg',r=>r.abort());await page.locator('.search-submit').click();await page.waitForFunction(()=>!document.querySelector('.search-submit').disabled)
   assert.equal(await page.locator('.search-match').count(),5);assert.match(await page.locator('.image-search-panel').innerText(),/无法读取/)
  })
  await scenario('编号与明确名称回车仍精确命中且不调用模型',null,async(page,calls)=>{
   await page.goto(base+'/samples');const id=await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');return S.base[0].id})
   await page.getByLabel('搜索样例',{exact:true}).fill(id);await page.waitForFunction(()=>document.querySelectorAll('.sample-card').length===1)
   await page.getByLabel('搜索样例',{exact:true}).press('Enter');await page.getByText('按编号或名称精确匹配',{exact:true}).waitFor()
   assert.equal(await page.locator('.sample-card').count(),1);assert.equal(calls.length,0)
  })
  await scenario('部分失败计数、刷新恢复、续生成与候选去重一致',(body,calls)=>body.kind==='generate'&&calls.length===2?{state:'failed',phase:'fixture',error:'controlled second-image failure',usage:{id:'failed-2',model:'fixture',kind:'generate',status:'failed',inputTokens:null,outputTokens:null}}:null,async(page,calls)=>{
   await page.locator('[data-design-mode="generate"]').click();await run(page)
   assert.equal(await page.locator('.candidate-card').count(),1)
   assert.equal(await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');return S.tasks.at(-1).outputCount}),1)
   await page.getByRole('button',{name:'保存候选方案',exact:true}).click();await page.getByRole('button',{name:'已保存候选',exact:true}).waitFor()
   await page.reload();await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');await S.ready;S.openTask(S.tasks.at(-1))})
   await page.getByRole('button',{name:'继续生成剩余 2 张',exact:true}).waitFor();assert.equal(await page.locator('.candidate-card').count(),1)
   await run(page);assert.equal(calls.length,4);assert.equal(await page.locator('.candidate-card').count(),3)
   const state=await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');const t=S.tasks.at(-1);return {count:t.outputCount,results:t.generation.results.length,assets:S.assets.length,usage:t.modelUsage.length,status:t.status}})
   assert.deepEqual(state,{count:3,results:3,assets:1,usage:4,status:'已保存候选'});assert.equal(await page.getByRole('button',{name:'已保存候选',exact:true}).count(),1)
  })
  await scenario('参考图保持原像素，变化倾向不是伪造百分比',null,async(page,calls)=>{
   const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1000;c.getContext('2d').fillRect(0,0,1600,1000);return c.toDataURL().split(',')[1]})
   await page.locator('.source-panel input[type=file]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.locator('.source-panel[data-input-ready="true"]').waitFor()
   await page.locator('[data-design-mode="twin"]').click();await run(page)
   const data=Buffer.from(calls[0].images[0].split(',')[1],'base64');assert.equal(data.readUInt32BE(16),1600);assert.equal(data.readUInt32BE(20),1000)
   assert.match(calls[0].query,/变化倾向/);assert.doesNotMatch(calls[0].query,/%/)
   await page.locator('.candidate-card .design-result-details summary').click();assert.match(await page.locator('.candidate-card').innerText(),/输入 100 Token/)
  })
  await scenario('参考图超限时在模型调用前拒绝，不自动缩小',null,async(page,calls)=>{
   const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=8001;c.height=10;c.getContext('2d').fillRect(0,0,8001,10);return c.toDataURL().split(',')[1]})
   await page.locator('.source-panel input[type=file]').setInputFiles({name:'oversized.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.locator('.source-panel[data-input-ready="true"]').waitFor()
   await page.locator('[data-design-mode="twin"]').click();await run(page)
   assert.equal(calls.length,0);assert.match(await page.locator('.design-error').innerText(),/不会自动缩小/);assert.equal(await page.locator('.candidate-card').count(),0)
  })
  await scenario('传入的材质、色系、原帖来源参与执行并持久保存',null,async(page,calls)=>{
   await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');await S.createTask({id:'review-post',title:'fine grain',keywords:['walnut','brown']},S.base[0],{mode:'generate',source:'真实帖子参考',parameters:{direction:'fine grain',material:'walnut',color:'dark brown',engineering:{version:'seamless-v1',baseUrl:'old-image',maskUrl:'old-mask',overlap:15,lightBalance:false},referencePost:{id:'post',title:'wood inspiration',url:'https://www.douyin.com/video/123456789'}}})})
   await page.locator('[data-design-mode="generate"].active').waitFor();await run(page)
   assert.match(calls[0].query,/walnut/);assert.match(calls[0].query,/dark brown/);assert.match(calls[0].query,/wood inspiration/)
   const p=await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');return S.tasks.at(-1).parameters})
   assert.equal(p.material,'walnut');assert.equal(p.color,'dark brown');assert.equal(p.referencePost.id,'post');assert.equal(p.engineering,undefined)
   await page.getByRole('button',{name:'保存候选方案',exact:true}).first().click();await page.getByRole('button',{name:'已保存候选',exact:true}).waitFor()
   const saved=await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');return S.assets[0].parameters});assert.equal(saved.material,'walnut');assert.equal(saved.engineering,undefined);assert.equal(saved.outputWidth,1)
   const history=await page.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');const old=S.tasks.at(-1),before=JSON.stringify(old);await S.createTask({id:'review-post',title:'changed requirements',keywords:['oak']},S.base[0],{mode:'generate',parameters:{direction:'new direction',material:'oak'}});return {count:S.tasks.length,unchanged:JSON.stringify(S.tasks.find(t=>t.id===old.id))===before,direction:S.tasks.at(-1).parameters.direction}})
   assert.deepEqual(history,{count:2,unchanged:true,direction:'new direction'})
  })
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
