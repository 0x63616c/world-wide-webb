// ds-flow.jsx, Flow & states: state machine, per-screen spec, validation rules,
// copy deck, accessibility checklist, edge-case matrix. Depends on ds-kit.jsx.

const {
  Section,
  Sub,
  Lead,
  Note,
  Notes,
  Table,
  ScreenCard,
  Chip,
  Chips,
  ChecklistCard,
  FlowNode,
  FlowArrow,
} = window;

/* --------------------------------- Flow map --------------------------------- */
function FlowSection() {
  return (
    <Section
      id="flow"
      eyebrow="Flow"
      title="State machine"
      lead="One linear happy path, collect details, verify email, enter the Wi-Fi password, connect, with recovery branches off every step. A returning device that’s still in its 30-day window skips straight to “already online”."
    >
      <div className="ds-flow">
        <div className="ds-flow-track">
          <FlowNode k="01" t="Landing" d="Name · email · terms" />
          <FlowArrow />
          <FlowNode k="02" t="Sending code" d="~1.3s loading" />
          <FlowArrow />
          <FlowNode k="03" t="Verify email" d="6-digit code" />
          <FlowArrow />
          <FlowNode k="04" t="Wi-Fi password" d="from the host" />
          <FlowArrow />
          <FlowNode k="05" t="Connecting" d="~2.6s" />
          <FlowArrow />
          <FlowNode k="06" t="You’re online" d="Success" variant="terminal" />
        </div>
        <div className="ds-flow-track" style={{ paddingTop: 4 }}>
          <FlowNode
            k="E1"
            t="Code wrong / expired"
            d="inline on Verify · 3 wrong → rate limit"
            variant="error"
          />
          <FlowNode
            k="E2"
            t="Wrong password"
            d="inline on step 04 · 3 wrong → rate limit"
            variant="error"
          />
          <FlowNode k="E3" t="Network failure" d="returns to step 04 with alert" variant="error" />
          <FlowNode k="E4" t="Too many attempts" d="cooldown timer → retry" variant="error" />
          <FlowNode k="E5" t="Session expired" d="30-day lapse → restart" variant="error" />
          <FlowNode k="E6" t="Something went wrong" d="generic fallback → retry" variant="error" />
        </div>
        <div className="ds-flow-legend">
          <span>
            <span
              className="ds-leg-box"
              style={{ borderColor: "var(--border-strong)", background: "#0c0c0c" }}
            />{" "}
            Step
          </span>
          <span>
            <span
              className="ds-leg-box"
              style={{ borderColor: "rgba(255,255,255,0.22)", background: "#111" }}
            />{" "}
            Terminal
          </span>
          <span>
            <span className="ds-leg-box" style={{ borderColor: "var(--destructive-border)" }} />{" "}
            Error / recovery
          </span>
        </div>
      </div>
      <Notes>
        <Note tag="spec">
          Screen state is a single enum:{" "}
          <code>
            landing · sending · verify · password · connecting · success · ratelimited ·
            sessionexpired · error · terms
          </code>
          . Terms is a modal-style detour that returns to wherever it was opened from.
        </Note>
        <Note tag="impl">
          Guard every transition on a request lifecycle. The two simulated delays (
          <code>sending</code> ~1.3s, <code>connecting</code> ~2.6s) stand in for real network
          calls, replace with actual request/response and keep the loading screens until they
          resolve.
        </Note>
        <Note tag="edge">
          Both wrong-code and wrong-password counters trip the same lockout at <b>3</b> attempts.
          Reset the counters on a successful step and on a fresh resend.
        </Note>
      </Notes>
    </Section>
  );
}

/* ------------------------------ Per-screen spec ----------------------------- */
function ScreensSection() {
  return (
    <Section
      id="screens"
      eyebrow="Flow"
      title="Screens, one by one"
      lead="Every screen with its trigger, contents, the actions that leave it, and the error states it owns. Build each to be reachable, recoverable and refresh-safe."
    >
      <div className="ds-screens">
        <ScreenCard
          idx="01"
          name="Landing"
          route="state: landing"
          rows={[
            {
              k: "Shows",
              v: (
                <span>
                  Welcome line, <b>Name</b> + <b>Email</b> fields, required <b>terms</b> checkbox,
                  primary <b>Connect</b>. Free-floating (no card) on the bare layout.
                </span>
              ),
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Valid submit → <code>sending</code>. Terms link → <code>terms</code>.
                </span>
              ),
            },
            {
              k: "Errors",
              v: (
                <Chips>
                  <Chip kind="err">name required</Chip>
                  <Chip kind="err">email required</Chip>
                  <Chip kind="err">email format</Chip>
                  <Chip kind="err">terms unticked</Chip>
                </Chips>
              ),
            },
            {
              k: "Variants",
              v: (
                <span>
                  Three landing layouts, <b>centered</b>, <b>split hero</b>, <b>bare</b> (shipped).
                  Same form + logic underneath.
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="02"
          name="Sending code"
          route="state: sending"
          rows={[
            { k: "Shows", v: "Large spinner, “Sending your code”, the destination email in mono." },
            {
              k: "Leaves on",
              v: (
                <span>
                  Code dispatched → <code>verify</code>. Send failure → <code>error</code>.
                </span>
              ),
            },
            { k: "Duration", v: "Transient, driven by the real send request, not a fixed timer." },
          ]}
        />
        <ScreenCard
          idx="03"
          name="Verify email"
          route="state: verify"
          rows={[
            {
              k: "Shows",
              v: (
                <span>
                  “Check your email”, destination email on its own line, <b>6-box OTP</b>, and a
                  resend row with a <b>30s</b> cooldown.
                </span>
              ),
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Correct code → <code>password</code>. Back → <code>landing</code>.
                </span>
              ),
            },
            {
              k: "Errors",
              v: (
                <Chips>
                  <Chip kind="err">incorrect code</Chip>
                  <Chip kind="err">code expired</Chip>
                  <Chip>3 wrong → ratelimited</Chip>
                </Chips>
              ),
            },
            {
              k: "Resend",
              v: (
                <span>
                  Disabled with a live “Resend in <b>{`{n}`}</b>s” countdown; enabled at 0 or once a
                  code expires. Resending shows a brief “New code sent” confirmation and resets the
                  timer.
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="04"
          name="Wi-Fi password"
          route="state: password"
          rows={[
            {
              k: "Shows",
              v: (
                <span>
                  “Enter the Wi-Fi password”, sub “
                  <b>Ask your host for the password to access this network.</b>”, password field +
                  Show/Hide, primary <b>Connect</b>.
                </span>
              ),
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Accepted → <code>connecting</code>. Back → <code>verify</code>.
                </span>
              ),
            },
            {
              k: "Errors",
              v: (
                <Chips>
                  <Chip kind="err">required</Chip>
                  <Chip kind="err">too short</Chip>
                  <Chip kind="err">wrong password</Chip>
                  <Chip kind="err">network failure</Chip>
                  <Chip>3 wrong → ratelimited</Chip>
                </Chips>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="05"
          name="Connecting"
          route="state: connecting"
          rows={[
            {
              k: "Shows",
              v: "Large spinner with stepped status text (Authenticating → Assigning session → Opening the gateway).",
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Success → <code>success</code>. Failure → back to <code>password</code> with a
                  network alert.
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="06"
          name="You’re online"
          route="state: success"
          rows={[
            {
              k: "Shows",
              v: (
                <span>
                  <b>White</b> success ring + check, “You’re online, {`{first name}`}.”, the
                  standard “your browser should redirect…” line, and a <b>Start browsing</b> button.
                </span>
              ),
            },
            {
              k: "Leaves on",
              v: "Start browsing → opens the originally-requested URL / a default page.",
            },
            {
              k: "Note",
              v: "Terminal & idempotent, re-landing here on a connected device is fine.",
            },
          ]}
        />
        <ScreenCard
          idx="R1"
          name="Too many attempts"
          route="state: ratelimited"
          rows={[
            { k: "Trigger", v: "3 wrong codes or 3 wrong passwords." },
            {
              k: "Shows",
              v: (
                <span>
                  Neutral ring, “Too many attempts”, a <b>mm:ss countdown</b>, disabled{" "}
                  <b>Try again</b> until it hits 0, and “Start over”.
                </span>
              ),
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Timer done + Try again → <code>verify</code>. Start over → <code>landing</code>{" "}
                  (reset).
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="R2"
          name="Session expired"
          route="state: sessionexpired"
          rows={[
            { k: "Trigger", v: "A returning device whose 30-day access has lapsed." },
            { k: "Shows", v: "Wifi ring, “Your access has expired”, “Sign in again”." },
            {
              k: "Leaves on",
              v: (
                <span>
                  Sign in again → <code>landing</code> (fresh).
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="R3"
          name="Something went wrong"
          route="state: error"
          rows={[
            { k: "Trigger", v: "Unexpected server / send error with no specific message." },
            { k: "Shows", v: "Neutral ring, generic apology, “Try again” + “Start over”." },
            {
              k: "Leaves on",
              v: (
                <span>
                  Try again → retries the last step. Start over → <code>landing</code>.
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="07"
          name="Terms of use"
          route="state: terms"
          rows={[
            {
              k: "Shows",
              v: "5 short sections (friendly network, acceptable use, data, sessions, no warranty), Back link.",
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Back → returns to the screen it was opened from, <b>preserving form state</b>.
                </span>
              ),
            },
          ]}
        />
        <ScreenCard
          idx="08"
          name="Already online"
          route="state: alreadyConnected"
          rows={[
            { k: "Trigger", v: "Device already has a live session." },
            {
              k: "Shows",
              v: "White ring, “You’re already online.”, Continue browsing, “Not you? Sign in again”.",
            },
            {
              k: "Leaves on",
              v: (
                <span>
                  Continue → default page. Sign in again → <code>landing</code>.
                </span>
              ),
            },
          ]}
        />
      </div>
    </Section>
  );
}

/* ----------------------------- Validation rules ----------------------------- */
function ValidationSection() {
  return (
    <Section
      id="validation"
      eyebrow="Rules"
      title="Validation"
      lead="Validate on submit, not on every keystroke. Clear a field’s error as soon as the user edits it. Messages are specific, lower-case-friendly and never blame the user."
    >
      <Table
        head={["Field", "Rule", "Trigger", "Message"]}
        rows={[
          [
            <b>Name</b>,
            <span className="mono">non-empty after trim</span>,
            "Connect pressed",
            "“Please enter your name.”",
          ],
          [
            <b>Email</b>,
            <span className="mono">non-empty</span>,
            "Connect pressed",
            "“Email is required to connect.”",
          ],
          [
            <b>Email</b>,
            <span className="mono">/^[^@\s]+@[^@\s]+\.[^@\s]{"{2,}"}$/</span>,
            "Connect pressed",
            "“That doesn’t look like a valid email address.”",
          ],
          [
            <b>Terms</b>,
            <span className="mono">checked === true</span>,
            "Connect pressed",
            "“You must accept the terms to continue.”",
          ],
          [
            <b>Code</b>,
            <span className="mono">6 numeric digits</span>,
            "onComplete",
            "(submits, no inline message until server replies)",
          ],
          [
            <b>Code</b>,
            <span className="mono">server: match</span>,
            "after verify request",
            "“That code didn’t match. Check the digits and try again.”",
          ],
          [
            <b>Code</b>,
            <span className="mono">server: not expired</span>,
            "after verify request",
            "“This code is no longer valid, request a new one.”",
          ],
          [
            <b>Password</b>,
            <span className="mono">non-empty</span>,
            "Connect pressed",
            "“Enter the Wi-Fi password to continue.”",
          ],
          [
            <b>Password</b>,
            <span className="mono">length ≥ 6</span>,
            "Connect pressed",
            "“That password looks too short.”",
          ],
          [
            <b>Password</b>,
            <span className="mono">server: correct</span>,
            "after connect request",
            "“That password isn’t right. Double-check with your host.”",
          ],
        ]}
      />
      <Notes>
        <Note tag="impl">
          Client rules live in <code>validate()</code> and <code>validatePassword()</code> in{" "}
          <code>components.jsx</code>. The email regex is deliberately permissive, it catches
          obvious typos, not every RFC edge case. Real verification is the emailed code.
        </Note>
        <Note tag="spec">
          Two error tiers: <b>client</b> (format, required, shown immediately on submit) and{" "}
          <b>server</b> (wrong/expired code, wrong password, shown after the request resolves).
          Server errors clear the relevant input so the user can retry.
        </Note>
        <Note tag="edge">
          Counters: 3 wrong codes → rate limit; 3 wrong passwords → rate limit. Reset on success, on
          Back, and on a fresh resend. A resend also clears any “expired/incorrect” code error.
        </Note>
      </Notes>
    </Section>
  );
}

/* -------------------------------- Copy deck --------------------------------- */
function CopySection() {
  return (
    <Section
      id="copy"
      eyebrow="Rules"
      title="Copy deck"
      lead="Every user-facing string in one place. Tone: warm, plain, second-person. Contractions yes; jargon no. Never name the household or imply it’s a guest network."
    >
      <Table
        head={["Screen", "Element", "String"]}
        rows={[
          ["Landing", "Heading (bare)", "“Hey there. Let’s get you online.”"],
          ["Landing", "Sub", "“Two quick fields and you’re in.”"],
          ["Landing", "Terms consent", "“I agree to the terms of use.”"],
          ["Sending", "Heading", "“Sending your code”"],
          ["Sending", "Sub", "“It’s on its way to your inbox.”"],
          ["Verify", "Heading", "“Check your email”"],
          [
            "Verify",
            "Sub",
            "“We sent a 6-digit code to {email}, enter it below to confirm it’s you.”",
          ],
          ["Verify", "Resend (waiting)", "“Didn’t get it? Resend in {n}s”"],
          ["Verify", "Resend (ready)", "“Didn’t get it? Resend code”"],
          ["Verify", "Resend (done)", "“New code sent”"],
          ["Password", "Heading", "“Enter the Wi-Fi password”"],
          ["Password", "Sub", "“Ask your host for the password to access this network.”"],
          [
            "Connecting",
            "Status steps",
            "“Authenticating” → “Assigning your session” → “Opening the gateway”",
          ],
          ["Success", "Heading", "“You’re online, {first}.”"],
          [
            "Success",
            "Sub",
            "“Your browser should redirect automatically. If it doesn’t, tap below.”",
          ],
          ["Success", "Button", "“Start browsing”"],
          ["Rate limit", "Heading", "“Too many attempts”"],
          ["Session expired", "Heading", "“Your access has expired”"],
          ["Generic error", "Heading", "“Something went wrong”"],
        ]}
      />
      <Note tag="copy">
        Placeholders: name → “John Appleseed”, email → “you@example.com”. Keep the real apostrophes
        and em/en dashes. <b>Do not</b> reference the network’s real SSID name or the word “guest”
        anywhere in copy.
      </Note>
    </Section>
  );
}

/* ------------------------ Accessibility + edge matrix ----------------------- */
function QualitySection() {
  const { CheckIcon } = window;
  return (
    <Section
      id="quality"
      eyebrow="Rules"
      title="Accessibility & resilience"
      lead="The portal runs inside a constrained captive webview on phones and laptops. It has to survive refreshes, slow networks, autofill, reduced-motion and keyboard-only use."
    >
      <div className="ds-cols">
        <ChecklistCard
          title="Accessibility"
          icon={
            <span style={{ color: "var(--success)", display: "inline-flex" }}>
              <CheckIcon />
            </span>
          }
          items={[
            {
              children: (
                <>
                  Every input has a real <code>&lt;label&gt;</code> tied by <code>htmlFor/id</code>.
                </>
              ),
            },
            {
              children: (
                <>
                  Errors use <code>role="alert"</code> + <code>aria-invalid</code> +{" "}
                  <code>aria-describedby</code>.
                </>
              ),
            },
            {
              children: (
                <>
                  Focus ring is a visible 3px halo on all interactive elements, never{" "}
                  <code>outline:none</code> alone.
                </>
              ),
            },
            {
              children: (
                <>
                  OTP first box is <code>autocomplete="one-time-code"</code>; each box is labelled.
                </>
              ),
            },
            { children: <>Touch targets ≥ 44px; the 42px controls sit in ≥44px rows.</> },
            {
              children: (
                <>
                  Motion (success pop) is gated behind <code>prefers-reduced-motion</code>.
                </>
              ),
            },
            { children: <>Status never relies on color alone, always paired with text/icon.</> },
          ]}
        />
        <ChecklistCard
          title="Resilience / edge cases"
          icon={
            <span style={{ color: "var(--success)", display: "inline-flex" }}>
              <CheckIcon />
            </span>
          }
          items={[
            {
              children: (
                <>
                  <b>Refresh-safe:</b> persist current step + entered email so a reload doesn’t dump
                  the user back to start.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Double-submit:</b> button locks on press; requests are idempotent per step.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Slow network:</b> loading screens hold until resolve; no fixed-timeout false
                  success.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Paste & autofill</b> work on email and OTP.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Already connected</b> short-circuits to the “already online” screen.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Expired session</b> (30 days) routes to its own screen, not a generic error.
                </>
              ),
            },
            {
              children: (
                <>
                  <b>Webfont blocked:</b> falls back to system-ui without layout break (self-host to
                  avoid).
                </>
              ),
            },
            {
              children: (
                <>
                  <b>No dead ends:</b> every error screen has a way forward (retry) and a way back
                  (start over).
                </>
              ),
            },
          ]}
        />
      </div>
      <Notes>
        <Note tag="impl">
          Access lifetime is <b>30 days</b> per device. Surface it where relevant server-side; the
          UI itself no longer prints an “access until” date (kept minimal on purpose).
        </Note>
        <Note tag="edge">
          Test the unhappy paths explicitly: wrong code ×3, wrong password ×3, resend spam, mid-flow
          refresh, airplane-mode submit, and returning after expiry. Each has a defined screen
          above, there should be no white screen or silent failure.
        </Note>
        <Note tag="a11y">
          Tab order follows visual order top-to-bottom. The terms link inside the checkbox label
          must be independently focusable and must not toggle the checkbox.
        </Note>
      </Notes>
    </Section>
  );
}

function Flow() {
  return (
    <React.Fragment>
      <FlowSection />
      <ScreensSection />
      <ValidationSection />
      <CopySection />
      <QualitySection />
    </React.Fragment>
  );
}

Object.assign(window, { Flow });
