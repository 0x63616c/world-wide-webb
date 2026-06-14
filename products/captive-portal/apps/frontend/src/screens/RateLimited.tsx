import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { AlertIcon } from "@/components/icons";

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
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-icon-ring">
          <AlertIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          Too many attempts
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          For security, we’ve paused sign-in for a moment.
          {left > 0 ? " Try again when the timer runs out." : " You can try again now."}
        </p>
        <p className="wwb-countdown">
          {mm}:{ss}
        </p>
        <div style={{ marginTop: 18, width: "100%", maxWidth: 300 }}>
          <Button type="button" variant="primary" disabled={left > 0} onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button type="button" className="wwb-textbtn" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}
