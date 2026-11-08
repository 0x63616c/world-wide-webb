import { generateKeyPairSync,sign,verify,createHash,createDecipheriv } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Local workerd only. No remote binding, account identifier, token, or deploy command.
const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "folding-local",
  modules: [
    { type: "ESModule", path: `${root}crates/worker/build/index.js` },
    { type: "CompiledWasm", path: `${root}crates/worker/build/index_bg.wasm` },
  ],
  compatibilityDate: "2026-11-04",
  d1Databases: { DB: "folding-local-transaction-experiment" },
}] }));
after(() => runtime.dispose());

test("compiled Rust Worker fails closed and bounds untrusted bodies", async () => {
  const policyDB = await runtime.getD1Database("DB");
  for(const migration of ["0013_operations.sql","0020_admin_minimum_build.sql"])
    for(const sql of (await readFile(`${root}migrations/${migration}`,"utf8")).split(";").filter(s=>s.trim())) await policyDB.prepare(sql).run();
  const response = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST", headers: { Authorization: "Bearer forged", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "temporarily_unavailable");
  assert.match(body.request_id, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const oversized = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST", headers: {"Content-Type":"application/json"}, body: "x".repeat(256 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "body_too_large");
  const empty = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST" });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "malformed_request");
  const admin = await runtime.dispatchFetch("https://api.example/admin/participants");
  assert.equal(admin.status, 503); // Admin fails closed when Access configuration is absent.
});

test("local D1 CHECK guard rolls back and admits only one competing revision", async () => {
  const db = await runtime.getD1Database("DB");
  const schema = await readFile(`${root}migrations/0001_mutation_fences.sql`, "utf8");
  for (const sql of schema.split(";").filter((s) => s.trim())) await db.prepare(sql).run();
  const sessions = await readFile(`${root}migrations/0002_sessions.sql`, "utf8");
  for (const sql of sessions.split(";").filter((s) => s.trim())) await db.prepare(sql).run();
  for (const sql of [
    "INSERT INTO participants VALUES ('p','subject','joined','none',0,'g','e','d')",
    "INSERT INTO participant_revisions VALUES ('p',0)",
    "INSERT INTO attestation_keys VALUES ('k','p','d','staging',x'01',0,0)",
    "INSERT INTO sessions VALUES ('guard-session','p','d','staging',0,0,1000,1000,0)",
    "INSERT INTO access_tokens VALUES (zeroblob(32),'guard-session',1000)",
    "INSERT INTO challenges VALUES ('c','p','d','k','staging','submit_events',x'02',100,0,'guard-session')",
    "CREATE TABLE test_receipts (id TEXT PRIMARY KEY)",
    "CREATE TABLE test_jobs (id TEXT PRIMARY KEY)",
  ]) await db.prepare(sql).run();
  const source = await readFile(`${root}crates/worker/src/mutation.rs`, "utf8");
  const guardSQL = source.match(/pub const GUARD_SQL: &str = r#"([\s\S]*?)"#;/)[1];
  const guard = (id) => db.prepare(guardSQL).bind(id, "p", 0, "e", 0, "g", "d", "k", "staging", 0, 1, "c", "submit_events", 99, new Uint8Array([2]).buffer,"guard-session",new Uint8Array(32).buffer);
  await assert.rejects(db.batch([
    guard("failed"),
    db.prepare("UPDATE challenges SET used=1 WHERE challenge_id='c'"),
    db.prepare("UPDATE attestation_keys SET counter=1 WHERE key_id='k'"),
    db.prepare("INSERT INTO test_receipts VALUES ('failure')"),
    db.prepare("INSERT INTO test_jobs VALUES ('failure')"),
    db.prepare("INSERT INTO test_receipts VALUES ('failure')"),
  ]));
  for (const table of ["mutation_guards", "test_receipts", "test_jobs"]) assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n"), 0);
  assert.equal(await db.prepare("SELECT counter FROM attestation_keys").first("counter"), 0);
  assert.equal(await db.prepare("SELECT used FROM challenges").first("used"), 0);
  const attempt = (id) => db.batch([
    guard(id),
    db.prepare("UPDATE challenges SET used=1 WHERE challenge_id='c'"),
    db.prepare("UPDATE attestation_keys SET counter=1 WHERE key_id='k'"),
    db.prepare("UPDATE participant_revisions SET revision=revision+1 WHERE participant_id='p'"),
    db.prepare("INSERT INTO test_receipts VALUES (?)").bind(id),
    db.prepare("INSERT INTO test_jobs VALUES (?)").bind(id),
    db.prepare("DELETE FROM mutation_guards WHERE guard_id=?").bind(id),
  ]);
  const results = await Promise.allSettled([attempt("a"), attempt("b")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const table of ["test_receipts", "test_jobs"]) assert.equal(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first("n"), 1);
  assert.equal(await db.prepare("SELECT revision FROM participant_revisions").first("revision"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM mutation_guards").first("n"), 0);
});

test("local D1 session fences reject revoked sessions and rotate exactly once", async () => {
  const db = await runtime.getD1Database("DB");
  const token=new Uint8Array(32).fill(1).buffer;
  await db.prepare("INSERT INTO sessions VALUES ('s','p','d','staging',0,0,900000,300000,0)").run();
  await db.prepare("INSERT INTO access_tokens VALUES (?,'s',900)").bind(token).run();
  await db.prepare("INSERT INTO refresh_tokens VALUES (?,'s',0,NULL,NULL)").bind(token).run();
  const source = await readFile(`${root}crates/worker/src/session.rs`,"utf8");
  const sql = name => source.match(new RegExp(`pub const ${name}: &str = r#"([\\s\\S]*?)"#;`))[1];
  const sessionGuard = id => db.prepare(sql("SESSION_GUARD_SQL")).bind(id,"s","p","d","staging",100,token);
  await db.batch([sessionGuard("authorized"),db.prepare("DELETE FROM mutation_guards WHERE guard_id='authorized'")]);
  await db.prepare("UPDATE sessions SET revoked=1 WHERE session_id='s'").run();
  await assert.rejects(db.batch([sessionGuard("revoked"),db.prepare("INSERT INTO test_jobs VALUES ('revoked')")]));
  assert.equal(await db.prepare("SELECT count(*) n FROM test_jobs WHERE id='revoked'").first("n"),0);
  await db.prepare("UPDATE sessions SET revoked=0 WHERE session_id='s'").run();
  const rotate = id => db.batch([
    db.prepare(sql("REFRESH_GUARD_SQL")).bind(id,"s","staging",100,token,id),
    db.prepare("UPDATE refresh_tokens SET rotated_operation_id=?,rotated_at_ms=100 WHERE token_hash=?").bind(id,token),
    db.prepare("INSERT INTO refresh_receipts VALUES ('s',?,?,x'01','synthetic-key',60100)").bind(id,token),
    db.prepare("DELETE FROM mutation_guards WHERE guard_id=?").bind(id),
  ]);
  const outcomes=await Promise.allSettled([rotate("r1"),rotate("r2")]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(await db.prepare("SELECT count(*) n FROM refresh_receipts").first("n"),1);
});

// Entirely synthetic Apple issuer and client keys, confined to the local outbound service.
const appleSigning=generateKeyPairSync("rsa",{modulusLength:2048});
const appleClient=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const appleCodes=new Map();
let exchangeCount=0;
let jwksRequests=0;
const appleToken=claims=> {
  const b64=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const message=b64({alg:"RS256",kid:"local-apple"})+"."+b64({iss:"https://appleid.apple.com",aud:"app.test.Folding",iat:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+300,...claims});
  return message+"."+sign("RSA-SHA256",Buffer.from(message),appleSigning.privateKey).toString("base64url");
};
async function syntheticApple(request) {
  if(request.url==="https://folding-test.cloudflareaccess.com/cdn-cgi/access/certs") return Response.json({keys:[{...appleSigning.publicKey.export({format:"jwk"}),kid:"local-apple",alg:"RS256",use:"sig"}]});
  if(request.url==="https://appleid.apple.com/auth/keys") {jwksRequests++; return Response.json({keys:[{...appleSigning.publicKey.export({format:"jwk"}),kid:"local-apple",alg:"RS256",use:"sig"}]});}
  assert.equal(request.url,"https://appleid.apple.com/auth/token");
  const form=new URLSearchParams(await request.text());
  assert.equal(form.get("client_id"),"app.test.Folding");assert.equal(form.get("grant_type"),"authorization_code");
  const pieces=form.get("client_secret").split(".");
  assert.ok(verify("sha256",Buffer.from(pieces[0]+"."+pieces[1]),{key:appleClient.publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(pieces[2],"base64url")));
  const claims=JSON.parse(Buffer.from(pieces[1],"base64url"));
  assert.equal(claims.iss,"TEAM123456");assert.equal(claims.sub,"app.test.Folding");assert.equal(claims.exp-claims.iat,300);
  if(form.get("code")==="redirect-code") return new Response(null,{status:302,headers:{Location:"https://attacker.invalid/token"}});
  if(form.get("code")==="oversized-code") return new Response("x".repeat(65537));
  const token=appleCodes.get(form.get("code"));if(!token) return Response.json({error:"invalid_grant"},{status:400});
  appleCodes.delete(form.get("code"));exchangeCount++;
  return Response.json({id_token:token,refresh_token:"synthetic-revocation-token",access_token:"synthetic-apple-access",expires_in:3600,token_type:"Bearer"});
}
const authenticatedRuntime = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "folding-auth-local",
  modules: [
    { type: "ESModule", path: `${root}crates/worker/build/index.js` },
    { type: "CompiledWasm", path: `${root}crates/worker/build/index_bg.wasm` },
  ],
  compatibilityDate: "2026-11-04",
  outboundService: syntheticApple,
  ratelimits: Object.fromEntries(['API_NETWORK_BURST','AUTH_NETWORK_BURST','API_CREDENTIAL_BURST'].map((name,i)=>[name,{namespace_id:String(900+i),simple:{limit:100000,period:60}}])),
  queueProducers: {JOBS:"folding-local-jobs", JOBS_DEAD:"folding-local-dead"},
  queueConsumers: {"folding-local-jobs":{maxBatchSize:1,maxBatchTimeout:0}},
  bindings: {
    WORKER_VERSION:"synthetic-local-worker",ADMIN_ORIGIN:"https://admin.example",ACCESS_TEAM_DOMAIN:"https://folding-test.cloudflareaccess.com",ACCESS_AUDIENCE:"local-admin",ADMIN_EMAIL_ALLOWLIST:JSON.stringify(["admin@example.test"]),AVATAR_UPLOADS_ENABLED:"true",
    APP_ATTEST_APP_ID:"TEAM123456.app.test.Folding",APP_ATTEST_ENVIRONMENT:"development",APP_ATTEST_BUNDLE_VERSIONS:JSON.stringify(["1"]),
    APPLE_SIGN_IN_CLIENT_ID:"app.test.Folding",APPLE_SIGN_IN_TEAM_ID:"TEAM123456",APPLE_SIGN_IN_KEY_ID:"KEY1234567",
    APPLE_SIGN_IN_PRIVATE_KEY_PKCS8:appleClient.privateKey.export({type:"pkcs8",format:"der"}).toString("base64url"),
    AUTH_SUBJECT_HMAC_KEY_VERSION:"test-v1",AUTH_SUBJECT_HMAC_KEYS:JSON.stringify({"test-v1":Buffer.alloc(32,9).toString("base64url")}),
    DEPLOYMENT: "staging", AUTH_ENCRYPTION_KEY_VERSION: "test-v1",
    // Public synthetic test keys, never account credentials or production bindings.
    AUTH_ENCRYPTION_KEYS: JSON.stringify({"test-v1":Buffer.alloc(32,7).toString("base64url")}),
    AUTH_NETWORK_HMAC_KEY: Buffer.alloc(32,8).toString("base64url"),
  },
  r2Buckets: { AVATARS: "folding-local-avatars" },
  d1Databases: { DB: "folding-local-auth-experiment" },
}] }));
after(() => authenticatedRuntime.dispose());

test("actual Worker issues bounded challenges and rotates encrypted sessions with response-loss recovery", async () => {
  const {createHash}=await import("node:crypto");
  const hash=bytes=>createHash("sha256").update(bytes).digest();
  const db=await authenticatedRuntime.getD1Database("DB");
  for (const migration of ["0001_mutation_fences.sql","0002_sessions.sql","0003_auth_operations.sql","0004_sign_in.sql","0005_attestation_enrollment.sql","0006_competition.sql","0007_community_reads.sql","0008_privacy_lifecycle.sql","0009_period_finalization.sql","0010_moderation.sql","0011_avatars.sql","0012_notifications.sql", "0013_operations.sql", "0014_corrections.sql", "0015_moderation_cases.sql", "0016_monitoring.sql", "0017_external_retries.sql", "0018_entry_deletions.sql", "0019_resource_protection.sql", "0020_admin_minimum_build.sql"]) {
    const source=await readFile(`${root}migrations/${migration}`,"utf8");
    for(const sql of source.split(";").filter(s=>s.trim())) await db.prepare(sql).run();
  }
  const post=(path,body,headers={})=>authenticatedRuntime.dispatchFetch(`https://api.example/v1/auth/${path}`,{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json",...headers}});
  assert.equal((await post("challenges",{purpose:"administrator"},{"CF-Connecting-IP":"192.0.2.1"})).status,422);
  const malformed=await authenticatedRuntime.dispatchFetch("https://api.example/v1/auth/challenges",{method:"POST",body:"{",headers:{"Content-Type":"application/json"}});
  assert.equal(malformed.status,400);assert.equal((await malformed.json()).code,"malformed_request");
  assert.equal((await authenticatedRuntime.dispatchFetch("http://api.example/v1/auth/challenges",{method:"POST",body:'{"purpose":"sign_in"}',headers:{"Content-Type":"application/json"}})).status,400);
  const challenge=await post("challenges",{purpose:"sign_in"},{"CF-Connecting-IP":"192.0.2.1"});
  assert.equal(challenge.status,200);
  const issued=await challenge.json();
  assert.equal(Buffer.from(issued.nonce,"base64url").length,32);
  const persisted=await db.prepare("SELECT nonce_hash,used,expires_at_ms FROM challenges WHERE challenge_id=?").bind(issued.challenge_id).first();
  assert.deepEqual(Buffer.from(persisted.nonce_hash),hash(issued.nonce));
  assert.equal(persisted.used,0);
  assert.equal(persisted.expires_at_ms,issued.expires_at_ms);
  for(let i=1;i<20;i++) assert.equal((await post("challenges",{purpose:"sign_in"},{"CF-Connecting-IP":"192.0.2.1"})).status,200);
  const limited=await post("challenges",{purpose:"sign_in"},{"CF-Connecting-IP":"192.0.2.1"});
  assert.equal(limited.status,429);assert.equal(limited.headers.get("Retry-After"),"60");assert.equal((await limited.json()).retry_after_seconds,60);
  const timestamp=Date.now();
  await db.prepare("INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id,epoch_id,active_device_id) VALUES ('auth-person','auth-subject','not_joined','none',0,'g',NULL,NULL)").run();
  await db.prepare("INSERT INTO sessions VALUES ('auth-session','auth-person','device','staging',?,?,?, ?,0)").bind(timestamp,timestamp,timestamp+86400000,timestamp+86400000).run();
  const old=Buffer.alloc(32,11);
  await db.prepare("INSERT INTO refresh_tokens VALUES (?,'auth-session',?,NULL,NULL)").bind(hash(old),timestamp).run();
  const operation="00000000-0000-0000-0000-000000000901";
  const request={operation_id:operation,refresh_token:old.toString("base64url")};
  const responses=await Promise.all([post("refresh",request),post("refresh",request)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  const pairs=await Promise.all(responses.map(r=>r.json()));
  assert.deepEqual(pairs[0],pairs[1]);
  assert.notEqual(pairs[0].refresh_token,request.refresh_token);
  const receipt=await db.prepare("SELECT ciphertext,key_version FROM refresh_receipts WHERE session_id='auth-session'").first();
  assert.equal(receipt.key_version,"test-v1");
  const envelope=Buffer.from(receipt.ciphertext);
  const decipher=createDecipheriv("aes-256-gcm",Buffer.alloc(32,7),envelope.subarray(0,12));
  decipher.setAAD(Buffer.from(`Folding-v1/staging/refresh/auth-session/${operation}`));
  decipher.setAuthTag(envelope.subarray(-16));
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(envelope.subarray(12,-16)),decipher.final()])),pairs[0]);
  assert.ok(!Buffer.from(receipt.ciphertext).includes(Buffer.from(pairs[0].refresh_token)));
  assert.equal(await db.prepare("SELECT count(*) n FROM refresh_tokens WHERE session_id='auth-session'").first("n"),2);
  const retry=await post("refresh",request);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),pairs[0]);
  const advance=await post("refresh",{operation_id:"00000000-0000-0000-0000-000000000904",refresh_token:pairs[0].refresh_token});
  assert.equal(advance.status,200);
  assert.equal((await post("refresh",request)).status,401); // Never hand back a refresh token already rotated again.
  assert.equal(await db.prepare("SELECT revoked FROM sessions WHERE session_id='auth-session'").first("revoked"),0);
  const replay=await post("refresh",{...request,operation_id:"00000000-0000-0000-0000-000000000902"});
  assert.equal(replay.status,401);
  assert.equal(await db.prepare("SELECT revoked FROM sessions WHERE session_id='auth-session'").first("revoked"),1);
  assert.equal((await post("refresh",{operation_id:"00000000-0000-0000-0000-000000000903",refresh_token:pairs[0].refresh_token})).status,401);
  assert.equal((await post("logout",{operation_id:operation},{Authorization:`Bearer ${pairs[0].access_token}`})).status,401);
  // A separate active family proves logout removes its push binding atomically.
  await db.prepare("INSERT INTO sessions VALUES ('logout-session','auth-person','device2','staging',?,?,?, ?,0)").bind(timestamp,timestamp,timestamp+86400000,timestamp+86400000).run();
  const access=Buffer.alloc(32,12);
  await db.prepare("INSERT INTO access_tokens VALUES (?,'logout-session',?)").bind(hash(access),timestamp+900000).run();
  await db.prepare("INSERT INTO push_installations(device_id,participant_id,session_id,deployment,environment,token_ciphertext,key_version,topic,enabled) VALUES ('device2','auth-person','logout-session','staging','sandbox',x'01','test-v1','app.test',1)").run();
  const otherRefresh=Buffer.alloc(32,13);
  await db.prepare("INSERT INTO refresh_tokens VALUES (?,'logout-session',?,NULL,NULL)").bind(hash(otherRefresh),timestamp).run();
  assert.equal((await post("refresh",{operation_id:operation,refresh_token:otherRefresh.toString("base64url")})).status,409);
  assert.equal(await db.prepare("SELECT revoked FROM sessions WHERE session_id='logout-session'").first("revoked"),0);
  assert.equal((await post("logout",{operation_id:operation},{Authorization:`Bearer ${access.toString("base64url")}`})).status,200);
  assert.equal(await db.prepare("SELECT count(*) n FROM push_installations").first("n"),0);
  assert.equal(await db.prepare("SELECT revoked FROM sessions WHERE session_id='logout-session'").first("revoked"),1);
});

test("actual Worker verifies Apple exchange, recovers one sign-in and fences changed or revoked identities", async () => {
  const db=await authenticatedRuntime.getD1Database("DB");
  const post=(path,body)=>authenticatedRuntime.dispatchFetch(`https://api.example/v1/auth/${path}`,{method:"POST",body:JSON.stringify(body),headers:{"CF-Connecting-IP":"192.0.2.2","Content-Type":"application/json"}});
  const challenge=await (await post("challenges",{purpose:"sign_in"})).json();
  const nonce=createHash("sha256").update(challenge.nonce).digest("hex");
  const token=appleToken({sub:"synthetic-new-subject",nonce});
  appleCodes.set("first-code",token);
  const input={operation_id:"00000000-0000-0000-0000-000000000801",purpose:"sign_in",challenge_id:challenge.challenge_id,identity_token:token,authorization_code:"first-code",device_id:"00000000-0000-0000-0000-000000000802",deletion_operation_id:null};
  const result=await post("apple",input);assert.equal(result.status,200,JSON.stringify({exchangeCount,jwksRequests}));
  const body=await result.json();assert.equal(body.profile.membership,"not_joined");
  assert.equal(exchangeCount,1);
  const retry=await post("apple",input);assert.equal(retry.status,200);assert.deepEqual(await retry.json(),body);assert.equal(exchangeCount,1);
  await db.prepare("UPDATE challenges SET expires_at_ms=0 WHERE challenge_id=?").bind(challenge.challenge_id).run();
  assert.equal((await post("apple",input)).status,200); // Committed receipt outlives the spent challenge's issuance window.
  const participant=body.profile.participant_id;
  assert.equal(await db.prepare("SELECT count(*) n FROM sessions WHERE participant_id=?").bind(participant).first("n"),1);
  assert.equal(await db.prepare("SELECT used FROM challenges WHERE challenge_id=?").bind(challenge.challenge_id).first("used"),1);
  const authorization=await db.prepare("SELECT ciphertext FROM apple_authorizations WHERE participant_id=?").bind(participant).first("ciphertext");
  assert.ok(!Buffer.from(authorization).includes(Buffer.from("synthetic-revocation-token")));
  assert.equal((await post("apple",{...input,device_id:"00000000-0000-0000-0000-000000000803"})).status,409);
  assert.equal((await post("apple",{...input,identity_token:appleToken({sub:"another-subject",nonce})})).status,401);
  assert.equal((await post("apple",{...input,identity_token:appleToken({sub:"synthetic-new-subject",nonce:"wrong"})})).status,401);
  await db.prepare("UPDATE participants SET restriction='banned' WHERE participant_id=?").bind(participant).run();
  assert.equal((await post("apple",input)).status,401);
  await db.prepare("UPDATE participants SET restriction='none',account_state='deleting' WHERE participant_id=?").bind(participant).run();
  assert.equal((await post("apple",input)).status,401);
  await db.prepare("UPDATE participants SET account_state='active' WHERE participant_id=?").bind(participant).run();
  await db.prepare("UPDATE sessions SET revoked=1 WHERE participant_id=?").bind(participant).run();
  assert.equal((await post("apple",input)).status,401);
  // A code-exchange identity must match the native signed identity, even with valid Apple signatures.
  const otherChallenge=await (await post("challenges",{purpose:"sign_in"})).json();
  const otherNonce=createHash("sha256").update(otherChallenge.nonce).digest("hex");
  const original=appleToken({sub:"expected-subject",nonce:otherNonce});
  appleCodes.set("mismatch-code",appleToken({sub:"different-subject",nonce:otherNonce}));
  assert.equal((await post("apple",{...input,operation_id:"00000000-0000-0000-0000-000000000804",challenge_id:otherChallenge.challenge_id,identity_token:original,authorization_code:"mismatch-code"})).status,401);
  assert.equal(await db.prepare("SELECT used FROM challenges WHERE challenge_id=?").bind(otherChallenge.challenge_id).first("used"),0);
  for(const code of ["redirect-code","oversized-code"]) {
    assert.equal((await post("apple",{...input,operation_id:"00000000-0000-0000-0000-000000000805",challenge_id:otherChallenge.challenge_id,identity_token:original,authorization_code:code})).status,503);
  }
  assert.equal(await db.prepare("SELECT count(*) n FROM sessions WHERE participant_id=?").bind(participant).first("n"),1);
  const expiryChallenge=await (await post("challenges",{purpose:"sign_in"})).json();
  const expiryNonce=createHash("sha256").update(expiryChallenge.nonce).digest("hex");
  const expiryToken=appleToken({sub:"expiry-subject",nonce:expiryNonce});
  appleCodes.set("expiry-code",expiryToken);
  const expiryInput={...input,operation_id:"00000000-0000-0000-0000-000000000806",challenge_id:expiryChallenge.challenge_id,identity_token:expiryToken,authorization_code:"expiry-code"};
  const expiryResponse=await post("apple",expiryInput);assert.equal(expiryResponse.status,200);
  const expiryOwner=(await expiryResponse.json()).profile.participant_id;
  await db.prepare("UPDATE sign_in_receipts SET expires_at_ms=0 WHERE participant_id=?").bind(expiryOwner).run();
  assert.equal((await post("apple",expiryInput)).status,401);
  assert.equal(await db.prepare("SELECT count(*) n FROM sessions WHERE participant_id=? AND revoked=0").bind(expiryOwner).first("n"),1);
  const unused=await (await post("challenges",{purpose:"sign_in"})).json();
  await db.prepare("UPDATE challenges SET expires_at_ms=0 WHERE challenge_id=?").bind(unused.challenge_id).run();
  assert.equal((await post("apple",{...input,challenge_id:unused.challenge_id})).status,401);
});


test("scheduled retention purges expired ciphertext while keeping replay tombstones",async()=>{
  const db=await authenticatedRuntime.getD1Database("DB");
  const before=await db.prepare("SELECT count(*) n FROM auth_operation_claims").first("n");
  assert.ok(before>0);
  await db.prepare("UPDATE refresh_receipts SET expires_at_ms=0").run();
  await db.prepare("UPDATE sign_in_receipts SET expires_at_ms=0").run();
  const worker=await authenticatedRuntime.getWorker();
  await worker.scheduled({cron:"* * * * *",scheduledTime:Date.now()});
  for (let attempt=0;attempt<50;attempt++) {
    if(await db.prepare("SELECT count(*) n FROM refresh_receipts").first("n")===0) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await db.prepare("SELECT count(*) n FROM refresh_receipts").first("n"),0);
  assert.equal(await db.prepare("SELECT count(*) n FROM sign_in_receipts").first("n"),0);
  assert.equal(await db.prepare("SELECT count(*) n FROM auth_operation_claims").first("n"),before);
});

test("reset raw-history purge is atomic and preserves replay receipts and other accounts",async()=>{
  const db=await authenticatedRuntime.getD1Database("DB");
  const source=await readFile(`${root}crates/worker/src/lifecycle_runtime.rs`,"utf8");
  const purge=source.match(/const PURGE_OBSERVATIONS: &str = "([^"]+)"/)[1];
  await db.prepare("INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id) VALUES ('reset-person','reset-subject','joined','none',0,'old')").run();
  await db.prepare("INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms) VALUES ('reset-person','raw-event','phone',1,?, 'accepted',1)").bind(JSON.stringify({private:"raw movement history"})).run();
  await db.prepare("INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms) VALUES ('auth-person','other-event','other-phone',1,'{}','accepted',1)").run();
  await db.prepare("INSERT INTO competition_operations VALUES ('reset-person','receipt','/v1/event-batches',?,'{}')").bind(Buffer.alloc(32)).run();
  await assert.rejects(db.batch([
    db.prepare(purge).bind("reset-person"),
    db.prepare("INSERT INTO mutation_guards VALUES ('reset-rollback',0)"),
  ]));
  assert.equal(await db.prepare("SELECT count(*) n FROM observations WHERE participant_id='reset-person'").first("n"),1);
  await db.batch([
    db.prepare("INSERT INTO mutation_guards VALUES ('reset-success',1)"),
    db.prepare(purge).bind("reset-person"),
    db.prepare("UPDATE participants SET generation_revision=1,generation_id='new' WHERE participant_id='reset-person'"),
    db.prepare("DELETE FROM mutation_guards WHERE guard_id='reset-success'"),
  ]);
  assert.equal(await db.prepare("SELECT count(*) n FROM observations WHERE participant_id='reset-person'").first("n"),0);
  assert.equal(await db.prepare("SELECT count(*) n FROM observations WHERE participant_id='auth-person'").first("n"),1);
  assert.equal(await db.prepare("SELECT count(*) n FROM competition_operations WHERE participant_id='reset-person'").first("n"),1);
});

test("entry deletion is owned, idempotent and durable before late upload", async () => {
  const db=await authenticatedRuntime.getD1Database("DB");
  const participant="00000000-0000-0000-0000-000000008101";
  const other="00000000-0000-0000-0000-000000008102";
  const device="00000000-0000-0000-0000-000000008103";
  const nil="00000000-0000-0000-0000-000000000000";
  const first="00000000-0000-0000-0000-000000008111";
  const repeated="00000000-0000-0000-0000-000000008112";
  const close="00000000-0000-0000-0000-000000008113";
  const future="00000000-0000-0000-0000-000000008114";
  const operation="00000000-0000-0000-0000-000000008121";
  const time=Date.now();
  for(const person of [participant,other]) {
    await db.prepare("INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id) VALUES (?,?,'joined','none',0,?)").bind(person,person,nil).run();
    await db.prepare("INSERT INTO participant_revisions VALUES (?,0)").bind(person).run();
  }
  const access=Buffer.alloc(32,81);
  await db.prepare("INSERT INTO sessions VALUES ('entry-delete-session',?,?,'staging',?,?,?,?,0)").bind(participant,device,time,time,time+86400000,time+86400000).run();
  await db.prepare("INSERT INTO access_tokens VALUES (?,'entry-delete-session',?)").bind(createHash("sha256").update(access).digest(),time+900000).run();
  const event=(id,sequence,transition)=>({schema_version:1,event_id:id,device_id:device,sequence,generation:{revision:0,reset_id:nil},observed_at_ms:time-10000+sequence*1000,timezone_id:"UTC",transition,is_test:false,competition_epoch_id:null});
  for(const [id,seq,state] of [[first,1,"open"],[repeated,2,"open"],[close,3,"close"]]) {
    await db.prepare("INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms) VALUES (?,?,?,?,?,'accepted',?)").bind(participant,id,device,seq,JSON.stringify(event(id,seq,state)),time).run();
  }
  await db.prepare("INSERT INTO live_scores VALUES (?,0,?,'all',2,0)").bind(participant,nil).run();
  await db.prepare("INSERT INTO live_scores VALUES (?,0,?,'all',8,0)").bind(other,nil).run();
  const send=(body,token=access.toString("base64url"))=>authenticatedRuntime.dispatchFetch("https://api.example/v1/entry-deletions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  const epoch="00000000-0000-0000-0000-000000008131";
  const otherEpoch="00000000-0000-0000-0000-000000008132";
  for(const [id,owner] of [[epoch,participant],[otherEpoch,other]]) {
    await db.prepare("INSERT INTO epochs VALUES (?,?,?,0,?,?,?,NULL)").bind(id,owner,device,nil,time-20000,time-20000).run();
  }
  const body={operation_id:operation,event_ids:[first,future],epoch_ids:[epoch]};
  const concurrent=await Promise.all([send(body),send(body)]);
  assert.ok(concurrent.every(value=>[200,409].includes(value.status)));
  const initial=concurrent.find(value=>value.status===200);assert.ok(initial);
  assert.equal(await db.prepare("SELECT revision FROM participant_revisions WHERE participant_id=?").bind(participant).first("revision"),1);
  assert.equal((await initial.json()).state,"completed");
  assert.equal(await db.prepare("SELECT folds FROM live_scores WHERE participant_id=? AND period_id='all'").bind(participant).first("folds"),1);
  assert.equal(await db.prepare("SELECT folds FROM live_scores WHERE participant_id=? AND period_id='all'").bind(other).first("folds"),8);
  const retry=await send({...body,event_ids:[future,first]});assert.equal(retry.status,200);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM deleted_observations WHERE participant_id=?").bind(participant).first("n"),2);
  assert.equal((await send({...body,event_ids:[close]})).status,409);
  assert.equal((await send({operation_id:"00000000-0000-0000-0000-000000008122",event_ids:[first,first],epoch_ids:[epoch]})).status,422);
  assert.equal((await send(body,Buffer.alloc(32,82).toString("base64url"))).status,401);
  assert.equal((await send({operation_id:"00000000-0000-0000-0000-000000008124",event_ids:[close],epoch_ids:[otherEpoch]})).status,403);
  // An immutable upload arriving after deletion cannot restore that observation's score.
  await db.prepare("INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,received_at_ms) VALUES (?,?,?,?,?,'accepted',?)").bind(participant,future,device,4,JSON.stringify(event(future,4,"open")),time).run();
  const recalculate=await send({operation_id:"00000000-0000-0000-0000-000000008123",event_ids:[future],epoch_ids:[epoch]});assert.equal(recalculate.status,200);
  assert.equal(await db.prepare("SELECT folds FROM live_scores WHERE participant_id=? AND period_id='all'").bind(participant).first("folds"),1);

});

const protectionRuntime = new Miniflare(convertV4MiniflareOptions({workers:[{
 name:'folding-burst-local',modules:[{type:'ESModule',path:`${root}crates/worker/build/index.js`},{type:'CompiledWasm',path:`${root}crates/worker/build/index_bg.wasm`}],
 compatibilityDate:'2026-11-04',bindings:{DEPLOYMENT:'staging'},d1Databases:{DB:'burst-local'},
 ratelimits:{API_NETWORK_BURST:{namespace_id:'910',simple:{limit:3,period:60}},AUTH_NETWORK_BURST:{namespace_id:'911',simple:{limit:1,period:60}},API_CREDENTIAL_BURST:{namespace_id:'912',simple:{limit:1,period:60}}}
}]}));
after(()=>protectionRuntime.dispose());
test('pre-database burst limits cover forged credentials and rotating-token floods',async()=>{
 const db=await protectionRuntime.getD1Database('DB');
 await db.prepare('CREATE TABLE ingestion_metrics(minute_ms INTEGER PRIMARY KEY,requests INTEGER,failures INTEGER)').run();
 const get=(ip,token,path='/v1/me')=>protectionRuntime.dispatchFetch(`https://api.example${path}`,{headers:{'CF-Connecting-IP':ip,Authorization:`Bearer ${token}`}});
 assert.equal((await get('192.0.2.80','one')).status,503);
 const credential=await get('192.0.2.81','one','/v1/event-batches');
 assert.equal(credential.status,429); assert.equal(credential.headers.get('Retry-After'),'60');
 for(let i=0;i<3;i++) assert.equal((await get('192.0.2.82',`rotate-${i}`)).status,503);
 const network=await protectionRuntime.dispatchFetch('https://api.example/v1/event-batches',{method:'POST',headers:{'CF-Connecting-IP':'192.0.2.82',Authorization:'Bearer new-token'},body:'x'.repeat(256*1024+1)});
 assert.equal(network.status,429);
 assert.equal(await db.prepare('SELECT count(*) n FROM ingestion_metrics').first('n'),0);
 assert.equal((await get('192.0.2.83','fresh')).status,503);
 await get('192.0.2.84','auth-a','/v1/auth/challenges');
 assert.equal((await get('192.0.2.84','auth-b','/v1/auth/challenges')).status,429);
});
test('scheduler avoids empty categories, duplicate pending work and failed retry resets',async()=>{
 const db=await authenticatedRuntime.getD1Database('DB');
 const source=await readFile(`${root}crates/worker/src/jobs_runtime.rs`,'utf8');
 const sql=name=>source.match(new RegExp(`pub const ${name}: &str = r#"([\\s\\S]*?)"#;`))[1];
 const time=Date.now()+86400000,slot=Math.floor(time/300000),firstHour=Math.floor(time/3600000)*12;
 await db.prepare('DELETE FROM jobs').run();
 await db.prepare('DELETE FROM epochs').run();
 const due=async()=> (await db.prepare(sql('DUE_CATEGORIES_SQL')).bind(time,firstHour).all()).results.map(r=>r.kind);
 assert.deepEqual(await due(),['retention']);
 const insert=(id,kind,version=slot)=>db.prepare(sql('INSERT_CATEGORY_SQL')).bind(id,kind,version,time).run();
 await insert('hourly-retention','retention'); await insert('duplicate-pending','retention',slot+1);
 assert.equal(await db.prepare("SELECT count(*) n FROM jobs WHERE kind='retention'").first('n'),1);
 await db.prepare("UPDATE jobs SET state='completed' WHERE kind='retention'").run();
 assert.deepEqual(await due(),[]);
 await db.prepare("INSERT INTO avatar_purge_jobs VALUES ('synthetic-object','nobody',0,0)").run();
 assert.ok((await due()).includes('avatar_cleanup'));
 await insert('cleanup-failed','avatar_cleanup');
 await db.prepare("UPDATE jobs SET state='failed' WHERE job_id='cleanup-failed'").run();
 await insert('must-not-reset-retries','avatar_cleanup',slot+1);
 assert.equal(await db.prepare("SELECT count(*) n FROM jobs WHERE kind='avatar_cleanup'").first('n'),1);
 await db.prepare("DELETE FROM avatar_purge_jobs WHERE object_key='synthetic-object'").run();
});

test('D1 neighbor lookups stay scoped and negative score deltas apply atomically',async()=>{
 const db=await protectionRuntime.getD1Database('DB');
 await db.prepare('CREATE TABLE observations(participant_id TEXT,event_id TEXT,device_id TEXT,sequence INTEGER,event_json TEXT,disposition TEXT,PRIMARY KEY(participant_id,event_id),UNIQUE(participant_id,device_id,sequence))').run();
 const migration=await readFile(`${root}migrations/0019_resource_protection.sql`,'utf8');
 await db.prepare(migration.split('CREATE INDEX jobs_category_state')[0]).run();
 for(const [id,sequence,owner] of [['a',1,'p'],['c',3,'p'],['private',2,'other']]){
   const event={event_id:id,device_id:'d',sequence,generation:{revision:0,reset_id:'g'},is_test:false};
   await db.prepare("INSERT INTO observations VALUES (?,?,'d',?,?,'accepted')").bind(owner,id,sequence,JSON.stringify(event)).run();
 }
 const source=await readFile(`${root}crates/worker/src/ingestion_neighbors.rs`,'utf8');
 const query=source.match(/pub const NEIGHBORS_SQL: &str = r#"([\s\S]*?)"#;/)[1];
 const input={events:[{event_id:'b',device_id:'d',sequence:2,generation:{revision:0,reset_id:'g'}}]};
 const rows=(await db.prepare(query).bind('p',JSON.stringify(input)).all()).results;
 assert.deepEqual(rows.map(r=>JSON.parse(r.event_json).event_id).sort(),['a','c']);
 await db.prepare('CREATE TABLE live_scores(participant_id TEXT,generation_revision INTEGER,generation_id TEXT,period_id TEXT,folds INTEGER CHECK(folds>=0),revision INTEGER,PRIMARY KEY(participant_id,period_id))').run();
 const scoring=await readFile(`${root}crates/worker/src/competition_runtime.rs`,'utf8');
 const delta=scoring.match(/const SCORE_DELTA_SQL: &str = r#"([\s\S]*?)"#;/)[1];
 await db.prepare(delta).bind('p',0,'g','week',1,1).run();
 await db.prepare(delta).bind('p',0,'g','week',-1,2).run();
 assert.equal(await db.prepare("SELECT folds FROM live_scores WHERE participant_id='p'").first('folds'),0);
 await assert.rejects(db.prepare(delta).bind('p',0,'g','week',-1,3).run());
 assert.equal(await db.prepare("SELECT revision FROM live_scores WHERE participant_id='p'").first('revision'),2);
});

test('database minimum-build policy uses bounded cached reads and preserves recovery',async()=>{
 const make=minimum=>new Miniflare(convertV4MiniflareOptions({workers:[{
  name:`policy-${minimum}`,modules:[{type:'ESModule',path:`${root}crates/worker/build/index.js`},{type:'CompiledWasm',path:`${root}crates/worker/build/index_bg.wasm`}],
  compatibilityDate:'2026-11-04',d1Databases:{DB:`policy-${minimum}`}
 }]}));
 const worker=make('10'),disabled=make('0'),invalid=make('invalid');
 try {
  for(const [instance,minimum] of [[worker,10],[disabled,0]]) {
    const db=await instance.getD1Database('DB');
    for(const migration of ['0013_operations.sql','0020_admin_minimum_build.sql'])
      for(const sql of (await readFile(`${root}migrations/${migration}`,'utf8')).split(';').filter(s=>s.trim())) await db.prepare(sql).run();
    await db.prepare('UPDATE administrative_configuration SET minimum_ios_build=?').bind(minimum).run();
    await assert.rejects(db.prepare('UPDATE administrative_configuration SET minimum_ios_build=-1').run());
    await assert.rejects(db.prepare('UPDATE administrative_configuration SET minimum_ios_build=2147483648').run());
  }
  const policy=await worker.dispatchFetch('https://api.example/v1/client-policy');
  assert.equal(policy.status,200);assert.equal((await policy.json()).minimum_ios_build,10);assert.equal(policy.headers.get('Cache-Control'),'no-store');
  await (await worker.getD1Database('DB')).prepare('DROP TABLE administrative_configuration').run(); // hot requests use the cached policy, not another database read
  for(const build of [undefined,'9','bad','2147483648']) {
    const headers=build===undefined?{}:{'X-Folding-Build':build};
    const result=await worker.dispatchFetch('https://api.example/v1/event-batches',{method:'POST',headers,body:'x'.repeat(256*1024+1)});
    assert.equal(result.status,426);const body=await result.json();assert.equal(body.code,'app_update_required');assert.equal(body.retryable,true);assert.equal(body.retry_after_seconds,3600);assert.equal(body.minimum_ios_build,10);
    assert.equal(result.headers.get('X-Folding-Minimum-Build'),'10');
  }
  const current=await worker.dispatchFetch('https://api.example/v1/event-batches',{method:'POST',headers:{'X-Folding-Build':'10'},body:'x'.repeat(256*1024+1)});
  assert.equal(current.status,413); // compatibility is not authentication; ordinary checks still run
  const legacy=await disabled.dispatchFetch('https://api.example/v1/me');assert.equal(legacy.status,503); // reaches unconfigured auth, not retirement
  const deletion=await worker.dispatchFetch('https://api.example/v1/account/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(deletion.status,503);
  assert.equal((await invalid.dispatchFetch('https://api.example/v1/client-policy')).status,503);
 } finally { await Promise.all([worker.dispose(),disabled.dispose(),invalid.dispose()]); }
});

for (const documentedNames of [true, false]) test(`actual Worker verifies ${documentedNames ? "documented metadata" : "device metadata and flags"} Apple assertions on Join without weakening replay or body binding`, async () => {
  const db = await authenticatedRuntime.getD1Database("DB");
  const hash = value => createHash("sha256").update(value).digest();
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const keyID = hash(publicKey).toString("base64");
  const token = Buffer.alloc(32, documentedNames ? 46 : 56);
  const participant = `00000000-0000-4000-8000-0000000000${documentedNames ? "46" : "56"}`;
  const device = `00000000-0000-4000-8000-0000000000${documentedNames ? "47" : "57"}`;
  const session = `join-metadata-session-${documentedNames}`;
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id) VALUES (?,?,'not_joined','none',0,'00000000-0000-0000-0000-000000000000')").bind(participant, `join-metadata-subject-${documentedNames}`),
    db.prepare("INSERT INTO participant_revisions VALUES (?,0)").bind(participant),
    db.prepare("INSERT INTO profiles VALUES (?,'Folder',NULL,'approved','none')").bind(participant),
    db.prepare("INSERT INTO sessions VALUES (?, ?, ?, 'staging', ?, ?, ?, ?, 0)").bind(session, participant, device, now, now, now + 900000, now + 900000),
    db.prepare("INSERT INTO access_tokens VALUES (?, ?, ?)").bind(hash(token), session, now + 900000),
    db.prepare("INSERT INTO attestation_keys(key_id,participant_id,device_id,deployment,public_key_sec1,counter,revoked,attestation_environment) VALUES (?, ?, ?, 'staging', ?, 0, 0, 'development')").bind(keyID, participant, device, publicKey),
  ]);
  const headers = { Authorization: "Bearer " + token.toString("base64url"), "Content-Type": "application/json" };
  const challengeResponse = await authenticatedRuntime.dispatchFetch("https://api.example/v1/attestation/challenges", {
    method: "POST", headers, body: JSON.stringify({purpose: "join", device_id: device, key_id: keyID}),
  });
  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();
  const path = "/v1/enrollment/join";
  const body = JSON.stringify({operation_id: "00000000-0000-4000-8000-000000000048", device_id: device, generation: {revision: 0, reset_id: "00000000-0000-0000-0000-000000000000"}, nickname: "Metadata Tester"});
  const binding = hash(Buffer.from(["Folding-v1", "staging", "POST", path, challenge.challenge_id, challenge.nonce, hash(body).toString("hex")].join("\n")));
  const length = (major, n) => Buffer.from(n < 24 ? [(major << 5) | n] : [(major << 5) | 24, n]);
  const bytes = value => Buffer.concat([length(2, value.length), value]);
  const text = value => { const b = Buffer.from(value); return Buffer.concat([length(3, b.length), b]); };
  const category = Buffer.alloc(4); category.writeUInt32LE(3);
  const extensions = Buffer.concat([Buffer.from([0xa2]), text(documentedNames ? "validationCategory" : "apple_validation_category_01"), bytes(category), text(documentedNames ? "bundleVersion" : "apple_bundle_version_01"), text("1")]);
  const auth = Buffer.concat([hash("TEAM123456.app.test.Folding"), Buffer.from([documentedNames ? 0x80 : 0xc0, 0, 0, 0, 1]), extensions]);
  const signature = sign("sha256", hash(Buffer.concat([auth, binding])), pair.privateKey);
  const assertion = Buffer.concat([Buffer.from([0xa2]), text("signature"), bytes(signature), text("authenticatorData"), bytes(auth)]);
  const signedHeaders = {...headers, "X-Folding-Key-ID": keyID, "X-Folding-Challenge-ID": challenge.challenge_id, "X-Folding-Assertion": assertion.toString("base64url")};
  const submit = value => authenticatedRuntime.dispatchFetch("https://api.example" + path, {method: "POST", headers: signedHeaders, body: value});
  assert.equal((await submit(body.replace("Metadata Tester", "Changed Name"))).status, 401);
  assert.equal(await db.prepare("SELECT counter FROM attestation_keys WHERE key_id=?").bind(keyID).first("counter"), 0);
  const result = await submit(body);
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()));
  const joinedProfile = (await result.json()).profile;
  assert.equal(joinedProfile.membership, "joined");
  assert.equal(joinedProfile.nickname, "Metadata Tester");
  assert.equal(joinedProfile.nickname_status, "approved");
  assert.equal(await db.prepare("SELECT count(*) n FROM nickname_requests WHERE participant_id=?").bind(participant).first("n"), 0);
  assert.equal(await db.prepare("SELECT counter FROM attestation_keys WHERE key_id=?").bind(keyID).first("counter"), 1);
  assert.equal(await db.prepare("SELECT used FROM challenges WHERE challenge_id=?").bind(challenge.challenge_id).first("used"), 1);
  assert.equal((await submit(body)).status, 401);
  const changed = await authenticatedRuntime.dispatchFetch("https://api.example/v1/profile", {method:"PATCH", headers, body:JSON.stringify({operation_id:"00000000-0000-4000-8000-000000000049",nickname:"  Public Name  "})});
  assert.equal(changed.status,200);
  const changedProfile=(await changed.json()).profile;
  assert.equal(changedProfile.nickname,"Public Name"); assert.equal(changedProfile.nickname_status,"approved");
  const photo=await readFile(`${root}tests/fixtures/valid-avatar.png`);
  const avatarPath="/v1/avatars/00000000-0000-4000-8000-000000000050";
  const issued=await authenticatedRuntime.dispatchFetch("https://api.example/v1/attestation/challenges",{method:"POST",headers,body:JSON.stringify({purpose:"avatar_upload",device_id:device,key_id:keyID})});
  assert.equal(issued.status,200);const uploadChallenge=await issued.json();
  const avatarBinding=hash(Buffer.from(["Folding-v1","staging","PUT",avatarPath,uploadChallenge.challenge_id,uploadChallenge.nonce,hash(photo).toString("hex")].join("\n")));
  const avatarAuth=Buffer.from(auth);avatarAuth.writeUInt32BE(2,33);
  const avatarSignature=sign("sha256",hash(Buffer.concat([avatarAuth,avatarBinding])),pair.privateKey);
  const avatarAssertion=Buffer.concat([Buffer.from([0xa2]),text("signature"),bytes(avatarSignature),text("authenticatorData"),bytes(avatarAuth)]);
  const upload=await authenticatedRuntime.dispatchFetch("https://api.example"+avatarPath,{method:"PUT",headers:{...headers,"Content-Type":"image/png","X-Folding-Key-ID":keyID,"X-Folding-Challenge-ID":uploadChallenge.challenge_id,"X-Folding-Assertion":avatarAssertion.toString("base64url")},body:photo});
  assert.equal(upload.status,200,JSON.stringify(await upload.clone().json()));
  const receipt=await upload.json();assert.equal(receipt.state,"pending");assert.equal(receipt.publication_state,"approved");
  const profile=await (await authenticatedRuntime.dispatchFetch("https://api.example/v1/me",{headers})).json();
  assert.equal(profile.profile.avatar_id,receipt.avatar_id);assert.equal(profile.profile.avatar_status,"approved");assert.equal(profile.profile.pending_avatar_id,null);
  assert.equal(await db.prepare("SELECT count(*) n FROM avatar_alerts WHERE state='pending' AND avatar_id=?").bind(receipt.avatar_id).first("n"),0);
  const image=await authenticatedRuntime.dispatchFetch(`https://api.example/v1/avatars/${receipt.avatar_id}/image`,{headers});assert.equal(image.status,200);assert.equal(image.headers.get("Content-Type"),"image/jpeg");
});


test("admin root stays host-scoped and every admin view retains shared dark navigation", async () => {
  const redirect=await authenticatedRuntime.dispatchFetch("https://admin.example/",{redirect:"manual"});
  assert.equal(redirect.status,303);assert.equal(redirect.headers.get("Location"),"/admin");
  assert.equal((await authenticatedRuntime.dispatchFetch("https://api.example/")).status,404);
  assert.equal((await authenticatedRuntime.dispatchFetch("https://admin.example/admin")).status,401);
  const jwt=appleToken({iss:"https://folding-test.cloudflareaccess.com",aud:["local-admin"],sub:"synthetic-admin",email:"admin@example.test",type:"app"});
  const pages=["/admin","/admin/queue","/admin/queue?kind=avatars","/admin/queue?kind=reports","/admin/queue?kind=quarantine","/admin/audit","/admin/config","/admin/periods","/admin/jobs","/admin/queue?kind=cases","/admin/queue?kind=ban_reviews"];
  for(const path of pages){
    const response=await authenticatedRuntime.dispatchFetch("https://admin.example"+path,{headers:{"Cf-Access-Jwt-Assertion":jwt}});
    assert.equal(response.status,200,path+" "+await response.clone().text());
    const html=await response.text();assert.ok(html.includes('<nav aria-label="Admin">'),path);assert.ok(html.includes('href="/admin/jobs"'),path);assert.ok(html.includes('background:#000'),path);assert.ok(html.includes('color-scheme:dark'),path);
    if(process.env.FOLDING_ADMIN_PREVIEW_DIR){await mkdir(process.env.FOLDING_ADMIN_PREVIEW_DIR,{recursive:true});await writeFile(`${process.env.FOLDING_ADMIN_PREVIEW_DIR}/${path.includes("jobs")?"jobs":path==="/admin"?"people":encodeURIComponent(path)}.html`,html);}
  }
});


test("admin minimum build is authenticated, audited, revision guarded and reversible",async()=>{
 const db=await authenticatedRuntime.getD1Database('DB');
 const jwt=appleToken({iss:'https://folding-test.cloudflareaccess.com',aud:['local-admin'],sub:'synthetic-admin',email:'admin@example.test',type:'app'});
 const auth={'Cf-Access-Jwt-Assertion':jwt};
 const policy=async()=>{const r=await authenticatedRuntime.dispatchFetch('https://api.example/v1/client-policy');assert.equal(r.status,200);return (await r.json()).minimum_ios_build;};
 assert.equal(await policy(),0);
 const form=async()=>{
  const r=await authenticatedRuntime.dispatchFetch('https://admin.example/admin/config',{headers:auth});assert.equal(r.status,200);
  const html=await r.text();assert.match(html,/name="minimum_ios_build"/);assert.match(html,/0 = off/);
  const field=name=>html.match(new RegExp(`name="${name}" value="([^"]+)"`))[1];
  return {operation_id:field('operation_id'),csrf_token:field('csrf_token'),expected_revision:field('expected_revision'),competition_ingestion_enabled:'1',result_notifications_enabled:'1',avatar_uploads_enabled:'1',minimum_ios_build:'12',reason:'Require available build 12'};
 };
 const post=(input,headers={})=>authenticatedRuntime.dispatchFetch('https://admin.example/admin/config',{method:'POST',redirect:'manual',headers:{...auth,Origin:'https://admin.example','Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(input)});
 const input=await form();
 const auditBefore=await db.prepare('SELECT count(*) n FROM operational_audit').first('n');
 for(const minimum of ['-1','2147483648','bad','1.5']) assert.equal((await post({...input,minimum_ios_build:minimum})).status,422);
 assert.equal((await post(input,{'Cf-Access-Jwt-Assertion':'forged'})).status,401);
 assert.equal((await post(input,{Origin:'https://attacker.invalid'})).status,401);
 assert.equal((await post({...input,csrf_token:'forged'})).status,401);
 assert.equal((await post({...input,expected_revision:'999999'})).status,409);
 assert.equal(await policy(),0);assert.equal(await db.prepare('SELECT count(*) n FROM operational_audit').first('n'),auditBefore);
 assert.equal((await post(input)).status,303);
 assert.equal(await policy(),12); // successful save invalidates this isolate's cached 0
 const older=await authenticatedRuntime.dispatchFetch('https://api.example/v1/me',{headers:{'X-Folding-Build':'11'}});
 assert.equal(older.status,426);assert.equal((await older.json()).minimum_ios_build,12);
 assert.equal((await authenticatedRuntime.dispatchFetch('https://api.example/v1/me',{headers:{'X-Folding-Build':'12'}})).status,401);
 assert.equal((await authenticatedRuntime.dispatchFetch('https://api.example/v1/health')).status,200);
 assert.equal((await authenticatedRuntime.dispatchFetch('https://api.example/v1/account/delete',{method:'POST',body:'{}'})).status,400);
 assert.equal((await post(input)).status,303); // exact response-loss retry does not duplicate the audit
 assert.equal(await db.prepare('SELECT count(*) n FROM operational_audit').first('n'),auditBefore+1);
 assert.equal((await post({...input,minimum_ios_build:'13'})).status,409);
 assert.equal((await post({...input,operation_id:crypto.randomUUID()})).status,409);
 const audit=await db.prepare('SELECT before_json,after_json FROM operational_audit WHERE operation_id=?').bind(input.operation_id).first();
 assert.equal(JSON.parse(audit.before_json).minimum_ios_build,0);assert.equal(JSON.parse(audit.after_json).minimum_ios_build,12);
 const rollback={...await form(),minimum_ios_build:'0',reason:'Disable required updates'};
 assert.equal((await post(rollback)).status,303);assert.equal(await policy(),0);
 assert.equal((await authenticatedRuntime.dispatchFetch('https://api.example/v1/me',{headers:{'X-Folding-Build':'11'}})).status,401);
});
