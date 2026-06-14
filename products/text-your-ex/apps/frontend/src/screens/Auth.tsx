import { useState } from "react";
import { api } from "../api";
import type { AppCtx } from "../appctx";
import { T } from "../theme";
import { Btn, Screen, TopBar } from "../ui";
import { type AvatarDraft, AvatarEditor, inputStyle, labelStyle, NumberPad } from "./common";

// ─────────────────────── Phone number entry ───────────────────────
export function PhoneEntry({ ctx }: { ctx: AppCtx }) {
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(false);
  const fmt = (d: string) => {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  };
  const press = (k: string) =>
    setNum((n) => (k === "del" ? n.slice(0, -1) : n.length < 10 ? n + k : n));

  const send = async () => {
    if (num.length < 10 || busy) return;
    setBusy(true);
    const phone = `+1${num}`;
    try {
      await api.requestOtp(phone);
      ctx.nav("code", { num, phone });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar onBack={() => ctx.back()} title="" />
      <div style={{ display: "flex", flexDirection: "column", minHeight: 660 }}>
        <div style={{ paddingTop: 6 }}>
          <h1
            style={{
              fontFamily: T.disp,
              fontWeight: 800,
              fontSize: 32,
              letterSpacing: "-0.03em",
              margin: "0 0 8px",
            }}
          >
            What's your number?
          </h1>
          <p style={{ color: T.sec, fontSize: 15.5, lineHeight: 1.4, margin: 0 }}>
            We'll text you a code. The irony isn't lost on us.
          </p>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: T.surface2,
                border: `1px solid ${T.hair}`,
                borderRadius: 12,
                padding: "10px 14px",
                fontFamily: T.disp,
                fontWeight: 700,
                fontSize: 22,
              }}
            >
              🇺🇸 +1
            </div>
            <div
              style={{
                fontFamily: T.disp,
                fontWeight: 800,
                fontSize: 30,
                letterSpacing: "0.01em",
                minWidth: 200,
                color: num ? T.text : T.ter,
              }}
            >
              {num ? fmt(num) : "(555) 000-0000"}
            </div>
          </div>
        </div>
        <div style={{ paddingBottom: 8 }}>
          <div style={{ marginBottom: 18 }}>
            <NumberPad onPress={press} />
          </div>
          <Btn kind="gold" disabled={num.length < 10 || busy} onClick={send}>
            Send me the code
          </Btn>
        </div>
      </div>
    </Screen>
  );
}

// ─────────────────────── OTP code entry ───────────────────────
export function CodeEntry({ ctx }: { ctx: AppCtx }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const phone = (ctx.route.params.phone as string) ?? "";
  const num = (ctx.route.params.num as string) ?? "";

  const submit = async (full: string) => {
    setBusy(true);
    setErr(false);
    try {
      const { token, user, isNew } = await api.verifyOtp(phone, full);
      if (isNew || !user.name) {
        // brand-new phone account: stash token so /me works, then collect a name
        ctx.signIn(token, user);
        ctx.nav("setup", {});
      } else {
        ctx.signIn(token, user);
      }
    } catch {
      setErr(true);
      setCode("");
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (busy) return;
    setCode((c) => {
      if (k === "del") return c.slice(0, -1);
      const n = c.length < 6 ? c + k : c;
      if (n.length === 6) setTimeout(() => submit(n), 180);
      return n;
    });
  };

  return (
    <Screen>
      <TopBar onBack={() => ctx.back()} title="" />
      <div style={{ display: "flex", flexDirection: "column", minHeight: 660 }}>
        <div style={{ paddingTop: 6 }}>
          <h1
            style={{
              fontFamily: T.disp,
              fontWeight: 800,
              fontSize: 32,
              letterSpacing: "-0.03em",
              margin: "0 0 8px",
            }}
          >
            Check your texts
          </h1>
          <p style={{ color: T.sec, fontSize: 15.5, lineHeight: 1.4, margin: 0 }}>
            Sent a 6-digit code to {num ? `(${num.slice(0, 3)}) •••-${num.slice(6)}` : "your phone"}
            . <span style={{ color: T.ter }}>(demo: any 6 digits)</span>
          </p>
        </div>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 22,
          }}
        >
          <div style={{ display: "flex", gap: 9 }}>
            {[0, 1, 2, 3, 4, 5].map((pos) => (
              <div
                key={`digit-${pos}`}
                style={{
                  width: 44,
                  height: 56,
                  borderRadius: 13,
                  background: T.surface2,
                  border: `1.5px solid ${err ? T.red : code.length === pos ? T.gold : T.hair}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: T.disp,
                  fontWeight: 800,
                  fontSize: 26,
                  color: T.text,
                }}
              >
                {code[pos] || ""}
              </div>
            ))}
          </div>
          {err && (
            <div style={{ color: T.red, fontFamily: T.ui, fontSize: 14 }}>
              That code didn't work. Try again.
            </div>
          )}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: T.gold,
              fontFamily: T.ui,
              fontWeight: 600,
              fontSize: 14.5,
              cursor: "pointer",
            }}
          >
            Resend code
          </button>
        </div>
        <div style={{ paddingBottom: 8 }}>
          <NumberPad onPress={press} />
        </div>
      </div>
    </Screen>
  );
}

// ─────────────────────── New-user profile setup ───────────────────────
export function SetupProfile({ ctx }: { ctx: AppCtx }) {
  const [draft, setDraft] = useState<AvatarDraft>({
    name: ctx.me?.name ?? "",
    color: ctx.me?.color ?? "#5E5CE6",
    emoji: ctx.me?.emoji ?? null,
    photo: ctx.me?.photo ?? null,
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true);
    try {
      const me = await api.updateMe({
        name: draft.name.trim(),
        color: draft.color,
        emoji: draft.emoji,
        photo: draft.photo,
      });
      ctx.setMe(me);
      ctx.tab("home");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar onBack={() => ctx.back()} title="" />
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <h1
          style={{
            fontFamily: T.disp,
            fontWeight: 800,
            fontSize: 32,
            letterSpacing: "-0.03em",
            margin: "0 0 6px",
          }}
        >
          Make it official
        </h1>
        <p style={{ color: T.sec, fontSize: 15.5, lineHeight: 1.4, margin: 0 }}>
          Your friends need to know whose shame is whose.
        </p>
      </div>
      <div style={{ margin: "28px 0 26px" }}>
        <AvatarEditor draft={draft} setDraft={setDraft} />
      </div>
      <span style={labelStyle}>Display name</span>
      <input
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="Calum"
        style={{
          ...inputStyle,
          fontSize: 18,
          fontFamily: T.disp,
          fontWeight: 700,
          marginBottom: 26,
        }}
      />
      <Btn kind="gold" disabled={!draft.name.trim() || busy} onClick={save}>
        Start the shame →
      </Btn>
    </Screen>
  );
}

// ─────────────────────── Edit existing profile ───────────────────────
export function EditProfile({ ctx }: { ctx: AppCtx }) {
  const cur = ctx.me;
  const [draft, setDraft] = useState<AvatarDraft>({
    name: cur?.name ?? "",
    color: cur?.color ?? "#5E5CE6",
    emoji: cur?.emoji ?? null,
    photo: cur?.photo ?? null,
  });
  const [busy, setBusy] = useState(false);

  if (!cur) return null;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const me = await api.updateMe({
        name: draft.name.trim() || cur.name,
        color: draft.color,
        emoji: draft.emoji,
        photo: draft.photo,
      });
      ctx.setMe(me);
      ctx.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar
        onBack={() => ctx.back()}
        title="Edit profile"
        trailing={
          <button
            type="button"
            onClick={save}
            style={{
              background: "none",
              border: "none",
              color: T.gold,
              fontFamily: T.disp,
              fontWeight: 700,
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Save
          </button>
        }
      />
      <div style={{ margin: "20px 0 26px" }}>
        <AvatarEditor draft={draft} setDraft={setDraft} />
      </div>
      <span style={labelStyle}>Display name</span>
      <input
        value={draft.name}
        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        placeholder="Your name"
        style={{
          ...inputStyle,
          fontSize: 18,
          fontFamily: T.disp,
          fontWeight: 700,
          marginBottom: 26,
        }}
      />
      <Btn kind="gold" disabled={busy} onClick={save}>
        Save changes
      </Btn>
    </Screen>
  );
}
