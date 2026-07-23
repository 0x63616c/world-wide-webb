import { expect, it } from "vitest";
import { APP_BRAND, defineApp } from "./define-app";
import {
  API_FACET_BRAND,
  CRON_BRAND,
  defineApi,
  defineCron,
  defineJobs,
  JOBS_FACET_BRAND,
} from "./define-facets";

const Dummy = () => null;

it("defineApp brands and passes through the manifest", () => {
  const m = defineApp({
    id: "demo",
    tile: { label: "Demo", component: Dummy, worldCol: 0, worldRow: 0, cols: 1, rows: 1 },
  });
  expect(m.id).toBe("demo");
  expect((m as Record<symbol, unknown>)[APP_BRAND]).toBe(true);
});

it("facet wrappers brand their payload", () => {
  expect((defineApi({} as never) as Record<symbol, unknown>)[API_FACET_BRAND]).toBe(true);
  expect(
    (
      defineJobs([{ type: "demo_job" as never, handler: async () => {}, maxMs: 1000 }]) as Record<
        symbol,
        unknown
      >
    )[JOBS_FACET_BRAND],
  ).toBe(true);
  expect(
    (
      defineCron({ name: "c", schedule: "* * * * *", run: async () => {} }) as Record<
        symbol,
        unknown
      >
    )[CRON_BRAND],
  ).toBe(true);
});
