import { type FormEvent, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { CheckboxRow } from "@/components/CheckboxRow";
import { Field } from "@/components/Field";
import { LockIcon } from "@/components/icons";
import { TextInput } from "@/components/TextInput";

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
            <h1 className="wwb-h1">Enter the Wi-Fi password</h1>
            <p className="wwb-sub" style={{ marginTop: 10 }}>
              Ask your host for the password to get online.
            </p>
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
              icon={<LockIcon />}
              error={error ?? undefined}
            >
              <TextInput
                id="w-pass"
                type={show ? "text" : "password"}
                icon
                error={!!error}
                placeholder="Enter the password"
                autoComplete="off"
                value={pw}
                disabled={busy}
                style={{ paddingRight: 58 }}
                onChange={(e) => setPw(e.target.value)}
              />
              <button
                type="button"
                className="wwb-pw-toggle"
                tabIndex={-1}
                onClick={() => setShow((s) => !s)}
                disabled={busy}
                aria-pressed={show}
                aria-label={show ? "Hide password" : "Show password"}
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
    </div>
  );
}
