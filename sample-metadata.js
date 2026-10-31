/* Shared metadata contract for ZIP import, editing and export. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.DilongSampleMetadata=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const groups=[
    {title:'基本信息',fields:[['name','样例名称'],['wood','木种 / 材质'],['style','风格'],['tone','色系'],['source','来源']]},
    {title:'客户与工艺信息',fields:[['customer','客户 / 项目'],['customerCode','客户编号'],['orderNo','订单编号'],['substrate','承印原纸'],['inkSeries','油墨型号 / 系列'],['machine','生产设备']]}
  ];
  const staffFields=[['designer','设计人员'],['colorist','调墨师傅'],['operator','生产操作人员'],['reviewer','审核人员']];
  const productionFields=[['batchNo','批次编号'],['stage','阶段'],['date','生产日期'],['equipment','设备'],['quantity','生产数量'],['substrate','原纸'],['deltaE','实测色差'],['result','生产结果'],['operator','操作人员']];
  const text=(v,label)=>{if(v===undefined||v===null)return '';if(typeof v!=='string')throw Error(label+'必须是文字');return v.trim();};
  const inputValue=v=>v==null||v==='未填写'||v==='待人工评价'?'':String(v);
  function validDate(v,label){if(v&&!/^\d{4}-\d{2}-\d{2}$/.test(v))throw Error(label+'应为YYYY-MM-DD');if(v){const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)throw Error(label+'不是有效日期');}return v;}
  function normalize(input){
    const out={};
    for(const group of groups)for(const [key,label] of group.fields)out[key]=text(input[key],label)||'未填写';
    if(out.name==='未填写')throw Error('请填写样例名称');
    out.feedback=text(input.feedback,'反馈')||'待人工评价';
    if(input.staff!=null&&(typeof input.staff!=='object'||Array.isArray(input.staff)))throw Error('人员信息staff应为对象');
    out.staff=Object.fromEntries(staffFields.map(([key,label])=>[key,text(input.staff?.[key],label)||'未填写']));
    if(input.productionRecords!=null&&!Array.isArray(input.productionRecords))throw Error('productionRecords应为生产记录数组');
    out.productionRecords=(input.productionRecords||[]).map((row,index)=>{
      if(!row||typeof row!=='object'||Array.isArray(row))throw Error('第'+(index+1)+'条生产记录格式错误');
      const values=Object.fromEntries(productionFields.map(([key,label])=>[key,inputValue(row[key])]));
      for(const [key,label] of productionFields){if(key==='deltaE'&&typeof row[key]==='number')values[key]=String(row[key]);else values[key]=text(row[key],label);if(values[key]==='未填写')values[key]='';}
      if(!Object.values(values).some(Boolean))return null;
      if(!values.batchNo)throw Error('第'+(index+1)+'条生产记录请填写批次编号');
      validDate(values.date,'第'+(index+1)+'条生产日期');
      if(values.deltaE&&(!Number.isFinite(Number(values.deltaE))||Number(values.deltaE)<0))throw Error('实测色差必须为大于或等于0的数值');
      return Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v||'未填写']));
    }).filter(Boolean);
    if(input.history!=null&&!Array.isArray(input.history))throw Error('history应为历史记录数组');
    out.history=(input.history||[]).map((row,i)=>{
      if(!row||typeof row!=='object'||Array.isArray(row))throw Error('第'+(i+1)+'条历史记录格式错误');
      const date=text(row.date,'历史日期');validDate(date==='未填写'?'':date,'历史日期');
      return {date:date||'未填写',title:text(row.title,'历史标题')||'未填写',description:text(row.description,'历史说明')||'未填写',status:text(row.status,'历史状态')||'未填写'};
    });
    if(input.parameters!=null&&(typeof input.parameters!=='object'||Array.isArray(input.parameters)))throw Error('parameters应为对象');
    out.parameters=input.parameters||{};
    if(input.recordKind!=null){if(!['sample','design-candidate'].includes(input.recordKind))throw Error('recordKind应为sample或design-candidate');out.recordKind=input.recordKind;}
    if(input.candidateReview!=null){const review=input.candidateReview;if(typeof review!=='object'||Array.isArray(review)||!['pending','accepted','adjust','rejected'].includes(review.status))throw Error('候选评价状态无效');out.candidateReview={status:review.status};if(review.updatedAt)out.candidateReview.updatedAt=text(review.updatedAt,'评价时间');}
    return out;
  }
  function draft(asset){const data=normalize(asset);for(const group of groups)for(const [key] of group.fields)data[key]=inputValue(data[key]);if(['导入样例','本地用户'].includes(data.customer))data.customer='';data.feedback=inputValue(data.feedback);data.staff=Object.fromEntries(staffFields.map(([key])=>[key,inputValue(data.staff[key])]));data.productionRecords=data.productionRecords.map(row=>Object.fromEntries(productionFields.map(([key])=>[key,inputValue(row[key])])));return data;}
  return Object.freeze({groups,staffFields,productionFields,normalize,draft,inputValue});
});
