import test from 'node:test';
import assert from 'node:assert/strict';
import {homography,project,validQuad,flatten,detectDocument} from '../imaging.js';
import {buildPdf,safeFilename} from '../pdf.js';
const rect=(w,h)=>[{x:0,y:0},{x:w-1,y:0},{x:w-1,y:h-1},{x:0,y:h-1}];
test('perspective mapping hits all four selected corners and inverts correctly',()=>{
  const source=rect(201,301),target=[{x:20,y:40},{x:180,y:10},{x:210,y:290},{x:3,y:260}],matrix=homography(source,target),inverse=homography(target,source);
  for(let i=0;i<4;i++){const p=project(matrix,source[i].x,source[i].y);assert.ok(Math.abs(p.x-target[i].x)<1e-8);assert.ok(Math.abs(p.y-target[i].y)<1e-8);}
  const p=project(matrix,83,147),back=project(inverse,p.x,p.y);assert.ok(Math.abs(back.x-83)<1e-8);assert.ok(Math.abs(back.y-147)<1e-8);
});
test('crossed, concave, tiny and out-of-bounds corner selections are rejected',()=>{
  assert.ok(validQuad(rect(100,150),100,150));
  assert.equal(validQuad([{x:0,y:0},{x:99,y:149},{x:99,y:0},{x:0,y:149}],100,150),false);
  assert.equal(validQuad([{x:0,y:0},{x:99,y:0},{x:20,y:20},{x:0,y:149}],100,150),false);
  assert.equal(validQuad(rect(2,2),100,150),false);
  assert.equal(validQuad(rect(101,150),100,150),false);
});
test('flattening preserves a source gradient and enforces the output limit',()=>{
  const w=100,h=120,data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data[i]=x*2;data[i+1]=y*2;data[i+2]=90;data[i+3]=255;}
  const out=flatten(data,w,h,rect(w,h),'original',0,60);assert.equal(out.height,60);assert.ok(out.width<=60);assert.equal(out.data[0],0);assert.equal(out.data.at(-2),90);assert.ok(Math.abs(out.data.at(-4)-198)<2);assert.ok(Math.abs(out.data.at(-3)-238)<2);
});
test('cleanup lifts paper shadows while keeping dark text',()=>{
  const w=120,h=160,data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,v=x>30&&x<80&&y>70&&y<76?25:160+x*.4;data[i]=data[i+1]=data[i+2]=v;data[i+3]=255;}
  const out=flatten(data,w,h,rect(w,h),'clean');assert.ok(out.data[0]>240);assert.ok(out.data[(72*out.width+50)*4]<70);
  const bw=flatten(data,w,h,rect(w,h),'bw');assert.ok(bw.data.every((v,i)=>i%4===3?v===255:v===0||v===255));
});
test('edge suggestions find a bright perspective page on a dark surface',()=>{
  const w=260,h=320,quad=[{x:55,y:30},{x:210,y:48},{x:230,y:285},{x:25,y:270}],data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let inside=true;for(let k=0;k<4;k++){const a=quad[k],b=quad[(k+1)%4];if((b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x)<0)inside=false;}const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=inside?235:45;data[i+3]=255;}
  const result=detectDocument(data,w,h);assert.ok(result);for(let i=0;i<4;i++)assert.ok(Math.hypot(result[i].x-quad[i].x,result[i].y-quad[i].y)<4);
  data.fill(255);assert.equal(detectDocument(data,w,h),null);
});
test('PDF has correct byte offsets, stream lengths, page count and paper size',async()=>{
  const jpeg=new Uint8Array([255,216,255,224,0,0,255,217]),blob=buildPdf([{width:100,height:200,jpeg},{width:300,height:200,jpeg}]);
  const bytes=new Uint8Array(await blob.arrayBuffer()),text=new TextDecoder('latin1').decode(bytes);assert.equal(blob.type,'application/pdf');assert.ok(text.startsWith('%PDF-1.4'));assert.match(text,/\/Count 2/);assert.match(text,/\/MediaBox \[0 0 612 792\]/);
  const start=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(new TextDecoder().decode(bytes.slice(start,start+4)),'xref');
  const lines=text.slice(start).split('\n'),count=Number(lines[1].split(' ')[1]);assert.equal(count,9);
  for(let id=1;id<count;id++){const offset=Number(lines[id+2].slice(0,10));assert.ok(new TextDecoder().decode(bytes.slice(offset,offset+20)).startsWith(`${id} 0 obj\n`));}
  const a4=await buildPdf([{width:100,height:100,jpeg}],'a4').text();assert.match(a4,/595.28 841.89/);
});
test('filenames are safe and empty documents are rejected',()=>{assert.equal(safeFilename('../My:scan.pdf'),'..-My-scan');assert.equal(safeFilename('   '),'My document');assert.throws(()=>buildPdf([]));});

test('sharing sends only a named PDF file, with no separate text/title item',async()=>{
  const {preparePdfExport,pdfShareData}=await import('../export.js');
  const original=new Blob(['%PDF-1.4\nTest bytes\n%%EOF'],{type:'application/pdf'});
  const {file,download}=await preparePdfExport(original,'A test document');
  assert.equal(file.name,'A test document.pdf');assert.equal(file.type,'application/pdf');
  const payload=pdfShareData(file);assert.deepEqual(Object.keys(payload),['files']);assert.equal(payload.files.length,1);assert.equal(payload.files[0],file);
  assert.equal(download.name,file.name);assert.equal(download.type,'application/octet-stream');
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()),new Uint8Array(await original.arrayBuffer()));
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()),new Uint8Array(await original.arrayBuffer()));
  await assert.rejects(preparePdfExport(new Blob(['not a PDF']),'Invalid'),/not a PDF/);
});
