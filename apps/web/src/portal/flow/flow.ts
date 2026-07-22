// Pure, UI-free flow state machine for the captive portal (www-q002.7,
// password-only since www-p9hx). The guest types a single shared WiFi password
// and is authorized; there is no email/OTP step (Apple's CNA can't reach Mail
// pre-auth). The reducer NEVER does I/O: network/server work is returned as
// `effects` for the UI layer to run, keeping the reducer pure + table-testable.
import { validatePassword } from "../lib/validate";

/** @public - flow step union; consumed by the App switch + screen wiring and tests. */
export type FlowStep =
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
  password: string;
  agreed: boolean;
}

export interface FlowState {
  step: FlowStep;
  /** Where Terms returns to. */
  returnTo: FlowStep;
  form: FlowForm;
  networkError: boolean;
  passwordError: string | null;
  busy: boolean;
  /** Client MAC from the UniFi redirect, threaded through every server call. */
  mac: string;
}

export type FlowEvent =
  | { type: "EDIT_FIELD"; field: "password" | "agreed"; value: string | boolean }
  | { type: "PASSWORD_SUBMIT"; password: string }
  | { type: "PASSWORD_WRONG" }
  | { type: "PASSWORD_OK" }
  | { type: "CONNECT_OK" }
  | { type: "CONNECT_FAILED" }
  | { type: "OPEN_TERMS" }
  | { type: "CLOSE_TERMS" }
  | { type: "RETRY" }
  | { type: "RESET" }
  | { type: "SHOW_ALREADY_CONNECTED" }
  | { type: "SHOW_SESSION_EXPIRED" }
  | { type: "SHOW_RATELIMIT" }
  | { type: "SHOW_ERROR" };

export type PortalEffect =
  | { type: "checkPassword"; password: string; mac: string }
  | { type: "authorize"; password: string; mac: string };

export interface FlowResult {
  state: FlowState;
  effects: PortalEffect[];
}

const WRONG_PW_MSG = "That password isn’t right. Double-check with your host.";

function freshForm(): FlowForm {
  return { password: "", agreed: false };
}

export function initialFlowState(mac: string): FlowState {
  return {
    step: "password",
    returnTo: "password",
    form: freshForm(),
    networkError: false,
    passwordError: null,
    busy: false,
    mac,
  };
}

export function reducer(state: FlowState, event: FlowEvent): FlowResult {
  const noEffects = (s: FlowState): FlowResult => ({ state: s, effects: [] });

  switch (event.type) {
    case "EDIT_FIELD":
      return noEffects({
        ...state,
        form: { ...state.form, [event.field]: event.value },
        passwordError: null,
        networkError: false,
      });

    case "PASSWORD_SUBMIT": {
      if (state.busy) return noEffects(state); // double-submit lock
      if (!state.form.agreed) return noEffects(state); // terms gate (UI also disables)
      const fmt = validatePassword(event.password);
      if (fmt) return noEffects({ ...state, passwordError: fmt });
      return {
        state: {
          ...state,
          busy: true,
          passwordError: null,
          networkError: false,
          form: { ...state.form, password: event.password },
        },
        effects: [{ type: "checkPassword", password: event.password, mac: state.mac }],
      };
    }

    case "PASSWORD_WRONG":
      // No client-side lockout: the server enforces a GLOBAL daily limit and
      // returns RATE_LIMITED (→ SHOW_RATELIMIT) when it trips. Here we just
      // surface the inline "wrong password" hint.
      return noEffects({ ...state, busy: false, passwordError: WRONG_PW_MSG });

    case "PASSWORD_OK":
      return noEffects({
        ...state,
        busy: false,
        passwordError: null,
        networkError: false,
        step: "connecting",
      });

    case "CONNECT_OK":
      return noEffects({ ...state, busy: false, step: "success" });

    case "CONNECT_FAILED":
      return noEffects({ ...state, busy: false, networkError: true, step: "password" });

    case "OPEN_TERMS":
      return noEffects({
        ...state,
        returnTo: state.step === "terms" ? state.returnTo : state.step,
        step: "terms",
      });

    case "CLOSE_TERMS":
      return noEffects({ ...state, step: state.returnTo });

    case "RETRY":
      // From ratelimited/error: clear errors, resume at the password screen.
      return noEffects({
        ...state,
        passwordError: null,
        networkError: false,
        step: "password",
      });

    case "RESET":
      // Fresh start, same device (mac survives).
      return noEffects(initialFlowState(state.mac));

    case "SHOW_ALREADY_CONNECTED":
      return noEffects({ ...state, step: "already" });

    case "SHOW_SESSION_EXPIRED":
      return noEffects({ ...state, step: "sessionexpired" });

    case "SHOW_RATELIMIT":
      return noEffects({ ...state, busy: false, step: "ratelimited" });

    case "SHOW_ERROR":
      return noEffects({ ...state, busy: false, step: "error" });

    default:
      return noEffects(state);
  }
}
