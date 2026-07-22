/**
 * PushRegistrar covers the bug where a device with `pushEnabled` already true
 * never re-registered, so a token that never reached the server could never be
 * recovered without toggling the setting off and on again.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enablePush = vi.fn();
const mutate = vi.fn();
let pushEnabled = false;

vi.mock("../../lib/push", () => ({
  enablePush: (fn: unknown) => enablePush(fn),
}));

vi.mock("../../lib/settings", () => ({
  useSettings: () => ({ pushEnabled }),
}));

vi.mock("../../lib/trpc", () => ({
  trpc: { notifications: { registerToken: { useMutation: () => ({ mutate }) } } },
}));

import { PushRegistrar } from "../PushRegistrar";

beforeEach(() => {
  enablePush.mockReset().mockResolvedValue({ ok: true });
  mutate.mockReset();
  pushEnabled = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PushRegistrar", () => {
  it("re-registers at launch when push is already enabled", () => {
    // The regression: enabling push in an earlier session persists the flag, so
    // nothing would ever call register() again.
    pushEnabled = true;
    render(<PushRegistrar />);
    expect(enablePush).toHaveBeenCalledOnce();
  });

  it("does nothing when push is disabled", () => {
    pushEnabled = false;
    render(<PushRegistrar />);
    expect(enablePush).not.toHaveBeenCalled();
  });

  it("registers only once per session across re-renders", () => {
    pushEnabled = true;
    const { rerender } = render(<PushRegistrar />);
    rerender(<PushRegistrar />);
    rerender(<PushRegistrar />);
    expect(enablePush).toHaveBeenCalledOnce();
  });

  it("passes a token callback that forwards to the registerToken mutation", async () => {
    pushEnabled = true;
    render(<PushRegistrar />);
    const cb = enablePush.mock.calls[0]?.[0] as (input: unknown) => void;
    cb({ deviceId: "iphone17-2-abc", token: "tok", platform: "ios", deviceName: "iPhone" });
    expect(mutate).toHaveBeenCalledWith({
      deviceId: "iphone17-2-abc",
      token: "tok",
      platform: "ios",
      deviceName: "iPhone",
    });
  });

  it("renders nothing", () => {
    pushEnabled = true;
    const { container } = render(<PushRegistrar />);
    expect(container.innerHTML).toBe("");
  });
});
