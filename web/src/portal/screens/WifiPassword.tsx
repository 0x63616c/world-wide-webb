import { type FormEvent, useState } from "react";
import { Alert } from "../../components/ui/Alert";
import { Button } from "../../components/ui/Button";
import { CheckboxRow } from "../../components/ui/CheckboxRow";
import { Field } from "../../components/ui/Field";
import { TextInput } from "../../components/ui/TextInput";
import { LockIcon } from "../components/icons";
import { col, h1, stage, sub } from "./layout";

interface WifiPasswordProps {
  error?: string | null;
  networkError?: boolean;
  busy?: boolean;
  agreed: boolean;
  onAgreeChange: (v: boolean) => void;
  onSubmit: (password: string) => void;
  onOpenTerms: () => void;
  initialValue?: string;
  initialShow?: boolean;
}

// The sole entry screen (password-only portal, www-p9hx): the guest types the
// shared Wi-Fi password and agrees to the terms, then connects. No email/OTP.
export function WifiPassword({
  error,
  networkError,
  busy,
  agreed,
  onAgreeChange,
  onSubmit,
  onOpenTerms,
  initialValue = "",
  initialShow = false,
}: WifiPasswordProps) {
  const [pw, setPw] = useState(initialValue);
  const [show, setShow] = useState(initialShow);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(pw);
  };
  return (
    <div style={stage}>
      <div style={{ ...col, maxWidth: 420 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginBottom: 22,
          }}
        >
          <h1 style={h1}>Enter the Wi-Fi password</h1>
          <p style={{ ...sub, marginTop: 10 }}>Ask your host for the password to get online.</p>
        </div>

        <form
          onSubmit={submit}
          noValidate
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {networkError && (
            <Alert title="Couldn’t connect.">
              The network didn’t respond. Check you’re in range and try again.
            </Alert>
          )}
          <Field
            id="w-pass"
            label="Wi-Fi password"
            icon={<LockIcon size={16} />}
            error={error ?? undefined}
          >
            <TextInput
              id="w-pass"
              label="Wi-Fi password"
              type={show ? "text" : "password"}
              icon
              error={!!error}
              placeholder="Enter the password"
              autoComplete="off"
              value={pw}
              disabled={busy}
              style={{ paddingRight: 58, height: 42 }}
              onChange={setPw}
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShow((s) => !s)}
              disabled={busy}
              aria-pressed={show}
              aria-label={show ? "Hide password" : "Show password"}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                height: 30,
                padding: "0 9px",
                display: "inline-flex",
                alignItems: "center",
                fontFamily: "var(--ui)",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--ink-2)",
                background: "transparent",
                border: "none",
                borderRadius: 6,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              {show ? "Hide" : "Show"}
            </button>
          </Field>

          <div style={{ marginTop: 2 }}>
            <CheckboxRow id="w-terms" checked={agreed} onChange={onAgreeChange}>
              I agree to the{" "}
              {/* biome-ignore lint/a11y/useValidAnchor: in-app link that opens the Terms screen */}
              <a
                href="#terms"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenTerms();
                }}
                style={{ color: "var(--ink)", fontWeight: 500 }}
              >
                terms of use
              </a>
              .
            </CheckboxRow>
          </div>

          <Button type="submit" variant="primary" loading={busy} disabled={!pw || !agreed}>
            Connect to Wi-Fi
          </Button>
        </form>
      </div>
    </div>
  );
}
