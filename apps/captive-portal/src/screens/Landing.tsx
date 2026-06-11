import type { FormEvent } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { CheckboxRow } from "@/components/CheckboxRow";
import { Field, fieldErrorId } from "@/components/Field";
import { AlertIcon, CheckIcon, Logo, MailIcon, UserIcon } from "@/components/icons";
import { NetworkPill } from "@/components/NetworkPill";
import { TextInput } from "@/components/TextInput";
import type { LandingErrors, LandingFormState } from "@/lib/validate";

export interface LandingProps {
  state: LandingFormState;
  errors: LandingErrors;
  networkError: boolean;
  busy: boolean;
  onChange: (key: keyof LandingFormState, value: string | boolean) => void;
  onSubmit: () => void;
  onOpenTerms: () => void;
  compact?: boolean;
}

// Shared form body used by every landing variant. The terms checkbox's error
// is rendered HERE at form level (role=alert), not inside CheckboxRow, the
// row only tints the box; the message is the form's job.
function GuestForm({
  state,
  errors,
  networkError,
  busy,
  onChange,
  onSubmit,
  onOpenTerms,
  compact,
}: LandingProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form
      onSubmit={submit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: compact ? 14 : 16 }}
    >
      {networkError && (
        <Alert title="Couldn’t connect.">
          The network didn’t respond. Check you’re in range and try again.
        </Alert>
      )}

      <Field id="f-name" label="Name" icon={<UserIcon />} error={errors.name}>
        <TextInput
          id="f-name"
          icon
          error={!!errors.name}
          placeholder="e.g. John Appleseed"
          autoComplete="name"
          value={state.name}
          disabled={busy}
          onChange={(e) => onChange("name", e.target.value)}
        />
      </Field>

      <Field id="f-email" label="Email" icon={<MailIcon />} error={errors.email}>
        <TextInput
          id="f-email"
          type="email"
          icon
          error={!!errors.email}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          value={state.email}
          disabled={busy}
          onChange={(e) => onChange("email", e.target.value)}
        />
      </Field>

      <div style={{ marginTop: 2 }}>
        <CheckboxRow
          id="f-terms"
          checked={state.agreed}
          error={!!errors.agreed}
          onChange={(v) => onChange("agreed", v)}
        >
          I agree to the{" "}
          {/* biome-ignore lint/a11y/useValidAnchor: in-app link that opens the Terms screen (design uses link-text, not a button) */}
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
        {/* Reserved error slot (CC-2nrj): always present so toggling the terms
            error never reflows the button below. role=alert only when shown. */}
        <div
          className="wwb-error wwb-error-terms"
          id={fieldErrorId("f-terms")}
          role={errors.agreed ? "alert" : undefined}
          aria-live="polite"
        >
          {errors.agreed && (
            <>
              <AlertIcon />
              <span className="wwb-error-text">{errors.agreed}</span>
            </>
          )}
        </div>
      </div>

      <Button type="submit" variant="primary" loading={busy}>
        {busy ? "Connecting…" : "Connect to Wi-Fi"}
      </Button>
    </form>
  );
}

function CheckIconSm() {
  return (
    <span style={{ display: "inline-flex", width: 16, height: 16, color: "var(--success)" }}>
      <CheckIcon />
    </span>
  );
}

function FooterNote({ onOpenTerms, bare }: { onOpenTerms: () => void; bare?: boolean }) {
  return (
    <p className="wwb-foot" style={{ textAlign: bare ? "left" : "center", marginTop: 18 }}>
      By connecting you agree to our{" "}
      {/* biome-ignore lint/a11y/useValidAnchor: in-app link that opens the Terms screen (design uses link-text, not a button) */}
      <a
        className="wwb-footlink"
        href="#terms"
        onClick={(e) => {
          e.preventDefault();
          onOpenTerms();
        }}
      >
        terms of use
      </a>
      . Be kind to the network.
    </p>
  );
}

// Variant C, Bare/minimal, the SHIPPED landing. No card, no sub line (the
// heading carries it). screens.jsx is the copy source of truth.
export function LandingBare(props: LandingProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 384 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <h1 className="wwb-h1 wwb-h1-xl" style={{ lineHeight: 1.1 }}>
            Hey there.
            <br />
            Let’s get you online.
          </h1>
          <GuestForm {...props} />
        </div>
      </div>
    </div>
  );
}

// Variant A, Centered card, stories-only (not shipped).
export function LandingCentered(props: LandingProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 408 }}>
        <div className="wwb-card" style={{ padding: "30px 30px 26px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              marginBottom: 22,
            }}
          >
            <Logo />
            <h1 className="wwb-h1" style={{ marginTop: 16 }}>
              Welcome aboard.
            </h1>
            <p className="wwb-sub" style={{ marginTop: 8 }}>
              Pop in your details and you’ll be online in a second.
            </p>
          </div>
          <GuestForm {...props} />
        </div>
        <FooterNote onOpenTerms={props.onOpenTerms} />
      </div>
    </div>
  );
}

// Variant B, Split hero, stories-only (not shipped). NetworkPill label stays
// "Wi-Fi" (never "guest"), per the PRD rule + lead ruling.
export function LandingSplit(props: LandingProps) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-split">
        <div className="wwb-split-hero">
          <Logo size={48} />
          <NetworkPill label="Wi-Fi" />
          <h1 className="wwb-h1 wwb-h1-xl">You’re almost online.</h1>
          <p className="wwb-sub wwb-sub-lg">
            Welcome to the house Wi-Fi. Add your details below and you’ll be connected in seconds.
          </p>
          <ul className="wwb-bullets">
            <li>
              <CheckIconSm /> Fast, unmetered Wi-Fi
            </li>
            <li>
              <CheckIconSm /> One quick sign-in, then you’re set
            </li>
          </ul>
        </div>
        <div className="wwb-split-form">
          <div className="wwb-card" style={{ padding: "28px 28px 24px" }}>
            <GuestForm {...props} compact />
          </div>
          <FooterNote onOpenTerms={props.onOpenTerms} />
        </div>
      </div>
    </div>
  );
}
