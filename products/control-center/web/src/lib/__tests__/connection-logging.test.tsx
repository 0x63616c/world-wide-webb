/**
 * Query + connection logging.
 *
 * These cover the entries that make "Unable to connect" explain itself. The
 * end-to-end behaviour (banner fires -> `conn connection lost {failing:[...]}`)
 * was verified by pointing the dev proxy at a closed port and reading the entry
 * back out of IndexedDB; what is pinned here is the logic underneath it, which is
 * where a regression would actually hide.
 *
 * Deliberately no renderHook over useConnectionStatus: driving that hook with a
 * live React Query cache spins a render loop under test (the hook sets fresh
 * state on every cache event), which hangs the runner rather than failing it. The
 * hook is thin glue over the two functions tested below.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { getTail, log } from "../log/logger";
import { failingQueryKeys, installQueryLogging } from "../log/query-log";
import { isConnectivityError } from "../useConnectionStatus";

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
}

/** Build a cache entry keyed the way tRPC keys them: [[path...], {type}]. */
function seedQuery(client: QueryClient, path: string[]) {
  client.getQueryCache().build(client, { queryKey: [path, { type: "query" }] });
  const all = client.getQueryCache().getAll();
  return all[all.length - 1];
}

function since(n: number, source: string) {
  return getTail()
    .slice(n)
    .filter((e) => e.source === source);
}

describe("connection logging", () => {
  it("names the failing procedures, which is what the banner cannot do", () => {
    const client = makeClient();
    const weather = seedQuery(client, ["weather", "now"]);
    const camera = seedQuery(client, ["camera", "info"]);
    seedQuery(client, ["settings", "get"]); // healthy, must not be listed

    weather.setState({ status: "error", error: new Error("502") } as never);
    camera.setState({ status: "error", error: new Error("502") } as never);

    expect(failingQueryKeys(client).sort()).toEqual(["camera.info", "weather.now"]);
  });

  it("logs a query's fall into error and its recovery , each exactly once", () => {
    // A failing dashboard produces a storm of cache events (every query, every
    // retry). The log must record the TRANSITION, not every event, or the outage
    // buries the evidence around it under duplicate lines.
    const client = makeClient();
    const before = getTail().length;
    const stop = installQueryLogging(client);
    const query = seedQuery(client, ["weather", "now"]);

    query.setState({ status: "error", error: new Error("502") } as never);
    query.setState({ status: "error", error: new Error("502") } as never);
    query.setState({ status: "error", error: new Error("502") } as never);

    const errors = since(before, "query").filter((e) => e.msg.includes("-> error"));
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toBe("weather.now -> error");
    expect(errors[0].level).toBe("warn");

    query.setState({ status: "success", data: {}, error: null } as never);
    query.setState({ status: "success", data: {}, error: null } as never);

    const recovered = since(before, "query").filter((e) => e.msg.includes("-> recovered"));
    expect(recovered).toHaveLength(1);

    stop();
  });

  it("stops logging once unsubscribed", () => {
    const client = makeClient();
    const stop = installQueryLogging(client);
    const query = seedQuery(client, ["weather", "now"]);
    stop();

    const before = getTail().length;
    query.setState({ status: "error", error: new Error("502") } as never);
    expect(since(before, "query")).toHaveLength(0);
  });

  it("treats a structured server error as reachable, not a lost connection", () => {
    // A tRPC procedure that throws (SERVICE_UNAVAILABLE because one HA entity is
    // down) proves the server answered; only a response-less failure is outage
    // evidence. Regression: tesla.get 503s spammed "Panel lost contact with the
    // API" every 92s while every other tile was fine.
    const serverError = Object.assign(new Error("SERVICE_UNAVAILABLE"), {
      data: { httpStatus: 503 },
    });
    expect(isConnectivityError(serverError)).toBe(false);

    // fetch TypeError / ingress error page: no parsed tRPC data on the error.
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    const unparseable = Object.assign(new Error("502"), { data: undefined });
    expect(isConnectivityError(unparseable)).toBe(true);
    expect(isConnectivityError(null)).toBe(true);
  });

  it("keeps a log call off the hot path", () => {
    // A log call must cost an array write and a queue push, nothing more: this
    // runs on an always-on kiosk with an FPS meter, and logging that drops frames
    // is a failed feature. No await, no I/O, no throw , even 1k in a tight loop.
    const before = getTail().length;
    const started = performance.now();
    for (let i = 0; i < 1_000; i += 1) log.debug(`hot ${i}`, { i });
    const elapsed = performance.now() - started;

    expect(getTail().length).toBeGreaterThan(before);
    expect(elapsed).toBeLessThan(250);
  });
});
