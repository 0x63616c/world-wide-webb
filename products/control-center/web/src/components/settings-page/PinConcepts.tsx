/**
 * PinConcepts , Storybook-only mockups for the tile PIN gate: the small
 * tap-to-enter pin pad modal, and the change-PIN setup flow that will live in
 * the full-page Settings. Live local state (tap the pad, walk the flow), but
 * nothing persists , the real version stores the PIN via the synced settings
 * store. Correct PIN in these mocks is the default: 000000.
 */

import { type ReactNode, useState } from "react";
import { Icon } from "../Icon";
import { Switch } from "../ui/Switch";

export const PIN_LENGTH = 6;
const DEFAULT_PIN = "000000";

// ---------------------------------------------------------------------------
// PinPadView , dumb pad: entered-count dots + 3x4 keypad. Parent owns state.
// ---------------------------------------------------------------------------

export function PinPadView({
  entered,
  error,
  onDigit,
  onBackspace,
}: {
  entered: number;
  /** Paints the dots red (wrong PIN) until the next digit. */
  error?: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
      {/* Entry dots */}
      <div style={{ display: "flex", gap: 14 }}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length positions
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              border: `1.5px solid ${error ? "#c95c5c" : "var(--hair-3)"}`,
              background: i < entered ? (error ? "#c95c5c" : "var(--ink)") : "transparent",
              transition: "background 80ms",
            }}
          />
        ))}
      </div>

      {/* Keypad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 72px)", gap: 12 }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadKey key={d} onClick={() => onDigit(d)} label={d} />
        ))}
        <div />
        <PadKey label="0" onClick={() => onDigit("0")} />
        <PadKey label="backspace" onClick={onBackspace}>
          <span style={{ transform: "rotate(180deg)", display: "flex" }}>
            {/* No dedicated backspace glyph in the icon set; chevron reads fine. */}
            <Icon name="chevron" s={22} />
          </span>
        </PadKey>
      </div>
    </div>
  );
}

function PadKey({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        background: "var(--nest)",
        border: "1px solid var(--hair)",
        color: "var(--ink)",
        fontFamily: "var(--ui)",
        fontSize: 26,
        fontWeight: 500,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children ?? label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Unlock modal concept , small centered dialog over a dimmed board.
// ---------------------------------------------------------------------------

export function PinUnlockModalConcept() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  function digit(d: string) {
    if (unlocked) return;
    setError(false);
    const next = pin + d;
    if (next.length < PIN_LENGTH) {
      setPin(next);
      return;
    }
    // Full length: check.
    if (next === DEFAULT_PIN) {
      setPin(next);
      setUnlocked(true);
    } else {
      setPin("");
      setError(true);
    }
  }

  return (
    <div
      style={{
        width: 1366,
        height: 1024,
        background: "var(--bg)",
        position: "relative",
        fontFamily: "var(--ui)",
        overflow: "hidden",
      }}
    >
      {/* Stand-in board behind the dim field. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          padding: 16,
        }}
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static backdrop tiles
            key={i}
            style={{
              background: "var(--tile)",
              border: "1px solid var(--hair)",
              borderRadius: "var(--r)",
            }}
          />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "var(--tile)",
            border: "1px solid var(--hair)",
            borderRadius: "var(--r)",
            boxShadow: "0 24px 64px -16px rgba(0, 0, 0, 0.7)",
            padding: "36px 44px 40px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            color: "var(--ink)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "var(--nest)",
                border: "1px solid var(--hair)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: unlocked ? "#43a56c" : "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              <Icon name={unlocked ? "unlock" : "lock"} s={22} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {unlocked ? "Unlocked" : "Enter PIN"}
            </div>
            <div style={{ fontSize: 13, color: error ? "#c95c5c" : "var(--ink-3)" }}>
              {unlocked
                ? "Opening Settings…"
                : error
                  ? "Wrong PIN, try again"
                  : "Settings is locked"}
            </div>
          </div>
          <PinPadView
            entered={pin.length}
            error={error}
            onDigit={digit}
            onBackspace={() => {
              setError(false);
              setPin((p) => p.slice(0, -1));
            }}
          />
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "var(--ink-3)",
              fontFamily: "var(--ui)",
              fontSize: 14,
              cursor: "pointer",
              padding: 4,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change-PIN flow concept , the Security page's setup flow: verify current,
// enter new, confirm new. Framed like a Concept-A grouped card.
// ---------------------------------------------------------------------------

type ChangeStage = "current" | "new" | "confirm" | "done";

const STAGE_COPY: Record<ChangeStage, { title: string; sub: string }> = {
  current: { title: "Enter current PIN", sub: "Confirm it's you before changing the PIN." },
  new: { title: "Enter new PIN", sub: "Six digits. Used by every panel." },
  confirm: { title: "Confirm new PIN", sub: "Type the new PIN once more." },
  done: { title: "PIN changed", sub: "Synced to all panels." },
};

export function PinChangeFlowConcept() {
  const [stage, setStage] = useState<ChangeStage>("current");
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [newPin, setNewPin] = useState("");

  function digit(d: string) {
    if (stage === "done") return;
    setError(false);
    const next = pin + d;
    if (next.length < PIN_LENGTH) {
      setPin(next);
      return;
    }
    setPin("");
    if (stage === "current") {
      if (next === DEFAULT_PIN) setStage("new");
      else setError(true);
    } else if (stage === "new") {
      setNewPin(next);
      setStage("confirm");
    } else if (next === newPin) {
      setStage("done");
    } else {
      setError(true);
      setStage("new");
      setNewPin("");
    }
  }

  const copy = STAGE_COPY[stage];

  return (
    <div
      style={{
        width: 1366,
        height: 1024,
        background: "var(--bg)",
        fontFamily: "var(--ui)",
        color: "var(--ink)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 64,
      }}
    >
      <div style={{ width: 720, display: "flex", flexDirection: "column", gap: 28 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 650 }}>Security</h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
            PIN for locked tiles and settings
          </p>
        </div>

        <section>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--ink-3)",
              margin: "0 4px 8px",
            }}
          >
            Change PIN
          </div>
          <div
            style={{
              background: "var(--tile)",
              border: "1px solid var(--hair)",
              borderRadius: 16,
              padding: "36px 20px 40px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{copy.title}</div>
              <div style={{ fontSize: 13, color: error ? "#c95c5c" : "var(--ink-3)" }}>
                {error
                  ? stage === "current"
                    ? "Wrong PIN, try again"
                    : "PINs didn't match, start over"
                  : copy.sub}
              </div>
            </div>
            {stage === "done" ? (
              <div style={{ color: "#43a56c", padding: 24 }}>
                <Icon name="unlock" s={44} />
              </div>
            ) : (
              <PinPadView
                entered={pin.length}
                error={error}
                onDigit={digit}
                onBackspace={() => {
                  setError(false);
                  setPin((p) => p.slice(0, -1));
                }}
              />
            )}
            {/* Stage progress , which of the three steps you're on. */}
            {stage !== "done" ? (
              <div style={{ display: "flex", gap: 8 }}>
                {(["current", "new", "confirm"] as const).map((s) => (
                  <div
                    key={s}
                    style={{
                      width: 24,
                      height: 4,
                      borderRadius: 2,
                      background: s === stage ? "var(--ink-2)" : "var(--nest)",
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--ink-3)",
              margin: "0 4px 8px",
            }}
          >
            Locked tiles
          </div>
          <div
            style={{
              background: "var(--tile)",
              border: "1px solid var(--hair)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            {[
              { label: "Settings", sub: "Require PIN to open settings." },
              { label: "Wake photos", sub: "Require PIN to view captured wake photos." },
            ].map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "14px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--hair)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 15 }}>{row.label}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{row.sub}</span>
                </div>
                <DemoLockSwitch label={row.label} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// Real shared Switch driven by throwaway local state , the mock rows toggle
// but persist nothing.
function DemoLockSwitch({ label }: { label: string }) {
  const [on, setOn] = useState(true);
  return <Switch label={`Require PIN for ${label}`} checked={on} onChange={setOn} />;
}
