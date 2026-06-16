import { useState } from "react";
import { api } from "../api";
import type { AppCtx } from "../appctx";
import { T } from "../theme";
import { Btn, Screen, TopBar } from "../ui";
import { type AvatarDraft, AvatarEditor, inputStyle, labelStyle } from "./common";

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
