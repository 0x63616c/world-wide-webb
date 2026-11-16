import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { localWorker, root } from "./harness.mjs";

// Local workerd only. No remote binding, account identifier, token, or deploy command.
const protectionRuntime = localWorker({
  name: "folding-burst-local",
  bindings: { DEPLOYMENT: "production" },
  d1Databases: { DB: "burst-local" },
  ratelimits: {
    API_NETWORK_BURST: {
      namespace_id: "910",
      simple: { limit: 3, period: 60 },
    },
    AUTH_NETWORK_BURST: {
      namespace_id: "911",
      simple: { limit: 1, period: 60 },
    },
    API_CREDENTIAL_BURST: {
      namespace_id: "912",
      simple: { limit: 1, period: 60 },
    },
  },
});
after(() => protectionRuntime.dispose());
test("pre-database burst limits cover forged credentials and rotating-token floods", async () => {
  const db = await protectionRuntime.getD1Database("DB");
  await db
    .prepare(
      "CREATE TABLE ingestion_metrics(minute_ms INTEGER PRIMARY KEY,requests INTEGER,failures INTEGER)",
    )
    .run();
  const get = (ip, token, path = "/v1/me") =>
    protectionRuntime.dispatchFetch(`https://api.example${path}`, {
      headers: { "CF-Connecting-IP": ip, Authorization: `Bearer ${token}` },
    });
  assert.equal((await get("192.0.2.80", "one")).status, 503);
  const credential = await get("192.0.2.81", "one", "/v1/event-batches");
  assert.equal(credential.status, 429);
  assert.equal(credential.headers.get("Retry-After"), "60");
  for (let i = 0; i < 3; i++)
    assert.equal((await get("192.0.2.82", `rotate-${i}`)).status, 503);
  const network = await protectionRuntime.dispatchFetch(
    "https://api.example/v1/event-batches",
    {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "192.0.2.82",
        Authorization: "Bearer new-token",
      },
      body: "x".repeat(256 * 1024 + 1),
    },
  );
  assert.equal(network.status, 429);
  assert.equal(
    await db.prepare("SELECT count(*) n FROM ingestion_metrics").first("n"),
    0,
  );
  assert.equal((await get("192.0.2.83", "fresh")).status, 503);
  await get("192.0.2.84", "auth-a", "/v1/auth/challenges");
  assert.equal(
    (await get("192.0.2.84", "auth-b", "/v1/auth/challenges")).status,
    429,
  );
});
test("D1 neighbor lookups stay scoped and negative score deltas apply atomically", async () => {
  const db = await protectionRuntime.getD1Database("DB");
  await db
    .prepare(
      "CREATE TABLE observations(participant_id TEXT,event_id TEXT,device_id TEXT,sequence INTEGER,event_json TEXT,disposition TEXT,PRIMARY KEY(participant_id,event_id),UNIQUE(participant_id,device_id,sequence))",
    )
    .run();
  const migration = await readFile(
    `${root}migrations/0019_resource_protection.sql`,
    "utf8",
  );
  await db
    .prepare(migration.split("CREATE INDEX jobs_category_state")[0])
    .run();
  for (const [id, sequence, owner] of [
    ["a", 1, "p"],
    ["c", 3, "p"],
    ["private", 2, "other"],
  ]) {
    const event = {
      event_id: id,
      device_id: "d",
      sequence,
      generation: { revision: 0, reset_id: "g" },
      is_test: false,
    };
    await db
      .prepare("INSERT INTO observations VALUES (?,?,'d',?,?,'accepted')")
      .bind(owner, id, sequence, JSON.stringify(event))
      .run();
  }
  const source = await readFile(
    `${root}crates/worker/src/ingestion_neighbors.rs`,
    "utf8",
  );
  const query = source.match(
    /pub const NEIGHBORS_SQL: &str = r#"([\s\S]*?)"#;/,
  )[1];
  const input = {
    events: [
      {
        event_id: "b",
        device_id: "d",
        sequence: 2,
        generation: { revision: 0, reset_id: "g" },
      },
    ],
  };
  const rows = (await db.prepare(query).bind("p", JSON.stringify(input)).all())
    .results;
  assert.deepEqual(rows.map((r) => JSON.parse(r.event_json).event_id).sort(), [
    "a",
    "c",
  ]);
  await db
    .prepare(
      "CREATE TABLE live_scores(participant_id TEXT,generation_revision INTEGER,generation_id TEXT,period_id TEXT,folds INTEGER CHECK(folds>=0),revision INTEGER,PRIMARY KEY(participant_id,period_id))",
    )
    .run();
  const scoring = await readFile(
    `${root}crates/worker/src/competition_runtime.rs`,
    "utf8",
  );
  const delta = scoring.match(
    /const SCORE_DELTA_SQL: &str = r#"([\s\S]*?)"#;/,
  )[1];
  await db.prepare(delta).bind("p", 0, "g", "week", 1, 1).run();
  await db.prepare(delta).bind("p", 0, "g", "week", -1, 2).run();
  assert.equal(
    await db
      .prepare("SELECT folds FROM live_scores WHERE participant_id='p'")
      .first("folds"),
    0,
  );
  await assert.rejects(
    db.prepare(delta).bind("p", 0, "g", "week", -1, 3).run(),
  );
  assert.equal(
    await db
      .prepare("SELECT revision FROM live_scores WHERE participant_id='p'")
      .first("revision"),
    2,
  );
});
