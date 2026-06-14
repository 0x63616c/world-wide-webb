import { useEffect, useState } from "react";
import { api } from "../api";
import type { AppCtx } from "../appctx";
import { Icon } from "../icons";
import { T } from "../theme";
import type { JarDetailDTO } from "../types";
import { Btn, Screen, TopBar } from "../ui";

export function Invite({ ctx }: { ctx: AppCtx }) {
  const jarId = ctx.route.params.jarId as string;
  const fresh = !!ctx.route.params.fresh;
  const [jar, setJar] = useState<JarDetailDTO | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .jar(jarId)
      .then((d) => {
        if (alive) setJar(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [jarId]);

  const code = jar?.inviteCode ?? "······";
  const link = `textyourex.app/j/${code}`;

  const copy = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const shareApps = [
    { name: "Messages", bg: "#34C759", glyph: "💬" },
    { name: "WhatsApp", bg: "#25D366", glyph: "🟢" },
    {
      name: "Instagram",
      bg: "linear-gradient(45deg,#FEDA75,#FA7E1E,#D62976,#962FBF)",
      glyph: "📸",
    },
    { name: "Copy link", bg: T.surface2, glyph: "🔗" },
  ];

  return (
    <Screen>
      <TopBar onBack={() => ctx.back()} title="Invite to jar" />
      {fresh && (
        <div
          style={{
            background: "rgba(48,209,88,0.12)",
            border: `1px solid rgba(48,209,88,0.35)`,
            borderRadius: 16,
            padding: "12px 16px",
            marginBottom: 18,
            fontSize: 14,
            color: T.green,
            fontWeight: 600,
          }}
        >
          ✓ Jar created. Now drag your friends down with you.
        </div>
      )}
      <div style={{ textAlign: "center", padding: "6px 0 4px" }}>
        <div style={{ fontSize: 13.5, color: T.sec, fontWeight: 600, marginBottom: 8 }}>
          SHARE THIS CODE
        </div>
        <div
          style={{
            fontFamily: T.disp,
            fontWeight: 800,
            fontSize: 52,
            color: T.gold,
            letterSpacing: "0.08em",
          }}
        >
          {code}
        </div>
      </div>

      <button
        type="button"
        onClick={copy}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: T.surface,
          border: `1px solid ${T.hair}`,
          borderRadius: 16,
          padding: "14px 16px",
          margin: "20px 0 26px",
          cursor: "pointer",
          color: T.text,
        }}
      >
        <span style={{ flex: 1, textAlign: "left", fontFamily: T.ui, fontSize: 15, color: T.sec }}>
          {link}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: copied ? T.green : T.gold,
            fontFamily: T.ui,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {copied ? (
            <>
              <Icon.check style={{ width: 16, height: 16 }} /> Copied
            </>
          ) : (
            <>
              <Icon.copy /> Copy
            </>
          )}
        </span>
      </button>

      <div
        style={{
          fontSize: 12,
          color: T.sec,
          fontWeight: 600,
          marginBottom: 14,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Send it via
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 30 }}>
        {shareApps.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={a.name === "Copy link" ? copy : undefined}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              width: 72,
            }}
          >
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: 16,
                background: a.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                border: a.name === "Copy link" ? `1px solid ${T.hair}` : "none",
              }}
            >
              {a.glyph}
            </div>
            <span style={{ fontFamily: T.ui, fontSize: 11.5, color: T.sec, fontWeight: 600 }}>
              {a.name}
            </span>
          </button>
        ))}
      </div>

      <Btn kind="gold" onClick={() => ctx.nav("jar", { jarId }, true)}>
        {fresh ? "Take me to my jar" : "Done"}
      </Btn>
    </Screen>
  );
}
