const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path')
const output=path.resolve('verification/text-display'),base=process.env.DILONG_URL||'http://127.0.0.1:51458',rows=[]
fs.mkdirSync(output,{recursive:true})
function measure(){
 const roots=[...document.querySelectorAll('main,.ant-modal:where(:not([style*="display: none"])),dialog[open]')].filter(el=>el.getClientRects().length)
 const issues=[],seen=new Set(),style=el=>getComputedStyle(el),visible=el=>!!el.getClientRects().length
 const selector=el=>el.tagName.toLowerCase()+[...el.classList].slice(0,3).map(x=>'.'+x).join('')
 for(const root of roots){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node
 while(node=walker.nextNode()){
  const text=node.textContent.trim(),el=node.parentElement;if(!text||!el||seen.has(node)||!visible(el)||el.closest('script,style,option,select,textarea,svg,.sr-only,[aria-hidden="true"]'))continue;seen.add(node)
  const range=document.createRange();range.selectNodeContents(node);const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);if(!rects.length)continue
  let parent=el,depth=0
  while(parent&&depth++<8){const css=style(parent),a=parent.getBoundingClientRect();if(!visible(parent))break
   if((css.overflowX==='hidden'||css.overflowX==='clip')&&rects.some(r=>r.left<a.left-1.5||r.right>a.right+1.5)){
    issues.push({kind:css.textOverflow==='ellipsis'?'ellipsis':'clipped-text',text:text.slice(0,100),element:selector(el),container:selector(parent),width:Math.round(a.width)});break
   }
   parent=parent.parentElement
  }
  const css=style(el)
  if(css.whiteSpace==='nowrap'&&el.clientWidth>0&&el.scrollWidth>el.clientWidth+2&&!issues.some(x=>x.text===text.slice(0,100))&&!el.closest('.platform-sidebar'))issues.push({kind:'nowrap-overflow',text:text.slice(0,100),element:selector(el),width:el.clientWidth,scroll:el.scrollWidth})
 }
 }
 for(const el of document.querySelectorAll('.ant-modal:has(.ant-modal-content),dialog[open]'))if(visible(el)&&el.scrollWidth>el.clientWidth+2)issues.push({kind:'dialog-overflow',element:selector(el),width:el.clientWidth,scroll:el.scrollWidth})
 for(const hint of document.querySelectorAll('.image-hint'))if(visible(hint)){const image=hint.parentElement.querySelector('img');if(image&&Number(style(hint).zIndex)<=Number(style(image).zIndex))issues.push({kind:'hint-behind-image',element:selector(hint)})}
 if(document.documentElement.scrollWidth>innerWidth+2)issues.push({kind:'page-overflow',width:innerWidth,scroll:document.documentElement.scrollWidth})
 return issues
}
async function service(p){await p.evaluate(async()=>{const {S}=await import('/src/services/workflows.ts');await S.ready;window.__S=S})}
async function seed(p){return p.evaluate(async()=>{const S=window.__S,c=document.createElement('canvas');c.width=64;c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='#bc9971';ctx.fillRect(0,0,64,48);ctx.fillStyle='#62503b';ctx.fillRect(20,0,16,48);const url=c.toDataURL(),name='Customer_Production_Texture_'+('NaturalOak_'.repeat(13))+'2026.png';const task=await S.beginDesignTask({mode:'compare',runKey:S.createId(),input:{kind:'library',sampleId:S.base[0].id,name},parameters:{sorting:'balanced',limit:5}});await S.updateTask(task.id,{title:name,status:'已处理',outputCount:1});const asset=await S.save(url,name,'相似检索',{},'text-layout-candidate',task.id);await S.updateAsset(asset.id,{customer:'Customer_Project_'+('Contract_'.repeat(15))});const im=new Image();im.src=url;await im.decode();const a=S.analyzeFull(im);await S.recordInkRun({id:'text-layout-ink',inputName:name,source:'布局检查',layerCount:a.layers.length,difference:a.difference,snapshot:{version:1,imageUrl:url,layers:a.layers,renderModel:a.renderModel,settings:{weight:10,enabled:a.layers.map(()=>true),selectedLayer:0,tab:'overview'}}});window.__fixture={taskId:task.id,assetId:asset.id,name,url};return window.__fixture})}
async function audit(p,name,width){await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(70);const issues=await p.evaluate(measure);rows.push({name,width,issues});if(issues.length){console.log(JSON.stringify({name,width,issues:issues.slice(0,12)}));await p.screenshot({path:path.join(output,`${width}-${name}.png`),fullPage:false})}fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(rows,null,2))}
async function closeModal(p){const count=await p.locator('.ant-modal:visible').count();await p.locator('.ant-modal:visible .ant-modal-close').last().click();await p.waitForFunction(count=>[...document.querySelectorAll('.ant-modal')].filter(el=>el.getClientRects().length).length===count-1,count)}
;(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});try{for(const width of [1440,1024,390,320]){const c=await b.newContext({viewport:{width,height:1000}}),p=await c.newPage();p.setDefaultTimeout(15000);await p.goto(base);await service(p);const fixture=await seed(p)
 for(const [route,name] of [['/','home'],['/samples','samples'],['/design','design'],['/ink','ink'],['/production','production'],['/trends','trends']]){
  await p.goto(base+route,{waitUntil:'networkidle'});await service(p);await p.locator('h1').waitFor();if(name==='ink')await p.locator('.layer-card').first().waitFor();if(name==='production')await p.locator('.source-frame img').nth(1).waitFor();await audit(p,name,width)
  if(name==='samples'){await p.getByLabel('搜索样例',{exact:true}).fill(fixture.assetId);await p.locator('.sample-card').click();await p.locator('.sample-inspector h2').waitFor();await audit(p,'sample-inspector',width);await p.getByRole('button',{name:'查看完整样例档案',exact:false}).click();await p.locator('.sample-archive').waitFor();await audit(p,'sample-archive',width);await p.locator('.sample-archive').getByRole('button',{name:'编辑信息',exact:true}).click();await p.locator('.metadata-form').waitFor();await audit(p,'metadata',width);await closeModal(p);await closeModal(p);await p.getByRole('button',{name:'导入样例文件包',exact:true}).click();await p.locator('.package-manager input[type=file]').setInputFiles({name:fixture.name.replace('.png','.zip'),mimeType:'application/zip',buffer:fs.readFileSync(path.resolve('public/示例样例包.zip'))});await p.locator('.import-preview').waitFor();await audit(p,'package',width);await p.locator('.package-format summary').click();await audit(p,'package-format',width);await closeModal(p)}
  if(name==='design'){await p.evaluate(id=>window.__S.openTask(window.__S.tasks.find(t=>t.id===id)),fixture.taskId);await p.locator('.saved-results article').waitFor();await audit(p,'design-saved',width);await p.locator('.saved-image .big-image-trigger').first().click();await p.locator('.big-image-dialog[open]').waitFor();await audit(p,'big-image',width);await p.getByRole('button',{name:'关闭大图',exact:true}).click()}
  if(name==='ink'){await p.evaluate(()=>window.__S.openInkRun(window.__S.inkRuns.find(t=>t.id==='text-layout-ink')));await p.locator('.ink-run-info').waitFor();await audit(p,'ink-history',width);await p.getByRole('tab',{name:'单层配方详情',exact:true}).click();await audit(p,'ink-detail',width)}
  if(name==='production'){await p.getByRole('button',{name:'确认对齐并分析',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.comparison-metric strong')?.textContent!=='—'&&!document.querySelector('.calculation-progress'));await audit(p,'production-result',width);await p.locator('.comparison-metric').first().click();await p.locator('.metric-dialog[open]').waitFor();await audit(p,'metric-dialog',width);await p.getByRole('button',{name:'关闭指标详情',exact:true}).click()}
  if(name==='trends')for(const [label,key] of [['定向研究','research'],['趋势预测','forecast'],['趋势转化','translate']]){await p.getByRole('tab',{name:label,exact:true}).click();await audit(p,key,width)}
 }
 await p.goto(base);await service(p);for(const kind of ['tasks','pending','ink']){await p.evaluate(kind=>window.__S.showStats(kind),kind);await p.locator('.history-dialog').waitFor();await audit(p,'history-'+kind,width);await closeModal(p)}await c.close();console.log('Scanned '+width+'px')
}}finally{await b.close()}console.log('Cases '+rows.length+', with findings '+rows.filter(r=>r.issues.length).length);require('node:assert/strict').equal(rows.filter(r=>r.issues.length).length,0,'文字和弹窗不应被裁断或撑宽页面，详见verification/text-display/results.json')})().catch(e=>{console.error(e);process.exitCode=1})
