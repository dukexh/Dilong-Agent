const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const library=require('../../src/core/sample-library.ts'),metadata=require('../../src/core/sample-metadata.ts');
const root=path.resolve(__dirname,'../..');
const rows=JSON.parse(fs.readFileSync(path.join(root,'src/data/public-catalog.json'),'utf8'));
test('public catalog has 2890 unique new sources, valid local derivatives and actual image features',()=>{
 assert.equal(rows.length,2890);assert.equal(new Set(rows.map(r=>r.id)).size,2890);assert.equal(new Set(rows.map(r=>r.source+':'+r.sourceId)).size,2890);
 for(const r of rows){for(const key of ['imageUrl','thumbnailUrl'])assert(fs.existsSync(path.join(root,'public',r[key])),r[key]);assert(r.width<=720&&r.height<=540);assert(Number.isFinite(r.features.brightness));assert(Number.isFinite(r.features.textureDensity));assert(Object.values(r.features.averageRgb).every(v=>Number.isFinite(v)&&v>=0&&v<=255));}
});
test('merging preserves existing demo IDs and order, skips repeated sources/IDs, leaves business facts unfilled',()=>{
 const record=rows[0],base=[{id:'existing',assetId:record.sourceId}];
 const repeated={...record,id:'other-id',source:'polyhaven'};
 const result=library.merge(base,[record,record,repeated],metadata);
 assert.strictEqual(result[0],base[0]);assert.equal(result.length,2);assert.equal(result[1].customer,'未填写');assert.equal(result[1].productionRecords.length,0);assert.equal(result[1].analysis.layerCount,null);assert.equal(result[1].analysis.layers.length,0);
});
test('category and search filters compose, personal samples stay separate, pagination clamps and covers every result once',()=>{
 const all=library.merge([],rows,metadata),own={...all[0],id:'mine'};
 for(const [label,category] of [['木纹','wood'],['石纹','stone'],['织物 / 皮革','fabric'],['涂层 / 混凝土','coating']]){const filtered=library.filter(all,'',label);assert(filtered.length);assert(filtered.every(r=>r.category===category));}
 assert.equal(library.filter([...all,own],'','我的样例',[own]).length,1);
 assert.equal(library.filter(all,all[0].id.toUpperCase(),'全部')[0].id,all[0].id);
 assert.equal(library.filter(all,'not-present-123','全部').length,0);
 let ids=[];for(let p=1;p<=Math.ceil(all.length/24);p++)ids.push(...library.page(all,p).rows.map(r=>r.id));assert.equal(ids.length,all.length);assert.equal(new Set(ids).size,all.length);assert.equal(library.page([],99).current,1);assert.equal(library.page(all,999).current,Math.ceil(all.length/24));
});
