// A minimal PDF 1.4 writer: JPEG image pages, real byte offsets, no dependencies.
export function safeFilename(value){return (value||'My document').replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').trim().slice(0,100)||'My document';}
export function buildPdf(pages,paper='letter'){
  if(!pages.length)throw Error('Add at least one page.');
  const [pw,ph]=paper==='a4'?[595.28,841.89]:[612,792],enc=new TextEncoder();
  const chunks=[],offsets=[0];let length=0;
  const write=v=>{const b=typeof v==='string'?enc.encode(v):v;chunks.push(b);length+=b.byteLength;};
  const obj=(id,body)=>{offsets[id]=length;write(`${id} 0 obj\n`);write(body);write('\nendobj\n');};
  write('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
  obj(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
  pages.forEach((p,i)=>{
    const id=3+i*3,margin=18,scale=Math.min((pw-margin*2)/p.width,(ph-margin*2)/p.height);
    const w=p.width*scale,h=p.height*scale,x=(pw-w)/2,y=(ph-h)/2;
    obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    offsets[id+1]=length;write(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.byteLength} >>\nstream\n`);write(p.jpeg);write('\nendstream\nendobj\n');
    const cmd=`q\n${w.toFixed(3)} 0 0 ${h.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/Im0 Do\nQ\n`;
    obj(id+2,`<< /Length ${enc.encode(cmd).length} >>\nstream\n${cmd}endstream`);
  });
  const xref=length;write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for(let i=1;i<offsets.length;i++)write(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
  write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks,{type:'application/pdf'});
}
