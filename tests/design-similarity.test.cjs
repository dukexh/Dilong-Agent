const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../production-compare-core.js');
function make(width, height, altered=false) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,v=(x*13+y*7)%210;
    data.set([v,Math.min(255,v+(altered?32:0)),v,y<12?0:255],i);
  }
  return {width,height,data};
}
test('full-resolution candidate SSIM matches existing reference formula across stripes and ignores transparency',async()=>{
  const a=make(257,153),b=make(257,153,true);let yields=0;
  const result=await core.structureSimilarity(a,b,{yieldTask:async()=>{yields++}});
  assert(Math.abs(result-core.analyze(a,b).ssim)<1e-10);
  assert(yields>1); assert(result<1);
  assert.equal(await core.structureSimilarity(a,a),1);
});
test('candidate SSIM reports unavailable for mismatched, tiny or fully transparent inputs',async()=>{
  await assert.rejects(core.structureSimilarity(make(8,8),make(9,8)),/相同尺寸/);
  await assert.rejects(core.structureSimilarity(make(6,6),make(6,6)),/至少7/);
  await assert.rejects(core.structureSimilarity(make(8,8),make(8,8)),/不透明/);
});
