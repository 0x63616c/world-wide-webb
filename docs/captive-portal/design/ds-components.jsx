// ds-components.jsx, Component specs: Button, Field/Input, Password, Checkbox, OTP,
// Alert, Status pill, Spinner, Status rings. Depends on ds-kit.jsx + components.jsx.

const { Section, Sub, Lead, Specimen, StateGrid, Note, Notes, Table } = window;
const {
  Button,
  Field,
  TextInput,
  CheckboxRow,
  Alert,
  NetworkPill,
  OtpInput,
  MailIcon,
  LockIcon,
  AlertIcon,
  CheckIcon,
  WifiIcon,
} = window;

/* small live wrappers so specimens are interactive */
function LiveInput(props) {
  const [v, setV] = React.useState(props.initial || "");
  return <TextInput {...props} value={v} onChange={(e) => setV(e.target.value)} />;
}
function LiveCheckbox({ error, initial }) {
  const [c, setC] = React.useState(!!initial);
  return (
    <CheckboxRow
      id={"dsc-" + Math.random().toString(36).slice(2, 7)}
      checked={c}
      error={error}
      onChange={setC}
    >
      I agree to the{" "}
      <a href="#" onClick={(e) => e.preventDefault()}>
        terms of use
      </a>
      .
    </CheckboxRow>
  );
}
function LiveOtp({ error, initial }) {
  const [v, setV] = React.useState(initial || "");
  return (
    <div style={{ maxWidth: 280 }}>
      <OtpInput value={v} error={error} onChange={setV} />
    </div>
  );
}
function LivePassword({ initialShow, initial, error }) {
  const [v, setV] = React.useState(initial || "");
  const [show, setShow] = React.useState(!!initialShow);
  const id = React.useMemo(() => "dsp-" + Math.random().toString(36).slice(2, 7), []);
  return (
    <div style={{ width: 260 }}>
      <Field id={id} label="Wi-Fi password" icon={<LockIcon />} error={error}>
        <TextInput
          id={id}
          type={show ? "text" : "password"}
          icon
          error={error}
          placeholder="••••••••"
          value={v}
          onChange={(e) => setV(e.target.value)}
          style={{ paddingRight: 60 }}
        />
        <button
          type="button"
          className="wwb-pw-toggle"
          style={{ position: "absolute", right: 6, top: 21 }}
          onClick={() => setShow((s) => !s)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </Field>
    </div>
  );
}

/* ---------------------------------- Button ---------------------------------- */
function ButtonSpec() {
  return (
    <Section
      id="c-button"
      eyebrow="Components"
      title="Button"
      lead="Full-width, 42px tall. One primary (white on black) carries the main action on every screen; a ghost variant is available for secondary actions. Text actions (link-style) handle tertiary paths."
    >
      <StateGrid
        cols={4}
        items={[
          {
            name: "Primary",
            trigger: "default action",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="primary">Connect</Button>
              </div>
            ),
          },
          {
            name: "Primary · hover",
            trigger: "bg #e2e2e2",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="primary" style={{ background: "#e2e2e2" }}>
                  Connect
                </Button>
              </div>
            ),
          },
          {
            name: "Loading",
            trigger: "disabled + spinner",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="primary" loading>
                  Connecting…
                </Button>
              </div>
            ),
          },
          {
            name: "Disabled",
            trigger: "invalid / cooldown",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="primary" disabled>
                  Connect
                </Button>
              </div>
            ),
          },
          {
            name: "Ghost",
            trigger: "secondary",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="ghost">Back</Button>
              </div>
            ),
          },
          {
            name: "Ghost · hover",
            trigger: "bg #111",
            demo: (
              <div style={{ width: "100%" }}>
                <Button variant="ghost" style={{ background: "#111", borderColor: "#3a3a3a" }}>
                  Back
                </Button>
              </div>
            ),
          },
          {
            name: "Text action",
            trigger: "tertiary",
            demo: (
              <button className="wwb-textbtn" style={{ marginTop: 0 }}>
                Different email
              </button>
            ),
          },
          {
            name: "Resend link",
            trigger: "inline",
            demo: <button className="wwb-resend-btn">Resend code</button>,
          },
        ]}
      />
      <Sub title="Props" tag="<Button />" />
      <Table
        head={["Prop", "Type", "Default", "Notes"]}
        rows={[
          [
            <span className="mono">variant</span>,
            <span className="mono">'primary' | 'ghost'</span>,
            <span className="mono">'primary'</span>,
            "Visual style.",
          ],
          [
            <span className="mono">loading</span>,
            <span className="mono">boolean</span>,
            <span className="mono">false</span>,
            "Shows spinner + sets disabled. Label should change to a present-progressive (“Connecting…”).",
          ],
          [
            <span className="mono">disabled</span>,
            <span className="mono">boolean</span>,
            <span className="mono">false</span>,
            "Non-interactive; also true while loading.",
          ],
          [
            <span className="mono">…rest</span>,
            <span className="mono">button attrs</span>,
            "-",
            <span>
              <code>type</code>, <code>onClick</code>, etc. Default <code>type</code> in a form is
              submit.
            </span>,
          ],
        ]}
      />
      <Notes>
        <Note tag="spec">
          Height <b>42px</b>, radius <code>--radius-control</code>, font 14.5/500, tracking -0.01em.
          Active state nudges <code>translateY(0.5px)</code>. Primary disabled ={" "}
          <code>#1a1a1a</code> bg / faint text (not just reduced opacity).
        </Note>
        <Note tag="impl">
          A submit button must set <code>loading</code> the instant it’s pressed and stay loading
          until the request resolves, this is the only thing preventing double-submits. Re-enable on
          both success and error.
        </Note>
        <Note tag="a11y">
          Keep the accessible name meaningful while loading (“Connecting…”, not an empty spinner).
          Hit target is the full 42px row, never shrink below 44px on touch for standalone buttons.
        </Note>
      </Notes>
    </Section>
  );
}

/* ------------------------------- Field / Input ------------------------------ */
function InputSpec() {
  return (
    <Section
      id="c-input"
      eyebrow="Components"
      title="Field & text input"
      lead="A labelled control with an optional leading icon, an error message slot, and a 3px focus ring. The same Field wraps name, email and password inputs."
    >
      <StateGrid
        cols={3}
        items={[
          {
            name: "Default",
            trigger: "empty + placeholder",
            demo: (
              <div style={{ width: "100%" }}>
                <Field id="i1" label="Email" icon={<MailIcon />}>
                  <LiveInput id="i1" icon placeholder="you@example.com" />
                </Field>
              </div>
            ),
          },
          {
            name: "Filled",
            trigger: "has value",
            demo: (
              <div style={{ width: "100%" }}>
                <Field id="i2" label="Email" icon={<MailIcon />}>
                  <LiveInput id="i2" icon initial="john@example.com" />
                </Field>
              </div>
            ),
          },
          {
            name: "Focus",
            trigger: "border #5a5a5a + ring",
            demo: (
              <div style={{ width: "100%" }}>
                <Field id="i3" label="Email" icon={<MailIcon />}>
                  <TextInput
                    id="i3"
                    icon
                    value="john@example.com"
                    readOnly
                    style={{
                      borderColor: "#5a5a5a",
                      boxShadow: "0 0 0 3px rgba(255,255,255,0.10)",
                      background: "#0e0e0e",
                    }}
                  />
                </Field>
              </div>
            ),
          },
          {
            name: "Error",
            trigger: "failed validation",
            demo: (
              <div style={{ width: "100%" }}>
                <Field
                  id="i4"
                  label="Email"
                  icon={<MailIcon />}
                  error="That doesn’t look like a valid email address."
                >
                  <TextInput id="i4" icon error defaultValue="john@" />
                </Field>
              </div>
            ),
          },
          {
            name: "Disabled",
            trigger: "submitting",
            demo: (
              <div style={{ width: "100%" }}>
                <Field id="i5" label="Email" icon={<MailIcon />}>
                  <TextInput id="i5" icon disabled value="john@example.com" readOnly />
                </Field>
              </div>
            ),
          },
          {
            name: "No icon",
            trigger: "icon optional",
            demo: (
              <div style={{ width: "100%" }}>
                <Field id="i6" label="Name">
                  <LiveInput id="i6" placeholder="John Appleseed" />
                </Field>
              </div>
            ),
          },
        ]}
      />
      <Sub title="Anatomy" tag="dimensions" />
      <Table
        head={["Part", "Value", "Token"]}
        rows={[
          ["Input height", "42px", "-"],
          ["Padding", "0 12px · 38px left with icon", "-"],
          ["Radius", "9px", "--radius-control"],
          ["Fill", "#0c0c0c → #0e0e0e on focus", "-"],
          ["Border", "default / hover #3a3a3a / focus #5a5a5a", "--input-border"],
          ["Focus ring", "0 0 0 3px rgba(255,255,255,.10)", "-"],
          ["Label", "13px / 500, 7px below", ".wwb-label"],
          ["Error text", "12.5px destructive + 13px alert icon", ".wwb-error"],
        ]}
      />
      <Sub title="Props" tag="<Field /> + <TextInput />" />
      <Table
        head={["Prop", "Type", "Notes"]}
        rows={[
          [
            <span className="mono">label</span>,
            <span className="mono">string</span>,
            "Required visible label, tied via htmlFor/id.",
          ],
          [
            <span className="mono">icon</span>,
            <span className="mono">ReactNode</span>,
            "Optional leading icon; shifts padding to 38px.",
          ],
          [
            <span className="mono">error</span>,
            <span className="mono">string | null</span>,
            "When set: red border, ring on focus, and a message row below.",
          ],
          [
            <span className="mono">optional</span>,
            <span className="mono">boolean</span>,
            "Appends a muted “· optional” to the label.",
          ],
          [
            <span className="mono">type</span>,
            <span className="mono">string</span>,
            "text | email | password. Sets inputMode/autocomplete appropriately.",
          ],
        ]}
      />
      <Notes>
        <Note tag="impl">
          Set the right input hints so mobile keyboards behave: email →{" "}
          <code>type="email" inputmode="email" autocomplete="email"</code>; name →{" "}
          <code>autocomplete="name"</code>; code →{" "}
          <code>inputmode="numeric" autocomplete="one-time-code"</code>.
        </Note>
        <Note tag="spec">
          Error styling is driven entirely by the presence of <code>error</code>. Border uses{" "}
          <code>--destructive-border</code> at rest and solid <code>--destructive</code> + tinted
          ring on focus. Clearing the value or fixing the input should clear the error (see
          validation rules).
        </Note>
        <Note tag="a11y">
          The error row carries <code>role="alert"</code> so it’s announced. Associate it with the
          input via <code>aria-describedby</code> and set <code>aria-invalid="true"</code> when
          errored.
        </Note>
        <Note tag="edge">
          Never block typing of valid characters. Trim only on submit, not on each keystroke,
          trimming live breaks paste and trailing-space editing.
        </Note>
      </Notes>
    </Section>
  );
}

/* ------------------------------ Password input ------------------------------ */
function PasswordSpec() {
  return (
    <Section
      id="c-password"
      eyebrow="Components"
      title="Password input"
      lead="The standard field plus an in-field Show / Hide toggle. Asked on its own screen after the email is verified, the host shares the network password."
    >
      <Specimen label="Wi-Fi password · show / hide" tag="toggle is inside the field">
        <LivePassword initial="guest-passw0rd" />
        <LivePassword initial="guest-passw0rd" initialShow />
        <LivePassword error="That password isn’t right. Double-check with your host." />
      </Specimen>
      <Notes>
        <Note tag="spec">
          Toggle is a <code>.wwb-pw-toggle</code> button pinned <code>right:6px</code>, vertically
          centered to the 42px input, 30px tall. Input gets <code>padding-right: 60px</code> so text
          never slides under the button.
        </Note>
        <Note tag="impl">
          Toggle swaps <code>type</code> between <code>password</code> and <code>text</code> only,
          it must not re-render/clear the value. Default to hidden. The button is{" "}
          <code>type="button"</code> so it never submits the form.
        </Note>
        <Note tag="a11y">
          Give the toggle an <code>aria-pressed</code> state and a label like “Show password”. It’s
          decorative-text, so ensure it’s reachable by keyboard and has a ≥30px hit height.
        </Note>
        <Note tag="edge">
          Validation: required, min 6 chars (<code>validatePassword</code>). A wrong password is a{" "}
          <b>server</b> error returned after submit, show it as a field error, and after <b>3</b>{" "}
          wrong tries route to the rate-limited screen.
        </Note>
      </Notes>
    </Section>
  );
}

/* --------------------------------- Checkbox --------------------------------- */
function CheckboxSpec() {
  return (
    <Section
      id="c-checkbox"
      eyebrow="Components"
      title="Checkbox, terms consent"
      lead="A 17px custom checkbox with an inline link to the terms. Required: the user cannot connect until it’s ticked."
    >
      <StateGrid
        cols={3}
        items={[
          {
            name: "Unchecked",
            trigger: "default",
            demo: (
              <div style={{ width: "100%", textAlign: "left" }}>
                <LiveCheckbox />
              </div>
            ),
          },
          {
            name: "Checked",
            trigger: "white fill + tick",
            demo: (
              <div style={{ width: "100%", textAlign: "left" }}>
                <LiveCheckbox initial />
              </div>
            ),
          },
          {
            name: "Error",
            trigger: "submitted unticked",
            demo: (
              <div style={{ width: "100%", textAlign: "left" }}>
                <LiveCheckbox error />
              </div>
            ),
          },
        ]}
      />
      <Notes>
        <Note tag="spec">
          Box 17px, radius 5px. Checked = <code>--primary</code> fill with a CSS-drawn tick in{" "}
          <code>--primary-foreground</code>. The label link uses a 45%-opacity underline that
          brightens on hover. Error tints the box border only.
        </Note>
        <Note tag="impl">
          The inline “terms of use” link must open the Terms screen <b>without losing form state</b>
          , in the portal it swaps the screen and returns via Back. If you open terms in a new view,
          preserve the entered name/email/checkbox.
        </Note>
        <Note tag="a11y">
          Use a real <code>&lt;input type="checkbox"&gt;</code> (it is) so it’s keyboard- and
          SR-operable. Focus shows a 3px ring. The error message gets <code>role="alert"</code> and{" "}
          <code>aria-describedby</code>.
        </Note>
        <Note tag="copy">
          Consent copy: “I agree to the <u>terms of use</u>.” The link is the only part that
          navigates; ticking the box elsewhere must not trigger navigation.
        </Note>
      </Notes>
    </Section>
  );
}

/* ----------------------------------- OTP ------------------------------------ */
function OtpSpec() {
  return (
    <Section
      id="c-otp"
      eyebrow="Components"
      title="OTP code input"
      lead="Six independent digit boxes that behave as one field: auto-advance, paste-to-fill, backspace-to-previous, and arrow-key navigation. Fires onComplete when all six are filled."
    >
      <StateGrid
        cols={2}
        items={[
          { name: "Empty", trigger: "awaiting entry", demo: <LiveOtp /> },
          {
            name: "Partial / filled",
            trigger: "is-filled per box",
            demo: <LiveOtp initial="1234" />,
          },
          { name: "Complete", trigger: "fires onComplete", demo: <LiveOtp initial="123456" /> },
          {
            name: "Error",
            trigger: "wrong / expired code",
            demo: <LiveOtp initial="000000" error />,
          },
        ]}
      />
      <Sub title="Behaviour" tag="keyboard + paste" />
      <Table
        head={["Interaction", "Result"]}
        rows={[
          ["Type a digit", "Fills current box, focus auto-advances to the next."],
          ["Type when full", "Overflow digits spill into following boxes (multi-char input)."],
          ["Paste a 6-digit code", "Distributes across all boxes, focus lands on the last filled."],
          ["Backspace (empty box)", "Clears previous box and moves focus back."],
          ["Backspace (filled box)", "Clears current box, stays put."],
          ["Arrow ← / →", "Moves focus between boxes without changing values."],
          ["Non-numeric input", "Stripped, only [0-9] accepted."],
        ]}
      />
      <Sub title="Props" tag="<OtpInput />" />
      <Table
        head={["Prop", "Type", "Notes"]}
        rows={[
          [
            <span className="mono">value</span>,
            <span className="mono">string</span>,
            'Controlled joined value, e.g. "1234".',
          ],
          [
            <span className="mono">onChange</span>,
            <span className="mono">(v:string)=&gt;void</span>,
            "Fires on every edit with the joined string.",
          ],
          [
            <span className="mono">onComplete</span>,
            <span className="mono">(v:string)=&gt;void</span>,
            "Fires once all 6 are filled, trigger verification here.",
          ],
          [
            <span className="mono">error</span>,
            <span className="mono">boolean</span>,
            "Red border on every box.",
          ],
          [
            <span className="mono">disabled</span>,
            <span className="mono">boolean</span>,
            "Dim + non-editable while verifying.",
          ],
          [
            <span className="mono">length</span>,
            <span className="mono">number</span>,
            "Default 6.",
          ],
        ]}
      />
      <Notes>
        <Note tag="spec">
          Each box: max 52px wide, 56px tall, mono 22px, radius <code>--radius-control</code>. A
          filled box darkens to <code>#121212</code> with a lighter border. Boxes share a flex row
          with <code>gap: 8px</code>, centered.
        </Note>
        <Note tag="impl">
          Verify <b>onComplete</b>, and also disable the boxes while the request is in flight. On a
          wrong/expired code, clear the value and refocus the first box so the user can retype
          immediately (the portal does this via an effect on <code>error</code>).
        </Note>
        <Note tag="a11y">
          First box gets <code>autocomplete="one-time-code"</code> so iOS/Android SMS-autofill
          works. Each box has an <code>aria-label</code> (“Digit 1”…).{" "}
          <code>inputmode="numeric"</code> shows the number pad.
        </Note>
        <Note tag="edge">
          Codes expire (default 10 min). An expired code is distinct from a wrong code, see the{" "}
          <b>Verify</b> screen for both messages. After 3 wrong attempts, route to{" "}
          <b>Too many attempts</b>.
        </Note>
      </Notes>
    </Section>
  );
}

/* --------------------------- Alert + pill + feedback ------------------------ */
function FeedbackSpec() {
  return (
    <Section
      id="c-feedback"
      eyebrow="Components"
      title="Alert, status & feedback"
      lead="Inline error alerts, the network status pill, loading spinners, and the success / neutral status rings that anchor full-screen states."
    >
      <Sub title="Inline alert" tag="errors only" />
      <Specimen label="Alert · destructive" stretch>
        <div style={{ maxWidth: 360, width: "100%" }}>
          <Alert title="Couldn’t connect.">
            The network didn’t respond. Check you’re in range and try again.
          </Alert>
        </div>
      </Specimen>
      <Note tag="spec">
        Alert = tinted <code>--destructive-bg</code> fill, <code>--destructive-border</code>, alert
        icon + bold title + message. Sits at the top of the form it relates to. There is
        intentionally no “info/success” alert variant, success is a whole screen.
      </Note>

      <Sub title="Status pill, spinners & rings" tag="status surfaces" />
      <StateGrid
        cols={3}
        items={[
          { name: "Status pill", trigger: "connected indicator", demo: <NetworkPill /> },
          {
            name: "Spinner · inline",
            trigger: "in buttons",
            demo: (
              <span
                className="wwb-spinner"
                style={{ borderColor: "rgba(255,255,255,0.25)", borderTopColor: "#fff" }}
              />
            ),
          },
          {
            name: "Spinner · large",
            trigger: "connecting / sending",
            demo: <span className="wwb-spinner wwb-spinner-lg" />,
          },
          {
            name: "Success ring",
            trigger: "connected (white)",
            demo: (
              <span className="wwb-success-ring">
                <CheckIcon />
              </span>
            ),
          },
          {
            name: "Neutral ring",
            trigger: "rate-limit / error",
            demo: (
              <span className="wwb-icon-ring">
                <AlertIcon />
              </span>
            ),
          },
          {
            name: "Wifi ring",
            trigger: "session expired",
            demo: (
              <span className="wwb-icon-ring">
                <WifiIcon />
              </span>
            ),
          },
        ]}
      />
      <Notes>
        <Note tag="spec">
          Rings are 56px. <b>Success is white</b> (<code>rgba(255,255,255,.06)</code> fill, white
          check), green is reserved for the small dot in the status pill / session rows. Neutral
          rings use a muted icon for recoverable states.
        </Note>
        <Note tag="impl">
          The success ring plays a one-shot scale pop, gated behind{" "}
          <code>prefers-reduced-motion</code>. Its <b>resting state is fully visible</b>, never
          animate from <code>opacity:0</code>, so it still shows if the animation is skipped or
          frozen.
        </Note>
        <Note tag="a11y">
          Spinners are decorative; pair them with visible text (“Connecting…”). The countdown timer
          uses <code>tabular-nums</code> and should expose its remaining time as text, not color
          alone.
        </Note>
      </Notes>
    </Section>
  );
}

function Components() {
  return (
    <React.Fragment>
      <ButtonSpec />
      <InputSpec />
      <PasswordSpec />
      <CheckboxSpec />
      <OtpSpec />
      <FeedbackSpec />
    </React.Fragment>
  );
}

Object.assign(window, { Components });
