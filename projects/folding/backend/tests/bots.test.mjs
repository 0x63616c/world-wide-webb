import { after, test } from "node:test";
import assert from "node:assert/strict";
import { applyMigrations, localWorker } from "./harness.mjs";

// Local workerd only. No remote binding, account identifier, token, or deploy command.
const botSimulationRuntime = localWorker({
  name: "folding-bot-simulation-local",
  queueProducers: {
    JOBS: "folding-bot-sim-jobs",
    JOBS_DEAD: "folding-bot-sim-dead",
  },
  queueConsumers: {
    "folding-bot-sim-jobs": { maxBatchSize: 1, maxBatchTimeout: 0 },
  },
  bindings: {
    WORKER_VERSION: "synthetic-bot-simulation-worker",
    DEPLOYMENT: "production",
  },
  r2Buckets: { AVATARS: "folding-bot-sim-avatars" },
  d1Databases: { DB: "folding-bot-simulation" },
});
after(() => botSimulationRuntime.dispose());

function utcDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function periodIdsCovering(fromMs, toMs) {
  const ids = new Set(["all"]);
  for (let time = utcDay(fromMs); time <= toMs; time += 86400000) {
    const weekday = (new Date(time).getUTCDay() + 6) % 7;
    const weekStart = time - weekday * 86400000;
    const monthStart = Date.UTC(
      new Date(time).getUTCFullYear(),
      new Date(time).getUTCMonth(),
      1,
    );
    ids.add(`week:${weekStart}`);
    ids.add(`month:${monthStart}`);
  }
  return [...ids];
}

async function applyBotSimulationMigrations(db) {
  await applyMigrations(db);
}

async function runBotSimulationTick(db, label) {
  const before =
    (await db
      .prepare(
        "SELECT count(*) n FROM jobs WHERE kind='bot_simulation' AND state='completed'",
      )
      .first("n")) ?? 0;
  const worker = await botSimulationRuntime.getWorker();
  await worker.scheduled({ cron: "* * * * *", scheduledTime: Date.now() });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const row = await db
      .prepare(
        "SELECT state, last_error, job_id FROM jobs WHERE kind='bot_simulation' ORDER BY due_ms DESC, job_id DESC LIMIT 1",
      )
      .first();
    const completed =
      (await db
        .prepare(
          "SELECT count(*) n FROM jobs WHERE kind='bot_simulation' AND state='completed'",
        )
        .first("n")) ?? 0;
    if (completed > before && row?.state === "completed") return;
    if (row?.state === "failed") {
      throw new Error(
        `${label} failed: ${row.last_error || "execution_failed"}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const pending = await db
    .prepare(
      "SELECT job_id, state, last_error, attempts FROM jobs WHERE kind='bot_simulation' ORDER BY due_ms DESC",
    )
    .all();
  throw new Error(
    `${label} timed out: ${JSON.stringify(pending.results ?? pending)}`,
  );
}

test("launch tick creates a 50-bot roster with observations and is watermark-idempotent", async () => {
  const db = await botSimulationRuntime.getD1Database("DB");
  await applyBotSimulationMigrations(db);
  const human = "00000000-0000-4000-8000-000000009901";
  const generation = "00000000-0000-0000-0000-000000000000";
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id) VALUES (?,?,'joined','none',0,?)",
    )
    .bind(human, `human-leader-${human}`, generation)
    .run();
  await db
    .prepare("INSERT INTO participant_revisions VALUES (?,0)")
    .bind(human)
    .run();
  await db
    .prepare(
      "INSERT INTO profiles VALUES (?,'Human Leader',NULL,'approved','none')",
    )
    .bind(human)
    .run();
  const periods = periodIdsCovering(now - 800 * 86400000, now + 86400000);
  const inserts = periods.map((period) =>
    db
      .prepare(
        "INSERT INTO live_scores(participant_id,generation_revision,generation_id,period_id,folds,revision) VALUES (?,0,?,?,10000,0)",
      )
      .bind(human, generation, period),
  );
  for (let i = 0; i < inserts.length; i += 40) {
    await db.batch(inserts.slice(i, i + 40));
  }
  // Launch two days ago so the first ticks replay complete past days, independent of time of day.
  const launchedAt = now - 2 * 86400000;
  await db
    .prepare(
      "UPDATE bot_simulation_state SET launch_started_at_ms=? WHERE singleton=1",
    )
    .bind(launchedAt)
    .run();
  const botObservationCount = async () =>
    (await db
      .prepare(
        "SELECT count(*) n FROM observations o JOIN bot_profiles b ON b.participant_id=o.participant_id",
      )
      .first("n")) ?? 0;
  let ticks = 0;
  let observations = 0;
  while (ticks < 12) {
    ticks += 1;
    await runBotSimulationTick(db, `launch tick ${ticks}`);
    if (ticks === 1) {
      assert.equal(
        await db.prepare("SELECT count(*) n FROM bot_profiles").first("n"),
        50,
      );
    }
    observations = await botObservationCount();
    if (observations > 0) break;
  }
  assert.ok(
    observations > 0,
    `launch ticks should persist bot observations after ${ticks} ticks`,
  );
  const eventIds = (
    await db
      .prepare(
        "SELECT o.event_id FROM observations o JOIN bot_profiles b ON b.participant_id=o.participant_id ORDER BY o.event_id",
      )
      .all()
  ).results.map((row) => row.event_id);
  const watermark = await db
    .prepare(
      "SELECT watermark_ms, cursor_participant_id, revision, launch_started_at_ms FROM bot_simulation_state WHERE singleton=1",
    )
    .first();
  assert.ok(watermark.launch_started_at_ms > 0);
  await db
    .prepare(
      "UPDATE bot_simulation_state SET watermark_ms=0, cursor_participant_id=NULL WHERE singleton=1",
    )
    .run();
  for (let i = 1; i <= ticks; i++) {
    await runBotSimulationTick(db, `replay tick ${i}`);
  }
  assert.equal(
    await db.prepare("SELECT count(*) n FROM bot_profiles").first("n"),
    50,
  );
  // A replayed slice keeps every event it already wrote (deterministic IDs) and may only continue
  // a day the per-tick write limit left unfinished.
  const replayedIds = new Set(
    (
      await db
        .prepare(
          "SELECT o.event_id FROM observations o JOIN bot_profiles b ON b.participant_id=o.participant_id",
        )
        .all()
    ).results.map((row) => row.event_id),
  );
  assert.ok(eventIds.every((id) => replayedIds.has(id)));
  const leaders = (
    await db
      .prepare(
        `SELECT s.period_id, s.participant_id, s.folds
         FROM live_scores s
         JOIN bot_profiles b ON b.participant_id=s.participant_id
         WHERE s.folds>0 AND s.folds >= (
           SELECT max(s2.folds) FROM live_scores s2 WHERE s2.period_id=s.period_id
         )`,
      )
      .all()
  ).results;
  assert.deepEqual(
    leaders,
    [],
    "no bot may be #1 or tied for first on any board",
  );
  // Catch up past the launch days: the watermark stops at today and no future fold is recorded.
  for (let i = 1; i <= 20; i++) {
    await runBotSimulationTick(db, `catch-up tick ${i}`);
  }
  const caughtUp = Date.now();
  assert.equal(
    (
      await db
        .prepare(
          "SELECT watermark_ms FROM bot_simulation_state WHERE singleton=1",
        )
        .first()
    ).watermark_ms,
    Math.floor(caughtUp / 86400000) * 86400000,
  );
  assert.equal(
    await db
      .prepare(
        "SELECT count(*) n FROM observations o JOIN bot_profiles b ON b.participant_id=o.participant_id WHERE json_extract(o.event_json,'$.observed_at_ms') > ? OR json_extract(o.event_json,'$.observed_at_ms') < ?",
      )
      .bind(caughtUp, Math.floor(launchedAt / 86400000) * 86400000)
      .first("n"),
    0,
  );
  // Replaying completed past days from scratch writes nothing new.
  const today = Math.floor(caughtUp / 86400000) * 86400000;
  const pastEvents = async () =>
    db
      .prepare(
        "SELECT count(*) n FROM observations o JOIN bot_profiles b ON b.participant_id=o.participant_id WHERE json_extract(o.event_json,'$.observed_at_ms') < ?",
      )
      .bind(today)
      .first("n");
  const pastBefore = await pastEvents();
  assert.ok(pastBefore > 0);
  await db
    .prepare(
      "UPDATE bot_simulation_state SET watermark_ms=0, cursor_participant_id=NULL WHERE singleton=1",
    )
    .run();
  for (let i = 1; i <= 15; i++) {
    await runBotSimulationTick(db, `full replay tick ${i}`);
  }
  assert.equal(await pastEvents(), pastBefore);
});
