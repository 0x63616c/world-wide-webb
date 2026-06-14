import { useEffect, useState } from "react";

// Connecting screen: stepped status while the authorize request runs. The step
// text cycles for feedback; the real transition off this screen is driven by
// the flow (www-q002.7), not the timer. Step 1 is "Checking the password"
// (screens.jsx is the copy source of truth, not the deck's "Authenticating").
const STEPS = ["Checking the password", "Assigning your session", "Opening the gateway"];

export function Connecting({ email }: { email: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 408, alignItems: "center", textAlign: "center" }}>
        <div
          className="wwb-spinner wwb-spinner-lg"
          style={{ marginBottom: 22 }}
          aria-hidden="true"
        />
        <h1 className="wwb-h1">Getting you online</h1>
        <p className="wwb-sub" style={{ marginTop: 8 }}>
          {STEPS[step]}…
        </p>
        <p className="wwb-mono-faint" style={{ marginTop: 18 }}>
          {email}
        </p>
      </div>
    </div>
  );
}
