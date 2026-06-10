import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  type FlowEvent,
  type FlowState,
  initialFlowState,
  loadFlowState,
  type PortalEffect,
  persistFlowState,
  reducer,
} from "@/flow/flow";
import { AlreadyConnected } from "@/screens/AlreadyConnected";
import { Connecting } from "@/screens/Connecting";
import { GenericError } from "@/screens/GenericError";
import { LandingBare } from "@/screens/Landing";
import { RateLimited } from "@/screens/RateLimited";
import { Sending } from "@/screens/Sending";
import { SessionExpired } from "@/screens/SessionExpired";
import { Success } from "@/screens/Success";
import { Terms } from "@/screens/Terms";
import { Verify } from "@/screens/Verify";
import { WifiPassword } from "@/screens/WifiPassword";

// UniFi redirects the guest's browser here with query params; the MAC (id/mac)
// is the device identity threaded through every server call. Read once at boot.
function readMac(): string {
  const q = new URLSearchParams(window.location.search);
  return q.get("id") ?? q.get("mac") ?? "";
}

// Where "Start browsing" / "Continue browsing" sends the guest: the original
// requested URL UniFi passed through, or a sensible default.
function originalUrl(): string {
  const q = new URLSearchParams(window.location.search);
  return q.get("url") ?? "https://example.com";
}

export function App() {
  const mac = useMemo(readMac, []);
  // Rehydrate a mid-flow position (verify/password) after a refresh; otherwise
  // a fresh landing. (www-q002.7 refresh-safety.)
  const [state, rawDispatch] = useReducer(
    (s: FlowState, e: FlowEvent) => reducer(s, e).state,
    mac,
    (m) => loadFlowState(m) ?? initialFlowState(m),
  );

  // Run the side effects a transition asks for. This is the seam where the
  // tRPC client to /api/trpc portal.* procedures gets wired (www-q002.9 backend);
  // resetAttempts is fire-and-forget, exactly as the design rule requires.
  const runEffects = useCallback((effects: PortalEffect[]) => {
    for (const _eff of effects) {
      // Effect execution (portal.sendCode / verifyCode / checkPassword /
      // resetAttempts) is dispatched here once the tRPC client lands; the
      // reducer stays pure and the screens stay declarative.
    }
  }, []);

  const dispatch = useCallback(
    (event: FlowEvent) => {
      const result = reducer(state, event);
      runEffects(result.effects);
      rawDispatch(event);
    },
    [state, runEffects],
  );

  // Persist step + email so a mid-flow refresh restores position.
  useEffect(() => {
    persistFlowState(state);
  }, [state]);

  // Drive the resend cooldown tick while on verify.
  useEffect(() => {
    if (state.step !== "verify" || state.resendLeft <= 0) return undefined;
    const id = setTimeout(() => dispatch({ type: "RESEND_TICK" }), 1000);
    return () => clearTimeout(id);
  }, [state.step, state.resendLeft, dispatch]);

  const goExternal = () => window.location.assign(originalUrl());

  switch (state.step) {
    case "landing":
      return (
        <LandingBare
          state={state.form}
          errors={state.errors}
          networkError={state.networkError}
          busy={state.busy}
          onChange={(k, v) => dispatch({ type: "EDIT_FIELD", field: k, value: v })}
          onSubmit={() =>
            dispatch({
              type: "SUBMIT_LANDING",
              form: { name: state.form.name, email: state.form.email, agreed: state.form.agreed },
            })
          }
          onOpenTerms={() => dispatch({ type: "OPEN_TERMS" })}
        />
      );
    case "sending":
      return <Sending email={state.form.email} />;
    case "verify":
      return (
        <Verify
          email={state.form.email}
          error={state.verifyError}
          expired={state.verifyExpired}
          busy={state.busy}
          initialLeft={state.resendLeft}
          onVerify={(code) => dispatch({ type: "VERIFY_SUBMIT", code })}
          onResend={() => dispatch({ type: "RESEND" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );
    case "password":
      return (
        <WifiPassword
          error={state.passwordError}
          networkError={state.networkError}
          busy={state.busy}
          onSubmit={(password) => dispatch({ type: "PASSWORD_SUBMIT", password })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      );
    case "connecting":
      return <Connecting email={state.form.email} />;
    case "success":
      return <Success name={state.form.name} email={state.form.email} onPrimary={goExternal} />;
    case "already":
      return (
        <AlreadyConnected
          email={state.form.email}
          onPrimary={goExternal}
          onReset={() => dispatch({ type: "RESET" })}
        />
      );
    case "ratelimited":
      return (
        <RateLimited
          initialLeft={60}
          onRetry={() => dispatch({ type: "RETRY" })}
          onReset={() => dispatch({ type: "RESET" })}
        />
      );
    case "sessionexpired":
      return <SessionExpired onReconnect={() => dispatch({ type: "RESET" })} />;
    case "error":
      return (
        <GenericError
          onRetry={() => dispatch({ type: "RETRY" })}
          onReset={() => dispatch({ type: "RESET" })}
        />
      );
    case "terms":
      return <Terms onBack={() => dispatch({ type: "CLOSE_TERMS" })} />;
    default:
      return (
        <LandingBare
          state={state.form}
          errors={state.errors}
          networkError={state.networkError}
          busy={state.busy}
          onChange={() => {}}
          onSubmit={() => {}}
          onOpenTerms={() => {}}
        />
      );
  }
}
