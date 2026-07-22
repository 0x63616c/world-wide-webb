import { afterEach, describe, expect, it, vi } from "vitest";

import {
  awaitVideoReady,
  BURST_DELAYS_MS,
  captureWakeBurst,
  uploadBurstFramesForTests,
  videoHasFrame,
} from "../wake-capture";

describe("wake-capture", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

    captureWakeBurst("isn_abc123abc123", runner);
    captureWakeBurst("isn_abc123abc123", runner); // overlaps , must not start a second stream
    expect(runs).toBe(1);

    release();
    await Promise.resolve(); // let the finally re-arm
    await Promise.resolve();

    captureWakeBurst("isn_abc123abc123", runner);
    expect(runs).toBe(2);
    release();
  });

  it("hands the session id to the runner", () => {
    let seen: string | null = "unset" as string | null;
    captureWakeBurst("isn_abc123abc123", (sessionId) => {
      seen = sessionId;
      return Promise.resolve();
    });
    expect(seen).toBe("isn_abc123abc123");
  });

  it("swallows runner failures and re-arms", async () => {
    captureWakeBurst(null, () => Promise.reject(new Error("no camera")));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    let ran = false;
    captureWakeBurst(null, () => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });

  it("sends the session id and frame index on every uploaded frame", async () => {
    const calls: { sessionId: string | null; frameIdx: string | null }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({
        sessionId: headers["x-session-id"] ?? null,
        frameIdx: headers["x-frame-idx"] ?? null,
      });
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await uploadBurstFramesForTests("isn_abc123abc123", [
      new Blob(["a"], { type: "image/jpeg" }),
      new Blob(["b"], { type: "image/jpeg" }),
    ]);

    expect(calls).toEqual([
      { sessionId: "isn_abc123abc123", frameIdx: "0" },
      { sessionId: "isn_abc123abc123", frameIdx: "1" },
    ]);
  });

  it("videoHasFrame is true only once both dimensions are non-zero", () => {
    expect(videoHasFrame({ videoWidth: 0, videoHeight: 0 })).toBe(false);
    expect(videoHasFrame({ videoWidth: 640, videoHeight: 0 })).toBe(false);
    expect(videoHasFrame({ videoWidth: 640, videoHeight: 480 })).toBe(true);
  });

  it("awaitVideoReady resolves true as soon as a real frame appears", async () => {
    // A cold camera: 0×0 for a couple of polls, then a real frame decodes.
    const video = { videoWidth: 0, videoHeight: 0 };
    setTimeout(() => {
      video.videoWidth = 640;
      video.videoHeight = 480;
    }, 60);
    const ready = await awaitVideoReady(video, 1000, 20);
    expect(ready).toBe(true);
  });

  it("awaitVideoReady gives up (false) when no frame ever arrives", async () => {
    const ready = await awaitVideoReady({ videoWidth: 0, videoHeight: 0 }, 80, 20);
    expect(ready).toBe(false);
  });

  it("awaitVideoReady returns immediately when the frame is already ready", async () => {
    const ready = await awaitVideoReady({ videoWidth: 1280, videoHeight: 720 }, 1000, 20);
    expect(ready).toBe(true);
  });

  it("omits the session header entirely when no session is live", async () => {
    const headerLists: string[][] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      headerLists.push(Object.keys(init.headers as Record<string, string>));
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await uploadBurstFramesForTests(null, [new Blob(["a"], { type: "image/jpeg" })]);
    expect(headerLists[0]).not.toContain("x-session-id");
    expect(headerLists[0]).toContain("x-device-id");
  });
});
