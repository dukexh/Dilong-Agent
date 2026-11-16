const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib')
const {seamless,repeatTile}=require('../../src/core/seamless.ts'),{S}=require('../../src/services/workflows.ts')
const terms=[[.038731945417821406,.07977475591935217,1.2520653925649823,17.2295098612085],[.027738525196909905,.05698154320009052,3.7430520419962705,24.722008635289967],[.09687009293586016,.03977221936918795,2.1861545758508147,16.712977536953986],[.021936346739530564,.025884773852303623,.07979066723957658,27.84361090976745]]
function fixture(){const width=128,height=96,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const v=128+terms.reduce((sum,[a,b,p,k])=>sum+k*Math.sin(a*x+b*y+p),0);data.set([v,v,v,255],(y*width+x)*4)}return{width,height,data}}
function rotate(im){const out={width:im.height,height:im.width,data:new Uint8ClampedArray(im.data.length)};for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++)out.data.set(im.data.subarray((y*im.width+x)*4,(y*im.width+x+1)*4),((im.width-1-x)*out.width+y)*4);return out}
function edges(im){let horizontal=0,vertical=0;for(let y=0;y<im.height;y++)horizontal=Math.max(horizontal,Math.abs(im.data[y*im.width*4]-im.data[(y*im.width+im.width-1)*4]));for(let x=0;x<im.width;x++)vertical=Math.max(vertical,Math.abs(im.data[x*4]-im.data[((im.height-1)*im.width+x)*4]));return{horizontal,vertical}}
test('closed cuts prevent the second pass reopening the fixed left/right seam, including rotations and corners',()=>{
 let image=fixture()
 for(let rotation=0;rotation<4;rotation++){
  for(const overlap of[5,15,30])for(const lightBalance of[false,true]){
   const doc=seamless(image,overlap,lightBalance),e=edges(doc.result)
   assert(e.horizontal<=5,JSON.stringify({rotation,overlap,lightBalance,e}));assert(e.vertical<=16,JSON.stringify({rotation,overlap,lightBalance,e}))
   const tiled=repeatTile(doc.result,3,3),{width:w,height:h}=doc.result
   for(const [x,y]of[[0,0],[w-1,h-1],[w,h],[w*2-1,h*2-1],[w*2,h*2]]){const i=(y*tiled.width+x)*4,j=((y%h)*w+x%w)*4;assert.deepEqual(tiled.data.subarray(i,i+4),doc.result.data.subarray(j,j+4))}
   for(let i=0;i<doc.repairMask.length;i++)assert.equal(doc.repairMask[i]===0?doc.base.data[i*4]:doc.result.data[i*4],doc.result.data[i*4])
  }
  image=rotate(image)
 }
 const transparent=fixture();for(let i=3;i<transparent.data.length;i+=4)transparent.data[i]=128
 assert(seamless(transparent).result.data.every((value,index)=>index%4!==3||value===128))
 assert.equal(seamless(fixture()).result.width,109);assert.equal(seamless(fixture()).result.height,82)
})
async function deflated(bytes,declared=bytes.length){const name='image.bin',initial=new Uint8Array(await S.zip([[name,bytes]]).arrayBuffer()),offset=30+name.length,central=initial.slice(offset+bytes.length,-22),end=initial.slice(-22),local=initial.slice(0,offset),packed=new Uint8Array(zlib.deflateRawSync(bytes));const l=new DataView(local.buffer),c=new DataView(central.buffer),e=new DataView(end.buffer);l.setUint16(8,8,true);l.setUint32(18,packed.length,true);l.setUint32(22,declared,true);c.setUint16(10,8,true);c.setUint32(20,packed.length,true);c.setUint32(24,declared,true);e.setUint32(16,local.length+packed.length,true);return new Blob([local,packed,central,end]).arrayBuffer()}
test('misdeclared deflate is cancelled before collecting its full expanded content',async()=>{
 const zip=await deflated(new Uint8Array(8*1024*1024).fill(65),1),Original=globalThis.DecompressionStream;let emitted=0,cancelled=false
 globalThis.DecompressionStream=class{constructor(format){const inner=new Original(format),reader=inner.readable.getReader();return{writable:inner.writable,readable:new ReadableStream({async pull(controller){const packet=await reader.read();if(packet.done)controller.close();else{emitted+=packet.value.byteLength;controller.enqueue(packet.value)}},async cancel(reason){cancelled=true;await reader.cancel(reason)}})}}}
 try{await assert.rejects(()=>S.unzip(zip),/实际大小超过声明/);assert(cancelled);assert(emitted<8*1024*1024)}finally{globalThis.DecompressionStream=Original}
})
test('actual streamed byte budget and stored-entry lengths are enforced before concatenation',async()=>{
 const zip=await deflated(new Uint8Array([1,2,3]),150*1024*1024),Original=globalThis.DecompressionStream;let cancelled=false
 globalThis.DecompressionStream=class{constructor(){return{writable:new WritableStream(),readable:new ReadableStream({start(controller){controller.enqueue({byteLength:150*1024*1024+1})},cancel(){cancelled=true}})}}}
 try{await assert.rejects(()=>S.unzip(zip),/150MB/);assert(cancelled)}finally{globalThis.DecompressionStream=Original}
 const stored=await S.zip([['a',new Uint8Array([1,2,3])]]).arrayBuffer(),view=new DataView(stored);view.setUint32(34+24,1,true);await assert.rejects(()=>S.unzip(stored),/实际大小与声明不符/)
 await assert.rejects(()=>S.unzip(stored.slice(0,20)),/有效的 ZIP/)
})
test('personal export membership matches formal library eligibility and excludes public catalog and unadopted candidates',()=>{
 const oldAssets=S.assets,oldBase=S.base
 try{const sample=(id,status)=>({id,name:id,source:'测试',imageUrl:'',wood:'',style:'',tone:'',...(status?{recordKind:'design-candidate',candidateReview:{status}}:{recordKind:'sample',importedAt:'2026-11-16'})});S.base=[sample('public')];S.assets=[sample('imported'),...['pending','adjust','rejected','accepted'].map(s=>sample(s,s))];S.assets.push({...sample('legacy','pending'),recordKind:undefined,importedAt:'2026-11-16'});assert.deepEqual(S.personalSamples().map(s=>s.id),['imported','accepted']);S.assets.find(s=>s.id==='accepted').candidateReview.status='pending';assert.deepEqual(S.personalSamples().map(s=>s.id),['imported'])}finally{S.assets=oldAssets;S.base=oldBase}
})
