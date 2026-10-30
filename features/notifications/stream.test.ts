import { afterEach, expect, it, vi } from "vitest";
import { notificationStream } from "./stream";

afterEach(() => vi.useRealTimers());
it("drains pages immediately, emits heartbeats and cancels pending waits", async () => {
  vi.useFakeTimers();
  const list = vi
    .fn()
    .mockResolvedValueOnce({ items: [], cursor: "10", has_more: true })
    .mockResolvedValue({ items: [], cursor: "11", has_more: false });
  const response = notificationStream(new Request("http://test/"), "0", list);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing body");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("id: 10");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");
  expect(list).toHaveBeenNthCalledWith(2, { since: "10", limit: 200 });
  const pending = reader.read();
  await vi.advanceTimersByTimeAsync(1000);
  expect(new TextDecoder().decode((await pending).value)).toContain("heartbeat");
  await reader.cancel();
  await vi.advanceTimersByTimeAsync(5000);
  expect(list).toHaveBeenCalledTimes(3);
});
it("closes on abort and rolls the stream after 55 seconds for reconnect", async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const list = vi.fn().mockResolvedValue({ items: [], cursor: "0", has_more: false });
  const reader = notificationStream(
    new Request("http://test/", { signal: abort.signal }),
    undefined,
    list,
  ).body?.getReader();
  if (!reader) throw new Error("Missing body");
  await reader.read();
  const pending = reader.read();
  abort.abort();
  expect((await pending).done).toBe(true);
  const second = notificationStream(new Request("http://test/"), undefined, list).body?.getReader();
  if (!second) throw new Error("Missing body");
  await second.read();
  vi.setSystemTime(Date.now() + 56_000);
  const end = second.read();
  await vi.advanceTimersByTimeAsync(1000);
  expect((await end).done).toBe(true);
});
it("propagates database failure so clients reconnect or poll", async () => {
  const reader = notificationStream(
    new Request("http://test/"),
    "0",
    vi.fn().mockRejectedValue(new Error("offline")),
  ).body?.getReader();
  if (!reader) throw new Error("Missing body");
  await expect(reader.read()).rejects.toThrow("offline");
});
