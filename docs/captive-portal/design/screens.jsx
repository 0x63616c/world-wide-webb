// screens.jsx, world-wide-webb captive portal screens
// Depends on components.jsx (window globals). Exports screens to window.

const {
  Logo,
  Field,
  TextInput,
  CheckboxRow,
  Button,
  Alert,
  NetworkPill,
  OtpInput,
  MailIcon,
  UserIcon,
  LockIcon,
  CheckIcon,
  WifiIcon,
  AlertIcon,
  ArrowLeft,
} = window;

/* =========================================================================
   GuestForm, the shared form body used by every landing variant
   ========================================================================= */
function GuestForm({
  state,
  errors,
  networkError,
  busy,
  onChange,
  onSubmit,
  onOpenTerms,
  compact,
}) {
  const submit = (e) => {
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
          error={errors.name}
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
          error={errors.email}
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
          error={errors.agreed}
          onChange={(v) => onChange("agreed", v)}
        >
          I agree to the{" "}
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
        {errors.agreed && (
          <div className="wwb-error" style={{ marginLeft: 27, marginTop: 8 }} role="alert">
            <window.AlertIcon />
            <span>{errors.agreed}</span>
          </div>
        )}
      </div>

      <Button type="submit" variant="primary" loading={busy}>
        {busy ? "Connecting…" : "Connect to Wi-Fi"}
      </Button>
    </form>
  );
}

/* =========================================================================
   Variant A, Centered card (default, classic shadcn auth card)
   ========================================================================= */
function LandingCentered(props) {
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

/* =========================================================================
   Variant B, Split hero (desktop: copy left / form right)
   ========================================================================= */
function LandingSplit(props) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-split">
        <div className="wwb-split-hero">
          <Logo size={48} />
          <NetworkPill />
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

/* =========================================================================
   Variant C, Bare minimal (no card; form floats on black)
   ========================================================================= */
function LandingBare(props) {
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

function CheckIconSm() {
  return (
    <span style={{ display: "inline-flex", width: 16, height: 16, color: "var(--success)" }}>
      <CheckIcon />
    </span>
  );
}

function FooterNote({ onOpenTerms, bare }) {
  return (
    <p className="wwb-foot" style={{ textAlign: bare ? "left" : "center", marginTop: 18 }}>
      By connecting you agree to our{" "}
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

/* =========================================================================
   Email verification (6-digit code)
   ========================================================================= */
function Verify({
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
}) {
  const [code, setCode] = React.useState(initialCode);
  const [left, setLeft] = React.useState(initialLeft);
  const [resent, setResent] = React.useState(initialResent);

  React.useEffect(() => {
    if (left <= 0) return undefined;
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  // clear the code when a fresh error arrives so the user can retype
  React.useEffect(() => {
    if (error) setCode("");
  }, [error]);

  const canResend = left <= 0 || expired;
  const resend = () => {
    if (!canResend) return;
    onResend && onResend();
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

/* =========================================================================
   Wi-Fi password (asked after email is verified)
   ========================================================================= */
function WifiPassword({
  error,
  networkError,
  busy,
  onSubmit,
  onBack,
  initialValue = "",
  initialShow = false,
}) {
  const [pw, setPw] = React.useState(initialValue);
  const [show, setShow] = React.useState(initialShow);
  const submit = (e) => {
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
            <Field id="w-pass" label="Wi-Fi password" icon={<LockIcon />} error={error}>
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

/* =========================================================================
   Already connected (returning device, session still valid)
   ========================================================================= */
function AlreadyConnected({ email, onReset }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-success-ring">
          <CheckIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          You’re already online.
        </h1>
        <p className="wwb-sub" style={{ marginTop: 8, width: "100%" }}>
          This device is already signed in, nothing to do.
        </p>
        <div style={{ marginTop: 24, width: "100%", maxWidth: 300 }}>
          <Button
            variant="primary"
            onClick={() => {
              window.open("https://example.com", "_blank");
            }}
          >
            Continue browsing
          </Button>
        </div>
        <button className="wwb-textbtn" onClick={onReset}>
          Not you? Sign in again
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   Connecting screen
   ========================================================================= */
function Connecting({ email }) {
  const [step, setStep] = React.useState(0);
  const steps = ["Checking the password", "Assigning your session", "Opening the gateway"];
  React.useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 408, alignItems: "center", textAlign: "center" }}>
        <div className="wwb-spinner wwb-spinner-lg" style={{ marginBottom: 22 }} />
        <h1 className="wwb-h1">Getting you online</h1>
        <p className="wwb-sub" style={{ marginTop: 8 }}>
          {steps[step]}…
        </p>
        <p className="wwb-mono-faint" style={{ marginTop: 18 }}>
          {email}
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
   Success screen
   ========================================================================= */
function Success({ name, email, onReset }) {
  const first = (name || "").trim().split(/\s+/)[0] || "friend";
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-success-ring">
          <CheckIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          You’re online, {first}.
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          Your browser should redirect automatically. If it doesn’t, tap below.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button
            variant="primary"
            onClick={() => {
              window.open("https://example.com", "_blank");
            }}
          >
            Start browsing
          </Button>
        </div>
      </div>
    </div>
  );
}

function SessionRow({ label, value }) {
  return (
    <div className="wwb-session-row">
      <span className="wwb-session-label">{label}</span>
      <span className="wwb-session-value">{value}</span>
    </div>
  );
}

/* =========================================================================
   Sending the code (brief loading after landing submit)
   ========================================================================= */
function Sending({ email }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 408, alignItems: "center", textAlign: "center" }}>
        <div className="wwb-spinner wwb-spinner-lg" style={{ marginBottom: 22 }} />
        <h1 className="wwb-h1">Sending your code</h1>
        <p className="wwb-sub" style={{ marginTop: 8 }}>
          It’s on its way to your inbox.
        </p>
        <p className="wwb-mono-faint" style={{ marginTop: 18 }}>
          {email}
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
   Too many attempts (rate limited)
   ========================================================================= */
function RateLimited({ seconds = 60, onRetry, onReset, initialLeft }) {
  const [left, setLeft] = React.useState(initialLeft != null ? initialLeft : seconds);
  React.useEffect(() => {
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
          <Button variant="primary" disabled={left > 0} onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button className="wwb-textbtn" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   Session expired (30-day access lapsed)
   ========================================================================= */
function SessionExpired({ onReconnect }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-icon-ring">
          <WifiIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          Your access has expired
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          Your 30-day Wi-Fi access has ended. Sign in again to reconnect this device.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button variant="primary" onClick={onReconnect}>
            Sign in again
          </Button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Generic error (server / unexpected)
   ========================================================================= */
function GenericError({ onRetry, onReset }) {
  return (
    <div className="wwb-stage wwb-stage-center">
      <div className="wwb-col" style={{ maxWidth: 360, alignItems: "center", textAlign: "center" }}>
        <span className="wwb-icon-ring">
          <AlertIcon />
        </span>
        <h1 className="wwb-h1" style={{ marginTop: 22, fontSize: 22, width: "100%" }}>
          Something went wrong
        </h1>
        <p className="wwb-sub" style={{ marginTop: 10, width: "100%" }}>
          We couldn’t complete your connection. Please try again in a moment.
        </p>
        <div style={{ marginTop: 22, width: "100%", maxWidth: 300 }}>
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        </div>
        <button className="wwb-textbtn" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}

/* =========================================================================
   Terms of use page
   ========================================================================= */
function Terms({ onBack }) {
  return (
    <div className="wwb-stage wwb-stage-terms">
      <div className="wwb-col" style={{ maxWidth: 620, width: "100%" }}>
        <button className="wwb-backbtn" onClick={onBack}>
          <ArrowLeft /> Back
        </button>
        <div className="wwb-card" style={{ padding: "34px 34px 30px", marginTop: 16 }}>
          <h1 className="wwb-h1" style={{ fontSize: 26, marginTop: 0 }}>
            Terms of use
          </h1>
          <p className="wwb-mono-faint" style={{ marginTop: 6 }}>
            Last updated · Jun 2026
          </p>

          <div className="wwb-prose">
            <TermsSection n="1" title="A friendly network">
              This is a private home Wi-Fi network offered as a courtesy. By connecting, you agree
              to use it responsibly and in line with these terms.
            </TermsSection>
            <TermsSection n="2" title="Acceptable use">
              Please don’t use the connection for anything illegal, for downloading or sharing
              copyrighted material without permission, or for activity that disrupts the network or
              other devices on it.
            </TermsSection>
            <TermsSection n="3" title="What we collect">
              We record the name and email you provide, along with your device identifier and
              connection time, purely to manage access. We don’t sell your details or use them for
              marketing.
            </TermsSection>
            <TermsSection n="4" title="Access &amp; sessions">
              A session lasts 30 days, after which you may be asked to sign in again. Access may be
              paused or revoked at any time to keep the network healthy.
            </TermsSection>
            <TermsSection n="5" title="No warranty">
              The network is provided “as is.” We can’t guarantee speed, uptime, or security, and
              we’re not liable for any loss arising from its use. Treat any public or shared network
              with sensible caution.
            </TermsSection>
          </div>

          <hr className="wwb-divider" style={{ margin: "24px 0 18px" }} />
          <p className="wwb-foot" style={{ textAlign: "left" }}>
            Questions about the network? Ask your host, they’ll sort you out.
          </p>
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function TermsSection({ n, title, children }) {
  return (
    <section className="wwb-prose-sec">
      <h2>
        <span className="wwb-prose-n">{n}</span>
        {title}
      </h2>
      <p>{children}</p>
    </section>
  );
}

Object.assign(window, {
  GuestForm,
  LandingCentered,
  LandingSplit,
  LandingBare,
  Verify,
  WifiPassword,
  AlreadyConnected,
  Connecting,
  Success,
  Terms,
  Sending,
  RateLimited,
  SessionExpired,
  GenericError,
});
