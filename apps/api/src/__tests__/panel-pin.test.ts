import { beforeEach, expect, it, vi } from "vitest";

const { limit } = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("../db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) },
}));

import { verifyPanelPIN } from "../services/panel-pin";

beforeEach(() => vi.resetAllMocks());
it("compares only well-formed persisted PINs", async () => {
  limit.mockResolvedValue([{ value: { pinCode: "123456" } }]);
  expect(await verifyPanelPIN("123456")).toBe(true);
  expect(await verifyPanelPIN("654321")).toBe(false);
  expect(await verifyPanelPIN("123")).toBe(false);
});
it("does not substitute a default for missing, corrupt or unreadable settings", async () => {
  for (const rows of [[], [{ value: {} }], [{ value: { pinCode: "bad" } }]]) {
    limit.mockResolvedValue(rows);
    expect(await verifyPanelPIN("000000")).toBe(false);
  }
  limit.mockRejectedValue(new Error("unavailable"));
  await expect(verifyPanelPIN("000000")).rejects.toThrow();
});
