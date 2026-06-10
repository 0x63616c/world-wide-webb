import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { type EffectContext, runEffect, statusToEvent } from "@/flow/effects";
import {
  type FlowEvent,
  type FlowState,
  initialFlowState,
  loadFlowState,
  persistFlowState,
  reducer,
} from "@/flow/flow";
import { portalClient } from "@/lib/trpc";
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
  // a fresh landing. (CC-q002.7 refresh-safety.)
  const [state, rawDispatch] = useReducer(
    (s: FlowState, e: FlowEvent) => reducer(s, e).state,
    mac,
    (m) => loadFlowState(m) ?? initialFlowState(m),
  );

  // The latest state, read inside async effect callbacks without re-binding
  // dispatch on every render (which would re-fire the boot/connecting effects).
  const stateRef = useRef(state);
  stateRef.current = state;

  // dispatch = reduce + run the resulting effects against the portal client,
  // dispatching each effect's result events as they resolve. The reducer stays
  // pure; this is the only place that touches the network (the .7->.9 seam).
  const dispatch = useCallback((event: FlowEvent) => {
    const before = stateRef.current;
    const { effects } = reducer(before, event);
    rawDispatch(event);
    for (const effect of effects) {
      const ctx: EffectContext = {
        name: before.form.name,
        email: before.form.email,
        guestId: before.guestId ?? undefined,
      };
      runEffect(portalClient, effect, ctx).then((events) => {
        for (const e of events) rawDispatch(e);
      });
    }
  }, []);

  // Persist step + email so a mid-flow refresh restores position.
  useEffect(() => {
    persistFlowState(state);
  }, [state]);

  // Boot: ask the server if this device is already authorized (active) or
  // lapsed (expired) and short-circuit to the matching screen. Only from a
  // fresh landing (a restored mid-flow position is honoured as-is). Runs once.
  useEffect(() => {
    if (!mac || stateRef.current.step !== "landing") return;
    let cancelled = false;
    portalClient
      .status({ mac })
      .then((res) => {
        if (cancelled) return;
        const ev = statusToEvent(res.state);
        if (ev) rawDispatch(ev);
      })
      .catch(() => {
        // No status (network/unconfigured): stay on landing, the guest can
        // still sign in normally.
      });
    return () => {
      cancelled = true;
    };
  }, [mac]);

  // Entering "connecting" kicks the authorize call (verifyCode already supplied
  // guestId). authorize is idempotent server-side, so a retry is safe.
  useEffect(() => {
    if (state.step !== "connecting") return;
    runEffect(
      portalClient,
      { type: "authorize", mac },
      { guestId: state.guestId ?? undefined },
    ).then((events) => {
      for (const e of events) rawDispatch(e);
    });
  }, [state.step, state.guestId, mac]);

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
