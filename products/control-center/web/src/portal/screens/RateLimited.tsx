import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { AlertIcon } from "../components/icons";
import { col, h1, stage, sub, textBtn } from "./layout";
import { neutralRing } from "./rings";

interface RateLimitedProps {
  /** Cooldown seconds; the server is the authority, this just renders it. */
  initialLeft: number;
  onRetry: () => void;
  onReset: () => void;
}

export function RateLimited({ initialLeft, onRetry, onReset }: RateLimitedProps) {
  const [left, setLeft] = useState(initialLeft);
  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span style={neutralRing}>
          <AlertIcon size={24} />
        </span>
        <h1 style={{ ...h1, marginTop: 22, fontSize: 22, width: "100%" }}>Too many attempts</h1>
        <p style={{ ...sub, marginTop: 10, width: "100%" }}>
          For security, we’ve paused sign-in for a moment.
          {left > 0 ? " Try again when the timer runs out." : " You can try again now."}
        </p>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 30,
            fontWeight: 500,
            letterSpacing: "0.02em",
            color: "var(--ink)",
            margin: "18px 0 0",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {mm}:{ss}
        </p>
        <div style={{ marginTop: 18, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" disabled={left > 0} onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button type="button" onClick={onReset} style={textBtn}>
          Start over
        </button>
      </div>
    </div>
  );
}
