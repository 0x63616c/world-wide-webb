import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { requireUser } from "./auth";
import { appleBundleId, isProduction } from "./env";
import { resetAndSeed } from "./seed";
import * as store from "./store";

export type Env = { Variables: { userId: string | null; token: string } };

export const api = new Hono<Env>();

const unauth = { error: "not_authenticated" } as const;

// Sign In with Apple: verify the identity token against Apple's public JWKS.
// audience must equal the app's bundle id; no Apple private key is needed.
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

async function verifyAppleToken(identityToken: string): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: "https://appleid.apple.com",
    audience: appleBundleId(),
  });
  if (!payload.sub) throw new Error("missing sub in Apple JWT");
  return { sub: payload.sub };
}

// ─────────────────────────── health ───────────────────────────
api.get("/health", (c) => c.json({ ok: true }));

// ─────────────────────────── auth ───────────────────────────
// Non-production dev/test login seam (404 in production). The native "Sign in
// with Apple" sheet can't run in a browser, so local dev and the e2e suite mint
// a session here instead. { as: "new" } creates a fresh empty-profile user (the
// first-run setup flow); otherwise it logs in as the seeded primary user.
api.post("/auth/dev", async (c) => {
  if (isProduction()) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ as?: "new" | "calum" }>().catch(() => ({}) as { as?: string });
  if (body.as === "new") {
    const fresh = await store.createUser({
      name: "",
      appleId: `dev_${crypto.randomUUID()}`,
      authProvider: "apple",
    });
    const token = await store.createSession(fresh.id);
    return c.json({ token, user: await store.getMe(fresh.id), isNew: true });
  }
  const seeded = await store.findUserByPhone("+15550000001");
  const user =
    seeded ?? (await store.createUser({ name: "Calum", color: "#5E5CE6", exes: ["Christie"] }));
  const token = await store.createSession(user.id);
  return c.json({ token, user: await store.getMe(user.id), isNew: false });
});

// Non-production test seam: truncate + reseed for per-test isolation (404 in prod).
api.post("/test/reset", async (c) => {
  if (isProduction()) return c.json({ error: "not_found" }, 404);
  await resetAndSeed();
  return c.json({ ok: true });
});

// Real Sign In with Apple: verifies the JWT from the native
// ASAuthorizationAppleIDProvider flow, then finds or creates the user.
api.post("/auth/apple", async (c) => {
  const { identityToken } = await c.req.json<{ identityToken: string }>();
  if (!identityToken) return c.json({ error: "identity_token_required" }, 400);
  let sub: string;
  try {
    ({ sub } = await verifyAppleToken(identityToken));
  } catch {
    return c.json({ error: "invalid_apple_token" }, 401);
  }
  const existing = await store.findUserByAppleId(sub);
  const isNew = !existing;
  const user =
    existing ?? (await store.createUser({ name: "", appleId: sub, authProvider: "apple" }));
  const token = await store.createSession(user.id);
  return c.json({ token, user: await store.getMe(user.id), isNew });
});

api.post("/auth/logout", async (c) => {
  const token = c.get("token");
  if (token) await store.deleteSession(token);
  return c.json({ ok: true });
});

// ─────────────────────────── me ───────────────────────────
api.get("/me", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(await store.getMe(uid));
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
  }>();
  if (
    body.name !== undefined ||
    body.color !== undefined ||
    body.emoji !== undefined ||
    body.photo !== undefined
  ) {
    await store.updateUser(uid, {
      name: body.name,
      color: body.color,
      emoji: body.emoji,
      photo: body.photo,
    });
  }
  if (body.exes !== undefined) await store.setExes(uid, body.exes);
  return c.json(await store.getMe(uid));
});

// ─────────────────────────── jars ───────────────────────────
api.get("/jars", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(await store.listJarsForUser(uid));
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
  return c.json(await store.createJar({ userId: uid, name: name.trim(), rule, defaultCents }));
});

api.get("/jars/code/:code", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const preview = await store.getJarPreviewByCode(c.req.param("code"));
  if (!preview) return c.json({ error: "not_found" }, 404);
  return c.json(preview);
});

api.post("/jars/join", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const { code } = await c.req.json<{ code: string }>();
  const res = await store.joinJarByCode(uid, code ?? "");
  if (!res) return c.json({ error: "not_found" }, 404);
  return c.json(res);
});

api.get("/jars/:id", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!(await store.isMember(jarId, uid))) return c.json({ error: "not_member" }, 403);
  const detail = await store.getJarDetail(jarId, uid);
  if (!detail) return c.json({ error: "not_found" }, 404);
  return c.json(detail);
});

api.post("/jars/:id/share-streak", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!(await store.isMember(jarId, uid))) return c.json({ error: "not_member" }, 403);
  const { value } = await c.req.json<{ value: boolean }>();
  await store.setShareStreak(jarId, uid, !!value);
  return c.json({ ok: true });
});

// ─────────────────────────── slips ───────────────────────────
api.post("/jars/:id/slips", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!(await store.isMember(jarId, uid))) return c.json({ error: "not_member" }, 403);
  const { amountCents, note, exLabel } = await c.req.json<{
    amountCents: number;
    note?: string;
    exLabel?: string;
  }>();
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return c.json({ error: "bad_amount" }, 400);
  await store.logSlip({ jarId, userId: uid, amountCents, note, exLabel, source: "self" });
  return c.json(await store.getJarDetail(jarId, uid));
});

// ─────────────────────────── reports ───────────────────────────
api.post("/jars/:id/reports", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const jarId = c.req.param("id");
  if (!(await store.isMember(jarId, uid))) return c.json({ error: "not_member" }, 403);
  const body = await c.req.json<{
    accusedId: string;
    note?: string;
    anonymous?: boolean;
    amountCents?: number;
    evidence?: import("./types").EvidenceThread[];
  }>();
  if (!body.accusedId || !(await store.isMember(jarId, body.accusedId)))
    return c.json({ error: "bad_target" }, 400);
  const detail = await store.getJarDetail(jarId, uid);
  if (!detail) return c.json({ error: "jar_not_found" }, 404);
  const amount = body.amountCents ?? detail.defaultCents;
  const report = await store.createReport({
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

api.get("/reports/pending", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(await store.pendingReportsForUser(uid));
});

api.post("/reports/:id/resolve", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  const { action } = await c.req.json<{ action: "own" | "deny" }>();
  if (action !== "own" && action !== "deny") return c.json({ error: "bad_action" }, 400);
  const res = await store.resolveReport(c.req.param("id"), uid, action);
  if (!res) return c.json({ error: "not_found_or_forbidden" }, 404);
  return c.json(res);
});

// ─────────────────────────── activity ───────────────────────────
api.get("/activity", async (c) => {
  const uid = requireUser(c);
  if (!uid) return c.json(unauth, 401);
  return c.json(await store.activityForUser(uid));
});
