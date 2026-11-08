import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

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
 const participant=uuid(n),device=uuid(n+1),epoch=uuid(n+2),session=`milestone-session-${n}`,token=Buffer.alloc(32,n%250+1),time=Date.now();
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

test('real Worker derives owner progress, exposes a public allowlist and persists one featured award',async()=>{
 await setup();
 const p=await person(100,100),viewer=await person(200);
 await observations(p,Array.from({length:100},(_,i)=>event(p,i+1,i*86400000)));
 const own=await jsonOK(await request(p,'/v1/milestones'));
 assert.equal(own.progress.folds,100);assert.equal(own.progress.days_used,100);
 assert.equal(own.progress.next.length,1);assert.equal(own.progress.next[0].target,1000);
 assert.deepEqual(new Set(own.grants.map(g=>g.badge_id)),new Set(['folds_1','folds_100','days_7','days_30']));
 assert.ok(own.grants.every(g=>g.acknowledged===false));
 assert.equal((await request(null,'/v1/participants/'+p.participant)).status,401);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:'folds_1000'},'PATCH')).status,422);
 const selection={operation_id:uuid(++op),generation,badge_id:'folds_100'};
 const selected=await jsonOK(await request(p,'/v1/profile/badge',selection,'PATCH'));
 assert.equal(selected.featured_badge_id,'folds_100');
 assert.deepEqual(await jsonOK(await request(p,'/v1/profile/badge',selection,'PATCH')),selected);
 assert.equal((await request(p,'/v1/profile/badge',{...selection,badge_id:'folds_1'},'PATCH')).status,409);
 const visible=await jsonOK(await request(viewer,'/v1/participants/'+p.participant));
 assert.deepEqual(Object.keys(visible.profile).sort(),['participant_id','nickname','avatar_id','folds','earned_badges','featured_badge_id'].sort());
 assert.equal(visible.profile.featured_badge_id,'folds_100');
 assert.ok(!JSON.stringify(visible).includes('earned_at_ms'));assert.ok(!JSON.stringify(visible).includes('days_used'));
 const ack={operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']};
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',ack));
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',ack));
 const again=await jsonOK(await request(p,'/v1/milestones'));
 assert.ok(again.grants.filter(g=>g.badge_id.startsWith('folds')).every(g=>g.acknowledged));
 assert.equal((await request(p,'/v1/milestones/acknowledgments',{...ack,operation_id:uuid(++op),badge_ids:['folds_1','folds_1']})).status,422);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation:{revision:1,reset_id:uuid(888)},badge_id:null},'PATCH')).status,409);
 await db.batch([db.prepare("UPDATE participants SET restriction='banned' WHERE participant_id=?").bind(p.participant),db.prepare('UPDATE participant_revisions SET revision=revision+1 WHERE participant_id=?').bind(p.participant)]);
 assert.equal((await request(viewer,'/v1/participants/'+p.participant)).status,404);
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
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:'days_30'},'PATCH')).status,422);
});

test('entry deletion corrects profile awards atomically without re-awarding on retries',async()=>{
 await setup();const p=await person(400,100);
 const events=Array.from({length:100},(_,i)=>event(p,i+1,i*1000));await observations(p,events);
 await jsonOK(await request(p,'/v1/milestones'));
 await jsonOK(await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:'folds_100'},'PATCH'));
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']}));
 const body={operation_id:uuid(++op),event_ids:[events[0].event_id],epoch_ids:[p.epoch]};
 await jsonOK(await request(p,'/v1/entry-deletions',body));await jsonOK(await request(p,'/v1/entry-deletions',body));
 const corrected=await jsonOK(await request(p,'/v1/milestones'));
 assert.equal(corrected.progress.folds,99);assert.equal(corrected.featured_badge_id,null);
 assert.deepEqual(corrected.grants.map(g=>g.badge_id),['folds_1']);assert.ok(corrected.grants[0].acknowledged);
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
 await jsonOK(await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:'folds_100'},'PATCH'));
 const board=await jsonOK(await request(p,'/v1/leaderboards?kind=all'));assert.equal(board.you.featured_badge_id,'folds_100');
 await jsonOK(await request(p,'/v1/milestones/acknowledgments',{operation_id:uuid(++op),generation,badge_ids:['folds_1','folds_100']}));
 const nextGeneration={revision:1,reset_id:uuid(99999)};
 const reset={schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,generation:nextGeneration};
 await jsonOK(await send('/v1/resets',reset,'reset'));
 own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,0);assert.equal(own.progress.days_used,0);assert.deepEqual(own.grants,[]);assert.equal(own.featured_badge_id,null);assert.deepEqual(own.generation,nextGeneration);
 assert.equal(await db.prepare('SELECT count(*) n FROM milestone_acknowledgments WHERE participant_id=?').bind(p.participant).first('n'),0);
 assert.equal((await request(p,'/v1/profile/badge',{operation_id:uuid(++op),generation,badge_id:null},'PATCH')).status,409);
});

test('late insertion moves a counted transition between UTC days without inventing a fold',async()=>{
 await setup();const p=await person(520,2),day=Math.floor(Date.now()/86400000)-2;
 const opening=event(p,1,day*86400000+1),closing=event(p,3,(day+1)*86400000+1,'close');
 await observations(p,[opening,closing]);
 let own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.days_used,2);
 const send=await signer(p),late=event(p,2,day*86400000+2,'close');
 await jsonOK(await send('/v1/event-batches',{schema_version:1,operation_id:uuid(++op),epoch_id:p.epoch,events:[late]}));
 own=await jsonOK(await request(p,'/v1/milestones'));assert.equal(own.progress.folds,2);assert.equal(own.progress.days_used,1);
 const counted=(await db.prepare('SELECT event_id FROM milestone_counted_events WHERE participant_id=? ORDER BY event_id').bind(p.participant).all()).results.map(r=>r.event_id);
 assert.deepEqual(counted,[opening.event_id,late.event_id]);
});
