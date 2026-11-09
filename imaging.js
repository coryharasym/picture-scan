// All image processing is local. No network or persistent storage APIs.
export function polygonArea(points) {
  return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0)/2);
}
export function validQuad(points,w,h){
  if(points.length!==4 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>w-1||p.y>h-1))return false;
  let sign=0;
  for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);if(Math.abs(cross)<1)return false;if(!sign)sign=Math.sign(cross);if(Math.sign(cross)!==sign)return false;}
  return sign>0&&polygonArea(points)>w*h*.005;
}
export function homography(from,to){
  const rows=[];
  for(let i=0;i<4;i++){const {x,y}=from[i],u=to[i].x,v=to[i].y;rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}
  for(let i=0;i<8;i++){
    let pivot=i;for(let j=i+1;j<8;j++)if(Math.abs(rows[j][i])>Math.abs(rows[pivot][i]))pivot=j;
    [rows[i],rows[pivot]]=[rows[pivot],rows[i]];
    const d=rows[i][i];if(Math.abs(d)<1e-10)throw Error('The selected corners are too close together.');
    for(let k=i;k<9;k++)rows[i][k]/=d;
    for(let j=0;j<8;j++){if(j===i)continue;const f=rows[j][i];for(let k=i;k<9;k++)rows[j][k]-=f*rows[i][k];}
  }
  return [...rows.map(r=>r[8]),1];
}
export function project(m,x,y){const d=m[6]*x+m[7]*y+1;return {x:(m[0]*x+m[1]*y+m[2])/d,y:(m[3]*x+m[4]*y+m[5])/d};}
export function flatten(data,w,h,corners,mode='clean',brightness=0,maxEdge=2200){
  if(!validQuad(corners,w,h))throw Error('Keep all four corners around the page without crossing the edges.');
  const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const ow=(dist(corners[0],corners[1])+dist(corners[3],corners[2]))/2;
  const oh=(dist(corners[0],corners[3])+dist(corners[1],corners[2]))/2;
  const scale=Math.min(1,maxEdge/Math.max(ow,oh));
  const width=Math.max(2,Math.round(ow*scale)),height=Math.max(2,Math.round(oh*scale));
  const m=homography([{x:0,y:0},{x:width-1,y:0},{x:width-1,y:height-1},{x:0,y:height-1}],corners);
  const out=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=project(m,x,y),sx=Math.max(0,Math.min(w-1,p.x)),sy=Math.max(0,Math.min(h-1,p.y));
    const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=sx-x0,fy=sy-y0;
    const pos=(y*width+x)*4;
    for(let c=0;c<3;c++)out[pos+c]=(data[(y0*w+x0)*4+c]*(1-fx)+data[(y0*w+x1)*4+c]*fx)*(1-fy)+(data[(y1*w+x0)*4+c]*(1-fx)+data[(y1*w+x1)*4+c]*fx)*fy;
    out[pos+3]=255;
  }
  // Estimate illumination in tiles; preserve ink while lifting uneven paper shadows.
  const cell=32,cols=Math.ceil(width/cell),rows=Math.ceil(height/cell),paper=new Float32Array(cols*rows);
  if(mode==='clean'||mode==='bw'){
    for(let ty=0;ty<rows;ty++)for(let tx=0;tx<cols;tx++){
      const hist=new Uint32Array(256);let count=0;
      for(let yy=ty*cell;yy<Math.min(height,(ty+1)*cell);yy+=2)for(let xx=tx*cell;xx<Math.min(width,(tx+1)*cell);xx+=2){const i=(yy*width+xx)*4;hist[Math.round(.299*out[i]+.587*out[i+1]+.114*out[i+2])]++;count++;}
      let sum=0,v=0;for(;v<255;v++){sum+=hist[v];if(sum>=count*.85)break;}paper[ty*cols+tx]=Math.max(50,v);
    }
  }
  const clamp=v=>Math.max(0,Math.min(255,v));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;let r=out[i],g=out[i+1],b=out[i+2];
    if(mode==='clean'||mode==='bw'){
      const cx=Math.max(0,Math.min(cols-1,x/cell-.5)),cy=Math.max(0,Math.min(rows-1,y/cell-.5));
      const ax=Math.floor(cx),ay=Math.floor(cy),bx=Math.min(cols-1,ax+1),by=Math.min(rows-1,ay+1),fx=cx-ax,fy=cy-ay;
      const bg=(paper[ay*cols+ax]*(1-fx)+paper[ay*cols+bx]*fx)*(1-fy)+(paper[by*cols+ax]*(1-fx)+paper[by*cols+bx]*fx)*fy;
      const gain=255/bg;r=clamp((r*gain-128)*1.08+128);g=clamp((g*gain-128)*1.08+128);b=clamp((b*gain-128)*1.08+128);
    }
    r=clamp(r+brightness);g=clamp(g+brightness);b=clamp(b+brightness);
    if(mode==='gray'||mode==='bw'){let l=.299*r+.587*g+.114*b;if(mode==='bw')l=l>170?255:0;r=g=b=l;}
    out[i]=r;out[i+1]=g;out[i+2]=b;
  }
  return {data:out,width,height};
}
function hull(points){
  points.sort((a,b)=>a.x-b.x||a.y-b.y);const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lo=[],hi=[];
  for(const p of points){while(lo.length>=2&&cross(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}
  for(const p of [...points].reverse()){while(hi.length>=2&&cross(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  return lo.slice(0,-1).concat(hi.slice(0,-1));
}
export function detectDocument(data,w,h){
  // Try several brightness thresholds; score the largest filled convex page region.
  const lum=new Uint8Array(w*h),hist=new Uint32Array(256);
  for(let i=0;i<lum.length;i++){lum[i]=Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]);hist[lum[i]]++;}
  let total=0;for(let i=0;i<256;i++)total+=i*hist[i];let bg=0,sum=0,best=0,otsu=160;
  for(let i=0;i<255;i++){bg+=hist[i];sum+=i*hist[i];if(!bg||bg===lum.length)continue;const variance=bg*(lum.length-bg)*(sum/bg-(total-sum)/(lum.length-bg))**2;if(variance>best){best=variance;otsu=i;}}
  let winner=null,score=0;
  for(const threshold of [...new Set([Math.max(80,otsu),Math.max(120,Math.min(220,otsu+25)),190,225])]){
    const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
    for(let start=0;start<lum.length;start++){
      if(seen[start]||lum[start]<=threshold)continue;
      let head=0,tail=1;queue[0]=start;seen[start]=1;const boundary=[];let touches=0;
      while(head<tail){const idx=queue[head++],x=idx%w,y=Math.floor(idx/w);let edge=false;
        if(x===0||x===w-1||y===0||y===h-1)touches++;
        for(const ni of [x>0?idx-1:-1,x<w-1?idx+1:-1,y>0?idx-w:-1,y<h-1?idx+w:-1]){
          if(ni<0){edge=true;continue;}if(lum[ni]<=threshold){edge=true;continue;}if(!seen[ni]){seen[ni]=1;queue[tail++]=ni;}
        }
        if(edge)boundary.push({x,y});
      }
      if(tail<w*h*.12||boundary.length<4||touches>2*(w+h)*.35)continue;
      let poly=hull(boundary);const hullArea=polygonArea(poly);if(hullArea<w*h*.15||tail/hullArea<.65)continue;
      // Maximize the quadrilateral area; removing individual hull vertices can
      // accidentally trim a shallow document corner on a rasterized edge.
      while(poly.length>40){let min=Infinity,at=0;for(let i=0;i<poly.length;i++){const area=polygonArea([poly[(i+poly.length-1)%poly.length],poly[i],poly[(i+1)%poly.length]]);if(area<min){min=area;at=i;}}poly.splice(at,1);}
      let largest=0,chosen=null;
      for(let a=0;a<poly.length-3;a++)for(let b=a+1;b<poly.length-2;b++)for(let c=b+1;c<poly.length-1;c++)for(let d=c+1;d<poly.length;d++){
        const q=[poly[a],poly[b],poly[c],poly[d]],area=polygonArea(q);if(area>largest){largest=area;chosen=q;}
      }
      if(!chosen)continue;poly=chosen;
      let tl=0;for(let i=1;i<4;i++)if(poly[i].x+poly[i].y<poly[tl].x+poly[tl].y)tl=i;
      poly=poly.slice(tl).concat(poly.slice(0,tl));if(!validQuad(poly,w,h))continue;
      const area=polygonArea(poly),s=area*(tail/hullArea)*(area/hullArea);
      if(s>score){score=s;winner=poly;}
    }
  }
  return winner;
}
