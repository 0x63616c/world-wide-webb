import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {performance} from 'node:perf_hooks';

// Isolated local workerd/D1. All token material is deliberately synthetic.
const root=fileURLToPath(new URL('../',import.meta.url));
const runtime=new Miniflare(convertV4MiniflareOptions({workers:[{
 name:'milestones-local',modules:[{type:'ESModule',path:`${root}crates/worker/build/index.js`},{type:'CompiledWasm',path:`${root}crates/worker/build/index_bg.wasm`}],compatibilityDate:'2026-11-04',
 ratelimits:Object.fromEntries(['API_NETWORK_BURST','AUTH_NETWORK_BURST','API_CREDENTIAL_BURST'].map((name,i)=>[name,{namespace_id:String(1400+i),simple:{limit:100000,period:60}}])),
 bindings:{APP_ATTEST_APP_ID:'TEAM123456.app.test.Folding',APP_ATTEST_ENVIRONMENT:'development',APP_ATTEST_BUNDLE_VERSIONS:'["1"]',WORKER_VERSION:'milestones-local',DEPLOYMENT:'staging',AUTH_ENCRYPTION_KEY_VERSION:'test-v1',AUTH_ENCRYPTION_KEYS:JSON.stringify({'test-v1':Buffer.alloc(32,7).toString('base64url')}),AUTH_NETWORK_HMAC_KEY:Buffer.alloc(32,8).toString('base64url')},
 d1Databases:{DB:'milestones-local'},queueProducers:{JOBS:'milestones-test-jobs',JOBS_DEAD:'milestones-test-dead'}
}]}));
after(()=>runtime.dispose());
const nil='00000000-0000-0000-0000-000000000000';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let op=90000;
let db;
async function setup(){
 if(db)return;
 db=await runtime.getD1Database('DB');
 for(const name of (await readdir(`${root}migrations`)).filter(n=>n.endsWith('.sql')).sort())
  for(const sql of (await readFile(`${root}migrations/${name}`,'utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
}
async function person(n,folds=0){
 const participant=uuid(n),device=uuid(n+1),epoch=uuid(n+2),session=`milestone-session-${n}`,token=createHash('sha256').update(`milestone-person-${n}`).digest(),time=Date.now();
 await db.batch([
  db.prepare("INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id,epoch_id,active_device_id) VALUES (?,?,'joined','none',0,?,?,?)").bind(participant,participant,nil,epoch,device),
  db.prepare('INSERT INTO participant_revisions VALUES (?,0)').bind(participant),
  db.prepare("INSERT INTO profiles VALUES (?, 'Folder',NULL,'approved','none')").bind(participant),
  db.prepare("INSERT INTO epochs VALUES (?,?,?,0,?,0,0,NULL)").bind(epoch,participant,device,nil),
  db.prepare("INSERT INTO sessions VALUES (?,?,?,'staging',?,?,?,?,0)").bind(session,participant,device,time,time,time+86400000,time+86400000),
  db.prepare('INSERT INTO access_tokens VALUES (?,?,?)').bind(createHash('sha256').update(token).digest(),session,time+86400000),
  db.prepare("INSERT INTO live_scores VALUES (?,0,?,'all',?,0)").bind(participant,nil,folds),
 ]);
 return {participant,device,epoch,headers:{Authorization:'Bearer '+token.toString('base64url'),'Content-Type':'application/json'}};
}
const request=(p,path,body,method='POST')=>runtime.dispatchFetch('https://api.example'+path,{method:body===undefined?'GET':method,headers:p?.headers??{},...(body===undefined?{}:{body:JSON.stringify(body)})});
const generation={revision:0,reset_id:nil};
const event=(p,n,time,transition=n%2?'open':'close')=>({schema_version:1,event_id:uuid(n+100000),device_id:p.device,sequence:n,generation,observed_at_ms:time,timezone_id:'UTC',transition,is_test:false,competition_epoch_id:p.epoch});
async function observations(p,events,disposition='accepted'){
 for(let start=0;start<events.length;start+=100)await db.batch(events.slice(start,start+100).map(e=>db.prepare('INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms) VALUES (?,?,?,?,?,?,?)').bind(p.participant,e.event_id,p.device,e.sequence,JSON.stringify(e),disposition,Date.now())));
}
async function jsonOK(response){assert.equal(response.status,200,await response.clone().text());return response.json();}

test('real Worker derives owner progress, keeps awards private and disables new featured selections',async()=>{
 await setup();
 const p=await person(100,100),viewer=await person(200);
 await observations(p,Array.from({length:100},(_,i)=>event(p,i+1,i*86400000+1234)));
 const own=await jsonOK(await request(p,'/v1/milestones'));
 assert.equal(own.progress.folds,100);assert.equal(own.progress.days_used,100);
 assert.equal(own.progress.next.length,1);assert.equal(own.progress.next[0].target,1000);
 assert.deepEqual(new Set(own.grants.map(g=>g.badge_id)),new Set(['folds_1','folds_100','days_7','days_30']));
 assert.ok(own.grants.every(g=>g.acknowledged===false));
 assert.equal(own.grants.find(g=>g.badge_id==='days_7').earned_at_ms,6*86400000+1234);
 assert.equal(own.grants.find(g=>g.badge_id==='days_30').earned_at_ms,29*86400000+1234);
 assert.equal((await request(null,'/v1/participants/'+p.participant)).status,401);
 for(const badge of ['folds_1000','folds_100',null]) {
  assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:badge},'PATCH')).status,404);
 }
 // Previously featured data must stay private even before any cleanup or client upgrade.
 await db.prepare('INSERT INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_100').run();
 const visible=await jsonOK(await request(viewer,'/v1/participants/'+p.participant));
 assert.deepEqual(Object.keys(visible.profile).sort(),['participant_id','nickname','avatar_id','folds','earned_badges','featured_badge_id'].sort());
 assert.equal(visible.profile.featured_badge_id,null);assert.deepEqual(visible.profile.earned_badges,[]);
 assert.ok(!JSON.stringify(visible).includes('earned_at_ms'));assert.ok(!JSON.stringify(visible).includes('days_used'));
 const ack={operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']};
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',ack));
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',ack));
 const again=await jsonOK(await request(p,'/v1/milestones'));
 assert.ok(again.grants.filter(g=>g.badge_id.startsWith('folds')).every(g=>g.acknowledged));
 assert.equal((await request(p,'/v1/milestones/acknowledgments',{...ack,operation_id:uuid(++op),badge_ids:['folds_1','folds_1']})).status,422);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation:{revision:1,reset_id:uuid(888)},badge_id:null},'PATCH')).status,404);
 await db.batch([db.prepare("UPDATE participants SET restriction='banned' WHERE participant_id=?").bind(p.participant),db.prepare('UPDATE participant_revisions SET revision=revision+1 WHERE participant_id=?').bind(p.participant)]);
 assert.equal((await request(viewer,'/v1/participants/'+p.participant)).status,404);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:null},'PATCH')).status,401);
});

test('bounded backfill resumes across causal boundaries and never returns partial awards',async()=>{
 await setup();const p=await person(300,639);
 const events=Array.from({length:640},(_,i)=>event(p,i+1,i*1000));
 // A deleted transition stays in causal replay but contributes no fold/day.
 await observations(p,events);
 await db.prepare('INSERT INTO deleted_observations VALUES (?,?,?)').bind(p.participant,events[256].event_id,Date.now()).run();
 for(let page=0;page<2;page++){
  const response=await request(p,'/v1/milestones');assert.equal(response.status,503);
  const state=await db.prepare('SELECT state,cursor_sequence FROM milestone_state WHERE participant_id=?').bind(p.participant).first();
  assert.equal(state.state,'building');assert.equal(state.cursor_sequence,(page+1)*256);
  assert.equal(await db.prepare('SELECT count(*) n FROM milestone_grants WHERE participant_id=?').bind(p.participant).first('n'),0);
 }
 const done=await jsonOK(await request(p,'/v1/milestones'));
 assert.equal(done.progress.folds,639);assert.equal(done.progress.days_used,1);
 assert.equal(done.progress.next[0].current,639);assert.equal(done.progress.next[0].target,1000);
 assert.equal(await db.prepare('SELECT count(*) n FROM milestone_counted_events WHERE participant_id=?').bind(p.participant).first('n'),639);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:'days_30'},'PATCH')).status,404);
});

test('entry deletion corrects profile awards atomically without re-awarding on retries',async()=>{
 await setup();const p=await person(400,100);
 const events=Array.from({length:100},(_,i)=>event(p,i+1,i*1000));await observations(p,events);
 await jsonOK(await request(p,'/v1/milestones'));
 await db.prepare('INSERT OR REPLACE INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_100').run();
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']}));
 const body={operation_id:uuid(++op),event_ids:[events[0].event_id],epoch_ids:[p.epoch]};
 await jsonOK(await request(p,'/v1/entry-deletions',body));await jsonOK(await request(p,'/v1/entry-deletions',body));
 const corrected=await jsonOK(await request(p,'/v1/milestones'));
 assert.equal(corrected.progress.folds,99);assert.equal(corrected.featured_badge_id,null);
 assert.deepEqual(corrected.grants.map(g=>g.badge_id),['folds_1']);assert.ok(corrected.grants[0].acknowledged);
 assert.equal(corrected.grants[0].earned_at_ms,events[1].observed_at_ms);
 assert.equal(await db.prepare("SELECT count(*) n FROM milestone_acknowledgments WHERE participant_id=? AND badge_id='folds_100'").bind(p.participant).first('n'),1);
});

async function signer(p){
 const hash=value=>createHash('sha256').update(value).digest();
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
 const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
 const keyID=hash(publicKey).toString('base64');
 await db.prepare("INSERT INTO attestation_keys(key_id,participant_id,device_id,deployment,public_key_sec1,counter,revoked,attestation_environment) VALUES (?,?,?,'staging',?,0,0,'development')").bind(keyID,p.participant,p.device,publicKey).run();
 let counter=0;
 const len=(major,n)=>Buffer.from(n<24?[(major<<5)|n]:[(major<<5)|24,n]);
 const bytes=b=>Buffer.concat([len(2,b.length),b]);
 const text=t=>{const b=Buffer.from(t);return Buffer.concat([len(3,b.length),b]);};
 return async(path,input,purpose='submit_events')=>{
  const challenge=await jsonOK(await request(p,'/v1/attestation/challenges',{purpose,device_id:p.device,key_id:keyID}));
  const body=JSON.stringify(input),binding=hash(Buffer.from(['Folding-v1','staging','POST',path,challenge.challenge_id,challenge.nonce,hash(body).toString('hex')].join('\n')));
  const category=Buffer.alloc(4);category.writeUInt32LE(3);
  const extensions=Buffer.concat([Buffer.from([0xa2]),text('validationCategory'),bytes(category),text('bundleVersion'),text('1')]);
  const header=Buffer.alloc(5);header[0]=0x80;header.writeUInt32BE(++counter,1);
  const auth=Buffer.concat([hash('TEAM123456.app.test.Folding'),header,extensions]);
  const signature=sign('sha256',hash(Buffer.concat([auth,binding])),pair.privateKey);
  const assertion=Buffer.concat([Buffer.from([0xa2]),text('signature'),bytes(signature),text('authenticatorData'),bytes(auth)]);
  return runtime.dispatchFetch('https://api.example'+path,{method:'POST',headers:{...p.headers,'X-Folding-Key-ID':keyID,'X-Folding-Challenge-ID':challenge.challenge_id,'X-Folding-Assertion':assertion.toString('base64url')},body});
 };
}

test('signed uploads advance milestones with scores; duplicates/quarantine do not; reset clears all reward state',async()=>{
 await setup();const p=await person(510,98),base=Date.now()-100000;
 await observations(p,Array.from({length:98},(_,i)=>event(p,i+1,base+i)));
 await jsonOK(await request(p,'/v1/milestones'));
 const send=await signer(p);
 const batch={schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events:[event(p,99,base+99),event(p,100,base+100)]};
 await jsonOK(await send('/v1/event-batches',batch));
 let own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,100);assert.equal(own.progress.days_used,1);assert.ok(own.grants.some(g=>g.badge_id==='folds_100'));
 await jsonOK(await send('/v1/event-batches',batch));
 await jsonOK(await send('/v1/event-batches',{...batch,operation_id:uuid(++op)}));
 await jsonOK(await send('/v1/event-batches',{...batch,operation_id:uuid(++op),events:[event(p,101,Date.now()+600000)]}));
 own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,100);
 await db.prepare('INSERT OR REPLACE INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_100').run();
 const board=await jsonOK(await request(p,'/v1/leaderboards?kind=all'));assert.equal(board.you.featured_badge_id,null);assert.ok(board.page.items.every(e=>e.featured_badge_id==null));
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']}));
 const nextGeneration={revision:1,reset_id:uuid(99999)};
 const reset={schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,generation:nextGeneration};
 await jsonOK(await send('/v1/resets',reset,'reset'));
 own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,0);assert.equal(own.progress.days_used,0);assert.deepEqual(own.grants,[]);assert.equal(own.featured_badge_id,null);assert.deepEqual(own.generation,nextGeneration);
 assert.equal(await db.prepare('SELECT count(*) n FROM milestone_acknowledgments WHERE participant_id=?').bind(p.participant).first('n'),0);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:null},'PATCH')).status,404);
});

test('late insertion moves a counted transition between UTC days without inventing a fold',async()=>{
 await setup();const p=await person(520),today=Math.floor(Date.now()/86400000);
 // Always cross the active UTC week boundary. Seed through ingestion so both
 // all-time and current-period scores exist before correcting a counted event.
 const day=today-(new Date(today*86400000).getUTCDay()+6)%7-1;
 const opening=event(p,1,day*86400000+1),closing=event(p,3,(day+1)*86400000+1,'close');
 const send=await signer(p);
 await jsonOK(await send('/v1/event-batches',{schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events:[opening,closing]}));
 const weekly=()=>db.prepare("SELECT s.folds FROM live_scores s JOIN periods w ON w.period_id=s.period_id WHERE s.participant_id=? AND w.kind='week' AND w.start_ms=?").bind(p.participant,(day+1)*86400000).first('folds');
 assert.equal(await weekly(),1);
 let own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.days_used,2);
 const late=event(p,2,day*86400000+2,'close');
 await jsonOK(await send('/v1/event-batches',{schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events:[late]}));
 own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,2);assert.equal(own.progress.days_used,1);
 assert.equal(await weekly(),0);
 const counted=(await db.prepare('SELECT event_id FROM milestone_counted_events WHERE participant_id=? ORDER BY event_id').bind(p.participant).all()).results.map(r=>r.event_id);
 assert.deepEqual(counted,[opening.event_id,late.event_id]);
});

test('100k retained folds backfill in bounded pages and keep profile reads and entry deletion usable',{timeout:120000},async()=>{
 await setup();const count=100000,p=await person(60001,count),base=(Math.floor(Date.now()/86400000)-100)*86400000;
 const seedStart=performance.now();
 // Seed the same retained events in bulk; per-row D1 RPC preparation dominated this test.
 for(let offset=0;offset<count;offset+=1000){
  const rows=Array.from({length:Math.min(1000,count-offset)},(_,i)=>{
   const index=offset+i;return event(p,index+1,base+Math.floor(index/2000)*86400000+(index%2000)*1000);
  });
  await db.prepare(`INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms)
   SELECT ?2,json_extract(value,'$.event_id'),?3,json_extract(value,'$.sequence'),value,'accepted',?4 FROM json_each(?1)`)
   .bind(JSON.stringify(rows),p.participant,p.device,Date.now()).run();
 }
 const seedMS=performance.now()-seedStart,backfillStart=performance.now();let pages=0,own;
 while(pages<400){
  const response=await request(p,'/v1/milestones');pages++;
  if(response.status===200){own=await response.json();break;}
  assert.equal(response.status,503,await response.clone().text());
  const state=await db.prepare('SELECT state,cursor_sequence FROM milestone_state WHERE participant_id=?').bind(p.participant).first();
  assert.equal(state.state,'building');assert.ok(state.cursor_sequence<=pages*256);
  assert.equal(await db.prepare('SELECT count(*) n FROM milestone_grants WHERE participant_id=?').bind(p.participant).first('n'),0);
 }
 const backfillMS=performance.now()-backfillStart;
 assert.equal(pages,Math.ceil(count/256));assert.equal(own.progress.folds,count);assert.equal(own.progress.days_used,50);assert.equal(own.grants.length,6);assert.equal(own.progress.next.length,0);
 const reads=[];
 for(let i=0;i<20;i++){const start=performance.now();await jsonOK(await request(p,'/v1/milestones'));reads.push(performance.now()-start);}
 reads.sort((a,b)=>a-b);
 console.log(JSON.stringify({experiment:'milestone-100k-local',folds:count,pages,seed_ms:Math.round(seedMS),backfill_ms:Math.round(backfillMS),owner_read_p95_ms:Math.round(reads[18])}));
 await db.prepare('INSERT OR REPLACE INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_10000').run();
 const deletion={operation_id:uuid(++op),event_ids:[event(p,1,base).event_id],epoch_ids:[p.epoch]};
 const start=performance.now();await jsonOK(await request(p,'/v1/entry-deletions',deletion));
 let after,correctionPages=0;
 while(correctionPages<400){
  const response=await request(p,'/v1/milestones');correctionPages++;
  if(response.status===200){after=await response.json();break;}
  assert.equal(response.status,503,await response.clone().text());
  // Retain the choice privately while the corrected projection is hidden.
  assert.equal(await db.prepare('SELECT badge_id FROM milestone_featured WHERE participant_id=?').bind(p.participant).first('badge_id'),'folds_10000');
 }
 assert.equal(correctionPages,Math.ceil(count/256));
 assert.equal(after.progress.folds,count-1);assert.equal(after.grants.length,6);assert.equal(after.featured_badge_id,'folds_10000');
 assert.equal(after.grants.find(g=>g.badge_id==='folds_1').earned_at_ms,base+1000);
 console.log(JSON.stringify({experiment:'milestone-100k-deletion-local',duration_ms:Math.round(performance.now()-start)}));
});

test('phone transfer preserves awards and selection while fencing old-phone uploads',async()=>{
 await setup();const p=await person(631,100),base=Date.now()-100000;
 await observations(p,Array.from({length:100},(_,i)=>event(p,i+1,base+i)));
 const before=await jsonOK(await request(p,'/v1/milestones'));
 await db.prepare('INSERT OR REPLACE INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_100').run();
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']}));
 const token=Buffer.alloc(32,240),time=Date.now(),device=uuid(70001),session='milestone-transfer-session';
 await db.batch([
  db.prepare("INSERT INTO sessions VALUES (?,?,?,'staging',?,?,?,?,0)").bind(session,p.participant,device,time,time,time+86400000,time+86400000),
  db.prepare('INSERT INTO access_tokens VALUES (?,?,?)').bind(createHash('sha256').update(token).digest(),session,time+86400000),
 ]);
 const other={...p,device,headers:{...p.headers,Authorization:'Bearer '+token.toString('base64url')}};
 const send=await signer(other);
 const transferred=await jsonOK(await send('/v1/enrollment/transfer',{operation_id:uuid(++op),from_epoch_id:p.epoch,device_id:device,generation},'transfer'));
 other.epoch=transferred.enrollment.epoch_id;
 let own=await jsonOK(await request(other,'/v1/milestones'));
 assert.equal(own.progress.folds,100);assert.equal(own.featured_badge_id,'folds_100');assert.ok(own.grants.every(g=>g.acknowledged));assert.deepEqual(own.grants.map(g=>g.earned_at_ms),before.grants.map(g=>g.earned_at_ms));
 const oldSend=await signer(p);
 assert.equal((await oldSend('/v1/event-batches',{schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events:[event(p,101,Date.now())]})).status,409);
 await jsonOK(await send('/v1/event-batches',{schema_version:1,operation_id:uuid(++op),epoch_id:other.epoch,events:[{...event(other,1,Date.now()),event_id:uuid(72001)}]}));
 own=await jsonOK(await request(other,'/v1/milestones'));assert.equal(own.progress.folds,101);assert.equal(own.featured_badge_id,'folds_100');
});

test('reset interrupts partial backfill and prevents erased awards returning',async()=>{
 await setup();const p=await person(632,640),base=Date.now()-100000;
 await observations(p,Array.from({length:640},(_,i)=>event(p,i+1,base+i)));
 assert.equal((await request(p,'/v1/milestones')).status,503);
 const send=await signer(p),next={revision:1,reset_id:uuid(71001)};
 await jsonOK(await send('/v1/resets',{schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,generation:next},'reset'));
 const own=await jsonOK(await request(p,'/v1/milestones'));
 assert.deepEqual(own.generation,next);assert.equal(own.progress.folds,0);assert.deepEqual(own.grants,[]);
 assert.equal(await db.prepare('SELECT count(*) n FROM milestone_counted_events WHERE participant_id=?').bind(p.participant).first('n'),0);
});

test('account deletion immediately removes ready and partially built badge projections',async()=>{
 await setup();const viewer=await person(633);
 for(const [n,count] of [[634,100],[635,640]]){
  const p=await person(n,count),base=Date.now()-100000;
  await observations(p,Array.from({length:count},(_,i)=>event(p,i+1,base+i)));
  const initial=await request(p,'/v1/milestones');assert.equal(initial.status,count===100?200:503);
  if(count===100)await db.prepare('INSERT OR REPLACE INTO milestone_featured VALUES (?,?)').bind(p.participant,'folds_100').run();
  const token=Buffer.alloc(32,n%200),time=Date.now();
  await db.prepare('INSERT INTO reauthentications VALUES (?,?,?,?,?,?,?,?,?,0)').bind(createHash('sha256').update(token).digest(),p.participant,`milestone-session-${n}`,uuid(++op),'synthetic',Buffer.alloc(32),Buffer.alloc(32),'test-v1',time+300000).run();
  const response=await request(p,'/v1/account/delete',{operation_id:uuid(++op),reauthentication_token:token.toString('base64url')});
  assert.equal(response.status,202,await response.clone().text());
  assert.equal((await request(viewer,'/v1/participants/'+p.participant)).status,404);
  assert.equal((await request(p,'/v1/milestones')).status,401);
  for(const table of ['milestone_state','milestone_counted_events','milestone_days','milestone_grants','milestone_featured','milestone_acknowledgments'])assert.equal(await db.prepare(`SELECT count(*) n FROM ${table} WHERE participant_id=?`).bind(p.participant).first('n'),0,table);
 }
});

test('new capability stays unadvertised without deployment acceptance evidence',async()=>{
 const response=await runtime.dispatchFetch('https://api.example/v1/capabilities');
 const value=await jsonOK(response);assert.equal(value.contract_version,1);assert.equal(value.worker_version,'milestones-local');assert.ok(!value.capabilities.includes('profiles.milestones'));
});

test('pre-join history brings 18 accepted folds to the original 59 without rewriting or double-counting',async()=>{
 await setup();const p=await person(91000),send=await signer(p);
 const joined=Date.now()-100000;
 await db.prepare('UPDATE epochs SET joined_at_ms=?,issued_at_ms=? WHERE epoch_id=?').bind(joined,joined,p.epoch).run();
 const originals=Array.from({length:41},(_,i)=>({...event(p,i+1,joined-1000+i),competition_epoch_id:null}));
 const live=Array.from({length:18},(_,i)=>event(p,42+i,joined+i));
 const make=events=>({schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events});
 await jsonOK(await send('/v1/event-batches',make(live)));
 assert.equal((await jsonOK(await request(p,'/v1/milestones'))).progress.folds,18);
 const me=await jsonOK(await request(p,'/v1/me'));assert.equal(me.enrollment.history_import_before_ms,joined);
 assert.equal((await send('/v1/event-batches',make(originals))).status,422);
 const batch=make(originals),first=await jsonOK(await send('/v1/history-batches',batch));
 assert.ok(first.events.every(e=>e.disposition==='accepted'));
 assert.deepEqual(await jsonOK(await send('/v1/history-batches',batch)),first);
 const duplicate=await jsonOK(await send('/v1/history-batches',make(originals)));
 assert.ok(duplicate.events.every(e=>e.disposition==='duplicate'));
 const own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,59);
 const board=await jsonOK(await request(p,'/v1/leaderboards?kind=all'));assert.equal(board.you.folds,59);
 const saved=JSON.parse(await db.prepare('SELECT event_json FROM observations WHERE participant_id=? AND event_id=?').bind(p.participant,originals[0].event_id).first('event_json'));
 assert.equal(saved.competition_epoch_id,null);assert.equal(saved.event_id,originals[0].event_id);
 assert.equal((await send('/v1/history-batches',make([{...originals[0],observed_at_ms:joined-2000}]))).status,409);
 const invalid=[{...event(p,100,joined+1),competition_epoch_id:null},{...event(p,101,joined-10),is_test:true},event(p,102,joined-10)];
 const rejected=await jsonOK(await send('/v1/history-batches',make(invalid)));
 assert.ok(rejected.events.every(e=>e.disposition==='rejected'));
 assert.equal((await jsonOK(await request(p,'/v1/milestones'))).progress.folds,59);
 // The caller must still own the currently active tracking phone/epoch.
 await db.prepare('UPDATE participants SET active_device_id=? WHERE participant_id=?').bind(uuid(91999),p.participant).run();
 assert.equal((await send('/v1/history-batches',make(originals))).status,409);
});

test('badge pushes are opt-in, group new awards, suppress viewed awards and do not alert for the old collection',async()=>{
 await setup();const p=await person(93000,100);
 await observations(p,Array.from({length:100},(_,i)=>event(p,i+1,i*86400000+1234)));
 await jsonOK(await request(p,'/v1/milestones'));
 const count=async(person,state)=>db.prepare('SELECT count(*) n FROM badge_notification_jobs WHERE participant_id=? AND state=?').bind(person.participant,state).first('n');
 assert.equal(await count(p,'pending'),0);
 const prefs={weekly:'off',monthly:'off',home_timezone:'UTC',locale:'en',badge_earned:true};
 const set=async(person,value)=>jsonOK(await request(person,'/v1/preferences',{operation_id:uuid(++op),preferences:value},'PUT'));
 assert.equal((await set(p,prefs)).preferences.badge_earned,true);
 assert.equal(await count(p,'pending'),0);assert.equal(await count(p,'suppressed'),4);
 const next=await person(94000,100);await set(next,prefs);
 await observations(next,Array.from({length:100},(_,i)=>event(next,i+1,i*86400000+1234)));
 const own=await jsonOK(await request(next,'/v1/milestones'));
 assert.equal(await count(next,'pending'),4);
 const groups=await db.prepare("SELECT participant_id,generation_revision,generation_id,delivery_id,count(*) n FROM badge_notification_jobs WHERE participant_id=? AND state='pending' GROUP BY participant_id,generation_revision,generation_id,delivery_id").bind(next.participant).all();
 assert.equal(groups.results.length,1);assert.equal(groups.results[0].n,4);
 await jsonOK(await request(next,'/v1/milestones'));assert.equal(await count(next,'pending'),4);
 await jsonOK(await request(next,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:own.grants.map(g=>g.badge_id)}));
 assert.equal(await count(next,'pending'),0);assert.equal(await count(next,'suppressed'),4);
 await set(next,{...prefs,badge_earned:false});await set(next,prefs);
 assert.equal(await count(next,'pending'),0);
 const fresh=await person(95000,1);await set(fresh,prefs);
 await observations(fresh,[event(fresh,1,Date.now()-1000)]);
 await jsonOK(await request(fresh,'/v1/milestones'));assert.equal(await count(fresh,'pending'),1);
 await set(fresh,{...prefs,badge_earned:false});assert.equal(await count(fresh,'pending'),0);
 await db.prepare('DELETE FROM participants WHERE participant_id=?').bind(fresh.participant).run();
 assert.equal(await db.prepare('SELECT count(*) n FROM badge_notification_jobs WHERE participant_id=?').bind(fresh.participant).first('n'),0);
 assert.equal((await request({headers:{'Content-Type':'application/json'}},'/v1/preferences',{operation_id:uuid(++op),preferences:prefs},'PUT')).status,401);
});


test('blocking anonymizes live and frozen ranks and denies direct profiles without reranking',async()=>{
 await setup();const viewer=await person(194000,10),target=await person(195000,200);
 await db.prepare("UPDATE profiles SET nickname='Visible name' WHERE participant_id=?").bind(target.participant).run();
 await observations(target,Array.from({length:200},(_,i)=>event(target,i+1,Date.now()-100000+i)));
 const initial=await jsonOK(await request(viewer,'/v1/leaderboards?kind=all'));
 const prior=initial.page.items.find(row=>row.participant_id===target.participant);assert.ok(prior);
 const block={operation_id:uuid(++op)};
 await jsonOK(await request(viewer,'/v1/blocks/'+target.participant,block,'PUT'));
 await jsonOK(await request(viewer,'/v1/blocks/'+target.participant,block,'PUT'));
 const masked=await jsonOK(await request(viewer,'/v1/leaderboards?kind=all'));
 const row=masked.page.items.find(row=>row.participant_id===target.participant);
 assert.equal(masked.population,initial.population);assert.equal(row.rank,prior.rank);assert.equal(row.folds,prior.folds);
 assert.equal(row.blocked,true);assert.equal(row.nickname,'Blocked player');assert.equal(row.avatar_id,null);assert.equal(row.featured_badge_id,null);
 assert.equal((await request(viewer,'/v1/participants/'+target.participant)).status,404);
 const list=await jsonOK(await request(viewer,'/v1/blocks'));assert.ok(list.items.some(r=>r.participant_id===target.participant));
 const period='week:blocked-fixture';
 await db.prepare("INSERT INTO periods(period_id,kind,start_ms,end_ms,cutoff_ms,state,published_version,population) VALUES (?,'week',1,2,3,'finalized',1,2)").bind(period).run();
 await db.prepare("INSERT INTO results VALUES (?,1,?,0,?,0,200,1,2,100,'gold')").bind(period,target.participant,nil).run();
 const frozen=await jsonOK(await request(viewer,'/v1/leaderboards?kind=week&period_id='+encodeURIComponent(period)));
 assert.equal(frozen.population,2);assert.equal(frozen.page.items[0].rank,1);assert.equal(frozen.page.items[0].blocked,true);assert.equal(frozen.page.items[0].nickname,'Blocked player');
 await jsonOK(await request(viewer,'/v1/blocks/'+target.participant,{operation_id:uuid(++op)},'DELETE'));
 const unmasked=await jsonOK(await request(viewer,'/v1/leaderboards?kind=all'));
 assert.equal(unmasked.page.items.find(r=>r.participant_id===target.participant).nickname,'Visible name');
 assert.equal((await request(viewer,'/v1/participants/'+target.participant)).status,200);
});

test('nonjoined and restricted accounts can delete; polling exposes cleanup failures and retry recovery',async()=>{
 await setup();
 for (const [n,membership,restriction] of [[96000,'not_joined','none'],[97000,'joined','banned']]) {
  const p=await person(n),token=createHash("sha256").update(`privacy-${n}`).digest(),time=Date.now();
  await db.prepare('UPDATE participants SET membership=?,restriction=? WHERE participant_id=?').bind(membership,restriction,p.participant).run();
  await db.prepare('INSERT INTO reauthentications VALUES (?,?,?,?,?,?,?,?,?,0)').bind(createHash('sha256').update(token).digest(),p.participant,`milestone-session-${n}`,uuid(++op),'synthetic',Buffer.alloc(32),Buffer.alloc(32),'test-v1',time+300000).run();
  const operation=uuid(++op);
  const response=await request(p,'/v1/account/delete',{operation_id:operation,reauthentication_token:token.toString('base64url')});
  assert.equal(response.status,202,await response.clone().text());const receipt=await response.json();
  const poll=()=>runtime.dispatchFetch('https://api.example/v1/operations/'+operation,{headers:{Authorization:'Deletion '+receipt.polling_token}});
  assert.equal((await jsonOK(await poll())).state,'pending');
  await db.prepare("INSERT INTO external_retry_state VALUES (?,'account_revocation',?,'failed',12,0,?,'external_failure')").bind(uuid(++op),operation,time).run();
  let status=await jsonOK(await poll());assert.equal(status.state,'failed');assert.equal(status.error_code,'cleanup_requires_attention');
  // The existing operator retry changes state; status polling alone never resets exhaustion.
  await db.prepare("UPDATE external_retry_state SET state='pending',attempts=0 WHERE work_key=?").bind(operation).run();
  status=await jsonOK(await poll());assert.equal(status.state,'pending');assert.equal(status.error_code,'cleanup_retrying');
  await db.prepare("DELETE FROM external_retry_state WHERE work_key=?").bind(operation).run();
  await db.prepare("UPDATE deletion_operations SET state='completed' WHERE operation_id=?").bind(operation).run();
  status=await jsonOK(await poll());assert.equal(status.state,'completed');assert.equal(status.error_code,null);
 }
});
