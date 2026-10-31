'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../production-compare-core.js');
const full=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
const options={blockRows:7,yieldTask:async()=>{}};
function image(width,height,rgb){const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++)data.set([...rgb,255],i*4);return{width,height,data};}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('RGB difference is zero for identical images and 255 for black versus white',async()=>{
 const black=image(32,24,[0,0,0]),white=image(32,24,[255,255,255]);
 close(core.analyze(black,black).meanRgbDifference,0);close(core.analyze(black,white).meanRgbDifference,255);
 close((await core.compareRegions(black,white,full,options)).meanRgbDifference,255);
});
test('RGB difference averages per-pixel distances, not the distance between average colors',async()=>{
 const reference=image(32,24,[100,100,100]),actual=image(32,24,[130,100,100]);
 for(let i=1;i<32*24;i+=2)actual.data[i*4]=70;
 const expected=30/Math.sqrt(3);
 close(core.analyze(reference,actual).meanRgbDifference,expected);
 for(const blockRows of [7,9,100])close((await core.compareRegions(reference,actual,full,{...options,blockRows})).meanRgbDifference,expected);
});
test('RGB metric excludes transparent positions and respects full-resolution crops',async()=>{
 const reference=image(80,64,[100,100,100]),actual=image(80,64,[100,100,100]);
 actual.data.set([255,0,0,0],0);actual.data.set([130,140,100,255],(30*80+40)*4);
 close(core.analyze(reference,actual).meanRgbDifference,50/Math.sqrt(3)/(80*64-1));
 const quad=[{x:.25,y:.25},{x:.75,y:.25},{x:.75,y:.75},{x:.25,y:.75}];
 const result=await core.compareRegions(reference,actual,quad,options);
 assert.equal(result.validCount,40*32);close(result.meanRgbDifference,50/Math.sqrt(3)/(40*32));
 const outside=[{x:0,y:0},{x:.25,y:0},{x:.25,y:.25},{x:0,y:.25}];
 close((await core.compareRegions(reference,actual,outside,options)).meanRgbDifference,0);
});
test('RGB metric uses all original pixels despite a smaller preview and ignores heat threshold',async()=>{
 const reference=image(2560,24,[0,0,0]),actual=image(2560,24,[0,0,0]);actual.data.set([255,255,255,255],(11*2560+2301)*4);
 for(const threshold of [1,20]){const r=await core.compareRegions(reference,actual,full,{...options,threshold});assert.equal(r.reference.width,1024);close(r.meanRgbDifference,255/(2560*24));}
});
test('opaque comparison matches the existing ink reconstruction deviation formula',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const sandbox={window:{},TextEncoder,TextDecoder,Blob,indexedDB:{open(){throw Error('No storage required for formula test');}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../stage1.js'),'utf8'),sandbox);
 const reference=image(16,16,[130,120,100]),actual=image(16,16,[120,115,90]);
 const model={original:reference.data,assignments:new Uint8Array(256),colours:[{r:120,g:115,b:90}]};
 assert.equal(Number(core.analyze(reference,actual).meanRgbDifference.toFixed(2)),sandbox.window.DilongStage1.layerDifference(model,[true]));
});
