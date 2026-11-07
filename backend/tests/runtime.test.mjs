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
  const admin = await runtime.dispatchFetch("https://api.example/admin/participants");
  assert.equal(admin.status, 404);
});

test("local D1 CHECK guard rolls back and admits only one competing revision", async () => {
  const db = await runtime.getD1Database("DB");
  const schema = await readFile(`${root}migrations/0001_mutation_fences.sql`, "utf8");
  for (const sql of schema.split(";").filter((s) => s.trim())) await db.prepare(sql).run();
  for (const sql of [
    "INSERT INTO participants VALUES ('p','subject','joined','none',0,'g','e','d')",
    "INSERT INTO participant_revisions VALUES ('p',0)",
    "INSERT INTO attestation_keys VALUES ('k','p','d','staging',x'01',0,0)",
    "INSERT INTO challenges VALUES ('c','p','d','k','staging','submit_events',x'02',100,0)",
    "CREATE TABLE test_receipts (id TEXT PRIMARY KEY)",
    "CREATE TABLE test_jobs (id TEXT PRIMARY KEY)",
  ]) await db.prepare(sql).run();
  const source = await readFile(`${root}crates/worker/src/mutation.rs`, "utf8");
  const guardSQL = source.match(/pub const GUARD_SQL: &str = r#"([\s\S]*?)"#;/)[1];
  const guard = (id) => db.prepare(guardSQL).bind(id, "p", 0, "e", 0, "g", "d", "k", "staging", 0, 1, "c", "submit_events", 99, new Uint8Array([2]).buffer);
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
