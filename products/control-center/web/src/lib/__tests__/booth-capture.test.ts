import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type BoothMode,
  bakeFrame,
  drawBoothFrame,
  formatStampDate,
  orderGifFrames,
  uploadBoothPhoto,
} from "../booth-capture";

// A recording stand-in for CanvasRenderingContext2D: booth-capture's drawing
// touches only these members, and jsdom's canvas has no real 2d context, so we
// spy on the calls instead of rendering pixels. `filter` is a tracked setter so
// a test can assert the exact filter string that was live at draw time.
function mockCtx() {
  const calls = {
    filters: [] as string[],
    translate: [] as [number, number][],
    scale: [] as [number, number][],
    drawImage: 0,
    fillText: [] as string[],
  };
  let filter = "none";
  const ctx = {
    get filter() {
      return filter;
    },
    set filter(v: string) {
      filter = v;
      calls.filters.push(v);
    },
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    save() {},
    restore() {},
    translate(x: number, y: number) {
      calls.translate.push([x, y]);
    },
    scale(x: number, y: number) {
      calls.scale.push([x, y]);
    },
    drawImage() {
      calls.drawImage += 1;
    },
    fillText(text: string) {
      calls.fillText.push(text);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const source = {} as unknown as CanvasImageSource;
const stampDate = new Date(Date.UTC(2026, 6, 19, 15, 4, 0));

describe("booth-capture drawBoothFrame", () => {
  it("applies the given CSS filter to the video draw", () => {
    const { ctx, calls } = mockCtx();
    drawBoothFrame(ctx, source, { filterCss: "sepia(0.6)", mirror: false, stampDate }, 640, 480);
    expect(calls.filters).toContain("sepia(0.6)");
    expect(calls.drawImage).toBe(1);
  });

  it("mirrors horizontally when mirror is true", () => {
    const { ctx, calls } = mockCtx();
    drawBoothFrame(ctx, source, { filterCss: "none", mirror: true, stampDate }, 640, 480);
    expect(calls.translate).toContainEqual([640, 0]);
    expect(calls.scale).toContainEqual([-1, 1]);
  });

  it("does not mirror when mirror is false", () => {
    const { ctx, calls } = mockCtx();
    drawBoothFrame(ctx, source, { filterCss: "none", mirror: false, stampDate }, 640, 480);
    expect(calls.scale).not.toContainEqual([-1, 1]);
  });

  it("stamps the capture date over the frame", () => {
    const { ctx, calls } = mockCtx();
    drawBoothFrame(ctx, source, { filterCss: "none", mirror: false, stampDate }, 640, 480);
    expect(calls.fillText.some((t) => t.includes("2026.07.19"))).toBe(true);
  });
});

describe("booth-capture formatStampDate", () => {
  it("formats as YYYY.MM.DD HH:MM in local time", () => {
    // Build from local parts so the assertion is timezone-agnostic.
    const d = new Date(2026, 0, 5, 9, 3, 0);
    expect(formatStampDate(d)).toBe("2026.01.05 09:03");
  });
});

describe("booth-capture orderGifFrames", () => {
  it("returns a copy unchanged when boomerang is off", () => {
    const frames = ["a", "b", "c"];
    const out = orderGifFrames(frames, false);
    expect(out).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(frames);
  });

  it("appends the reversed interior for a boomerang loop", () => {
    expect(orderGifFrames(["a", "b", "c"], true)).toEqual(["a", "b", "c", "b"]);
    expect(orderGifFrames(["a", "b", "c", "d"], true)).toEqual(["a", "b", "c", "d", "c", "b"]);
  });

  it("leaves too-short sequences alone", () => {
    expect(orderGifFrames(["a", "b"], true)).toEqual(["a", "b"]);
  });
});

describe("booth-capture uploadBoothPhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(
    status = 201,
    body: unknown = { id: "bph_abc123", path: "2026/07/19/1-0.jpg" },
  ) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return calls;
  }

  it("posts the blob to the booth upload route with attribution headers", async () => {
    const calls = stubFetch();
    const blob = new Blob(["x"], { type: "image/jpeg" });
    const res = await uploadBoothPhoto(blob, {
      mode: "burst",
      groupId: "bpg_grp1",
      capturedAt: 1_752_849_600_000,
      frameIdx: 2,
    });

    expect(res).toEqual({ id: "bph_abc123" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/media/booth-photo");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(blob);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["x-mode"]).toBe("burst");
    expect(headers["x-group-id"]).toBe("bpg_grp1");
    expect(headers["x-frame-idx"]).toBe("2");
    expect(headers["x-captured-at"]).toBe("1752849600000");
    expect(headers["x-device-id"]).toMatch(/.+/);
    // Unfiltered by default: no filter in meta means no x-filter header.
    expect(headers).not.toHaveProperty("x-filter");
  });

  it("sends the x-filter header for a filtered still", async () => {
    const calls = stubFetch();
    await uploadBoothPhoto(new Blob(["x"], { type: "image/jpeg" }), {
      mode: "photo",
      capturedAt: 1,
      filter: "noir",
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-filter"]).toBe("noir");
  });

  it("sends image/gif content type for gif captures", async () => {
    const calls = stubFetch();
    await uploadBoothPhoto(new Blob(["g"], { type: "image/gif" }), {
      mode: "gif",
      groupId: "bpg_g",
      capturedAt: 1,
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("image/gif");
    expect(headers["x-mode"]).toBe("gif");
  });

  it("defaults the frame index and omits the group header when absent", async () => {
    const calls = stubFetch();
    await uploadBoothPhoto(new Blob(["x"], { type: "image/jpeg" }), {
      mode: "photo",
      capturedAt: 1,
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-frame-idx"]).toBe("0");
    expect(headers).not.toHaveProperty("x-group-id");
    expect(headers).not.toHaveProperty("x-filter");
  });

  it("throws when the server rejects the upload", async () => {
    stubFetch(413, "too large");
    await expect(
      uploadBoothPhoto(new Blob(["x"], { type: "image/jpeg" }), { mode: "photo", capturedAt: 1 }),
    ).rejects.toThrow(/413/);
  });
});

describe("booth-capture bakeFrame", () => {
  it("throws when no 2d context is available (jsdom canvas)", async () => {
    // jsdom's HTMLCanvasElement has no 2d context; bakeFrame surfaces that
    // rather than silently producing an empty capture. The real render path is
    // covered by drawBoothFrame's unit tests above.
    const video = { videoWidth: 640, videoHeight: 480 } as unknown as HTMLVideoElement;
    await expect(
      bakeFrame(video, { filterCss: "none", mirror: false, stampDate }),
    ).rejects.toThrow();
  });
});

// Type-level guard: the mode union stays in lockstep with the backend schema.
const _modes: BoothMode[] = ["photo", "burst", "four_frame", "gif"];
void _modes;
