import { expect, test } from "bun:test";
import worker from "../src/index";

const env = { ENVIRONMENT: "staging" as const, RELEASE_REVISION: "test-revision" };

test("health reports the selected environment and revision without caching", async () => {
  const response = await worker.fetch(new Request("https://example.test/healthz"), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ status: "ok", environment: "staging", revision: "test-revision" });
});

test("unknown routes and mutation methods fail explicitly", async () => {
  expect((await worker.fetch(new Request("https://example.test/private"), env)).status).toBe(404);
  const response = await worker.fetch(new Request("https://example.test/healthz", { method: "POST" }), env);
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
});
