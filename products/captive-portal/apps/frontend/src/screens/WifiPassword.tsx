import { type FormEvent, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { LockIcon } from "@/components/icons";
import { TextInput } from "@/components/TextInput";

interface WifiPasswordProps {
  error?: string | null;
  networkError?: boolean;
  busy?: boolean;
  onSubmit: (password: string) => void;
  onBack: () => void;
  initialValue?: string;
  initialShow?: boolean;
}

// Asked after the email is verified: the host shares the network password.
export function WifiPassword({
  error,
  networkError,
  busy,
  onSubmit,
  onBack,
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
              Ask your host for the password to access this network.
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
            <Button type="submit" variant="primary" loading={busy} disabled={!pw}>
              Connect to Wi-Fi
            </Button>
          </form>
        </div>
        <p className="wwb-foot" style={{ textAlign: "center", marginTop: 18 }}>
          <button
            type="button"
            className="wwb-resend-btn"
            onClick={onBack}
            style={{ fontSize: 12.5 }}
          >
            Go back
          </button>
        </p>
      </div>
    </div>
  );
}
