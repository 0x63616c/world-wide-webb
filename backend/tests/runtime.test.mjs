import { generateKeyPairSync,sign,verify,createHash,createDecipheriv } from "node:crypto";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const response = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST", headers: { Authorization: "Bearer forged" }, body: "{}" });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "temporarily_unavailable");
  assert.match(body.request_id, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const oversized = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST", body: "x".repeat(256 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "body_too_large");
  const empty = await runtime.dispatchFetch("https://api.example/v1/event-batches", { method: "POST" });
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "malformed_request");
  const admin = await runtime.dispatchFetch("https://api.example/admin/participants");
  assert.equal(admin.status, 404);
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
  bindings: {
    APP_ATTEST_APP_ID:"TEAM123456.app.test.Folding",APP_ATTEST_ENVIRONMENT:"development",APP_ATTEST_BUNDLE_VERSIONS:JSON.stringify(["1"]),
    APPLE_SIGN_IN_CLIENT_ID:"app.test.Folding",APPLE_SIGN_IN_TEAM_ID:"TEAM123456",APPLE_SIGN_IN_KEY_ID:"KEY1234567",
    APPLE_SIGN_IN_PRIVATE_KEY_PKCS8:appleClient.privateKey.export({type:"pkcs8",format:"der"}).toString("base64url"),
    AUTH_SUBJECT_HMAC_KEY_VERSION:"test-v1",AUTH_SUBJECT_HMAC_KEYS:JSON.stringify({"test-v1":Buffer.alloc(32,9).toString("base64url")}),
    DEPLOYMENT: "staging", AUTH_ENCRYPTION_KEY_VERSION: "test-v1",
    // Public synthetic test keys, never account credentials or production bindings.
    AUTH_ENCRYPTION_KEYS: JSON.stringify({"test-v1":Buffer.alloc(32,7).toString("base64url")}),
    AUTH_NETWORK_HMAC_KEY: Buffer.alloc(32,8).toString("base64url"),
  },
  d1Databases: { DB: "folding-local-auth-experiment" },
}] }));
after(() => authenticatedRuntime.dispose());

test("actual Worker issues bounded challenges and rotates encrypted sessions with response-loss recovery", async () => {
  const {createHash}=await import("node:crypto");
  const hash=bytes=>createHash("sha256").update(bytes).digest();
  const db=await authenticatedRuntime.getD1Database("DB");
  for (const migration of ["0001_mutation_fences.sql","0002_sessions.sql","0003_auth_operations.sql","0004_sign_in.sql","0005_attestation_enrollment.sql","0006_competition.sql"]) {
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
  await db.prepare("INSERT INTO push_installations VALUES ('device2','auth-person','logout-session','staging','sandbox',x'01','test-v1','app.test',1)").run();
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
  assert.equal(await db.prepare("SELECT count(*) n FROM refresh_receipts").first("n"),0);
  assert.equal(await db.prepare("SELECT count(*) n FROM sign_in_receipts").first("n"),0);
  assert.equal(await db.prepare("SELECT count(*) n FROM auth_operation_claims").first("n"),before);
});
