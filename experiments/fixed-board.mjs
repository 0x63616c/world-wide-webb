// Fixed-board placeholder fill: skyline wall-builder that tiles the inner 31×31
// AROUND the reserved 12×9 cluster hole, with best-of-N to pick the shortest
// longest-seam. This is the actual production approach (no Wang/WFC) — validated
// here for gap-free + measured before wiring into the browser test bed.
function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const WMIN=2,WMAX=5,HMIN=2,HMAX=4;
const validSizes=(avail,mn,mx)=>{const o=[];const top=Math.min(mx,avail);for(let w=mn;w<=top;w++){const r=avail-w;if(r===0||r>=mn)o.push(w);}return o;};

// reserved = the cluster hole rect [hx0,hx1]×[hy0,hy1] inclusive (local coords).
function buildAround(W,H,hole,rng){
  const RES=-2; // reserved marker
  const owner=new Int32Array(W*H).fill(-1);
  for(let y=hole.hy0;y<=hole.hy1;y++)for(let x=hole.hx0;x<=hole.hx1;x++)owner[y*W+x]=RES;
  const isHoleCol=x=>x>=hole.hx0&&x<=hole.hx1;
  const frontier=new Int32Array(W).fill(0);
  const tiles=[];
  const setO=(x,y,w,h,v)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)owner[yy*W+xx]=v;};
  let guard=0;
  while(true){
    if(++guard>W*H*6)return {owner,tiles,W,H,failed:true};
    // jump any hole-column sitting at the hole's bottom edge straight past the hole
    for(let x=hole.hx0;x<=hole.hx1;x++)if(frontier[x]===hole.hy0)frontier[x]=hole.hy1+1;
    let f=Infinity;for(let x=0;x<W;x++)if(frontier[x]<H&&frontier[x]<f)f=frontier[x];
    if(f===Infinity)break;
    const sb=c=>{let n=0;for(let r=f-1;r>=0;r--){const a=owner[r*W+(c-1)],b=owner[r*W+c];if(a!==b)n++;else break;}return n;};
    const runs=[];for(let x=0;x<W;){if(frontier[x]===f){let l=0;const s=x;while(x<W&&frontier[x]===f){l++;x++;}runs.push([s,l]);}else x++;}
    let pick=null,pu=-1;for(const[s,l]of runs){let u=0;for(let c=s+1;c<s+l;c++)u=Math.max(u,sb(c));const ur=u+rng()*0.1;if(ur>pu){pu=ur;pick=[s,l];}}
    const[x0,L]=pick;
    // height cap: if any column in a candidate spans below the hole, the tile must
    // stop at the hole's bottom edge.
    const cand=[];
    for(let w=WMIN;w<=Math.min(WMAX,L);w++)for(let px=x0;px+w<=x0+L;px++){const lr=px-x0,rr=(x0+L)-(px+w);if((lr===0||lr>=WMIN)&&(rr===0||rr>=WMIN))cand.push([px,w]);}
    if(!cand.length)return {owner,tiles,W,H,failed:true};
    let best=null,bk=null;for(const[px,w]of cand){let cov=0;for(let c=px+1;c<px+w;c++)cov=Math.max(cov,sb(c));const e=Math.max(px>0?sb(px):0,(px+w)<W?sb(px+w):0);const key=cov*1000-e*10+rng();if(best===null||key>bk){bk=key;best=[px,w];}}
    const[px,w]=best;
    // available height before hitting the hole (if this tile spans hole columns and
    // sits below the hole) or the board top.
    let ceil=H;
    let spansHole=false;for(let c=px;c<px+w;c++)if(isHoleCol(c)){spansHole=true;break;}
    if(spansHole&&f<hole.hy0)ceil=hole.hy0;
    const avail=ceil-f;
    const hOpts=validSizes(avail,HMIN,HMAX);
    if(!hOpts.length){
      // can't place a >=2 tile here without hitting the hole (avail==1). This means
      // a sliver gap would form; reject this board (best-of-N will discard it).
      return {owner,tiles,W,H,failed:true,reason:`avail=${avail} at f=${f} x0=${x0}`};
    }
    const h=hOpts[(rng()*hOpts.length)|0];
    const id=tiles.length;tiles.push({x:px,y:f,w,h});setO(px,f,w,h,id);
    for(let x=px;x<px+w;x++)frontier[x]=f+h;
  }
  return {owner,tiles,W,H,failed:false};
}

function gaps(owner){for(const v of owner)if(v===-1)return true;return false;}
// longest seam, ignoring reserved cells (cluster edges are real boundaries, not
// decorative seams, so we don't count a seam where either side is reserved).
function longestLine(owner,W,H){const O=(x,y)=>owner[y*W+x];let v=0,h=0;
  for(let c=1;c<W;c++){let run=0;for(let r=0;r<H;r++){const a=O(c-1,r),b=O(c,r);if(a===-2||b===-2){run=0;continue;}if(a!==b){run++;if(run>v)v=run;}else run=0;}}
  for(let r=1;r<H;r++){let run=0;for(let c=0;c<W;c++){const a=O(c,r-1),b=O(c,r);if(a===-2||b===-2){run=0;continue;}if(a!==b){run++;if(run>h)h=run;}else run=0;}}
  return {v,h,max:Math.max(v,h)};}

const HOLE={hx0:13,hx1:24,hy0:14,hy1:22}; // local 31×31 inner coords
const W=31,H=31;
// best-of-N
function bestOfN(N,seed0){
  let best=null,bestScore=Infinity,solved=0;
  for(let i=0;i<N;i++){
    const b=buildAround(W,H,HOLE,mulberry32(seed0+i*101));
    if(b.failed||gaps(b.owner))continue;
    solved++;
    const ll=longestLine(b.owner,W,H);
    if(ll.max<bestScore){bestScore=ll.max;best={b,ll};}
  }
  return {best,solved};
}
const {best,solved}=bestOfN(300,1234);
console.log(`best-of-300: solved ${solved}/300`);
if(best){
  console.log(`best longestLine v=${best.ll.v} h=${best.ll.h} max=${best.ll.max}`);
  console.log(`tiles=${best.b.tiles.length} gaps=${gaps(best.b.owner)}`);
  const hist=new Map();for(const t of best.b.tiles){const k=`${t.w}x${t.h}`;hist.set(k,(hist.get(k)||0)+1);}
  console.log(`sizes: ${[...hist.entries()].sort().map(([k,v])=>k+':'+v).join(' ')}`);
}
// distribution of longest-line across single runs (no selection)
let sum=0,n=0,worst=0;for(let i=0;i<200;i++){const b=buildAround(W,H,HOLE,mulberry32(9000+i*7));if(b.failed||gaps(b.owner))continue;const ll=longestLine(b.owner,W,H);sum+=ll.max;n++;if(ll.max>worst)worst=ll.max;}
console.log(`single-run longestLine: avg=${(sum/n).toFixed(1)} worst=${worst} (n=${n})`);
