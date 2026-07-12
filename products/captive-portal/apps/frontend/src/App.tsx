import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { runEffect, statusToEvent } from "@/flow/effects";
import { type FlowEvent, type FlowState, initialFlowState, reducer } from "@/flow/flow";
import { portalClient } from "@/lib/trpc";
import { AlreadyConnected } from "@/screens/AlreadyConnected";
import { Connecting } from "@/screens/Connecting";
import { GenericError } from "@/screens/GenericError";
import { RateLimited } from "@/screens/RateLimited";
import { SessionExpired } from "@/screens/SessionExpired";
import { Success } from "@/screens/Success";
import { Terms } from "@/screens/Terms";
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
  const [state, rawDispatch] = useReducer(
    (s: FlowState, e: FlowEvent) => reducer(s, e).state,
    mac,
    initialFlowState,
  );

  // The latest state, read inside async effect callbacks without re-binding
  // dispatch on every render (which would re-fire the boot/connecting effects).
  const stateRef = useRef(state);
  stateRef.current = state;

  // dispatch = reduce + run the resulting effects against the portal client,
  // dispatching each effect's result events as they resolve. The reducer stays
  // pure; this is the only place that touches the network.
  const dispatch = useCallback((event: FlowEvent) => {
    const before = stateRef.current;
    const { effects } = reducer(before, event);
    rawDispatch(event);
    for (const effect of effects) {
      runEffect(portalClient, effect).then((events) => {
        for (const e of events) rawDispatch(e);
      });
    }
  }, []);

  // Boot: ask the server if this device is already authorized (active) or
  // lapsed (expired) and short-circuit to the matching screen. Only from the
  // fresh password screen. Runs once.
  useEffect(() => {
    if (!mac || stateRef.current.step !== "password") return;
    let canceled = false;
    portalClient
      .status({ mac })
      .then((res) => {
        if (canceled) return;
        const ev = statusToEvent(res.state);
        if (ev) rawDispatch(ev);
      })
      .catch(() => {
        // No status (network/unconfigured): stay on the password screen.
      });
    return () => {
      canceled = true;
    };
  }, [mac]);

  // Entering "connecting" kicks the (idempotent) authorize call.
  useEffect(() => {
    if (state.step !== "connecting") return;
    runEffect(portalClient, { type: "authorize", mac }).then((events) => {
      for (const e of events) rawDispatch(e);
    });
  }, [state.step, mac]);

  const goExternal = () => window.location.assign(originalUrl());

  switch (state.step) {
    case "password":
      return (
        <WifiPassword
          error={state.passwordError}
          networkError={state.networkError}
          busy={state.busy}
          agreed={state.form.agreed}
          onAgreeChange={(v) => dispatch({ type: "EDIT_FIELD", field: "agreed", value: v })}
          onSubmit={(password) => dispatch({ type: "PASSWORD_SUBMIT", password })}
          onOpenTerms={() => dispatch({ type: "OPEN_TERMS" })}
        />
      );
    case "connecting":
      return <Connecting />;
    case "success":
      return <Success onPrimary={goExternal} />;
    case "already":
      return (
        <AlreadyConnected onPrimary={goExternal} onReset={() => dispatch({ type: "RESET" })} />
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
      return <Connecting />;
  }
}
