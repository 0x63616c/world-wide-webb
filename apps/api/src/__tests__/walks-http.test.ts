import { readFileSync } from "node:fs";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc/context";

vi.mock("@features/walks/service", () => ({
  walkService: {
    state: vi.fn(),
    history: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { api } from "@features/walks/api";
import { walkService } from "@features/walks/service";

beforeEach(() => vi.clearAllMocks());
describe("plain tRPC v11 HTTP fixtures", () => {
  it.each([
    "state",
    "history",
    "start",
    "stop",
    "update",
    "delete",
  ] as const)("serves walks.%s without a transformer", async (name) => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(`../../../../docs/contracts/walks/fixtures/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
    vi.mocked(walkService[name]).mockResolvedValueOnce(fixture.result.data);
    const query = name === "state" || name === "history";
    const input = ["stop", "update", "delete"].includes(name) ? { id: "walk_example" } : {};
    const request = new Request(
      `http://localhost/trpc/walks.${name}${query ? `?input=${encodeURIComponent(JSON.stringify(input))}` : ""}`,
      {
        method: query ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(query ? {} : { body: JSON.stringify(input) }),
      },
    );
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router: api,
      createContext: () => ({}) as Context,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture);
  });
});
