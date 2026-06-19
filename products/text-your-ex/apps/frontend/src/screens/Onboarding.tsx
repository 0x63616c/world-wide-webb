import { Capacitor } from "@capacitor/core";
import { useState } from "react";
import { api } from "../api";
import type { AppCtx } from "../appctx";
import { Icon } from "../icons";
import { authorizeAppleSignIn, createAppleSignInRequest } from "../native/appleSignIn";
import { T } from "../theme";

type SignInLogEntry = {
  readonly at: string;
  readonly message: string;
};

function describeError(error: unknown): { code: unknown; message: string; full: string } {
  const code = (error as { code?: unknown })?.code;
  const message = (error as { message?: string })?.message ?? "unknown error";
  let full: string;
  try {
    full = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  } catch {
    full = String(error);
  }
  return { code, message, full };
}

export function Onboarding({ ctx }: { ctx: AppCtx }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signInLog, setSignInLog] = useState<SignInLogEntry[]>([]);

  const addLog = (message: string) => {
    const at = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    setSignInLog((entries) => [...entries.slice(-5), { at, message }]);
  };

  const signInApple = async () => {
    if (busy) return;
    setErr(null);
    setSignInLog([]);
    setBusy(true);
    addLog("tap received");
    try {
      // Real "Sign in with Apple" only works inside the native iOS app (the Apple
      // sheet can't run in a browser). On web the button is inert; local dev and
      // e2e mint a session through the non-production /auth/dev seam instead.
      if (!Capacitor.isNativePlatform()) {
        addLog("not native, skipping Apple sheet");
        setBusy(false);
        return;
      }
      let identityToken: string;
      try {
        const request = createAppleSignInRequest();
        addLog(`opening native Apple sheet attempt=${request.attemptId}`);
        const response = await authorizeAppleSignIn(request);
        identityToken = response.identityToken;
        addLog(
          `Apple returned identity token (${identityToken.length} chars) attempt=${response.attemptId} code=${response.hasAuthorizationCode}`,
        );
      } catch (e) {
        const { code, message, full } = describeError(e);
        addLog(`Apple authorize failed code=${code ?? "?"}`);
        console.error("[tye] signInApple native error", { code, message, full });
        setErr(`Apple authorize failed before API. code=${code ?? "?"}: ${message || full}`);
        setBusy(false);
        return;
      }
      try {
        addLog("posting identity token to API");
        const { token, user, isNew } = await api.signInWithApple(identityToken);
        addLog("API sign-in succeeded");
        ctx.signIn(token, user);
        if (isNew || !user.name) ctx.nav("setup", {});
      } catch (e) {
        const { message, full } = describeError(e);
        addLog("API rejected Apple token");
        setErr(`API rejected Apple token: ${message || full}`);
        setBusy(false);
      }
    } catch (e) {
      const { message, full } = describeError(e);
      addLog("unexpected sign-in failure");
      setErr(message || full);
      setBusy(false);
    }
  };

  // On the native shell the OS safe-area insets are already applied by the app
  // wrapper, so the screen must NOT also add the web-mockup status-bar clearance
  // (that double padding is what pushed the badge down and left a big bottom gap).
  const native = Capacitor.isNativePlatform();

  return (
    <div
      style={{
        flex: 1,
        background: T.bg,
        color: T.text,
        fontFamily: T.ui,
        display: "flex",
        flexDirection: "column",
        padding: `0 28px ${native ? 12 : 44}px`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          paddingTop: native ? 10 : 60,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 13,
            background: T.gold,
            color: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: T.disp,
            fontWeight: 800,
            fontSize: 26,
            transform: "rotate(-6deg)",
          }}
        >
          $
        </div>
        <span
          style={{
            fontFamily: T.ui,
            fontWeight: 700,
            fontSize: 15,
            color: T.sec,
            letterSpacing: "0.04em",
          }}
        >
          EST. AFTER THE BREAKUP
        </span>
      </div>
      {(err || signInLog.length > 0) && (
        <div
          style={{
            marginTop: 14,
            border: `1px solid ${err ? "rgba(255,69,58,0.35)" : T.hair}`,
            background: err ? "rgba(255,69,58,0.12)" : T.surface,
            borderRadius: 16,
            padding: 12,
            flexShrink: 0,
          }}
        >
          {err && (
            <p
              style={{
                fontSize: 13,
                color: T.red,
                margin: "0 0 8px",
                lineHeight: 1.35,
                wordBreak: "break-word",
                fontWeight: 700,
              }}
            >
              {err}
            </p>
          )}
          {signInLog.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {signInLog.map((entry) => (
                <p
                  key={`${entry.at}-${entry.message}`}
                  style={{
                    margin: 0,
                    color: T.sec,
                    fontSize: 11,
                    lineHeight: 1.3,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    wordBreak: "break-word",
                  }}
                >
                  {entry.at} {entry.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <h1
          style={{
            fontFamily: T.disp,
            fontWeight: 800,
            fontSize: 58,
            lineHeight: 0.92,
            letterSpacing: "-0.045em",
            margin: 0,
          }}
        >
          Text
          <br />
          Your
          <br />
          <span style={{ color: T.gold }}>Ex.</span>
        </h1>
        <p
          style={{
            fontFamily: T.disp,
            fontWeight: 700,
            fontSize: 23,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            margin: "26px 0 10px",
          }}
        >
          Stop texting your ex.
          <br />
          Or don't, but <span style={{ color: T.gold }}>pay up.</span>
        </p>
        <p style={{ fontSize: 16, color: T.sec, lineHeight: 1.45, margin: 0, maxWidth: 300 }}>
          A shared guilt jar for you and the friends who already know who you shouldn't be texting.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
        <button
          type="button"
          onClick={signInApple}
          disabled={busy}
          style={{
            width: "100%",
            height: 56,
            borderRadius: 16,
            background: "#fff",
            color: "#000",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            fontFamily: T.ui,
            fontWeight: 700,
            fontSize: 18,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Icon.apple style={{ marginTop: -2 }} /> Sign in with Apple
        </button>
        <p
          style={{
            textAlign: "center",
            fontSize: 12,
            color: T.ter,
            margin: "4px 0 0",
            lineHeight: 1.4,
          }}
        >
          Payments coming soon. The shame is real though.
        </p>
      </div>
    </div>
  );
}
