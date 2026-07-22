import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSessionForTests,
  DEFAULT_SESSION_TIMEOUT_MS,
  panelSession,
  registerSessionEffects,
  runSessionEnd,
  type SessionEndEffects,
  setSessionEnabled,
} from "../index";

function spyEffects(order: string[]): SessionEndEffects {
  return {
    dim: vi.fn(() => order.push("dim")),
    closeTileDetail: vi.fn(() => order.push("closeTileDetail")),
    clearModals: vi.fn(() => order.push("clearModals")),
    glideHome: vi.fn(() => order.push("glideHome")),
  };
}

describe("runSessionEnd", () => {
  it("dims, then strips overlays, then homes the camera , in that order", () => {
    const order: string[] = [];
    runSessionEnd(spyEffects(order));
    expect(order).toEqual(["dim", "closeTileDetail", "clearModals", "glideHome"]);
  });
});

describe("registerSessionEffects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSessionForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the fan-out once when the real session clock ends", () => {
    const order: string[] = [];
    const fx = spyEffects(order);
    registerSessionEffects(fx);
    setSessionEnabled(true);

    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);

    expect(order).toEqual(["dim", "closeTileDetail", "clearModals", "glideHome"]);
    expect(fx.dim).toHaveBeenCalledOnce();
    // The fan-out observes an already-locked, ended session.
    expect(panelSession.phase()).toBe("ended");
    expect(panelSession.isUnlocked()).toBe(false);
  });

  it("stops firing after unregister", () => {
    const fx = spyEffects([]);
    const off = registerSessionEffects(fx);
    off();
    setSessionEnabled(true);
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    expect(fx.glideHome).not.toHaveBeenCalled();
  });

  it("fires again for each subsequent session (wake then re-idle)", () => {
    const fx = spyEffects([]);
    registerSessionEffects(fx);
    setSessionEnabled(true);

    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);
    panelSession.touch(); // wake
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS);

    expect(fx.glideHome).toHaveBeenCalledTimes(2);
  });
});
