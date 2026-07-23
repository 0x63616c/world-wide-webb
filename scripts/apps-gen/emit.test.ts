import { expect, it } from "vitest";
import { collect } from "./collect";
import { renderTiles } from "./emit";

// The determinism gate for the emitter (Task 3.3): renderTiles() over the real
// collected model must be stable across two calls, and the emitted apps must be
// sorted by id. This is what makes `bun run apps:gen` twice produce zero diff.
it("renders tiles sorted by id and is stable across two runs", async () => {
  const model = await collect();
  const a = renderTiles(model);
  const b = renderTiles(model);
  expect(a).toBe(b);
  const ids = [...a.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual([...ids].sort());
});
