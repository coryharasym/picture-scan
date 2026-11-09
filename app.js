import {detectDocument,validQuad,flatten} from './imaging.js';
import {buildPdf} from './pdf.js';
import {preparePdfExport,pdfShareData} from './export.js';
const $=id=>document.getElementById(id),pages=[];
const modes={clean:'Clean colour',original:'Original colour',gray:'Grayscale',bw:'Black & white'};
let current=null,pending=[],importing=false,pdfFile=null,pdfUrl=null,downloadUrl=null,statusTimer,processing=false,worker=null;
try{worker=new Worker(new URL('./processor.js',import.meta.url),{type:'module'});}catch{}
function announce(message){$('status').textContent=message;$('status').hidden=false;clearTimeout(statusTimer);statusTimer=setTimeout(()=>$('status').hidden=true,6500);}
function busy(on,message='Preparing your page…'){if(on){const host=$('editor').open?$('editor'):document.body;host.append($('busy'));}$('busyText').textContent=message;$('busy').hidden=!on;}
function invalidatePdf(){pdfFile=null;if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null;}if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}$('downloadPdf').removeAttribute('href');$('openPdf').removeAttribute('href');}
function updatePages(){
  invalidatePdf();$('pageCount').textContent=pages.length;$('exportCount').textContent=pages.length?`${pages.length} ${pages.length===1?'page':'pages'}`:'No pages yet';$('makePdf').disabled=!pages.length;$('clearAll').hidden=!pages.length;$('pages').replaceChildren();
  pages.forEach((p,index)=>{
    const card=document.createElement('article');card.className='page-card';
    const preview=document.createElement('button');preview.className='page-preview';preview.setAttribute('aria-label',`Edit page ${index+1}`);
    const img=document.createElement('img');img.src=p.url;img.alt=`Flattened scan, page ${index+1}`;
    const edit=document.createElement('span');edit.textContent='Adjust scan';preview.append(img,edit);preview.onclick=()=>openPage(p,index);
    const info=document.createElement('div');info.className='page-info';const title=document.createElement('strong');title.textContent=`Page ${index+1}`;info.append(title);
    const actions=document.createElement('div');actions.className='page-actions';
    for(const [label,text,disabled,fn] of [[`Move page ${index+1} earlier`,'←',index===0,()=>{[pages[index-1],pages[index]]=[pages[index],pages[index-1]];updatePages();}],[`Move page ${index+1} later`,'→',index===pages.length-1,()=>{[pages[index+1],pages[index]]=[pages[index],pages[index+1]];updatePages();}],[`Delete page ${index+1}`,'Delete',false,()=>{URL.revokeObjectURL(p.url);pages.splice(index,1);updatePages();}]]){
      const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',label);b.disabled=disabled;b.onclick=fn;if(text==='Delete')b.className='delete-page';actions.append(b);
    }
    const finish=document.createElement('span');finish.textContent=modes[p.mode];finish.style.cssText='font-size:9px;color:var(--muted)';info.append(finish);card.append(preview,info,actions);$('pages').append(card);
  });
}
const toBlob=(canvas,quality=.93)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not prepare this image.')),'image/jpeg',quality));
async function loadImage(blob){
  const url=URL.createObjectURL(blob);
  try{const image=new Image();image.src=url;await image.decode();return image;}finally{URL.revokeObjectURL(url);}
}
async function normalizedPhoto(file){
  if(file.size>40*1024*1024)throw Error('This photo is too large. Choose a photo smaller than 40 MB.');
  let image;try{image=await loadImage(file);}catch{throw Error('This photo format could not be opened. Try a JPEG or PNG, or export the photo as JPEG first.');}
  if(!image.naturalWidth||!image.naturalHeight)throw Error('This photo could not be read.');
  const scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
  const c=document.createElement('canvas');c.width=Math.max(2,Math.round(image.naturalWidth*scale));c.height=Math.max(2,Math.round(image.naturalHeight*scale));const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(image,0,0,c.width,c.height);
  const blob=await toBlob(c,.95);c.width=c.height=1;return blob;
}
function fullCorners(w,h,inset=0){return [{x:inset,y:inset},{x:w-1-inset,y:inset},{x:w-1-inset,y:h-1-inset},{x:inset,y:h-1-inset}];}
async function openPage(page,index=-1){
  if(current||processing)return;
  busy(true,'Opening your photo…');
  try{
    const source=page.source||await normalizedPhoto(page),image=await loadImage(source),canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0);
    current={source,canvas,index,corners:page.corners?structuredClone(page.corners):null,mode:page.mode||'clean',brightness:page.brightness||0,url:URL.createObjectURL(source),preview:false};
    $('scanMode').value=current.mode;$('brightness').value=current.brightness;$('brightnessValue').value=current.brightness;
    $('editorTitle').textContent=index<0?`Adjust your scan${pending.length?` · ${pending.length} more after this`:''}`:`Adjust page ${index+1}`;
    $('saveScan').textContent=index<0?'Add page':'Save changes';
    setupCrop();if(!current.corners)findEdges();else drawCorners();
    $('editor').showModal();
  }catch(error){announce(error.message);current=null;}finally{busy(false);}
}
function setupCrop(){const {canvas,url}=current;$('cropSvg').setAttribute('viewBox',`0 0 ${canvas.width} ${canvas.height}`);$('cropImage').setAttribute('width',canvas.width);$('cropImage').setAttribute('height',canvas.height);$('cropImage').setAttribute('href',url);showCrop();}
function findEdges(){
  if(!current)return;const c=document.createElement('canvas'),scale=Math.min(1,360/Math.max(current.canvas.width,current.canvas.height));c.width=Math.round(current.canvas.width*scale);c.height=Math.round(current.canvas.height*scale);const ctx=c.getContext('2d');ctx.drawImage(current.canvas,0,0,c.width,c.height);
  const detected=detectDocument(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height);
  current.corners=detected?detected.map(p=>({x:p.x/ (c.width-1)*(current.canvas.width-1),y:p.y/(c.height-1)*(current.canvas.height-1)})):fullCorners(current.canvas.width,current.canvas.height,Math.round(Math.min(current.canvas.width,current.canvas.height)*.025));
  $('cropHint').textContent=detected?'Page edges suggested. Check all four corners and drag to adjust. Use arrow keys for fine adjustments.':'Drag the four corners to the edges of your page. Use the arrow keys for fine adjustments.';showCrop();drawCorners();
}
function drawCorners(){
  const {corners,canvas}=current,points=corners.map(p=>`${p.x},${p.y}`).join(' '),r=Math.max(canvas.width,canvas.height)/43;
  $('cropOutline').setAttribute('points',points);$('cropOutline').setAttribute('stroke-width',Math.max(canvas.width,canvas.height)/550);
  $('cropShade').setAttribute('d',`M0 0H${canvas.width}V${canvas.height}H0Z M${corners.map(p=>`${p.x} ${p.y}`).join('L')}Z`);
  const handles=$('cropHandles');
  if(!handles.children.length){for(let i=0;i<4;i++){const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('tabindex','0');circle.setAttribute('role','slider');circle.setAttribute('aria-valuemin','0');circle.setAttribute('aria-valuemax','100');circle.setAttribute('aria-label',['Top left corner','Top right corner','Bottom right corner','Bottom left corner'][i]);circle.addEventListener('pointerdown',event=>startDrag(event,i));circle.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?10:1,p={...current.corners[i]};if(event.key==='ArrowLeft')p.x-=step;if(event.key==='ArrowRight')p.x+=step;if(event.key==='ArrowUp')p.y-=step;if(event.key==='ArrowDown')p.y+=step;setCorner(i,p);});handles.append(circle);}}
  [...handles.children].forEach((el,i)=>{el.setAttribute('cx',corners[i].x);el.setAttribute('cy',corners[i].y);el.setAttribute('r',r);el.setAttribute('aria-valuenow',Math.round(corners[i].x/(canvas.width-1)*100));el.setAttribute('aria-valuetext',`${Math.round(corners[i].x/(canvas.width-1)*100)} percent across, ${Math.round(corners[i].y/(canvas.height-1)*100)} percent down`);});
}
function setCorner(i,p){const {canvas}=current;p.x=Math.max(0,Math.min(canvas.width-1,p.x));p.y=Math.max(0,Math.min(canvas.height-1,p.y));const next=current.corners.map((v,j)=>j===i?p:v);if(validQuad(next,canvas.width,canvas.height)){current.corners=next;drawCorners();}}
function startDrag(event,i){
  event.preventDefault();const target=event.currentTarget;target.setPointerCapture(event.pointerId);
  const move=e=>{if(!current)return;const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform($('cropSvg').getScreenCTM().inverse());setCorner(i,pt);};
  const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);
}
function showCrop(){if(!current)return;current.preview=false;$('cropSvg').hidden=false;$('previewCanvas').hidden=true;$('backToCrop').hidden=true;$('previewScan').textContent='Preview flattened page';}
async function processScan(maxEdge=2200){
  const {canvas,corners}=current,image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height),message={data:image.data,width:canvas.width,height:canvas.height,corners,mode:$('scanMode').value,brightness:Number($('brightness').value),maxEdge};
  if(!worker)return flatten(message.data,message.width,message.height,corners,message.mode,message.brightness,maxEdge);
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{worker?.terminate();worker=null;reject(Error('Processing took too long. Please try again.'));},45000);
    worker.onmessage=({data})=>{clearTimeout(timeout);data.error?reject(Error(data.error)):resolve(data);};
    worker.onerror=()=>{clearTimeout(timeout);worker.terminate();worker=null;try{resolve(flatten(message.data,message.width,message.height,corners,message.mode,message.brightness,maxEdge));}catch(e){reject(e);}};
    // Keep the source buffer available if a browser does not support module workers.
    worker.postMessage(message);
  });
}
async function renderScan(maxEdge){const result=await processScan(maxEdge),c=document.createElement('canvas');c.width=result.width;c.height=result.height;c.getContext('2d').putImageData(new ImageData(result.data,result.width,result.height),0,0);return c;}
async function preview(){if(processing||!current)return;processing=true;busy(true,'Flattening your page…');try{const c=await renderScan(1200),out=$('previewCanvas');out.width=c.width;out.height=c.height;out.getContext('2d').drawImage(c,0,0);c.width=c.height=1;$('cropSvg').hidden=true;out.hidden=false;$('backToCrop').hidden=false;current.preview=true;$('previewScan').textContent='Refresh preview';}catch(e){announce(e.message);}finally{busy(false);processing=false;}}
async function saveScan(){
  if(processing||!current)return;processing=true;busy(true,'Making your page print-ready…');
  try{
    const c=await renderScan(2200),blob=await toBlob(c),page={source:current.source,corners:structuredClone(current.corners),mode:$('scanMode').value,brightness:Number($('brightness').value),width:c.width,height:c.height,blob,url:URL.createObjectURL(blob)};
    c.width=c.height=1;if(current.index<0)pages.push(page);else{URL.revokeObjectURL(pages[current.index].url);pages[current.index]=page;}
    finishEditor();updatePages();announce('Page saved. Add another photo or create your PDF.');
  }catch(error){announce(error.message);}finally{busy(false);processing=false;}
  if(!current)await nextImport();
}
function finishEditor(){if(current){URL.revokeObjectURL(current.url);current.canvas.width=current.canvas.height=1;current=null;}$('cropImage').removeAttribute('href');$('cropHandles').replaceChildren();$('previewCanvas').width=$('previewCanvas').height=1;$('editor').close();}
async function cancelEditor(){if(processing)return;finishEditor();await nextImport();}
async function importFiles(files){
  if(importing||current){announce('Finish adjusting the current page first.');return;}
  const selected=Array.from(files).filter(f=>f.type.startsWith('image/')||/\.(heic|heif|jpg|jpeg|png|webp)$/i.test(f.name));
  if(!selected.length){announce('Choose an image, such as a JPEG or PNG.');return;}
  const room=24-pages.length;if(!room){announce('This document has reached the 24-page limit. Save it, then start a new document.');return;}
  pending=selected.slice(0,room);if(selected.length>room)announce(`Only the first ${room} photos were added. Documents can have up to 24 pages.`);importing=true;await nextImport();
}
async function nextImport(){while(pending.length&&!current){const file=pending.shift();await openPage(file);}if(!pending.length&&!current)importing=false;}
$('takePhoto').onclick=()=>$('cameraInput').click();$('choosePhotos').onclick=()=>$('photosInput').click();
for(const id of ['cameraInput','photosInput'])$(id).onchange=event=>{const files=[...event.target.files];event.target.value='';importFiles(files);};
for(const name of ['dragenter','dragover'])$('dropzone').addEventListener(name,event=>{event.preventDefault();$('dropzone').classList.add('dragover');});
for(const name of ['dragleave','drop'])$('dropzone').addEventListener(name,event=>{event.preventDefault();$('dropzone').classList.remove('dragover');if(name==='drop')importFiles(event.dataTransfer.files);});
$('autoDetect').onclick=findEdges;$('fullPhoto').onclick=()=>{current.corners=fullCorners(current.canvas.width,current.canvas.height);showCrop();drawCorners();};
$('rotatePhoto').onclick=async()=>{
  if(processing||!current)return;processing=true;busy(true,'Rotating your photo…');try{
    const old=current.canvas,c=document.createElement('canvas');c.width=old.height;c.height=old.width;const ctx=c.getContext('2d');ctx.translate(c.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(old,0,0);current.corners=[current.corners[3],current.corners[0],current.corners[1],current.corners[2]].map(p=>({x:old.height-1-p.y,y:p.x}));current.canvas=c;current.source=await toBlob(c,.95);URL.revokeObjectURL(current.url);current.url=URL.createObjectURL(current.source);old.width=old.height=1;setupCrop();drawCorners();
  }catch(e){announce(e.message);}finally{processing=false;busy(false);}
};
$('previewScan').onclick=preview;$('backToCrop').onclick=showCrop;$('saveScan').onclick=saveScan;$('closeEditor').onclick=cancelEditor;
$('editor').addEventListener('cancel',event=>{event.preventDefault();cancelEditor();});
$('scanMode').onchange=()=>{if(current?.preview)preview();};$('brightness').oninput=()=>{$('brightnessValue').value=$('brightness').value;};$('brightness').onchange=()=>{if(current?.preview)preview();};
$('clearAll').onclick=()=>{if(!confirm('Clear all pages? Save your PDF first if you want to keep it.'))return;pages.forEach(p=>URL.revokeObjectURL(p.url));pages.length=0;updatePages();announce('All pages cleared from this session.');};
$('filename').oninput=invalidatePdf;$('paperSize').onchange=invalidatePdf;
$('makePdf').onclick=async()=>{
  if(!pages.length||processing)return;processing=true;busy(true,'Putting your PDF together…');
  try{invalidatePdf();const input=[];for(const page of pages)input.push({width:page.width,height:page.height,jpeg:new Uint8Array(await page.blob.arrayBuffer())});const blob=buildPdf(input,$('paperSize').value),prepared=await preparePdfExport(blob,$('filename').value);pdfFile=prepared.file;pdfUrl=URL.createObjectURL(pdfFile);downloadUrl=URL.createObjectURL(prepared.download);$('openPdf').href=pdfUrl;$('downloadPdf').href=downloadUrl;$('downloadPdf').download=pdfFile.name;const name=pdfFile.name;$('pdfSummary').textContent=`${name} · ${pages.length} ${pages.length===1?'page':'pages'} · ${(blob.size/1024/1024).toFixed(1)} MB`;
    let share=false;try{share=!!navigator.canShare?.(pdfShareData(pdfFile));}catch{}$('sharePdf').hidden=!share;$('pdfDialog').showModal();
  }catch(e){announce(`Could not create the PDF. ${e.message}`);}finally{busy(false);processing=false;}
};
$('sharePdf').onclick=async()=>{if(!pdfFile)return;try{await navigator.share(pdfShareData(pdfFile));}catch(e){if(e.name!=='AbortError')announce('Sharing could not open. Use Download PDF instead.');}};
$('closePdf').onclick=()=>$('pdfDialog').close();
window.addEventListener('beforeunload',event=>{if(pages.length||current){event.preventDefault();event.returnValue='';}});
// Cache only application assets for offline launches. Photos and PDFs never enter the cache.
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
