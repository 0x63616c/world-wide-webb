// components.jsx, world-wide-webb · shadcn/Vercel primitives + icons
// Exported to window for use by screens.jsx and the prototype app.

/* ------------------------------ icons ------------------------------ */
function GlobeMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9s1.4-6.6 3.9-9Z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 7.3 5.2a2 2 0 0 0 2.4 0L20.5 7" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12.5 5 5 11-11" />
    </svg>
  );
}
function ArrowLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function WifiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 8.5C8 3.5 16 3.5 22 8.5" />
      <path d="M5 12c4-3.3 10-3.3 14 0" />
      <path d="M8.5 15.5c2.1-1.7 4.9-1.7 7 0" />
      <path d="M12 19h.01" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </svg>
  );
}

/* ------------------------------ Logo ------------------------------ */
function Logo({ size = 44 }) {
  return (
    <span className="wwb-mark" style={{ width: size, height: size }}>
      <GlobeMark />
    </span>
  );
}

/* ------------------------------ Field ------------------------------ */
function Field({ id, label, icon, error, optional, children }) {
  return (
    <div>
      <label className="wwb-label" htmlFor={id}>
        {label}
        {optional && (
          <span style={{ color: "var(--faint-foreground)", fontWeight: 400 }}> · optional</span>
        )}
      </label>
      <div className="wwb-input-wrap">
        {icon && <span className="wwb-input-icon">{icon}</span>}
        {children}
      </div>
      {error && (
        <div className="wwb-error" role="alert">
          <AlertIcon />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function TextInput({ id, type = "text", icon, error, ...rest }) {
  return (
    <input
      id={id}
      type={type}
      className={"wwb-input" + (icon ? " has-icon" : "") + (error ? " is-error" : "")}
      {...rest}
    />
  );
}

/* ------------------------------ Checkbox ------------------------------ */
function CheckboxRow({ id, checked, error, onChange, children }) {
  return (
    <div className="wwb-check-row">
      <input
        id={id}
        type="checkbox"
        className={"wwb-checkbox" + (error ? " is-error" : "")}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label className="wwb-check-label" htmlFor={id}>
        {children}
      </label>
    </div>
  );
}

/* ------------------------------ Button ------------------------------ */
function Button({ variant = "primary", loading, children, ...rest }) {
  return (
    <button className={"wwb-btn wwb-btn-" + variant} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="wwb-spinner" />}
      {children}
    </button>
  );
}

/* ------------------------------ Alert ------------------------------ */
function Alert({ title, children }) {
  return (
    <div className="wwb-alert wwb-alert-error" role="alert">
      <AlertIcon />
      <div>
        {title && <strong>{title}</strong>}
        {title && " "}
        {children}
      </div>
    </div>
  );
}

/* ------------------------------ Status pill ------------------------------ */
function NetworkPill() {
  return (
    <span className="wwb-pill">
      <span className="dot" />
      Guest Wi-Fi
    </span>
  );
}

/* ------------------------------ OTP input ------------------------------ */
function OtpInput({ value = "", onChange, onComplete, error, disabled, length = 6 }) {
  const refs = React.useRef([]);
  const chars = React.useMemo(() => {
    const a = (value || "").slice(0, length).split("");
    while (a.length < length) a.push("");
    return a;
  }, [value, length]);

  const focusBox = (i) => {
    const el = refs.current[i];
    if (el) {
      el.focus();
      el.select && el.select();
    }
  };

  const emit = (next) => {
    const joined = next.join("").slice(0, length);
    onChange && onChange(joined);
    if (joined.length === length && next.every((c) => c !== "") && onComplete) onComplete(joined);
  };

  const handleChange = (i, e) => {
    const raw = (e.target.value || "").replace(/\D/g, "");
    const next = [...chars];
    if (!raw) {
      next[i] = "";
      emit(next);
      return;
    }
    raw.split("").forEach((d, k) => {
      if (i + k < length) next[i + k] = d;
    });
    emit(next);
    focusBox(Math.min(i + raw.length, length - 1));
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...chars];
      if (chars[i]) {
        next[i] = "";
        emit(next);
      } else if (i > 0) {
        next[i - 1] = "";
        emit(next);
        focusBox(i - 1);
      }
    } else if (e.key === "ArrowLeft" && i > 0) focusBox(i - 1);
    else if (e.key === "ArrowRight" && i < length - 1) focusBox(i + 1);
  };

  const handlePaste = (e) => {
    const txt = ((e.clipboardData || window.clipboardData).getData("text") || "")
      .replace(/\D/g, "")
      .slice(0, length);
    if (!txt) return;
    e.preventDefault();
    const next = Array(length).fill("");
    txt.split("").forEach((d, k) => {
      next[k] = d;
    });
    emit(next);
    focusBox(Math.min(txt.length, length - 1));
  };

  return (
    <div className="wwb-otp" onPaste={handlePaste}>
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className={"wwb-otp-box" + (error ? " is-error" : "") + (c ? " is-filled" : "")}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          value={c}
          disabled={disabled}
          aria-label={"Digit " + (i + 1)}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

/* ------------------------------ helpers ------------------------------ */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate({ name, email, agreed }) {
  const errs = {};
  if (!name.trim()) errs.name = "Please enter your name.";
  if (!email.trim()) errs.email = "Email is required to connect.";
  else if (!EMAIL_RE.test(email.trim()))
    errs.email = "That doesn’t look like a valid email address.";
  if (!agreed) errs.agreed = "You must accept the terms to continue.";
  return errs;
}

function validatePassword(pw) {
  if (!pw || !pw.trim()) return "Enter the Wi-Fi password to continue.";
  if (pw.trim().length < 6) return "That password looks too short.";
  return null;
}

Object.assign(window, {
  GlobeMark,
  MailIcon,
  UserIcon,
  AlertIcon,
  CheckIcon,
  ArrowLeft,
  ArrowRight,
  WifiIcon,
  LockIcon,
  Logo,
  Field,
  TextInput,
  CheckboxRow,
  Button,
  Alert,
  NetworkPill,
  OtpInput,
  EMAIL_RE,
  validate,
  validatePassword,
});
