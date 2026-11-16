import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { root } from "./harness.mjs";

// Local workerd only. No remote binding, account identifier, token, or deploy command.
test("database minimum-build policy uses bounded cached reads and preserves recovery", async () => {
  const make = (minimum) =>
    new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: `policy-${minimum}`,
            modules: [
              { type: "ESModule", path: `${root}crates/worker/build/index.js` },
              {
                type: "CompiledWasm",
                path: `${root}crates/worker/build/index_bg.wasm`,
              },
            ],
            compatibilityDate: "2026-11-04",
            d1Databases: { DB: `policy-${minimum}` },
          },
        ],
      }),
    );
  const worker = make("10"),
    disabled = make("0"),
    invalid = make("invalid");
  try {
    for (const [instance, minimum] of [
      [worker, 10],
      [disabled, 0],
    ]) {
      const db = await instance.getD1Database("DB");
      for (const migration of [
        "0013_operations.sql",
        "0020_admin_minimum_build.sql",
        "0024_bot_simulation.sql",
        "0025_bot_simulation_always_on.sql",
      ])
        for (const sql of (
          await readFile(`${root}migrations/${migration}`, "utf8")
        )
          .split(";")
          .filter((s) => s.trim()))
          await db.prepare(sql).run();
      await db
        .prepare("UPDATE administrative_configuration SET minimum_ios_build=?")
        .bind(minimum)
        .run();
      await assert.rejects(
        db
          .prepare(
            "UPDATE administrative_configuration SET minimum_ios_build=-1",
          )
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE administrative_configuration SET minimum_ios_build=2147483648",
          )
          .run(),
      );
    }
    const policy = await worker.dispatchFetch(
      "https://api.example/v1/client-policy",
    );
    assert.equal(policy.status, 200);
    assert.equal((await policy.json()).minimum_ios_build, 10);
    assert.equal(policy.headers.get("Cache-Control"), "no-store");
    await (
      await worker.getD1Database("DB")
    )
      .prepare("DROP TABLE administrative_configuration")
      .run(); // hot requests use the cached policy, not another database read
    for (const build of [undefined, "9", "bad", "2147483648"]) {
      const headers = build === undefined ? {} : { "X-Folding-Build": build };
      const result = await worker.dispatchFetch(
        "https://api.example/v1/event-batches",
        { method: "POST", headers, body: "x".repeat(256 * 1024 + 1) },
      );
      assert.equal(result.status, 426);
      const body = await result.json();
      assert.equal(body.code, "app_update_required");
      assert.equal(body.retryable, true);
      assert.equal(body.retry_after_seconds, 3600);
      assert.equal(body.minimum_ios_build, 10);
      assert.equal(result.headers.get("X-Folding-Minimum-Build"), "10");
    }
    const current = await worker.dispatchFetch(
      "https://api.example/v1/event-batches",
      {
        method: "POST",
        headers: { "X-Folding-Build": "10" },
        body: "x".repeat(256 * 1024 + 1),
      },
    );
    assert.equal(current.status, 413); // compatibility is not authentication; ordinary checks still run
    const legacy = await disabled.dispatchFetch("https://api.example/v1/me");
    assert.equal(legacy.status, 503); // reaches unconfigured auth, not retirement
    const deletion = await worker.dispatchFetch(
      "https://api.example/v1/account/delete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(deletion.status, 503);
    assert.equal(
      (await invalid.dispatchFetch("https://api.example/v1/client-policy"))
        .status,
      503,
    );
  } finally {
    await Promise.all([
      worker.dispose(),
      disabled.dispose(),
      invalid.dispose(),
    ]);
  }
});
