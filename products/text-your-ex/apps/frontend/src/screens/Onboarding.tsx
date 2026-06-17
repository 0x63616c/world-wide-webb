import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { useState } from "react";
import { api } from "../api";
import type { AppCtx } from "../appctx";
import { Icon } from "../icons";
import { T } from "../theme";

export function Onboarding({ ctx }: { ctx: AppCtx }) {
  const [busy, setBusy] = useState(false);
  // Surfaced on-screen so a failed sign-in shows WHY (which stage, what error)
  // instead of the silent "Sign Up Not Completed" with no detail.
  const [err, setErr] = useState<string | null>(null);

  const signInApple = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      // Real "Sign in with Apple" only works inside the native iOS app (the Apple
      // sheet can't run in a browser). On web the button is inert; local dev and
      // e2e mint a session through the non-production /auth/dev seam instead.
      if (!Capacitor.isNativePlatform()) {
        setBusy(false);
        return;
      }
      let identityToken: string;
      try {
        const { response } = await SignInWithApple.authorize({
          clientId: "co.worldwidewebb.textyourex",
          redirectURI: "",
          scopes: "name email",
        });
        identityToken = response.identityToken;
      } catch (e) {
        // Native Apple sheet failed (config / entitlement / cancel).
        // Dump all properties — non-enumerable ones too — so Xcode / Safari
        // Web Inspector shows the full native error (code, domain, description).
        const code = (e as { code?: unknown })?.code;
        const msg = (e as { message?: string })?.message;
        const full = JSON.stringify(e, Object.getOwnPropertyNames(e as object));
        console.error("[tye] signInApple native error", { code, message: msg, full });
        setErr(`Apple sheet code=${code ?? "?"}: ${msg ?? full}`);
        setBusy(false);
        return;
      }
      try {
        const { token, user, isNew } = await api.signInWithApple(identityToken);
        ctx.signIn(token, user);
        if (isNew || !user.name) ctx.nav("setup", {});
      } catch (e) {
        // The token was minted but our API rejected it (e.g. aud mismatch -> 401).
        setErr(`API: ${(e as { message?: string })?.message ?? JSON.stringify(e)}`);
        setBusy(false);
      }
    } catch (e) {
      setErr(`${(e as { message?: string })?.message ?? JSON.stringify(e)}`);
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
        {err && (
          <p
            style={{
              textAlign: "center",
              fontSize: 12,
              color: T.red,
              margin: "2px 0 0",
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {err}
          </p>
        )}
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
