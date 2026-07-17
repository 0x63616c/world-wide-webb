import { describe, expect, it } from "vitest";

import { BURST_DELAYS_MS, captureWakeBurst } from "../wake-capture";

describe("wake-capture", () => {
  it("burst spreads three frames over ~2s", () => {
    expect(BURST_DELAYS_MS).toEqual([700, 1300, 2000]);
    expect([...BURST_DELAYS_MS]).toEqual([...BURST_DELAYS_MS].sort((a, b) => a - b));
  });

  it("dedupes overlapping bursts and re-arms after completion", async () => {
    let runs = 0;
    let release: () => void = () => {};
    const runner = () => {
      runs += 1;
      return new Promise<void>((r) => {
        release = r;
      });
    };

    captureWakeBurst(runner);
    captureWakeBurst(runner); // overlaps , must not start a second stream
    expect(runs).toBe(1);

    release();
    await Promise.resolve(); // let the finally re-arm
    await Promise.resolve();

    captureWakeBurst(runner);
    expect(runs).toBe(2);
    release();
  });

  it("swallows runner failures and re-arms", async () => {
    captureWakeBurst(() => Promise.reject(new Error("no camera")));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let ran = false;
    captureWakeBurst(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });
});
