/* First-stage local workflows. No remote service calls. */
(function (global) {
  'use strict';
  const S = global.DilongStage1 = { assets: [], tasks: [], inkRuns: [], operations: {}, listeners: new Set(), base: [] };
  const metadata=global.DilongSampleMetadata;
  const emit = () => S.listeners.forEach(f => f());
  S.status = (key, state, message = '') => { S.operations[key] = { state, message }; emit(); };
  S.subscribe = f => { S.listeners.add(f); return () => S.listeners.delete(f); };
  const id = () => crypto.randomUUID();
  let dataWrites=Promise.resolve();
  const withDataWrite=action=>{const pending=dataWrites.then(action);dataWrites=pending.catch(()=>{});return pending;};
  S.designModeLabels={compare:'相似检索',complete:'小样补全',twin:'风格迁移',generate:'示例候选推荐'};
  const describeConditions=(mode,p)=>mode==='compare'?({'balanced':'综合色彩与纹理','texture':'优先纹理','color':'优先色彩'}[p.sorting]+'；返回 '+p.limit+' 条'):mode==='complete'?({'horizontal3':'横向扩展3倍','horizontal5':'横向扩展5倍','around':'四周扩展'}[p.completion]):mode==='twin'?({'smoked':'烟熏胡桃','warmGrey':'暖灰中古','lightNatural':'浅米自然','redBrown':'红棕复古'}[p.style]+'；强度 '+p.strength+'%'):p.direction;
  const candidateSources=['相似检索','completion','twin','示例推荐'];
  const candidateStatus=a=>a.candidateReview?.status||'pending';
  S.isCandidate=a=>a.recordKind==='design-candidate'||(!a.importedAt&&(a.status==='本地保存'||(a.status!=='本地导入'&&candidateSources.includes(a.source))));
  S.stats=()=>({assets:S.all().length,designTasks:S.tasks.length,pendingCandidates:S.assets.filter(a=>S.isCandidate(a)&&candidateStatus(a)==='pending').length,inkRuns:S.inkRuns.length});
  S.showStats=(kind,trigger)=>{S.statsSession=(S.statsSession||0)+1;S.statsView=kind;S.statsTrigger=trigger;emit();};
  S.closeStats=session=>{if(session!==undefined&&session!==S.statsSession)return;S.statsView=null;emit();};
  const resultStatus=(resultIds,assets=S.assets)=>resultIds.some(key=>assets.some(a=>a.id===key&&candidateStatus(a)==='pending'))?'已保存候选':'已评价';
  let dbPromise;
  function db() {
    return dbPromise ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('dilong-workflows', 2);
      r.onupgradeneeded = () => {for(const name of ['assets','tasks','inkRuns'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'});};
      r.onblocked=()=>S.status('storage','error','本地记录升级被旧标签页占用，请关闭本网站其他标签页后刷新。');
      r.onsuccess = () => {r.result.onversionchange=()=>r.result.close();S.status('storage','ready');resolve(r.result);}; r.onerror = () => reject(r.error);
    }).catch(e => { dbPromise = null; throw e; });
  }
  async function write(store, records) {
    const d = await db();
    await new Promise((resolve, reject) => {
      const t = d.transaction(store, 'readwrite'); records.forEach(r => t.objectStore(store).put(r));
      t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || Error('保存事务取消'));
    });
  }
  async function read(store) {
    const d = await db(); return new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
  }
  async function writeLinked(records){
    const d=await db(),names=Object.keys(records).filter(name=>records[name].length);
    if(!names.length)return;
    await new Promise((resolve,reject)=>{const tx=d.transaction(names,'readwrite');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('保存事务取消'));try{for(const name of names)records[name].forEach(record=>tx.objectStore(name).put(record));}catch(e){tx.abort();reject(e);}});
  }
  S.ready = Promise.all([read('assets'), read('tasks'),read('inkRuns')]).then(([a,t,ink])=>{const chronological=(a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id);S.assets=a.map(item=>S.isCandidate(item)?{...item,recordKind:'design-candidate'}:item);S.tasks=t.sort(chronological);S.inkRuns=ink.sort(chronological);emit();}).catch(e => S.status('storage', 'error', '本地数据读取失败：' + e.message));
  S.all = () => [...S.base, ...S.assets];
  S.deleteAsset = assetId => withDataWrite(async()=>{
    await S.ready;
    const asset=S.assets.find(a=>a.id===assetId);
    if(!asset)throw Error('只能删除自己导入或保存的样例。');
    S.status('delete','busy');
    try {
      const changed=S.tasks.filter(t=>t.sampleId===assetId||(t.resultIds||[]).includes(assetId)).map(t=>{
        const resultIds=(t.resultIds||[]).filter(id=>id!==assetId);
        const status=t.sampleId===assetId?'源样例已删除':['已保存候选','已评价'].includes(t.status)?(resultIds.length?resultStatus(resultIds):'已处理'):t.status;
        return {...t,resultIds,status,updatedAt:new Date().toISOString()};
      });
      const d=await db();
      await new Promise((resolve,reject)=>{
        const tx=d.transaction(['assets','tasks'],'readwrite');
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('删除事务取消'));
        try{tx.objectStore('assets').delete(assetId);changed.forEach(t=>tx.objectStore('tasks').put(t));}
        catch(e){tx.abort();reject(e);}
      });
      S.assets=S.assets.filter(a=>a.id!==assetId);
      S.tasks=S.tasks.map(t=>changed.find(next=>next.id===t.id)||t);
      S.lastImportIds=(S.lastImportIds||[]).filter(id=>id!==assetId);
      if(S.editingAssetId===assetId)S.editingAssetId=null;
      if(S.tasks.some(t=>t.id===S.activeTask&&t.sampleId===assetId))S.activeTask=null;
      S.status('delete','ready','样例已删除');
      global.dispatchEvent(new CustomEvent('dilong-asset-deleted',{detail:{asset}}));
    }catch(e){S.status('delete','error','删除失败：'+e.message);throw e;}
  });
  S.confirmDelete = async asset => {
    if(S.operations.delete?.state==='busy'||!S.assets.some(a=>a.id===asset.id))return;
    if(!global.confirm('确定删除“'+asset.name+'”（'+asset.id+'）？\n这会从当前浏览器的样例库移除该图片与分析数据，关联任务将更新。已导出的 ZIP 文件不受影响。'))return;
    try{await S.deleteAsset(asset.id);}catch(e){/* Visible operation status reports the failure. */}
  };
  S.startEdit = asset => {if(!S.assets.some(a=>a.id===asset.id))return;S.editingAssetId=asset.id;S.editSession=(S.editSession||0)+1;emit();};
  S.closeEdit = () => {if(S.operations.edit?.state==='busy')return;S.editingAssetId=null;S.status('edit','ready');};
  S.updateAsset = (assetId,patch) => withDataWrite(async()=>{
    await S.ready;
    const previous=S.assets.find(a=>a.id===assetId);
    if(!previous)throw Error('只能编辑自己导入或保存的样例。');
    S.status('edit','busy');
    try{
      const info=metadata.normalize({...previous,...patch});
      const now=new Date();
      const next={...previous,...info,updatedAt:now.toISOString(),history:[...info.history,{date:now.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),title:'样例信息更新',description:'用户补充或修改样例资料。',status:'已保存'}]};
      await write('assets',[next]);S.assets=S.assets.map(a=>a.id===assetId?next:a);S.status('edit','ready','样例信息已保存');
      global.dispatchEvent(new CustomEvent('dilong-asset-updated',{detail:{asset:next}}));return next;
    }catch(e){S.status('edit','error','保存失败：'+e.message);throw e;}
  });
  S.librarySamples = samples => {
    const mine=new Set(S.assets.map(a=>a.id));
    return [...samples].sort((a,b)=>Number(mine.has(b.id))-Number(mine.has(a.id)) ||
      (mine.has(a.id)&&mine.has(b.id)?String(b.importedAt||b.createdAt||b.date||'').localeCompare(String(a.importedAt||a.createdAt||a.date||'')):0));
  };
  S.showImported = ids => {
    S.packageOpen=false;emit();S.navigate('samples');
    requestAnimationFrame(()=>requestAnimationFrame(()=>global.dispatchEvent(new CustomEvent('dilong-library-imported',{detail:{ids}}))));
  };
  function image(url) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error('图片损坏或无法读取')); im.src = url; }); }
  async function dataURL(url) {
    const im = await image(url), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0); return c.toDataURL('image/png');
  }
  async function analyzedRecord(input, url) {
    const summary=await S.analyze(url), result=S.analyzeFull(await image(url));
    if(!result)throw Error('图片没有可分析的有效颜色');
    const {r,g,b}=summary.averageRgb;
    return {...input,...metadata.normalize(input),schemaVersion:1,imageUrl:url,thumbnailUrl:await global.DilongDesignImages.thumbnail(url),layers:result.layers.length,
      sourceUrl:'',license:'用户提供',date:new Date().toISOString().slice(0,10),
      analysis:{...summary,algorithmVersion:'dilong-color-v0.3',analysedAt:new Date().toISOString(),layerCount:result.layers.length,
        averageHex:'#'+[r,g,b].map(n=>n.toString(16).padStart(2,'0')).join(''),reconstructionDifference:result.difference,
        layers:result.layers.map((l,i)=>({order:i+1,name:l.name,hex:l.hex,rgb:l.rgb,coverage:l.share,recipe:l.recipe}))}};
  }
  const candidateSaves = new Map();
  const persistCandidate=(sample,taskId,isNew)=>withDataWrite(async()=>{
    const task=S.tasks.find(t=>t.id===taskId),resultIds=task?[...new Set([...(task.resultIds||[]),sample.id])]:[];
    const assets=isNew?[...S.assets,sample]:S.assets;
    const nextTask=task?{...task,resultIds,status:resultStatus(resultIds,assets),updatedAt:new Date().toISOString()}:null;
    await writeLinked({assets:isNew?[sample]:[],tasks:nextTask?[nextTask]:[]});
    if(isNew)S.assets.push(sample);if(nextTask)S.tasks=S.tasks.map(t=>t.id===taskId?nextTask:t);emit();return sample;
  });
  S.save = (src, name, source, parameters = {}, sourceKey, taskId=S.activeTask) => {
    if(sourceKey && candidateSaves.has(sourceKey)) return candidateSaves.get(sourceKey).then(async sample=>{
      if(!taskId||S.tasks.find(t=>t.id===taskId)?.resultIds?.includes(sample.id))return sample;
      S.status('save','busy');try{await persistCandidate(sample,taskId,false);S.status('save','ready');return sample;}catch(e){S.status('save','error','关联失败：'+e.message);throw e;}
    });
    const pending=(async()=>{
    S.savingCandidateKey=sourceKey;
    S.status('save', 'busy');
    try {
      await S.ready;
      const old = S.assets.find(a => sourceKey && a.sourceKey === sourceKey);
      if (old) { await persistCandidate(old,taskId,false);S.status('save', 'ready', '已保存到样例库'); return old; }
      const url = await dataURL(src);
      const sample = await analyzedRecord({ id: 'LOCAL-' + id(), schemaVersion: 1, name, source, sourceKey,
        wood: parameters.wood || '自建样例', style: parameters.style || '本地设计', tone: parameters.tone || '自定义',
        customer: '未填写', orderNo: '未填写', status: '本地保存',recordKind:'design-candidate',candidateReview:{status:'pending'},parameters, createdAt: new Date().toISOString(),
        },url);
      await persistCandidate(sample,taskId,true);
      S.status('save', 'ready', '已保存到样例库'); return sample;
    } catch (e) { S.status('save', 'error', '保存失败：' + e.message); throw e; }
    })();
    if(sourceKey)candidateSaves.set(sourceKey,pending);
    return pending.finally(()=>{if(sourceKey)candidateSaves.delete(sourceKey);});
  };
  S.updateTask = (taskId, patch) => withDataWrite(async()=>{
    const old = S.tasks.find(t => t.id === taskId); if (!old) return;
    const next = { ...old, ...patch, updatedAt: new Date().toISOString() }; await write('tasks', [next]); S.tasks = S.tasks.map(t => t.id === taskId ? next : t); emit();
  });
  S.reviewCandidate=(assetId,status)=>withDataWrite(async()=>{
    if(!['pending','accepted','adjust','rejected'].includes(status))throw Error('请选择有效的评价状态');
    const old=S.assets.find(a=>a.id===assetId);if(!old||!S.isCandidate(old))throw Error('只能评价自己保存的设计候选');
    S.status('review','busy');
    try{const now=new Date().toISOString(),next={...old,recordKind:'design-candidate',candidateReview:{status,updatedAt:now},updatedAt:now};
      const assets=S.assets.map(a=>a.id===assetId?next:a),tasks=S.tasks.filter(t=>(t.resultIds||[]).includes(assetId)).map(t=>({...t,status:t.status==='源样例已删除'?t.status:resultStatus(t.resultIds,assets),updatedAt:now}));
      await writeLinked({assets:[next],tasks});S.assets=assets;S.tasks=S.tasks.map(t=>tasks.find(a=>a.id===t.id)||t);S.status('review','ready');global.dispatchEvent(new CustomEvent('dilong-asset-updated',{detail:{asset:next}}));return next;
    }catch(e){S.status('review','error','评价保存失败：'+e.message);throw e;}
  });
  const unsavedInkRuns=new Map();
  const inkRecordStatus=(id,state,message='')=>{S.inkRecordStatus={id,state,message};S.status('ink-record',state,message);};
  async function persistInkRun(next){
    inkRecordStatus(next.id,'busy');
    try{await write('inkRuns',[next]);S.inkRuns=S.inkRuns.some(r=>r.id===next.id)?S.inkRuns.map(r=>r.id===next.id?next:r):[...S.inkRuns,next];unsavedInkRuns.delete(next.id);inkRecordStatus(next.id,'ready');}
    catch(e){unsavedInkRuns.set(next.id,next);inkRecordStatus(next.id,'error','配墨记录保存失败：'+e.message);throw e;}
  }
  S.captureInkImage=im=>{const canvas=document.createElement('canvas');canvas.width=im.naturalWidth;canvas.height=im.naturalHeight;const context=canvas.getContext('2d');if(!context)throw Error('无法保存图片');context.drawImage(im,0,0);return canvas.toDataURL('image/png');};
  S.canRestoreInkRun=run=>{const snap=run?.snapshot,model=snap?.renderModel;return snap?.version===1&&typeof snap.imageUrl==='string'&&snap.imageUrl.startsWith('data:image/')&&snap.layers?.length>0&&model?.width>0&&model?.height>0&&model.assignments?.length===model.width*model.height&&model.original?.length===model.width*model.height*4&&model.colours?.length===snap.layers.length;};
  S.recordInkRun=record=>withDataWrite(async()=>{
    await S.ready;if(S.inkRuns.some(r=>r.id===record.id))return;
    const next={...record,schemaVersion:record.snapshot?2:1,createdAt:record.createdAt||new Date().toISOString()};
    await persistInkRun(next);
  });
  S.updateInkRunSettings=(runId,settings)=>withDataWrite(async()=>{
    await S.ready;const old=unsavedInkRuns.get(runId)||S.inkRuns.find(r=>r.id===runId);if(!S.canRestoreInkRun(old))return;
    if(!unsavedInkRuns.has(runId)&&JSON.stringify(old.snapshot.settings)===JSON.stringify(settings))return;
    const next={...old,updatedAt:new Date().toISOString(),difference:S.layerDifference(old.snapshot.renderModel,settings.enabled),snapshot:{...old.snapshot,settings:structuredClone(settings)}};
    await persistInkRun(next);
  });
  S.openInkRun=async record=>{
    await dataWrites;const run=S.inkRuns.find(r=>r.id===record.id);
    if(!S.canRestoreInkRun(run)){S.status('ink-restore','error','此旧记录没有完整快照，无法恢复当次配墨；可选择来源样例重新分析。');return;}
    S.status('ink-restore','ready');S.navigate('color');
    requestAnimationFrame(()=>requestAnimationFrame(()=>global.dispatchEvent(new CustomEvent('dilong-ink-open',{detail:{run:structuredClone(run)}}))));
  };
  S.beginDesignTask=async request=>{
    await S.ready;
    const input=request.input.kind==='upload'?{kind:'upload',name:request.input.name,imageUrl:await dataURL(request.input.src),summary:request.input.summary}:{kind:'library',sampleId:request.input.sampleId,name:request.input.name};
    if(input.kind==='library'&&!S.all().some(a=>a.id===input.sampleId))throw Error('任务输入样例已不存在，请重新选择');
    return withDataWrite(async()=>{const previous=S.tasks.find(t=>t.id===request.taskId),reuse=previous&&['待处理','执行失败'].includes(previous.status),now=new Date().toISOString();
      const next={...(reuse?previous:{}),schemaVersion:2,id:reuse?previous.id:id(),source:reuse?previous.source:'设计智能体',sourceId:reuse?previous.sourceId:'design-'+request.runKey,sampleId:input.kind==='library'?input.sampleId:null,title:reuse?previous.title:input.name+' · '+S.designModeLabels[request.mode],mode:request.mode,input,parameters:request.parameters,conditions:describeConditions(request.mode,request.parameters),status:'处理中',resultIds:reuse?(previous.resultIds||[]):[],attempts:(reuse?previous.attempts||0:0)+1,createdAt:reuse?previous.createdAt:now,updatedAt:now,runKey:request.runKey,error:''};
      await write('tasks',[next]);S.tasks=S.tasks.some(t=>t.id===next.id)?S.tasks.map(t=>t.id===next.id?next:t):[...S.tasks,next];S.status('task','ready');return next;
    });
  };
  S.createTask = (record, sample) => withDataWrite(async()=>{
    await S.ready;
    let task = S.tasks.find(t => t.sourceId === record.id && t.sampleId === sample.id);
    if (!task) {
      task = { schemaVersion: 1, id: id(), source: '演示趋势资料', sourceId: record.id, sampleId: sample.id,
        title: record.title, conditions: record.keywords.join('，'), status: '待处理', resultIds: [], createdAt: new Date().toISOString() };
      await write('tasks', [task]); S.tasks.push(task); emit();
    }
    S.openTask(task); return task;
  });
  S.openTask = task => {
    const sample=task.input?.kind==='upload'?{...S.base[0],id:'UPLOAD-'+task.id,name:task.input.name,imageUrl:task.input.imageUrl,analysis:{...S.base[0]?.analysis,...task.input.summary}}:S.all().find(a=>a.id===task.sampleId);
    if(!sample){S.activeTask=null;S.status('task','error','任务源样例已删除，请在样例库重新选择。');S.navigate('samples');return;}
    S.status('task','ready');S.activeTask=task.id;
    if(task.status==='源样例已删除')S.updateTask(task.id,{status:'待处理'}).catch(e=>S.status('task','error',e.message));
    S.open('design',sample,task);
  };
  S.open = (page, sample, task) => { if(page==='design')S.activeTask=task?.id||null; S.navigate(page); requestAnimationFrame(()=>requestAnimationFrame(()=>global.dispatchEvent(new CustomEvent('dilong-open', { detail: { page, sample, task } })))); };
  S.recommend = (query, count, samples = S.all()) => {
    const groups = [['橡木','橡木'], ['胡桃','胡桃'], ['木纹','木'], ['石纹','石'], ['大理石','石'], ['织物','织物'], ['皮革','皮革'],
      ['浅色','浅'], ['浅灰','灰'], ['黑色','黑'], ['暖灰','灰'], ['灰色','灰'], ['自然','自然'], ['现代','现代'], ['深色','深'], ['米色','米'], ['红棕','棕']];
    const terms = [...new Set(groups.filter(([a]) => query.includes(a)).map(([,b]) => b))];
    if (!terms.length) return [];
    // Every recognized constraint must occur in the record; never fill with unrelated images.
    return samples.filter(a => terms.every(t => `${a.name} ${a.wood} ${a.style} ${a.tone}`.includes(t))).slice(0, count);
  };
  S.layerDifference = (model, enabled) => {
    if (!model?.original) return 0;
    let sum = 0, count = 0;
    for (let k = 0; k < model.assignments.length; k++) {
      if (model.original[k*4+3] <= 220) continue;
      count++;
      let j = model.assignments[k]; while (j >= 0 && !enabled[j]) j--;
      const rgb = j < 0 ? { r: 255, g: 255, b: 255 } : model.colours[j];
      sum += Math.hypot(model.original[k*4]-rgb.r, model.original[k*4+1]-rgb.g, model.original[k*4+2]-rgb.b) / Math.sqrt(3);
    }
    return count ? Math.round(sum / count * 100) / 100 : 0;
  };
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  function crc(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let k=0;k<8;k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
  function header(size, fields) { const b = new Uint8Array(size), v = new DataView(b.buffer); fields.forEach(([p,n,x]) => n === 2 ? v.setUint16(p,x,true) : v.setUint32(p,x,true)); return b; }
  S.zip = files => {
    const parts = [], central = []; let offset = 0, total = 0;
    for (const [name, bytes] of files) {
      const n = encoder.encode(name), check = crc(bytes);
      const h = header(30, [[0,4,0x04034b50],[4,2,20],[6,2,0x800],[14,4,check],[18,4,bytes.length],[22,4,bytes.length],[26,2,n.length]]);
      parts.push(h,n,bytes);
      const c = header(46, [[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x800],[16,4,check],[20,4,bytes.length],[24,4,bytes.length],[28,2,n.length],[42,4,offset]]);
      central.push(c,n); total += c.length+n.length; offset += h.length+n.length+bytes.length;
    }
    return new Blob([...parts,...central,header(22,[[0,4,0x06054b50],[8,2,files.length],[10,2,files.length],[12,4,total],[16,4,offset]])], {type:'application/zip'});
  };
  S.unzip = async buffer => {
    const b = new Uint8Array(buffer), v = new DataView(buffer), files = new Map(); let end = b.length-22;
    while (end >= Math.max(0,b.length-65557) && v.getUint32(end,true)!==0x06054b50) end--;
    if (end<0 || end<Math.max(0,b.length-65557)) throw Error('不是有效的 ZIP 文件');
    let p = v.getUint32(end+16,true), size = 0;
    const count = v.getUint16(end+10,true); if (count>501) throw Error('最多导入500条样例');
    for (let k=0;k<count;k++) {
      if (v.getUint32(p,true)!==0x02014b50) throw Error('ZIP 目录损坏');
      const method=v.getUint16(p+10,true), packed=v.getUint32(p+20,true), length=v.getUint32(p+24,true), nl=v.getUint16(p+28,true), el=v.getUint16(p+30,true), cl=v.getUint16(p+32,true), off=v.getUint32(p+42,true);
      size += length; if(size>150*1024*1024) throw Error('解压内容超过150MB');
      const name=decoder.decode(b.slice(p+46,p+46+nl)); if(files.has(name)) throw Error('ZIP 包含重复路径');
      if (v.getUint16(p+8,true)&1) throw Error('不支持加密 ZIP');
      if (v.getUint32(off,true)!==0x04034b50) throw Error('ZIP 图片条目损坏');
      const start=off+30+v.getUint16(off+26,true)+v.getUint16(off+28,true);
      let content=b.slice(start,start+packed);
      if(method===8) content=new Uint8Array(await new Response(new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else if(method!==0) throw Error('不支持该 ZIP 压缩方式');
      if(content.length!==length || crc(content)!==v.getUint32(p+16,true)) throw Error('文件校验失败：'+name);
      files.set(name,content); p+=46+nl+el+cl;
    }
    return files;
  };
  const download = (blob, name) => { const a=document.createElement('a'), url=URL.createObjectURL(blob); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
  S.exportPackage = async () => {
    S.status('package','busy');
    try {
      const samples=S.assets, files=[], records=[];
      if(!samples.length)throw Error('暂无本地样例，请先保存或导入样例。');
      for(const [i,s] of samples.entries()) {
        const path=`images/${i}.png`, url=await dataURL(s.imageUrl), bytes=new Uint8Array(await (await fetch(url)).arrayBuffer());
        files.push([path,bytes]); records.push({id:s.id,...metadata.normalize(s),image:path});
      }
      files.unshift(['manifest.json',encoder.encode(JSON.stringify({schemaVersion:1,samples:records},null,2))]);
      download(S.zip(files),'帝龙样例包.zip'); S.status('package','ready','已导出样例包');
    } catch(e){S.status('package','error',e.message);}
  };
  S.previewPackage = async file => {
    if(file.size>100*1024*1024) throw Error('ZIP 不能超过100MB');
    const files=await S.unzip(await file.arrayBuffer());
    const manifest=JSON.parse(decoder.decode(files.get('manifest.json')||[]));
    if(manifest.schemaVersion!==1 || !Array.isArray(manifest.samples)) throw Error('不支持的样例包版本或清单格式');
    if(manifest.samples.length>500)throw Error('最多导入500条样例');
    const seen=new Set(S.all().map(s=>s.id)), rows=[];
    for(const r of manifest.samples) {
      try {
        if(!r || typeof r.id!=='string' || !r.id.trim() || typeof r.name!=='string' || !r.name.trim()) throw Error('缺少有效编号或名称');
        if(['wood','style','tone','source'].some(k=>r[k]!==undefined&&typeof r[k]!=='string'))throw Error('材质、风格、色系和来源必须为文字');
        if(seen.has(r.id)){rows.push({record:r,state:'重复：跳过'});continue;}
        metadata.normalize(r);
        if(typeof r.image!=='string' || !files.has(r.image)) throw Error('图片文件不存在');
        const bytes=files.get(r.image); if(bytes.length>30*1024*1024) throw Error('图片超过30MB');
        const blob=new Blob([bytes]), url=URL.createObjectURL(blob); let encoded;
        try {const im=await image(url);if(im.naturalWidth*im.naturalHeight>40000000)throw Error('图片超过4000万像素'); encoded=await dataURL(url);}finally{URL.revokeObjectURL(url);}
        const record=await analyzedRecord({...r,status:'本地导入'},encoded);
        rows.push({record,state:'有效'});seen.add(r.id);
      }catch(e){rows.push({record:r||{},state:'错误：'+e.message});}
    }
    return rows;
  };
  S.commitPackage=async rows=>{const now=new Date().toISOString();const records=rows.filter(r=>r.state==='有效').map(r=>({...r.record,importedAt:now,createdAt:r.record.createdAt||now})).filter(r=>!S.all().some(a=>a.id===r.id));await write('assets',records);S.assets.push(...records);S.lastImportIds=records.map(r=>r.id);emit();return records.length;};
  S.filterOriginal=(platform,period,space)=>{
    const days={'近7天':7,'近30天':30,'近90天':90,'近半年':180}[period]||90;
    const ages=[[3,18,20],[20,65,70],[5,30,40],[85,90,120]], spaces=[['客厅','卧室','厨房与柜体'],['客厅','商业空间'],['卧室','厨房与柜体'],['商业空间']];
    return (S.originalTrends||[]).map((r,i)=>({...r,sources:r.sources.filter((v,j)=>(platform==='全平台'||v.platform===platform)&&ages[i][j]<=days)})).filter((r,i)=>r.sources.length&&(space==='全屋空间'||spaces[i].includes(space)));
  };
  S.emptyTrend=base=>({...base,id:'empty',name:'暂无匹配资料',stage:'无数据',heat:0,growth:0,confidence:0,saturation:0,signals:[],sources:[],matches:[],palette:[],material:'—',texture:'—',layers:'—',forecast:'请调整筛选条件'});
  S.matchOriginal=record=>{
    const all=S.all(), exact=(record.matches||[]).map(name=>all.find(a=>a.name===name)).filter(Boolean);
    if(exact.length)return exact;
    return all.filter(a=>record.material?.split(' / ').some(m=>a.wood.includes(m)||a.name.includes(m))).slice(0,3);
  };
  S.researchOriginal=(query,platforms,matchLibrary)=>{
    const synonyms=[['浅木纹','奶油原木'],['浅色','奶油原木'],['浅木','奶油原木'],['胡桃','烟熏橡木'],['门墙柜','暖灰中古'],['红棕','深红棕复古']];
    const list=(S.originalTrends||[]).filter(r=>r.sources.some(s=>platforms.includes(s.platform))&&([r.name,...r.tags,...r.material.split(' / ')].some(term=>query.includes(term))||synonyms.some(([key,target])=>query.includes(key)&&r.name===target)));
    const sources=list.flatMap(r=>r.sources.filter(s=>platforms.includes(s.platform)));
    return {summary:list.length?list.map(r=>r.name+'：'+r.desc).join('；'):'所选演示资料中没有相关内容，请调整研究主题或来源。',change:list.map(r=>r.name+' · '+r.stage).join('；')||'—',palette:list.flatMap(r=>r.palette).join('、')||'—',material:list.map(r=>r.material).join('；')||'—',risk:list.length?'以上为演示资料汇总，实际需求需人工核对。':'暂无依据，不能形成结论',evidence:'匹配演示方向 '+list.length+' 项，来源记录 '+sources.reduce((sum,r)=>sum+r.count,0)+' 条',growth:matchLibrary?'关联样例 '+new Set(list.flatMap(r=>S.matchOriginal(r).map(a=>a.id))).size+' 条':'样例库匹配已关闭',confidence:'已选择来源：'+(platforms.join('、')||'无')};
  };
  S.connect = (React, base, analyze, analyzeFull, ui) => {
    S.React=React; S.base=base; S.analyze=analyze; S.analyzeFull=analyzeFull;
    const h=React.createElement;
    S.useStore=()=>{const [,set]=React.useState(0);React.useEffect(()=>S.subscribe(()=>set(x=>x+1)),[]);};
    S.useSamples=()=>{S.useStore();return S.all();};
    S.Status=function(){S.useStore();const ops=Object.values(S.operations),bad=ops.find(o=>o.state==='error'),busy=ops.some(o=>o.state==='busy');return h('span',{role:'status',title:bad?.message},busy?'处理中':bad?'操作失败：'+bad.message:'就绪');};
    S.DashboardStat=function({kind,label,value,note}){
      return h('div',{className:'dashboard-stat-cell'},h('button',{type:'button',className:'dashboard-stat-button','aria-label':'查看'+label+'，'+value+'项',title:'点击查看'+label,onClick:event=>kind==='assets'?S.navigate('samples'):S.showStats(kind,event.currentTarget)},h('span',null,label),h('strong',null,value),h('small',null,note)));
    };
    const recordTime=value=>{const date=new Date(value);return value&&!Number.isNaN(date.valueOf())?date.toLocaleString('zh-CN',{hour12:false}):'未记录';};
    const newest=rows=>[...rows].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||String(a.id).localeCompare(String(b.id)));
    const detail=(label,value)=>h('div',{key:label},h('dt',null,label),h('dd',null,value??'未记录'));
    S.StatsDialog=function(){
      S.useStore();const kind=S.statsView,session=S.statsSession||0,trigger=S.statsTrigger,title={tasks:'设计任务',pending:'待评价方案',ink:'配墨操作记录'}[kind];
      const rows=kind==='tasks'?newest(S.tasks):kind==='pending'?newest(S.assets.filter(a=>S.isCandidate(a)&&candidateStatus(a)==='pending')):kind==='ink'?newest(S.inkRuns):[];
      const go=action=>{if(session!==S.statsSession)return;S.closeStats(session);action();};
      const action=(label,fn)=>h(ui.Button,{type:'button',variant:'outline',size:'sm',onClick:()=>go(fn)},label);
      const sourceName=task=>task.input?.name||S.all().find(a=>a.id===task.sampleId)?.name||task.sampleId||'未记录';
      const taskCard=task=>h('article',{key:task.id,className:'summary-record','data-record-id':task.id},
        h('div',{className:'summary-record-heading'},h('h3',null,task.title||'设计任务'),h('span',null,task.status||'未记录状态')),
        h('dl',null,detail('创建时间',recordTime(task.createdAt)),detail('处理方式',S.designModeLabels[task.mode]||task.mode||'趋势设计任务'),detail('输入样例',sourceName(task)),detail('任务来源',task.source),detail('设计条件',task.conditions||'未记录'),detail('结果',`${task.outputCount==null?'处理结果数量未记录':task.outputCount+' 个处理结果'}；已保存 ${(task.resultIds||[]).filter(id=>S.assets.some(a=>a.id===id)).length} 个候选`)),
        task.error&&h('p',{className:'summary-record-error'},'失败原因：'+task.error),
        h('div',{className:'summary-record-actions'},action('打开任务',()=>S.openTask(task))));
      const candidateCard=asset=>h('article',{key:asset.id,className:'summary-record summary-candidate','data-record-id':asset.id},
        h('img',{src:asset.thumbnailUrl||asset.imageUrl,alt:asset.name||asset.id,loading:'lazy'}),
        h('div',null,h('div',{className:'summary-record-heading'},h('h3',null,asset.name||asset.id),h('span',null,'待评价')),
          h('dl',null,detail('样例编号',asset.id),detail('保存时间',recordTime(asset.createdAt||asset.importedAt)),detail('来源',asset.source)),
          h(S.CandidateReview,{sample:asset}),h('div',{className:'summary-record-actions'},action('查看样例档案',()=>S.open('samples',asset)),action('用于配墨',()=>S.open('color',asset)))));
      const inkCard=run=>{const sample=S.all().find(a=>a.id===run.sampleId);return h('article',{key:run.id,className:'summary-record','data-record-id':run.id},
        h('div',{className:'summary-record-heading'},h('h3',null,run.inputName||'未记录图片名称'),h('span',null,'分析成功')),
        h('dl',null,detail('分析时间',recordTime(run.createdAt)),detail('图片来源',run.source),detail('识别色层',Number.isFinite(run.layerCount)?run.layerCount+' 层':'未记录'),detail('合成偏差（RGB）',Number.isFinite(run.difference)?run.difference.toFixed(2)+' / 255':'未记录'),detail('关联样例',sample?.name||(run.sampleId?'源样例已删除（'+run.sampleId+'）':'用户上传图片'))),
        !S.canRestoreInkRun(run)&&h('p',{className:'stage1-edit-note'},'此旧记录未保存原图或完整配方，无法恢复当次操作。'),
        h('div',{className:'summary-record-actions'},S.canRestoreInkRun(run)&&action('打开此次配墨',()=>S.openInkRun(run)),sample&&action('查看来源样例',()=>S.open('samples',sample)),sample&&action('重新配墨',()=>S.open('color',sample))));};
      return h(ui.Dialog,{key:session,open:!!title,onOpenChange:open=>{if(!open)S.closeStats(session);}},h(ui.Content,{className:'sample-detail-dialog summary-records-dialog',onCloseAutoFocus:event=>{event.preventDefault();if(!S.statsView&&trigger?.isConnected)trigger.focus();}},
        h(ui.Header,null,h(ui.Title,null,title||'统计明细'),h(ui.Description,null,kind==='ink'?'打开此次配墨可恢复当次图片、配方及最近保存的参数，不重复分析或计数。旧记录未保存原图或完整配方，保留原有信息。':kind==='pending'?'查看已保存且尚未评价的候选；完成评价后会从此列表移除。':'查看实际任务的输入、条件和结果，打开任务可继续处理或查看已保存候选。')),
        h('p',{className:'summary-record-count',role:'status'},'共 '+rows.length+' 条'+(rows.length?'，按时间从新到旧排列':'')),
        rows.length?h('div',{className:'summary-record-list'},rows.map(kind==='tasks'?taskCard:kind==='pending'?candidateCard:inkCard)):
          h('div',{className:'summary-empty'},h('p',null,kind==='tasks'?'还没有实际设计任务。执行一次设计后，任务会显示在这里。':kind==='pending'?'暂无待评价方案。保存设计候选后，可在这里查看和评价。':'还没有成功配墨记录。主动选择样例或上传图片并完成分析后，会显示在这里。'),action(kind==='ink'?'进入配墨':'进入设计',()=>S.navigate(kind==='ink'?'color':'design')))));
    };
    S.InkRunInfo=function({runId,onRetry}){S.useStore();if(!runId)return null;const run=S.inkRuns.find(r=>r.id===runId)||unsavedInkRuns.get(runId),status=S.inkRecordStatus?.id===runId?S.inkRecordStatus:null;return h('div',{className:'design-task-info ink-run-info',role:'status'},h('strong',null,'当前配墨记录：'+(run?.inputName||'正在保存图片')),
      h('span',null,status?.state==='error'?status.message:status?.state==='busy'?'正在保存…':(run?'分析时间：'+recordTime(run.createdAt)+'；':'')+'重量与色层设置自动保存到此记录'),status?.state==='error'&&h(ui.Button,{type:'button',variant:'outline',size:'sm',onClick:onRetry},'重试保存'));};
    S.CandidateSaveButton=function({src,name,source,parameters,sourceKey,taskId=S.activeTask}){
      S.useStore();const [error,setError]=React.useState('');
      const saved=S.assets.find(a=>a.sourceKey===sourceKey),linked=!!saved&&(!taskId||!!S.tasks.find(t=>t.id===taskId)?.resultIds?.includes(saved.id)),busy=S.operations.save?.state==='busy';
      return h(React.Fragment,null,h('button',{type:'button',className:linked?'saved':'',disabled:busy||(linked&&!error),onClick:async()=>{setError('');try{await S.save(src,name,source,parameters,sourceKey,taskId);}catch(e){setError('保存失败：'+e.message);}}},
        h('svg',{width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},h('path',{d:'M5 3h12l4 4v14H3V3h2m2 0v7h10V3M7 21v-7h10v7'})),
        busy&&S.savingCandidateKey===sourceKey?'正在保存…':linked&&!error?'已保存候选':saved?'关联到当前任务':'保存候选方案'),error&&h('p',{className:'candidate-save-error',role:'alert'},error),saved&&h(S.CandidateReview,{sample:saved}));
    };
    S.CandidateReview=function({sample}){
      S.useStore();const [error,setError]=React.useState('');const current=S.assets.find(a=>a.id===sample?.id);
      if(!current||!S.isCandidate(current))return null;
      return h('div',{className:'candidate-review-control'},h('label',null,'候选评价',h('select',{'aria-label':'候选评价',value:candidateStatus(current),disabled:S.operations.review?.state==='busy'||S.operations.save?.state==='busy',onChange:async e=>{setError('');try{await S.reviewCandidate(current.id,e.target.value);}catch(error){setError(error.message);}}},[['pending','待评价'],['accepted','已采用'],['adjust','需调整'],['rejected','未采用']].map(([value,label])=>h('option',{key:value,value},label)))),error&&h('p',{role:'alert'},error));
    };
    S.DesignTaskInfo=function({taskId}){S.useStore();const task=S.tasks.find(t=>t.id===taskId);return task?h('div',{className:'design-task-info',role:'status'},h('strong',null,'当前任务：'+task.title),h('span',null,task.status+' · '+(task.outputCount??0)+' 个处理结果 · 已保存 '+(task.resultIds||[]).length+' 个候选')):null;};
    S.TaskSavedResults=function({taskId}){
      S.useStore();const task=S.tasks.find(t=>t.id===taskId),assets=(task?.resultIds||[]).map(key=>S.assets.find(a=>a.id===key)).filter(Boolean);
      return assets.length?h('div',{className:'result-cards task-saved-results'},...assets.map(a=>h('article',{key:a.id},h('div',{className:'result-image'},h(S.CandidateImage,{src:a.imageUrl,previewSrc:a.thumbnailUrl,alt:a.name})),h('div',{className:'result-copy'},h('div',null,h('b',null,a.name)),h('p',null,'此任务已保存的候选'),a.parameters?.mode==='twin'&&h('p',{title:'原图与候选的全分辨率灰度SSIM；明暗变化也会影响；负值显示0%。'},global.DilongDesignImages.scoreLabel(a.parameters.structureSimilarity)),h(S.CandidateReview,{sample:a}))))):h('div',{className:'design-empty-results'},h('b',null,'本任务尚未保存候选'),h('span',null,task?.error||'输入与参数已恢复，可重新执行并保存需要的方案。'));
    };
    S.CandidateImage=function({src,previewSrc,alt}){
      const [open,setOpen]=React.useState(false),[thumbnail,setThumbnail]=React.useState(''),[zoom,setZoom]=React.useState(null),[size,setSize]=React.useState(null),[error,setError]=React.useState('');
      const trigger=React.useRef(null),viewport=React.useRef(null),drag=React.useRef(null);
      React.useEffect(()=>{let cancelled=false;setThumbnail('');if(!previewSrc&&src)global.DilongDesignImages.thumbnail(src).then(url=>{if(!cancelled)setThumbnail(url)}).catch(()=>{});return()=>{cancelled=true}},[src,previewSrc]);
      React.useEffect(()=>{setZoom(null);setSize(null);setError('')},[src,open]);
      const scale=zoom||(size&&viewport.current?Math.min(1,viewport.current.clientWidth/size.width,viewport.current.clientHeight/size.height):1);
      const changeZoom=multiplier=>setZoom(Math.max(.05,Math.min(4,scale*multiplier)));
      return h(React.Fragment,null,h('button',{ref:trigger,type:'button',className:'candidate-preview-trigger','aria-label':'放大查看'+alt,title:'点击查看完整分辨率',onClick:()=>setOpen(true)},h('img',{src:previewSrc||thumbnail||src,alt,loading:'lazy'}),h('span',{className:'candidate-preview-hint'},'放大查看')),
        h(ui.Dialog,{open,onOpenChange:setOpen},h(ui.Content,{className:'sample-detail-dialog candidate-preview-dialog',onCloseAutoFocus:e=>{e.preventDefault();trigger.current?.focus();}},h(ui.Header,null,h(ui.Title,null,alt),h(ui.Description,null,'完整分辨率查看；可缩放、拖动或滚动查看细节，按 Esc 关闭。')),
          h('div',{className:'candidate-view-tools'},h(ui.Button,{type:'button',variant:'outline',onClick:()=>setZoom(null)},'适应窗口'),h(ui.Button,{type:'button',variant:'outline',onClick:()=>setZoom(1)},'100%'),h(ui.Button,{type:'button',variant:'outline','aria-label':'缩小图片',onClick:()=>changeZoom(.8)},'−'),h(ui.Button,{type:'button',variant:'outline','aria-label':'放大图片',onClick:()=>changeZoom(1.25)},'+'),h('span',{'aria-live':'polite'},size?size.width+' × '+size.height+' · '+Math.round(scale*100)+'%':'正在加载完整图片'),h('a',{href:src,download:(alt||'设计结果')+'.png',onClick:async e=>{if(src.startsWith('data:image/png'))return;e.preventDefault();try{download(await(await fetch(await dataURL(src))).blob(),(alt||'设计结果')+'.png')}catch(error){setError('下载失败：'+error.message)}}},'下载完整图片')),
          error&&h('p',{role:'alert'},error),
          h('div',{ref:viewport,className:'candidate-image-viewport',tabIndex:0,'aria-label':'完整图片，可滚动查看',onPointerDown:e=>{if(e.button!==0)return;drag.current={x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop};e.currentTarget.setPointerCapture(e.pointerId)},onPointerMove:e=>{if(!drag.current)return;e.currentTarget.scrollLeft=drag.current.left+drag.current.x-e.clientX;e.currentTarget.scrollTop=drag.current.top+drag.current.y-e.clientY},onPointerUp:()=>{drag.current=null},onPointerCancel:()=>{drag.current=null}},h('img',{src,alt,draggable:false,onLoad:e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight}),onError:()=>setError('完整图片加载失败，请关闭后重试'),style:{width:size?size.width*scale:undefined,height:size?size.height*scale:undefined}})))));
    };
    S.DeleteButton=function({sample}){S.useStore();return S.assets.some(a=>a.id===sample.id)?h(ui.Button,{type:'button',variant:'outline',size:'sm',className:'stage1-delete-button',disabled:S.operations.delete?.state==='busy',onClick:()=>S.confirmDelete(sample)},'删除样例'):null;};
    S.EditButton=function({sample}){S.useStore();return S.assets.some(a=>a.id===sample.id)?h(ui.Button,{type:'button',variant:'outline',size:'sm',onClick:()=>S.startEdit(sample)},'编辑信息'):null;};
    S.SampleActions=function({sample}){return h('div',{className:'stage1-dialog-actions'},h(ui.Button,{variant:'outline',size:'sm',onClick:()=>S.open('design',sample)},'用于设计'),h(ui.Button,{variant:'outline',size:'sm',onClick:()=>S.open('color',sample)},'用于配墨'),h(S.EditButton,{sample}),h(S.DeleteButton,{sample}),h(S.CandidateReview,{sample}));};
    S.EditForm=function({asset}){
      const [draft,setDraft]=React.useState(()=>metadata.draft(asset)),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
      const update=(key,value)=>setDraft(d=>({...d,[key]:value}));
      const field=(key,label,value,onChange,options={})=>h('label',{key,className:'stage1-edit-field'},h('span',null,label),h('input',{'aria-label':label,value:value??'',onChange:e=>onChange(e.target.value),disabled:busy,type:options.type||'text',required:!!options.required,min:options.min,step:options.step,placeholder:options.placeholder}));
      return h('form',{className:'stage1-edit-form',onSubmit:async e=>{e.preventDefault();setError('');setBusy(true);try{await S.updateAsset(asset.id,draft);S.closeEdit();}catch(e){setError(e.message);}finally{setBusy(false);}}},
        h('p',{className:'stage1-edit-note'},'样例编号：'+asset.id+'（固定）。业务资料均可留空后再补充；样例名称必填。'),
        ...metadata.groups.map(group=>h('fieldset',{key:group.title},h('legend',null,group.title),h('div',{className:'stage1-edit-grid'},group.fields.map(([key,label])=>field(key,label,draft[key],v=>update(key,v),{required:key==='name'}))))) ,
        h('fieldset',null,h('legend',null,'责任人员'),h('div',{className:'stage1-edit-grid'},metadata.staffFields.map(([key,label])=>field(key,label,draft.staff[key],v=>setDraft(d=>({...d,staff:{...d.staff,[key]:v}})))))),
        h('fieldset',null,h('legend',null,'生产记录'),h('p',{className:'stage1-edit-note'},'仅填写实际记录；填写一条记录时，批次编号必填，日期和实测色差可留空。'),
          ...draft.productionRecords.map((row,index)=>h('div',{key:index,className:'stage1-production-edit'},h('div',{className:'stage1-edit-record-heading'},h('strong',null,'第 '+(index+1)+' 条生产记录'),h(ui.Button,{type:'button',variant:'outline',size:'sm',disabled:busy,onClick:()=>setDraft(d=>({...d,productionRecords:d.productionRecords.filter((_,i)=>i!==index)}))},'移除此条记录')),
            h('div',{className:'stage1-edit-grid'},metadata.productionFields.map(([key,label])=>field(key,'第'+(index+1)+'条：'+label,row[key],v=>setDraft(d=>({...d,productionRecords:d.productionRecords.map((r,i)=>i===index?{...r,[key]:v}:r)})),{type:key==='date'?'date':key==='deltaE'?'number':'text',min:key==='deltaE'?0:undefined,step:key==='deltaE'?'any':undefined,placeholder:key==='batchNo'?'例如 BATCH-001':undefined}))))),
          h(ui.Button,{type:'button',variant:'outline',disabled:busy,onClick:()=>setDraft(d=>({...d,productionRecords:[...d.productionRecords,Object.fromEntries(metadata.productionFields.map(([key])=>[key,'']))]}))},'添加生产记录')),
        h('label',{className:'stage1-edit-field'},h('span',null,'生产 / 客户反馈'),h('textarea',{'aria-label':'生产 / 客户反馈',rows:3,value:draft.feedback,disabled:busy,onChange:e=>update('feedback',e.target.value)})),
        h('p',{className:'stage1-edit-note'},'图像分析只读：'+asset.analysis.layerCount+' 个色层，平均色 '+asset.analysis.averageHex+'。编辑资料不会修改原图、分色或算法参考配方。'),
        error&&h('p',{role:'alert'},error),h('div',{className:'stage1-edit-actions'},h(ui.Button,{type:'button',variant:'outline',disabled:busy,onClick:()=>S.closeEdit()},'取消'),h(ui.Button,{type:'submit',disabled:busy},busy?'正在保存…':'保存样例信息')));
    };
    S.EditDialog=function(){S.useStore();const asset=S.assets.find(a=>a.id===S.editingAssetId);return h(ui.Dialog,{open:!!asset,onOpenChange:open=>{if(!open)S.closeEdit()}},h(ui.Content,{className:'sample-detail-dialog stage1-edit-dialog'},h(ui.Header,null,h(ui.Title,null,'编辑样例信息'),h(ui.Description,null,'补充自己的样例资料，保存后会更新档案，并随样例包导出。')),asset&&h(S.EditForm,{key:asset.id+':'+S.editSession,asset})));};
    S.showPackage=()=>{S.packageOpen=true;emit()};
    S.LibraryActions=function({importIcon}){S.useStore();return h('div',{className:'stage1-library-actions'},
      h(ui.Button,{type:'button',variant:'outline',disabled:!S.assets.length||S.operations.package?.state==='busy',onClick:()=>S.exportPackage()},'导出本地样例包'),
      h(ui.Button,{type:'button',onClick:()=>S.showPackage()},importIcon&&h(importIcon),'导入样例文件包'));};
    S.PackageDialog=function(){S.useStore();return h(ui.Dialog,{open:!!S.packageOpen,onOpenChange:open=>{S.packageOpen=open;emit()}},h(ui.Content,{className:'sample-detail-dialog stage1-package-dialog'},h(ui.Header,null,h(ui.Title,null,'导入样例文件包'),h(ui.Description,null,'选择ZIP包后检查有效、重复和错误记录，再确认导入。')),h(S.PackagePanel)));};
    S.PackageFormat=function(){
      const example={schemaVersion:1,samples:[{id:'MY-001',name:'我的橡木样例',image:'images/oak.jpg',wood:'橡木',style:'自然',tone:'浅米',customer:'示例客户（请替换）',orderNo:'ORDER-001',substrate:'70g原纸',machine:'设备名称',staff:{colorist:'调墨人员姓名'},feedback:'填写实际反馈',productionRecords:[{batchNo:'BATCH-001',stage:'试印',date:'2026-10-31',quantity:'100 m',deltaE:'1.2',result:'填写实际结果'}]}]};
      return h('details',{className:'stage1-package-format'},h('summary',null,'参考格式查看'),
        h('div',{className:'stage1-package-format-body'},
          h('p',null,'样例包由一份图片清单和图片文件组成。ZIP 打开后，根目录应直接包含 manifest.json 和 images 文件夹。'),
          h('h3',null,'1. ZIP 目录结构'),
          h('pre',null,'我的样例包.zip\n├─ manifest.json\n└─ images/\n   └─ oak.jpg'),
          h('h3',null,'2. manifest.json 清单示例'),
          h('pre',{'aria-label':'样例清单参考格式'},h('code',null,JSON.stringify(example,null,2))),
          h('p',null,'schemaVersion 固定为 1，samples 是样例列表。每条记录必填 id（唯一编号）、name（样例名称）、image（图片相对路径）；wood、style、tone 分别是可选的材质、风格和色系。'),
          h('p',null,'客户 customer、客户编号 customerCode、订单 orderNo、原纸 substrate、油墨系列 inkSeries、设备 machine、人员 staff、反馈 feedback 和生产记录 productionRecords 均可选填。示例值仅说明格式，请替换成自己的真实资料；也可导入后点击“编辑信息”补充。'),
          h('p',null,'image 必须对应包里的真实文件，例如 images/oak.jpg。多张图片就在 samples 中添加多条记录，用英文逗号分隔，编号不要重复。'),
          h('h3',null,'3. 制作并导入'),
          h('ol',null,h('li',null,'把自己的图片放入 images 文件夹，按示例编辑 manifest.json，并保存为 UTF-8 编码。'),h('li',null,'选中 manifest.json 和 images 文件夹一起压缩为 ZIP，避免在外面再套一层文件夹。'),h('li',null,'点击“选择 ZIP 样例包”，查看有效、重复及错误记录，最后确认导入。重复编号默认跳过。')),
          h('p',null,'限制：ZIP 不超过 100 MB；解压内容不超过 150 MB；最多 500 条样例；单张图片不超过 30 MB、4000 万像素。'),
          h('p',null,'人员字段：designer（设计）、colorist（调墨）、operator（操作）、reviewer（审核）。生产记录字段：batchNo（批次，填写记录时必填）、stage、date（YYYY-MM-DD）、equipment、quantity（含单位的文字）、substrate、deltaE（非负实测值）、result、operator。'),
          h('p',null,'缺失的业务资料显示“未填写”，不由大模型补造。分色与算法参考配方始终根据图片计算；生产记录中的实测色差是用户提供值，与算法指标分开保存。编号重复仍默认跳过，修改现有样例请使用“编辑信息”。')));
    };
    S.PackagePanel=function(){S.useStore();const [rows,setRows]=React.useState(null),[busy,setBusy]=React.useState(false),[message,setMessage]=React.useState(''),[fileName,setFileName]=React.useState(''),[importedIds,setImportedIds]=React.useState([]),fileInput=React.useRef(null);
      return h('section',{className:'archive-section'},
        h('div',{className:'stage1-package-controls'},
          h('input',{ref:fileInput,hidden:true,tabIndex:-1,'aria-label':'导入样例文件包',type:'file',accept:'.zip',disabled:busy,onChange:async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;setFileName(f.name);setBusy(true);setRows(null);setMessage('');setImportedIds([]);try{setRows(await S.previewPackage(f));}catch(e){setMessage(e.message);}finally{setBusy(false);}}}),
          h('div',{className:'stage1-file-picker'},h(ui.Button,{type:'button',variant:'outline',disabled:busy,onClick:()=>fileInput.current?.click()},'选择 ZIP 样例包'),h('span',{className:'stage1-file-name','aria-live':'polite',title:fileName||undefined},fileName||'未选择任何文件'))),
        h(S.PackageFormat),
        busy&&h('p',null,'正在校验图片…'),message&&h('p',{role:'alert'},message),importedIds.length>0&&h(ui.Button,{type:'button',variant:'outline',onClick:()=>S.showImported(importedIds)},'查看导入样例'),rows&&h('div',null,h('p',null,`有效 ${rows.filter(r=>r.state==='有效').length} · 重复 ${rows.filter(r=>r.state.startsWith('重复')).length} · 错误 ${rows.filter(r=>r.state.startsWith('错误')).length}`),...rows.map((r,i)=>h('p',{key:i},`${r.record.id||'无编号'} ${r.record.name||''}：${r.state}`)),h(ui.Button,{disabled:busy||!rows.some(r=>r.state==='有效'),onClick:async()=>{setBusy(true);try{const n=await S.commitPackage(rows);setMessage(`已导入 ${n} 条样例`);setImportedIds([...S.lastImportIds]);setRows(null);}catch(e){setMessage('保存失败：'+e.message);}finally{setBusy(false);}}},'确认导入有效记录')));
    };
  };
})(window);
