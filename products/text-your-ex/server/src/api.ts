import { Hono } from "hono";
import { requireUser } from "./auth";
import * as store from "./store";

export type Env = { Variables: { userId: string | null; token: string } };

export const api = new Hono<Env>();

const unauth = { error: "not_authenticated" } as const;

// ─────────────────────────── health ───────────────────────────
api.get("/health", (c) => c.json({ ok: true }));

// ─────────────────────────── auth ───────────────────────────
// "Sign in with Apple" demo: log in as the seeded primary user (Calum).
api.post("/auth/demo", (c) => {
  const seeded = store.findUserByPhone("+15550000001");
  const user = seeded ?? store.createUser({ name: "Calum", color: "#5E5CE6", exes: ["Christie"] });
  const token = store.createSession(user.id);
  return c.json({ token, user: store.getMe(user.id), isNew: false });
});

api.post("/auth/otp/request", async (c) => {
  const { phone } = await c.req.json<{ phone: string }>();
  if (!phone) return c.json({ error: "phone_required" }, 400);
  const code = store.requestOtp(phone);
  return c.json({ ok: true, code }); // code echoed for the pretend/demo flow
});

api.post("/auth/otp/verify", async (c) => {
  const { phone, code } = await c.req.json<{ phone: string; code: string }>();
  if (!store.verifyOtp(phone, code)) return c.json({ error: "bad_code" }, 400);
  const existing = store.findUserByPhone(phone);
  const isNew = !existing;
  const user = existing ?? store.createUser({ name: "", phone, authProvider: "phone" });
  const token = store.createSession(user.id);
  return c.json({ token, user: store.getMe(user.id), isNew });
});

api.post("/auth/logout", (c) => {
  const token = c.get("token");
  if (token) store.deleteSession(token);
  return c.json({ ok: true });
});

// ─────────────────────────── me ───────────────────────────
api.get("/me", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(store.getMe(uid));
});

api.patch("/me", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const body = await c.req.json<{
    name?: string;
    color?: string;
    emoji?: string | null;
    photo?: string | null;
    exes?: string[];
    notifPrefs?: import("./types").NotifPrefs;
  }>();
  if (
    body.name !== undefined ||
    body.color !== undefined ||
    body.emoji !== undefined ||
    body.photo !== undefined
  ) {
    store.updateUser(uid, {
      name: body.name,
      color: body.color,
      emoji: body.emoji,
      photo: body.photo,
    });
  }
  if (body.exes !== undefined) store.setExes(uid, body.exes);
  if (body.notifPrefs !== undefined) store.setNotifPrefs(uid, body.notifPrefs);
  return c.json(store.getMe(uid));
});

// ─────────────────────────── jars ───────────────────────────
api.get("/jars", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(store.listJarsForUser(uid));
});

api.post("/jars", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const { name, rule, defaultCents } = await c.req.json<{
    name: string;
    rule?: string;
    defaultCents?: number;
  }>();
  if (!name?.trim()) return c.json({ error: "name_required" }, 400);
  return c.json(store.createJar({ userId: uid, name: name.trim(), rule, defaultCents }));
});

api.get("/jars/code/:code", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const preview = store.getJarPreviewByCode(c.req.param("code"));
  if (!preview) return c.json({ error: "not_found" }, 404);
  return c.json(preview);
});

api.post("/jars/join", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const { code } = await c.req.json<{ code: string }>();
  const res = store.joinJarByCode(uid, code ?? "");
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

api.get("/jars/:id", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!store.isMember(jarId, uid)) return c.json({ error: "not_member" }, 403);
  const detail = store.getJarDetail(jarId, uid);
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

api.post("/jars/:id/share-streak", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!store.isMember(jarId, uid)) return c.json({ error: "not_member" }, 403);
  const { value } = await c.req.json<{ value: boolean }>();
  store.setShareStreak(jarId, uid, !!value);
  return c.json({ ok: true });
});

// ─────────────────────────── slips ───────────────────────────
api.post("/jars/:id/slips", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!store.isMember(jarId, uid)) return c.json({ error: "not_member" }, 403);
  const { amountCents, note, exLabel } = await c.req.json<{
    amountCents: number;
    note?: string;
    exLabel?: string;
  }>();
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return c.json({ error: "bad_amount" }, 400);
  store.logSlip({ jarId, userId: uid, amountCents, note, exLabel, source: "self" });
  return c.json(store.getJarDetail(jarId, uid));
});

// ─────────────────────────── reports ───────────────────────────
api.post("/jars/:id/reports", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!store.isMember(jarId, uid)) return c.json({ error: "not_member" }, 403);
  const body = await c.req.json<{
    accusedId: string;
    note?: string;
    anonymous?: boolean;
    amountCents?: number;
    evidence?: import("./types").EvidenceThread[];
  }>();
  if (!body.accusedId || !store.isMember(jarId, body.accusedId))
    return c.json({ error: "bad_target" }, 400);
  const detail = store.getJarDetail(jarId, uid)!;
  const amount = body.amountCents ?? detail.defaultCents;
  const report = store.createReport({
    jarId,
    accuserId: uid,
    accusedId: body.accusedId,
    note: body.note ?? null,
    anonymous: !!body.anonymous,
    amountCents: amount,
    evidence: body.evidence ?? [],
  });
  return c.json(report);
});

api.get("/reports/pending", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(store.pendingReportsForUser(uid));
});

api.post("/reports/:id/resolve", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const { action } = await c.req.json<{ action: "own" | "deny" }>();
  if (action !== "own" && action !== "deny") return c.json({ error: "bad_action" }, 400);
  const res = store.resolveReport(c.req.param("id"), uid, action);
  if (!res) return c.json({ error: "not_found_or_forbidden" }, 404);
  return c.json(res);
});

// ─────────────────────────── activity ───────────────────────────
api.get("/activity", (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(store.activityForUser(uid));
});
