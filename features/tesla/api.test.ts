import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@app-kit/server", async (original) => ({
  ...(await original<typeof import("@app-kit/server")>()),
  verifyPanelPIN: vi.fn(),
}));
vi.mock("./service", () => ({ teslaService: { state: vi.fn(), command: vi.fn() } }));

import { verifyPanelPIN } from "@app-kit/server";
import { api } from "./api";
import { teslaService } from "./service";

const caller = api.createCaller({} as Parameters<typeof api.createCaller>[0]);
beforeEach(() => vi.resetAllMocks());
describe("Tesla router", () => {
  it("serves typed unconfigured state", async () => {
    vi.mocked(teslaService.state).mockResolvedValue({ status: "unconfigured", data: null });
    expect(await caller.tesla.state()).toEqual({ status: "unconfigured", data: null });
  });
  it("requires a fresh valid PIN on every command", async () => {
    vi.mocked(verifyPanelPIN).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(teslaService.command).mockResolvedValue({ accepted: true });
    expect(await caller.tesla.command({ action: "unlock", pin: "123456" })).toEqual({
      accepted: true,
    });
    await expect(caller.tesla.command({ action: "unlock", pin: "123456" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(teslaService.command).toHaveBeenCalledTimes(1);
    expect(teslaService.command).toHaveBeenCalledWith("unlock");
  });
  it.each([
    { action: "unlock" },
    { action: "unlock", pin: "123" },
    { action: "wake", pin: "123456" },
    { action: "unlock", pin: "123456", entity_id: "lock.arbitrary" },
  ])("rejects invalid commands before PIN or HA", async (input) => {
    await expect(caller.tesla.command(input as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(verifyPanelPIN).not.toHaveBeenCalled();
    expect(teslaService.command).not.toHaveBeenCalled();
  });
  it("fails closed on PIN storage failure without leaking the error", async () => {
    vi.mocked(verifyPanelPIN).mockRejectedValue(new Error("private database details"));
    await expect(caller.tesla.command({ action: "lock", pin: "123456" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "PIN verification is unavailable.",
    });
    expect(teslaService.command).not.toHaveBeenCalled();
  });
  it("returns generic command failure", async () => {
    vi.mocked(verifyPanelPIN).mockResolvedValue(true);
    vi.mocked(teslaService.command).mockRejectedValue(new Error("private vehicle data"));
    await expect(caller.tesla.command({ action: "lock", pin: "123456" })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Tesla command is unavailable.",
    });
  });
});
