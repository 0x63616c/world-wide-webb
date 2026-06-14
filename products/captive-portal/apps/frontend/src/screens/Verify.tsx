import { useEffect, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { CheckIcon } from "@/components/icons";
import { OtpInput } from "@/components/OtpInput";

interface VerifyProps {
  email: string;
  error?: string | null;
  /** Distinguishes the "Code expired." alert from "Incorrect code." */
  expired?: boolean;
  busy?: boolean;
  onVerify: (code: string) => void;
  onResend: () => void;
  onBack: () => void;
  initialCode?: string;
  /** Resend cooldown seconds (server-enforced; this renders the live countdown). */
  initialLeft?: number;
  initialResent?: boolean;
}

export function Verify({
  email,
  error,
  expired,
  busy,
  onVerify,
  onResend,
  onBack,
  initialCode = "",
  initialLeft = 30,
  initialResent = false,
}: VerifyProps) {
  const [code, setCode] = useState(initialCode);
  const [left, setLeft] = useState(initialLeft);
  const [resent, setResent] = useState(initialResent);

  useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  // Clear the code when a fresh error arrives so the user can retype immediately.
  useEffect(() => {
    if (error) setCode("");
  }, [error]);

  const canResend = left <= 0 || !!expired;
  const resend = () => {
    if (!canResend) return;
    onResend();
    setCode("");
    setLeft(30);
    setResent(true);
    setTimeout(() => setResent(false), 2600);
  };

  const ready = code.length === 6;

  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 420 }}>
        <div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              marginBottom: 22,
            }}
          >
            <h1 className="wwb-h1">Check your email</h1>
            <p className="wwb-sub" style={{ marginTop: 10 }}>
              We sent a 6-digit code to
              <br />
              <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{email}</span>
              <br />
              Enter it below to confirm it’s you.
            </p>
          </div>

          {error && (
            <div style={{ marginBottom: 16 }}>
              <Alert title={expired ? "Code expired." : "Incorrect code."}>{error}</Alert>
            </div>
          )}

          <OtpInput
            value={code}
            onChange={setCode}
            error={!!error}
            disabled={busy}
            onComplete={(c) => onVerify(c)}
          />

          <div style={{ marginTop: 18 }}>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={!ready}
              onClick={() => onVerify(code)}
            >
              Verify &amp; connect
            </Button>
          </div>

          <div className="wwb-resend" style={{ marginTop: 16 }}>
            {resent ? (
              <span className="wwb-resend-ok">
                <CheckIcon /> New code sent
              </span>
            ) : canResend ? (
              <span>
                Didn’t get it?{" "}
                <button type="button" className="wwb-resend-btn" onClick={resend}>
                  Resend code
                </button>
              </span>
            ) : (
              <span>
                Didn’t get it? <span className="wwb-resend-wait">Resend in {left}s</span>
              </span>
            )}
          </div>
        </div>

        <p className="wwb-foot" style={{ textAlign: "center", marginTop: 18 }}>
          Wrong address?{" "}
          <button
            type="button"
            className="wwb-resend-btn"
            onClick={onBack}
            style={{ fontSize: 12.5 }}
          >
            Use a different email
          </button>
        </p>
      </div>
    </div>
  );
}
