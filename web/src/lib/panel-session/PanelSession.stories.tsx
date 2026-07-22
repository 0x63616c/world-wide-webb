/**
 * panel-session , the ended→wake sequence (plan step 5). A live harness driving
 * the real session clock: it enables the session on a short timeout, so after a
 * beat the panel SESSION ENDS (dimmed + locked + home) and a wake shield appears;
 * tapping it wakes into a fresh, still-locked active session.
 *
 * This is the session MODEL on its own , the real wall wiring (DimOverlay,
 * backlight, camera glide-home) lives in Board; here the "dim" is a plain scrim
 * so the phase transition is visible without an iPad backlight.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { __resetSessionForTests, panelSession, setSessionEnabled } from "./index";

// Short so the story ends the session within a couple of seconds of viewing.
const STORY_TIMEOUT_MS = 2_000;

function SessionDemo() {
  const phase = panelSession.usePhase();
  const unlocked = panelSession.useIsUnlocked();

  // Drive the real clock: reset (so re-visiting the story restarts it), set a
  // short timeout, enable. Disable + reset on unmount so the singleton clock
  // never bleeds into another story.
  useEffect(() => {
    __resetSessionForTests();
    panelSession.setTimeoutMs(STORY_TIMEOUT_MS);
    setSessionEnabled(true);
    return () => {
      setSessionEnabled(false);
      __resetSessionForTests();
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: 480,
        height: 320,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid var(--hair)",
        background: "var(--tile)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
      }}
    >
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Panel board</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          phase: <strong>{phase}</strong> · {unlocked ? "unlocked" : "locked"}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
          Leave it idle ~2s , the session ends (dim + lock + home).
        </div>
        <button type="button" onClick={() => panelSession.touch()} style={{ alignSelf: "start" }}>
          touch (rearm)
        </button>
      </div>

      {phase === "ended" && (
        // The wake shield: the first tap is swallowed (wake only) and rearms a
        // fresh locked session , the DimOverlay's job on the real panel.
        <button
          type="button"
          data-testid="story-wake-shield"
          onPointerDown={(e) => {
            e.preventDefault();
            panelSession.touch();
          }}
          style={{
            position: "absolute",
            inset: 0,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontFamily: "var(--ui)",
            fontSize: 15,
            background: "rgba(0, 0, 0, 0.86)",
            cursor: "pointer",
          }}
        >
          Panel asleep , tap to wake
        </button>
      )}
    </div>
  );
}

const meta = {
  title: "Lib/PanelSession",
  component: SessionDemo,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof SessionDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Idle ~2s → the panel ends its session (scrim shows); tap it to wake. */
export const EndedThenWake: Story = {};
