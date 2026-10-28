import { describe, expect, it } from "vitest";
import { isMediaUnavailable, MediaGuard, MediaUnavailableError } from "./index";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const never = () => new Promise<never>(() => {});
const errno = (code: string) => Object.assign(new Error(code), { code });

describe("MediaGuard", () => {
  it("passes results and ordinary errors through without tripping", async () => {
    const g = new MediaGuard({ timeoutMs: 50, cooldownMs: 1_000 });
    await expect(g.run("ok", async () => 42)).resolves.toBe(42);
    await expect(g.run("missing", () => Promise.reject(errno("ENOENT")))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(g.isOpen).toBe(false);
  });

  it("times out a hung op and then fails fast without calling the op", async () => {
    const c = clock();
    const g = new MediaGuard({ timeoutMs: 20, cooldownMs: 1_000, now: c.now });
    await expect(g.run("hang", never)).rejects.toBeInstanceOf(MediaUnavailableError);
    expect(g.isOpen).toBe(true);

    let called = false;
    const err = await g
      .run("next", async () => {
        called = true;
      })
      .catch((e) => e);
    expect(isMediaUnavailable(err)).toBe(true);
    expect(called).toBe(false);
  });

  it("trips on soft-mount errno (EIO) and wraps it", async () => {
    const g = new MediaGuard({ timeoutMs: 50, cooldownMs: 1_000 });
    await expect(g.run("eio", () => Promise.reject(errno("EIO")))).rejects.toBeInstanceOf(
      MediaUnavailableError,
    );
    expect(g.isOpen).toBe(true);
  });

  it("lets one probe through after the cooldown and closes on success", async () => {
    const c = clock();
    const g = new MediaGuard({ timeoutMs: 20, cooldownMs: 100, now: c.now });
    await expect(g.run("hang", never)).rejects.toBeInstanceOf(MediaUnavailableError);
    c.advance(101);
    await expect(g.run("probe", async () => "back")).resolves.toBe("back");
    expect(g.isOpen).toBe(false);
  });

  it("rejects concurrent calls while the probe is in flight, and re-opens if it fails", async () => {
    const c = clock();
    const g = new MediaGuard({ timeoutMs: 20, cooldownMs: 100, now: c.now });
    await expect(g.run("hang", never)).rejects.toBeInstanceOf(MediaUnavailableError);
    c.advance(101);
    const probe = g.run("probe", never);
    await expect(g.run("concurrent", async () => 1)).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(probe).rejects.toBeInstanceOf(MediaUnavailableError);
    expect(g.isOpen).toBe(true);
  });
});
