'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const meta=require('../sample-metadata.js');
test('candidate review survives metadata normalization and rejects invalid states',()=>{
 const r=meta.normalize({name:'已保存候选',recordKind:'design-candidate',candidateReview:{status:'accepted',updatedAt:'2026-10-31T12:00:00Z'}});assert.equal(r.recordKind,'design-candidate');assert.equal(r.candidateReview.status,'accepted');assert.equal(meta.draft(r).candidateReview.status,'accepted');for(const patch of [{recordKind:'unknown'},{candidateReview:{status:'unknown'}},{candidateReview:[]}])assert.throws(()=>meta.normalize({name:'测试',...patch}));
});
test('old minimal records remain valid and missing business fields stay unfilled',()=>{
 const r=meta.normalize({name:'橡木'});assert.equal(r.customer,'未填写');assert.equal(r.orderNo,'未填写');assert.deepEqual(r.productionRecords,[]);assert.deepEqual(r.history,[]);assert.equal(r.staff.colorist,'未填写');
});
test('business metadata, staff, production and history survive normalization',()=>{
 const input={name:'客户橡木',wood:'橡木',customer:'真实客户',orderNo:'ORDER-1',machine:'设备A',staff:{colorist:'张师傅'},feedback:'实测反馈',productionRecords:[{batchNo:'B-1',date:'2026-10-31',quantity:'100 m',deltaE:1.25}],history:[{date:'2026-10-30',title:'客户确认',description:'由用户提供',status:'已确认'}],parameters:{setting:'保留'}};
 const r=meta.normalize(input);assert.equal(r.customer,input.customer);assert.equal(r.staff.colorist,'张师傅');assert.equal(r.productionRecords[0].deltaE,'1.25');assert.equal(r.productionRecords[0].quantity,'100 m');assert.deepEqual(r.history,input.history);assert.deepEqual(r.parameters,input.parameters);
});
test('invalid field types are rejected rather than silently discarded',()=>{
 for(const patch of [{name:''},{customer:[]},{staff:'张师傅'},{productionRecords:{}},{history:{}},{parameters:[]}])assert.throws(()=>meta.normalize({name:'测试',...patch}));
});
test('production records require an identifier and valid optional date and color difference',()=>{
 for(const row of [{stage:'试印'},{batchNo:'B',date:'2026-02-30'},{batchNo:'B',deltaE:-1},{batchNo:'B',deltaE:'不是数值'}])assert.throws(()=>meta.normalize({name:'测试',productionRecords:[row]}));
 assert.equal(meta.normalize({name:'测试',productionRecords:[{}]}).productionRecords.length,0);
 assert.equal(meta.normalize({name:'测试',productionRecords:[{batchNo:'B',date:'2024-02-29'}]}).productionRecords[0].date,'2024-02-29');
});
test('editing draft does not mutate existing staff or production records',()=>{
 const asset=meta.normalize({name:'测试',staff:{colorist:'张'},productionRecords:[{batchNo:'B'}]});const draft=meta.draft(asset);draft.staff.colorist='李';draft.productionRecords[0].batchNo='新批次';assert.equal(asset.staff.colorist,'张');assert.equal(asset.productionRecords[0].batchNo,'B');assert.equal(draft.orderNo,'');
});
test('readonly image and algorithm properties are not accepted as metadata',()=>{
 const r=meta.normalize({name:'测试',id:'fake',analysis:{layerCount:99},layers:99,imageUrl:'fake'});for(const key of ['id','analysis','layers','imageUrl'])assert(!(key in r));
});
