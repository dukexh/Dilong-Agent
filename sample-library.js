/* Public texture metadata and bounded library pagination. No browser storage writes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.DilongSampleLibrary=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const categories=['全部','我的样例','木纹','橡木','胡桃木','其他木纹','石纹','织物 / 皮革','涂层 / 混凝土'];
  const group=a=>a.category||(['石纹'].includes(a.wood)?'stone':['织物纹','皮革纹'].includes(a.wood)?'fabric':a.wood==='艺术涂层'?'coating':/木|wood/i.test(a.wood||'')?'wood':'other');
  const material=r=>r.category==='wood'?(/walnut/i.test(r.assetId)?'胡桃木':/oak/i.test(r.assetId)?'橡木':'木纹'):r.category==='stone'?'石纹':r.category==='fabric'?(/leather/i.test(r.assetId)?'皮革纹':'织物纹'):'艺术涂层';
  function merge(base,records,metadata){
    const ids=new Set(base.map(a=>a.id)),assets=new Set(base.map(a=>a.assetId)),sources=new Set();
    const added=[];
    for(const r of records){
      const key=r.source+':'+r.sourceId;
      if(ids.has(r.id)||sources.has(key)||(r.source==='polyhaven'&&assets.has(r.sourceId)))continue;
      ids.add(r.id);sources.add(key);
      const wood=material(r),label={wood:'木纹',stone:'石纹',fabric:'织物 / 皮革',coating:'涂层 / 混凝土'}[r.category];
      const defaults=metadata.normalize({name:label+' · '+r.name,wood,style:'未标注',tone:'未标注',source:'公共纹理 · '+r.source});
      const rgb=r.features.averageRgb;
      added.push({...defaults,...r,name:defaults.name,wood,source:defaults.source,sourceName:r.source,
        schemaVersion:1,recordKind:'sample',isPublicTexture:true,status:'公共纹理',date:'',layers:null,
        analysis:{...r.features,layerCount:null,averageHex:'#'+[rgb.r,rgb.g,rgb.b].map(v=>v.toString(16).padStart(2,'0')).join(''),layers:[],algorithmVersion:'图像特征摘要',reconstructionDifference:null}});
    }
    return [...base,...added];
  }
  function filter(samples,query,category,mine=[]){
    const owned=new Set(mine.map(a=>a.id)),q=query.trim().toLocaleLowerCase();
    return samples.filter(a=>{
      const g=group(a),match=category==='全部'||category==='我的样例'&&owned.has(a.id)||category==='木纹'&&g==='wood'||category==='其他木纹'&&g==='wood'&&!['橡木','胡桃木'].includes(a.wood)||category==='石纹'&&g==='stone'||category==='织物 / 皮革'&&g==='fabric'||category==='涂层 / 混凝土'&&g==='coating'||['橡木','胡桃木'].includes(category)&&a.wood===category;
      return match&&(!q||[a.id,a.name,a.assetId,a.wood,a.style,a.tone,a.source,...(a.tags||[])].join(' ').toLocaleLowerCase().includes(q));
    });
  }
  function page(rows,value,size=24){const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.max(1,Math.min(value,pages));return {current,pages,rows:rows.slice((current-1)*size,current*size)};}
  function install(S,React,ui){
    const h=React.createElement;
    S.libraryCategories=categories;S.filterLibrary=(rows,q,c)=>filter(rows,q,c,S.assets);
    S.LibraryPagination=function({page:current,pageCount,total,onChange}){
      const navigate=value=>{onChange(value);document.querySelector('.library-toolbar')?.scrollIntoView({block:'start'})};
      return h('nav',{className:'library-pagination','aria-label':'样例分页'},
        h(ui.Button,{variant:'outline',disabled:current<=1,onClick:()=>navigate(current-1)},'上一页'),
        h('span',{'aria-live':'polite'},'第 '+current+' / '+pageCount+' 页 · 共 '+total+' 条 · 每页24条'),
        h(ui.Button,{variant:'outline',disabled:current>=pageCount,onClick:()=>navigate(current+1)},'下一页'),
        h('label',null,'跳至',h('select',{'aria-label':'跳转到页',value:current,onChange:e=>navigate(Number(e.target.value))},...Array.from({length:pageCount},(_,i)=>h('option',{key:i+1,value:i+1},'第 '+(i+1)+' 页')))));
    };
    const facts=sample=>h('dl',null,...[
      ['木种 / 材质',sample.wood],['展示尺寸',sample.width+' × '+sample.height],['平均色',sample.analysis.averageHex],
      ['图片来源',sample.sourceName],['授权',sample.license],['配墨分析','用于配墨时计算'],['生产记录','暂无生产记录']
    ].map(([label,value])=>h('div',{key:label},h('dt',null,label),h('dd',null,value))));
    const provenance=sample=>h('p',{className:'public-texture-provenance'},h('a',{href:sample.sourceUrl,target:'_blank',rel:'noopener noreferrer'},'查看素材来源'),' · ',h('a',{href:sample.licenseUrl,target:'_blank',rel:'noopener noreferrer'},'查看授权'));
    S.PublicInspector=function({sample,onClose,onOpen}){return h(React.Fragment,null,
      h('div',{className:'inspector-head'},h('div',null,h('span',null,'公共纹理素材'),h('b',null,sample.id)),h('button',{type:'button',className:'stage1-inspector-close','aria-label':'关闭样例档案',onClick:onClose},'×')),
      h('div',{className:'public-texture-image'},h(S.CandidateImage,{src:sample.imageUrl,previewSrc:sample.thumbnailUrl,alt:sample.name})),
      h('h2',null,sample.name),facts(sample),provenance(sample),
      h('div',{className:'public-texture-actions'},h(ui.Button,{onClick:()=>S.open('design',sample)},'用于设计'),h(ui.Button,{variant:'outline',onClick:()=>S.open('color',sample)},'用于配墨')),
      h(ui.Button,{className:'inspector-action',onClick:onOpen},'查看完整样例档案'))};
    S.PublicArchive=function({sample,open,onOpenChange}){return h(ui.Dialog,{open,onOpenChange},h(ui.Content,{className:'sample-detail-dialog public-texture-dialog'},
      h(ui.Header,null,h(ui.Title,null,sample.name),h(ui.Description,null,'公共纹理参考；图像特征来自当前展示图的算法计算，客户、订单和生产资料尚未提供。')),
      h(S.SampleActions,{sample}),h('div',{className:'public-texture-image'},h(S.CandidateImage,{src:sample.imageUrl,previewSrc:sample.thumbnailUrl,alt:sample.name})),facts(sample),provenance(sample),
      h('p',null,'网页展示图按比例缩放，点击可放大查看完整画面。来源原文件未随网站上传。')))};
  }
  return {categories,group,merge,filter,page,install};
});
