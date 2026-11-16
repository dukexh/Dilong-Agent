const test = require('node:test')
const assert = require('node:assert/strict')
const { textureFeatures, textureScore } = require('../../src/core/texture-search.ts')
const { seamless, repeatTile } = require('../../src/core/seamless.ts')
const { encodeTiff, encodePsd, physicalSize, validateExport } = require('../../src/core/engineering-export.ts')
const { readPsd, initializeCanvas } = require('ag-psd')
initializeCanvas(()=>{throw Error('Unexpected DOM canvas request')},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}))
function texture(kind='wood', width=144, height=96, colour=[1,.8,.6]) {
  const data = new Uint8ClampedArray(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const v=kind==='wood'?130+45*Math.sin(x*.24+Math.sin(y*.05)*2)+15*Math.cos(x*.6+y*.1):((Math.floor(x/9)+Math.floor(y/9))%2?190:50)
    data.set([...colour.map(c=>v*c),255],(y*width+x)*4)
  }
  return {width,height,data}
}
function rotated(image){const result={width:image.height,height:image.width,data:new Uint8ClampedArray(image.data.length)};for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)result.data.set(image.data.subarray((y*image.width+x)*4,(y*image.width+x+1)*4),((image.width-1-x)*result.width+y)*4);return result}
test('structure search ranks the same texture across colour, exposure and rotation above a colour-matched different texture',()=>{
 const original=texture(),query=textureFeatures(original,true),features=textureFeatures(original)
 assert.equal(textureScore(query,features),100)
 for(const image of [texture('wood',144,96,[.6,.9,1.1]),texture('wood',144,96,[.6,.48,.36]),rotated(original)])assert(textureScore(textureFeatures(image,true),features)>textureScore(query,textureFeatures(texture('check'))))
 assert.throws(()=>textureFeatures({width:2,height:2,data:new Uint8ClampedArray(16)}),/透明/)
})

test('whole-texture search distinguishes grain spacing and orientation without automatic rotation',()=>{
 const stripe=(frequency,vertical=false)=>{const image=texture('wood',192,192);for(let y=0;y<192;y++)for(let x=0;x<192;x++){const v=128+90*Math.sin((vertical?y:x)/192*frequency*2*Math.PI);image.data.set([v,v,v,255],(y*192+x)*4)}return image}
 const query=textureFeatures(stripe(5)),same=textureScore(query,textureFeatures(stripe(5))),dense=textureScore(query,textureFeatures(stripe(15))),turned=textureScore(query,textureFeatures(stripe(5,true)))
 assert.equal(same,100);assert(same-dense>20);assert(dense-turned>20)
})

test('whole-texture search uses all corresponding regions rather than a few reusable local matches',()=>{
 const image=texture('wood',192,192)
 for(let y=0;y<192;y++)for(let x=0;x<192;x++){const v=128+60*Math.sin(x/192*2*Math.PI*(y<96?5:13))+(x>96?35:0)*Math.sin(y*.2);image.data.set([v,v*.8,v*.6,255],(y*192+x)*4)}
 const swapped={...image,data:new Uint8ClampedArray(image.data.length)},exposed={...image,data:Uint8ClampedArray.from(image.data,(v,i)=>i%4===3?v:v*.6+20)}
 for(let y=0;y<192;y++)swapped.data.set(image.data.subarray((y+96)%192*192*4,((y+96)%192+1)*192*4),y*192*4)
 const query=textureFeatures(image)
 assert(textureScore(query,textureFeatures(exposed))-textureScore(query,textureFeatures(swapped))>15)
})
test('seamless preserves input and texture scale, creates editable repairs, and repeat uses exact tile pixels',()=>{
 const image=texture(),before=new Uint8ClampedArray(image.data),doc=seamless(image,15)
 assert.deepEqual(image.data,before);assert.equal(doc.result.width,122);assert.equal(doc.result.height,82)
 assert(doc.repairMask.some(n=>n===255));assert(doc.repairMask.some(n=>n===0));assert(doc.result.data.every((n,i)=>i%4!==3||n===255))
 const repeated=repeatTile(doc.result,3,3)
 for(const [x,y]of [[0,0],[doc.result.width,0],[0,doc.result.height],[repeated.width-1,repeated.height-1]]){
  const src=((y%doc.result.height)*doc.result.width+x%doc.result.width)*4,dst=(y*repeated.width+x)*4
  assert.deepEqual(repeated.data.slice(dst,dst+4),doc.result.data.slice(src,src+4))
 }
 assert.throws(()=>seamless(image,0),/重叠/);assert.throws(()=>seamless(texture('wood',8,8)),/至少/)
})
test('periodic overlap substantially reduces wrap boundary discontinuity on a lit texture',()=>{
 const image=texture();for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let c=0;c<3;c++)image.data[(y*image.width+x)*4+c]+=x/image.width*50+y/image.height*30
 const boundary=im=>{let sum=0;for(let y=0;y<im.height;y++)sum+=Math.abs(im.data[(y*im.width)*4]-im.data[(y*im.width+im.width-1)*4]);for(let x=0;x<im.width;x++)sum+=Math.abs(im.data[x*4]-im.data[((im.height-1)*im.width+x)*4]);return sum/(im.width+im.height)}
 assert(boundary(seamless(image,15).result)<boundary(image)*.6)
})
test('smooth texture seams avoid introducing sharp staircase edges inside the repaired unit',()=>{
 const image=texture()
 const peak=im=>{let max=0;for(let y=1;y<im.height-1;y++)for(let x=1;x<im.width-1;x++){const p=(y*im.width+x)*4;max=Math.max(max,Math.abs(im.data[p-im.width*4]+im.data[p+im.width*4]-2*im.data[p]),Math.abs(im.data[p-4]+im.data[p+4]-2*im.data[p]))}return max}
 assert(peak(seamless(image).result)<=peak(image)*3)
})
test('TIF writes actual pixel bytes, alpha and 300 ppi; physical size does not resample',()=>{
 const image=texture('wood',32,24),bytes=encodeTiff(image,300),v=new DataView(bytes.buffer),tags=new Map()
 assert.deepEqual([...bytes.slice(0,4)],[73,73,42,0])
 for(let p=10;p<10+v.getUint16(8,true)*12;p+=12)tags.set(v.getUint16(p,true),v.getUint32(p+8,true))
 assert.equal(tags.get(256),32);assert.equal(tags.get(257),24);assert.equal(tags.get(338),2)
 for(const id of [282,283]){const offset=tags.get(id);assert.equal(v.getUint32(offset,true)/v.getUint32(offset+4,true),300)}
 assert.deepEqual([...bytes.slice(tags.get(273))],[...image.data]);assert.equal(physicalSize(3000,3000).widthMm,254)
 assert.throws(()=>physicalSize(10,10,NaN),/分辨率/)
 assert.throws(()=>validateExport({width:40000,height:1,data:new Uint8ClampedArray(0)},{format:'psd',ppi:300}),/限制/)
})
test('PSD preserves named layers, editable masks, resolution and composite pixels without a DOM',async()=>{
 const doc=seamless(texture('wood',64,48)),bytes=await encodePsd(doc.result,300,doc)
 const psd=readPsd(bytes,{useImageData:true,skipThumbnail:true})
 assert.equal(psd.width,doc.result.width);assert.equal(psd.height,doc.result.height)
 assert.equal(psd.imageResources.resolutionInfo.horizontalResolution,300)
 assert.deepEqual(psd.children.map(layer=>layer.name),['原始单元参考','单元基础','接缝修补'])
 assert.equal(psd.children[0].hidden,true);assert(psd.children[1].mask.imageData);assert(psd.children[2].mask.imageData)
 assert.deepEqual([...psd.imageData.data],[...doc.result.data])
 for(let i=0;i<doc.repairMask.length;i++)assert.equal(psd.children[2].mask.imageData.data[i*4],doc.repairMask[i])
})
test('PSD composite retains partial transparency and its masks partition the base and repair layers',async()=>{
 const input=texture('wood',64,48);for(let i=3;i<input.data.length;i+=4)input.data[i]=128
 const doc=seamless(input),decoded=readPsd(await encodePsd(doc.result,300,doc),{useImageData:true,skipThumbnail:true})
 assert(decoded.imageData.data.every((n,i)=>i%4!==3||n===128))
 for(let i=0;i<doc.repairMask.length;i++)assert.equal(decoded.children[1].mask.imageData.data[i*4]+decoded.children[2].mask.imageData.data[i*4],255)
})
