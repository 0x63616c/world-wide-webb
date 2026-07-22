import { useEffect, useState } from "react";
import { col, h1, stage, sub } from "./layout";

// Connecting screen: stepped status while the authorize request runs. The step
// text cycles for feedback; the real transition off this screen is driven by
// the flow (www-q002.7), not the timer. Step 1 is "Checking the password"
// (screens.jsx is the copy source of truth, not the deck's "Authenticating").
const STEPS = ["Checking the password", "Assigning your session", "Opening the gateway"];

export function Connecting() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 408, alignItems: "center", textAlign: "center" }}>
        <span
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "2.5px solid var(--hair-2)",
            borderTopColor: "var(--ink)",
            animation: "spin 0.6s linear infinite",
            marginBottom: 22,
          }}
        />
        <h1 style={h1}>Getting you online</h1>
        <p style={{ ...sub, marginTop: 8 }}>{STEPS[step]}…</p>
      </div>
    </div>
  );
}
