// Pure, UI-free flow state machine for the captive portal (CC-q002.7).
// Mirrors the reference behaviour in docs/captive-portal/design/World-Wide-Webb
// Portal.html, made deterministic + table-testable. The reducer NEVER does I/O:
// network/server work is returned as `effects` for the UI layer to run, which
// keeps "counters reset on back" server-authoritative (a resetAttempts effect)
// while the reducer stays pure.
import { validate, validatePassword } from "@/lib/validate";

export const RESEND_COOLDOWN_S = 30; // PRD: 30s server-enforced resend cooldown
export const CODE_TTL_MS = 10 * 60 * 1000; // PRD: codes expire after 10 minutes
const MAX_ATTEMPTS = 3; // 3 wrong codes OR 3 wrong passwords -> rate limit

/** @public - flow step union; consumed by the App switch + screen wiring and tests. */
export type FlowStep =
  | "landing"
  | "sending"
  | "verify"
  | "password"
  | "connecting"
  | "success"
  | "already"
  | "ratelimited"
  | "sessionexpired"
  | "error"
  | "terms";

/** @public - the portal form shape carried through the flow; used by callers/tests. */
export interface FlowForm {
  name: string;
  email: string;
  password: string;
  agreed: boolean;
}

/** @public - landing field-error map surfaced to the form; used by callers/tests. */
export type FieldErrors = Partial<Record<"name" | "email" | "agreed", string>>;

export interface FlowState {
  step: FlowStep;
  /** Where Terms returns to. */
  returnTo: FlowStep;
  form: FlowForm;
  errors: FieldErrors;
  networkError: boolean;
  verifyError: string | null;
  verifyExpired: boolean;
  passwordError: string | null;
  busy: boolean;
  codeTries: number;
  pwTries: number;
  resendLeft: number;
  /** Client MAC from the UniFi redirect, threaded through every server call. */
  mac: string;
}

export type FlowEvent =
  | { type: "SUBMIT_LANDING"; form: { name: string; email: string; agreed: boolean } }
  | { type: "CODE_SENT" }
  | { type: "SEND_FAILED" }
  | { type: "EDIT_FIELD"; field: "name" | "email" | "agreed"; value: string | boolean }
  | { type: "VERIFY_SUBMIT"; code: string }
  | { type: "VERIFY_WRONG" }
  | { type: "VERIFY_EXPIRED" }
  | { type: "VERIFY_OK" }
  | { type: "RESEND" }
  | { type: "RESEND_TICK" }
  | { type: "PASSWORD_SUBMIT"; password: string }
  | { type: "PASSWORD_WRONG" }
  | { type: "PASSWORD_OK" }
  | { type: "CONNECT_OK" }
  | { type: "CONNECT_FAILED" }
  | { type: "BACK" }
  | { type: "OPEN_TERMS" }
  | { type: "CLOSE_TERMS" }
  | { type: "RETRY" }
  | { type: "RESET" }
  | { type: "SHOW_ALREADY_CONNECTED" }
  | { type: "SHOW_SESSION_EXPIRED" }
  | { type: "SHOW_ERROR" };

export type PortalEffect =
  | { type: "sendCode"; email: string; mac: string }
  | { type: "verifyCode"; code: string; mac: string }
  | { type: "checkPassword"; password: string; mac: string }
  | { type: "resetAttempts"; mac: string };

export interface FlowResult {
  state: FlowState;
  effects: PortalEffect[];
}

const WRONG_CODE_MSG = "That code didn’t match. Check the digits and try again.";
const EXPIRED_CODE_MSG = "This code is no longer valid, request a new one.";
const WRONG_PW_MSG = "That password isn’t right. Double-check with your host.";

function freshForm(): FlowForm {
  return { name: "", email: "", password: "", agreed: false };
}

export function initialFlowState(mac: string): FlowState {
  return {
    step: "landing",
    returnTo: "landing",
    form: freshForm(),
    errors: {},
    networkError: false,
    verifyError: null,
    verifyExpired: false,
    passwordError: null,
    busy: false,
    codeTries: 0,
    pwTries: 0,
    resendLeft: RESEND_COOLDOWN_S,
    mac,
  };
}

// A back-navigation reset: counters cleared in state AND a server-authoritative
// resetAttempts effect (the design rule "counters reset on back" is enforced
// server-side, fire-and-forget).
function backTo(state: FlowState, step: FlowStep): FlowResult {
  return {
    state: {
      ...state,
      step,
      codeTries: 0,
      pwTries: 0,
      verifyError: null,
      verifyExpired: false,
      passwordError: null,
      networkError: false,
    },
    effects: [{ type: "resetAttempts", mac: state.mac }],
  };
}

export function reducer(state: FlowState, event: FlowEvent): FlowResult {
  const noEffects = (s: FlowState): FlowResult => ({ state: s, effects: [] });

  switch (event.type) {
    case "SUBMIT_LANDING": {
      if (state.busy) return noEffects(state); // double-submit lock
      const errors = validate(event.form);
      const form = { ...state.form, ...event.form };
      if (Object.keys(errors).length > 0) {
        return noEffects({ ...state, form, errors });
      }
      return {
        state: {
          ...state,
          form,
          errors: {},
          networkError: false,
          verifyError: null,
          verifyExpired: false,
          codeTries: 0,
          pwTries: 0,
          busy: true,
          step: "sending",
        },
        effects: [{ type: "sendCode", email: form.email, mac: state.mac }],
      };
    }

    case "CODE_SENT":
      return noEffects({ ...state, busy: false, step: "verify", resendLeft: RESEND_COOLDOWN_S });

    case "SEND_FAILED":
      return noEffects({ ...state, busy: false, step: "error" });

    case "EDIT_FIELD": {
      const errors = { ...state.errors };
      delete errors[event.field];
      return noEffects({
        ...state,
        form: { ...state.form, [event.field]: event.value },
        errors,
        networkError: false,
      });
    }

    case "VERIFY_SUBMIT":
      if (state.busy) return noEffects(state);
      return {
        state: { ...state, busy: true, verifyError: null },
        effects: [{ type: "verifyCode", code: event.code, mac: state.mac }],
      };

    case "VERIFY_WRONG": {
      const codeTries = state.codeTries + 1;
      if (codeTries >= MAX_ATTEMPTS) {
        return noEffects({ ...state, busy: false, codeTries, step: "ratelimited" });
      }
      return noEffects({
        ...state,
        busy: false,
        codeTries,
        verifyExpired: false,
        verifyError: WRONG_CODE_MSG,
      });
    }

    case "VERIFY_EXPIRED":
      // Distinct from a wrong code: does NOT count as an attempt.
      return noEffects({
        ...state,
        busy: false,
        verifyExpired: true,
        verifyError: EXPIRED_CODE_MSG,
      });

    case "VERIFY_OK":
      return noEffects({
        ...state,
        busy: false,
        codeTries: 0,
        verifyError: null,
        verifyExpired: false,
        passwordError: null,
        step: "password",
      });

    case "RESEND":
      return {
        state: {
          ...state,
          codeTries: 0,
          verifyError: null,
          verifyExpired: false,
          resendLeft: RESEND_COOLDOWN_S,
        },
        effects: [{ type: "sendCode", email: state.form.email, mac: state.mac }],
      };

    case "RESEND_TICK":
      return noEffects({ ...state, resendLeft: Math.max(0, state.resendLeft - 1) });

    case "PASSWORD_SUBMIT": {
      if (state.busy) return noEffects(state);
      const fmt = validatePassword(event.password);
      if (fmt) return noEffects({ ...state, passwordError: fmt });
      return {
        state: {
          ...state,
          busy: true,
          passwordError: null,
          form: { ...state.form, password: event.password },
        },
        effects: [{ type: "checkPassword", password: event.password, mac: state.mac }],
      };
    }

    case "PASSWORD_WRONG": {
      const pwTries = state.pwTries + 1;
      if (pwTries >= MAX_ATTEMPTS) {
        return noEffects({ ...state, busy: false, pwTries, step: "ratelimited" });
      }
      return noEffects({ ...state, busy: false, pwTries, passwordError: WRONG_PW_MSG });
    }

    case "PASSWORD_OK":
      return noEffects({
        ...state,
        busy: false,
        pwTries: 0,
        passwordError: null,
        networkError: false,
        step: "connecting",
      });

    case "CONNECT_OK":
      return noEffects({ ...state, busy: false, step: "success" });

    case "CONNECT_FAILED":
      return noEffects({ ...state, busy: false, networkError: true, step: "password" });

    case "BACK":
      if (state.step === "password") return backTo(state, "verify");
      if (state.step === "verify") return backTo(state, "landing");
      return noEffects(state);

    case "OPEN_TERMS":
      return noEffects({
        ...state,
        returnTo: state.step === "terms" ? state.returnTo : state.step,
        step: "terms",
      });

    case "CLOSE_TERMS":
      return noEffects({ ...state, step: state.returnTo });

    case "RETRY":
      // From ratelimited/error: clear counters + errors, resume at verify.
      return noEffects({
        ...state,
        codeTries: 0,
        pwTries: 0,
        verifyError: null,
        verifyExpired: false,
        passwordError: null,
        step: "verify",
      });

    case "RESET":
      // Fresh start, same device (mac survives).
      return noEffects(initialFlowState(state.mac));

    case "SHOW_ALREADY_CONNECTED":
      return noEffects({ ...state, step: "already" });

    case "SHOW_SESSION_EXPIRED":
      return noEffects({ ...state, step: "sessionexpired" });

    case "SHOW_ERROR":
      return noEffects({ ...state, step: "error" });

    default:
      return noEffects(state);
  }
}

// ---- sessionStorage persistence (refresh-safe step + email) -----------------
// Keyed by MAC so a different device on the same browser profile can't restore
// another guest's position. Only the durable bits are stored: step + form (the
// transient errors/busy/counters reset on reload, which is correct).
const storageKey = (mac: string) => `wwb-portal:${mac}`;

interface PersistedFlow {
  step: FlowStep;
  form: FlowForm;
  savedAt: number;
}

const PERSIST_STEPS: ReadonlySet<FlowStep> = new Set<FlowStep>(["verify", "password"]);

export function persistFlowState(state: FlowState): void {
  try {
    // Only persist mid-flow steps where a refresh should restore position;
    // terminal/landing/recovery screens start fresh.
    if (!PERSIST_STEPS.has(state.step)) {
      sessionStorage.removeItem(storageKey(state.mac));
      return;
    }
    const payload: PersistedFlow = { step: state.step, form: state.form, savedAt: Date.now() };
    sessionStorage.setItem(storageKey(state.mac), JSON.stringify(payload));
  } catch {
    // sessionStorage can throw (private mode / quota); persistence is best-effort.
  }
}

export function loadFlowState(mac: string): FlowState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(mac));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedFlow;
    if (!parsed || !PERSIST_STEPS.has(parsed.step)) return null;
    // A persisted position older than the code TTL is stale: the emailed code
    // can no longer be valid, so don't drop the guest back onto verify.
    if (Date.now() - parsed.savedAt > CODE_TTL_MS) return null;
    return { ...initialFlowState(mac), step: parsed.step, form: parsed.form };
  } catch {
    return null;
  }
}
