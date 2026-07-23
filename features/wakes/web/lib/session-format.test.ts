import { describe, expect, it } from "vitest";
import { formatEventLine } from "./session-format";

describe("formatEventLine", () => {
  it("tile/tap uses the label when present", () => {
    expect(formatEventLine("tile/tap", { target: "tile_climate", label: "Climate" })).toEqual({
      line: "Tapped Climate tile",
      detail: null,
    });
  });

  it("tile/tap falls back to a prettified target when no label", () => {
    expect(formatEventLine("tile/tap", { target: "tile_sound_system" })).toEqual({
      line: "Tapped Sound system tile",
      detail: null,
    });
  });

  it("tile/tap surfaces unconsumed detail keys as a tail", () => {
    const { line, detail } = formatEventLine("tile/tap", {
      target: "tile_climate",
      label: "Climate",
      kind: "open-modal",
    });
    expect(line).toBe("Tapped Climate tile");
    expect(detail).toBe("kind: open-modal");
  });

  it("modal/open strips the modal. prefix and keeps human casing", () => {
    expect(formatEventLine("modal/open", { target: "modal.Settings" })).toEqual({
      line: "Opened Settings",
      detail: null,
    });
  });

  it("modal/close handles the pin. sub-prefix", () => {
    expect(formatEventLine("modal/close", { target: "modal.pin.Settings" })).toEqual({
      line: "Closed Settings",
      detail: null,
    });
  });

  it("settings/change renders a from → to transition", () => {
    expect(
      formatEventLine("settings/change", { target: "settings.idleDimLevel", from: 0.2, to: 0.3 }),
    ).toEqual({ line: "Set Idle dim level 0.2 → 0.3", detail: null });
  });

  it("settings/commit names the committed setting", () => {
    expect(formatEventLine("settings/commit", { target: "settings.reset" })).toEqual({
      line: "Committed Reset",
      detail: null,
    });
  });

  it("control/change with brightness reads as a percentage", () => {
    expect(
      formatEventLine("control/change", { target: "control.lamp.desk", brightness: 60 }),
    ).toEqual({ line: "Set Desk lamp → 60%", detail: null });
  });

  it("control/commit with a scene names the scene", () => {
    expect(
      formatEventLine("control/commit", { target: "control.lamp.desk", scene: "Sunset" }),
    ).toEqual({ line: "Scene → Sunset", detail: null });
  });

  it("control/change with a plain value", () => {
    expect(
      formatEventLine("control/change", { target: "control.fan.study", value: "high" }),
    ).toEqual({
      line: "Set Study fan → high",
      detail: null,
    });
  });

  it("nav/jump reads as a map jump and keeps coordinates in the tail", () => {
    expect(formatEventLine("nav/jump", { target: "minimap", worldX: 500, worldY: 300 })).toEqual({
      line: "Jumped on the map",
      detail: "worldX: 500 · worldY: 300",
    });
  });

  it("session/wake reads as waking the panel", () => {
    expect(formatEventLine("session/wake", { target: "panel" })).toEqual({
      line: "Woke the panel",
      detail: null,
    });
  });

  it("session/end names the reason and hides bookkeeping fields", () => {
    expect(
      formatEventLine("session/end", { reason: "idle-dim", events: 4, durationMs: 134000 }),
    ).toEqual({ line: "Session ended (idle-dim)", detail: null });
  });

  it("session/start is a quiet line", () => {
    expect(formatEventLine("session/start", { target: "" }).line).toBe("Session started");
  });

  it("unknown surface/action falls back to a title-cased verb + prettified target", () => {
    expect(formatEventLine("gesture/recenter", { target: "board" })).toEqual({
      line: "Recentered Board",
      detail: null,
    });
  });

  it("a totally unknown action still produces a sane line and loses nothing", () => {
    const { line, detail } = formatEventLine("mystery/wobble", {
      target: "widget_thing",
      extra: 7,
    });
    expect(line).toBe("Wobble Widget thing");
    expect(detail).toBe("extra: 7");
  });

  it("tolerates missing/garbage data without throwing", () => {
    expect(formatEventLine("tile/tap", null).line).toBe("Tapped a tile");
    expect(formatEventLine("", undefined).line).toBe("Did");
  });
});
