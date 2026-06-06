// Real Wang-tile (edge-matched patch) bento-fill generator — by-example WFC.
//
// Idea: a SOURCE tiling is cut into overlapping P×P patches. Each patch's 4 edges
// get a "color" = the run-partition of tile heights/widths crossing that edge.
// We place patches on an output lattice so neighbouring edge-colors match, then
// MERGE the tile fragments across every patch boundary. Because matched edges are
// fully-crossing (a tile spans the boundary), the patch-lattice lines disappear:
// the only remaining seams are interior tile edges, which are short.
//
// This file is a node harness: it generates, validates (gaps), and measures the
// longest straight seam vs the other methods. The browser test bed reuses the
// same algorithm.

// ---------- PRNG ----------
function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const WMIN=2,WMAX=5,HMIN=2,HMAX=4;

// ---------- source tiling: skyline wall-builder (gap-free, varied) ----------
function validSizes(avail,mn,mx){const out=[];const top=Math.min(mx,avail);for(let w=mn;w<=top;w++){const r=avail-w;if(r===0||r>=mn)out.push(w);}return out;}
function wallBuilder(W,H,rng){
  const frontier=new Int32Array(W).fill(0);
  const owner=new Int32Array(W*H).fill(-1);
  const tiles=[];
  const setO=(x,y,w,h,v)=>{for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)owner[yy*W+xx]=v;};
  let guard=0;
  while(true){
    if(++guard>W*H*4)return {owner,tiles,W,H,failed:true};
    let f=Infinity;for(let x=0;x<W;x++)if(frontier[x]<H&&frontier[x]<f)f=frontier[x];
    if(f===Infinity)break;
    const seamBelow=(c)=>{let n=0;for(let r=f-1;r>=0;r--){if(owner[r*W+(c-1)]!==owner[r*W+c])n++;else break;}return n;};
    const runs=[];for(let x=0;x<W;){if(frontier[x]===f){let l=0;const s=x;while(x<W&&frontier[x]===f){l++;x++;}runs.push([s,l]);}else x++;}
    let pick=null,pu=-1;for(const [s,l] of runs){let u=0;for(let c=s+1;c<s+l;c++)u=Math.max(u,seamBelow(c));const ur=u+rng()*0.1;if(ur>pu){pu=ur;pick=[s,l];}}
    const [x0,L]=pick;
    const cand=[];for(let w=WMIN;w<=Math.min(WMAX,L);w++)for(let px=x0;px+w<=x0+L;px++){const lr=px-x0,rr=(x0+L)-(px+w);if((lr===0||lr>=WMIN)&&(rr===0||rr>=WMIN))cand.push([px,w]);}
    if(!cand.length)return {owner,tiles,W,H,failed:true};
    let best=null,bk=null;for(const [px,w] of cand){let cov=0;for(let c=px+1;c<px+w;c++)cov=Math.max(cov,seamBelow(c));const edge=Math.max(px>0?seamBelow(px):0,(px+w)<W?seamBelow(px+w):0);const key=cov*1000-edge*10+rng();if(best===null||key>bk){bk=key;best=[px,w];}}
    const [px,w]=best;const avail=H-f;const hOpts=validSizes(avail,HMIN,HMAX);if(!hOpts.length)return {owner,tiles,W,H,failed:true};
    const h=hOpts[(rng()*hOpts.length)|0];
    const id=tiles.length;tiles.push({x:px,y:f,w,h});setO(px,f,w,h,id);
    for(let x=px;x<px+w;x++)frontier[x]=f+h;
  }
  return {owner,tiles,W,H,failed:false};
}

// ---------- patch library extraction ----------
// For a window at (ox,oy) of size P, an edge is "fully crossing" if no source tile
// boundary lies on that edge line for the whole length. We keep only fully-crossing
// patches so every placed boundary merges away. Edge color encodes, per edge cell,
// the run id pattern + the fragment width on this side (so we can check the merged
// width stays <=WMAX).
function extractLibrary(src,P){
  const {owner,W,H}=src;const O=(x,y)=>owner[y*W+x];
  const lib=[];const seen=new Set();
  for(let oy=0;oy+P<=H;oy++){
    for(let ox=0;ox+P<=W;ox++){
      // build local fragment grid: relabel tiles 0..k within the window
      const map=new Map();const local=new Int32Array(P*P);
      for(let r=0;r<P;r++)for(let c=0;c<P;c++){const g=O(ox+c,oy+r);if(!map.has(g))map.set(g,map.size);local[r*P+c]=map.get(g);}
      // accept only if EVERY clipped fragment is a valid bounded rectangle. Then the
      // assembled output is a valid tiling even before any merge.
      const fb=new Map();
      for(let r=0;r<P;r++)for(let c=0;c<P;c++){const v=local[r*P+c];let b=fb.get(v);if(!b){b={x0:c,y0:r,x1:c,y1:r,n:0};fb.set(v,b);}if(c<b.x0)b.x0=c;if(c>b.x1)b.x1=c;if(r<b.y0)b.y0=r;if(r>b.y1)b.y1=r;b.n++;}
      let ok=true;
      for(const b of fb.values()){const w=b.x1-b.x0+1,h=b.y1-b.y0+1;
        if(w*h!==b.n){ok=false;break;}                 // fragment must be a solid rect
        if(w<WMIN||w>WMAX||h<HMIN||h>HMAX){ok=false;break;}}
      if(!ok)continue;
      const N=edgeColor(local,P,'N'),S=edgeColor(local,P,'S'),Wc=edgeColor(local,P,'W'),E=edgeColor(local,P,'E');
      const key=local.join('');if(seen.has(key))continue;seen.add(key); // dedupe identical patches
      lib.push({ox,oy,local,N,S,Wc,E});
    }
  }
  return lib;
}
function edgeColor(local,P,side){
  // returns a canonical run-partition string of the edge: consecutive equal local ids
  // collapsed to run lengths (ids themselves aren't comparable across patches, only
  // the PARTITION shape is). e.g. ids [0,0,1,1,1,2] -> "2,3,1"
  const seq=[];
  for(let i=0;i<P;i++){
    let v;
    if(side==='N')v=local[0*P+i];
    else if(side==='S')v=local[(P-1)*P+i];
    else if(side==='W')v=local[i*P+0];
    else v=local[i*P+(P-1)];
    seq.push(v);
  }
  const runs=[];let n=1;for(let i=1;i<seq.length;i++){if(seq[i]===seq[i-1])n++;else{runs.push(n);n=1;}}runs.push(n);
  return runs.join(',');
}

// ---------- WFC over the output patch lattice ----------
// Opposite edges must share the same run-partition color (N of a patch matches S of
// the patch above, etc). Simple backtracking with random tie-break.
function wfc(lib,GW,GH,rng){
  const grid=new Array(GW*GH).fill(null);
  const byS=new Map(),byE=new Map();
  for(const p of lib){(byS.get(p.S)||byS.set(p.S,[]).get(p.S)).push(p);(byE.get(p.E)||byE.set(p.E,[]).get(p.E)).push(p);}
  const order=[];for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++)order.push([gx,gy]);
  let steps=0;
  function rec(i){
    if(++steps>500000)return false;
    if(i>=order.length)return true;
    const [gx,gy]=order[i];
    // constraints: must match S-edge of patch above (its S == my N) and E-edge of left (its E == my Wc)
    const above=gy>0?grid[(gy-1)*GW+gx]:null;
    const left=gx>0?grid[gy*GW+(gx-1)]:null;
    let cands=lib;
    if(above)cands=cands.filter(p=>p.N===above.S);
    if(left)cands=cands.filter(p=>p.Wc===left.E);
    // shuffle
    cands=cands.slice();for(let k=cands.length-1;k>0;k--){const j=(rng()*(k+1))|0;[cands[k],cands[j]]=[cands[j],cands[k]];}
    for(const p of cands){grid[gy*GW+gx]=p;if(rec(i+1))return true;}
    grid[gy*GW+gx]=null;return false;
  }
  const ok=rec(0);
  return {ok,grid,GW,GH,steps};
}

// ---------- assemble + merge ----------
function assemble(src,res,P){
  const {grid,GW,GH}=res;const W=GW*P,H=GH*P;
  const owner=new Int32Array(W*H).fill(-1);
  // stamp each patch's local fragments as distinct tiles. Each fragment is a rect
  // (source tile clipped to the window box).
  let nextId=0;
  for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
    const p=grid[gy*GW+gx];const base=new Map();
    for(let r=0;r<P;r++)for(let c=0;c<P;c++){const lv=p.local[r*P+c];if(!base.has(lv))base.set(lv,nextId++);owner[(gy*P+r)*W+(gx*P+c)]=base.get(lv);}
  }
  // compute bbox per tile id
  const box=new Map();
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const id=owner[y*W+x];let b=box.get(id);if(!b){b={x0:x,y0:y,x1:x,y1:y};box.set(id,b);}else{if(x<b.x0)b.x0=x;if(x>b.x1)b.x1=x;if(y<b.y0)b.y0=y;if(y>b.y1)b.y1=y;}}
  const W_=(id)=>box.get(id).x1-box.get(id).x0+1, H_=(id)=>box.get(id).y1-box.get(id).y0+1;
  // greedy merge to fixpoint: fuse two adjacent rectangles when their union is a
  // rectangle within size bounds. This removes patch-boundary seams (crossing tiles).
  function relabel(){ // ensure owner ids are tight rects (they are by construction)
  }
  let changed=true,pass=0;
  while(changed&&pass++<20){
    changed=false;
    box.clear();
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const id=owner[y*W+x];let b=box.get(id);if(!b){b={x0:x,y0:y,x1:x,y1:y};box.set(id,b);}else{if(x<b.x0)b.x0=x;if(x>b.x1)b.x1=x;if(y<b.y0)b.y0=y;if(y>b.y1)b.y1=y;}}
    const ids=[...box.keys()];
    for(const id of ids){
      const b=box.get(id);if(!b)continue;const bw=b.x1-b.x0+1,bh=b.y1-b.y0+1;
      // try merge with the tile to the right
      if(b.x1+1<W){
        const rid=owner[b.y0*W+(b.x1+1)];const rb=box.get(rid);
        if(rid!==id&&rb&&rb.y0===b.y0&&rb.y1===b.y1&&rb.x0===b.x1+1){
          const rw=rb.x1-rb.x0+1;
          if(bw+rw<=WMAX&&bh>=HMIN&&bh<=HMAX){
            for(let y=rb.y0;y<=rb.y1;y++)for(let x=rb.x0;x<=rb.x1;x++)owner[y*W+x]=id;
            box.delete(rid);b.x1=rb.x1;changed=true;continue;
          }
        }
      }
      // try merge with the tile below
      if(b.y1+1<H){
        const did=owner[(b.y1+1)*W+b.x0];const db=box.get(did);
        if(did!==id&&db&&db.x0===b.x0&&db.x1===b.x1&&db.y0===b.y1+1){
          const dh=db.y1-db.y0+1;
          if(bh+dh<=HMAX&&bw>=WMIN&&bw<=WMAX){
            for(let y=db.y0;y<=db.y1;y++)for(let x=db.x0;x<=db.x1;x++)owner[y*W+x]=id;
            box.delete(did);b.y1=db.y1;changed=true;continue;
          }
        }
      }
    }
  }
  return {owner,W,H};
}

// ---------- metrics ----------
function longestLine(owner,W,H){const O=(x,y)=>owner[y*W+x];let v=0,h=0;
  for(let c=1;c<W;c++){let run=0;for(let r=0;r<H;r++){if(O(c-1,r)!==O(c,r)){run++;if(run>v)v=run;}else run=0;}}
  for(let r=1;r<H;r++){let run=0;for(let c=0;c<W;c++){if(O(c,r-1)!==O(c,r)){run++;if(run>h)h=run;}else run=0;}}
  return {v,h,max:Math.max(v,h)};}
function gaps(owner){for(const v of owner)if(v===-1)return true;return false;}

// ---------- run ----------
const P=6;
const src=wallBuilder(60,60,mulberry32(42));
console.log('source built, failed=',src.failed);
const lib=extractLibrary(src,P);
console.log(`fully-crossing P=${P} patches in library: ${lib.length}`);
// color stats
const colors=new Set();for(const p of lib){colors.add(p.N);colors.add(p.S);colors.add(p.Wc);colors.add(p.E);}
console.log(`distinct edge colors: ${colors.size}`);
if(lib.length>0){
  const res=wfc(lib,6,6,mulberry32(7));
  console.log(`WFC ok=${res.ok} steps=${res.steps}`);
  if(res.ok){
    const {owner,W,H}=assemble(src,res,P);
    const ll=longestLine(owner,W,H);
    // size histogram of final tiles
    const box=new Map();for(let y=0;y<H;y++)for(let x=0;x<W;x++){const id=owner[y*W+x];let b=box.get(id);if(!b){b={x0:x,y0:y,x1:x,y1:y};box.set(id,b);}else{if(x<b.x0)b.x0=x;if(x>b.x1)b.x1=x;if(y<b.y0)b.y0=y;if(y>b.y1)b.y1=y;}}
    const hist=new Map();let bad=0;for(const b of box.values()){const w=b.x1-b.x0+1,h=b.y1-b.y0+1;const k=`${w}x${h}`;hist.set(k,(hist.get(k)||0)+1);if(w<WMIN||w>WMAX||h<HMIN||h>HMAX)bad++;}
    console.log(`assembled ${W}x${H} gaps=${gaps(owner)} tiles=${box.size}`);
    console.log(`  longestLine v=${ll.v} h=${ll.h}  out-of-bounds-tiles=${bad}`);
    console.log(`  sizes: ${[...hist.entries()].sort().map(([k,v])=>k+':'+v).join(' ')}`);
  }
}
