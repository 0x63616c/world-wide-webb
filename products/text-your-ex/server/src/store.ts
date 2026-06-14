import { DAY, db, now } from "./db";
import { id, inviteCode } from "./ids";
import type {
  ActivityDTO,
  ActivityType,
  EvidenceThread,
  JarDetailDTO,
  JarSummaryDTO,
  MeDTO,
  MemberDTO,
  NotifPrefs,
  ReportDTO,
  UserDTO,
} from "./types";

// ─────────────────────────── time helpers ───────────────────────────
function daysClean(streakStartAt: number | null): number {
  if (streakStartAt == null) return -1; // never caved
  return Math.max(0, Math.floor((now() - streakStartAt) / DAY));
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((now() - ts) / 1000));
  if (s < 60) return `${s || 1}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ─────────────────────────── row types ───────────────────────────
type UserRow = {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  photo: string | null;
  phone: string | null;
  auth_provider: string;
  notif_prefs: string;
  created_at: number;
};
type MembershipRow = {
  id: string;
  jar_id: string;
  user_id: string;
  role: string;
  tally_cents: number;
  streak_start_at: number | null;
  share_streak: number;
  joined_at: number;
};
type JarRow = {
  id: string;
  name: string;
  rule: string;
  default_cents: number;
  currency: string;
  created_by: string;
  invite_code: string;
  created_at: number;
};

// ─────────────────────────── users / auth ───────────────────────────
function exesFor(userId: string): string[] {
  return (
    db.query("SELECT label FROM user_exes WHERE user_id = ? ORDER BY rowid").all(userId) as {
      label: string;
    }[]
  ).map((r) => r.label);
}

function serializeUser(u: UserRow): UserDTO {
  return {
    id: u.id,
    name: u.name,
    color: u.color,
    emoji: u.emoji,
    photo: u.photo,
    exes: exesFor(u.id),
  };
}

function getUserRow(userId: string): UserRow | null {
  return (db.query("SELECT * FROM users WHERE id = ?").get(userId) as UserRow) ?? null;
}

function getUser(userId: string): UserDTO | null {
  const u = getUserRow(userId);
  return u ? serializeUser(u) : null;
}

export function getMe(userId: string): MeDTO | null {
  const u = getUserRow(userId);
  if (!u) return null;
  return {
    ...serializeUser(u),
    phone: u.phone,
    notifPrefs: JSON.parse(u.notif_prefs) as NotifPrefs,
  };
}

export function createUser(opts: {
  name: string;
  color?: string;
  emoji?: string | null;
  photo?: string | null;
  phone?: string | null;
  authProvider?: string;
  exes?: string[];
}): UserDTO {
  const uid = id("usr");
  db.run(
    "INSERT INTO users (id, name, color, emoji, photo, phone, auth_provider, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [
      uid,
      opts.name,
      opts.color ?? "#5E5CE6",
      opts.emoji ?? null,
      opts.photo ?? null,
      opts.phone ?? null,
      opts.authProvider ?? "demo",
      now(),
    ],
  );
  for (const label of opts.exes ?? []) {
    db.run("INSERT INTO user_exes (id, user_id, label) VALUES (?,?,?)", [id("exe"), uid, label]);
  }
  return getUser(uid)!;
}

export function updateUser(
  userId: string,
  patch: {
    name?: string;
    color?: string;
    emoji?: string | null;
    photo?: string | null;
  },
): UserDTO | null {
  const u = getUserRow(userId);
  if (!u) return null;
  db.run("UPDATE users SET name=?, color=?, emoji=?, photo=? WHERE id=?", [
    patch.name ?? u.name,
    patch.color ?? u.color,
    patch.emoji === undefined ? u.emoji : patch.emoji,
    patch.photo === undefined ? u.photo : patch.photo,
    userId,
  ]);
  return getUser(userId);
}

export function setNotifPrefs(userId: string, prefs: NotifPrefs): void {
  db.run("UPDATE users SET notif_prefs=? WHERE id=?", [JSON.stringify(prefs), userId]);
}

export function setExes(userId: string, exes: string[]): void {
  db.run("DELETE FROM user_exes WHERE user_id=?", [userId]);
  for (const label of exes) {
    db.run("INSERT INTO user_exes (id, user_id, label) VALUES (?,?,?)", [id("exe"), userId, label]);
  }
}

// ─────────────────────────── sessions ───────────────────────────
export function createSession(userId: string): string {
  const token = id("sess", 24);
  db.run("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)", [
    token,
    userId,
    now(),
  ]);
  return token;
}
export function userIdForToken(token: string): string | null {
  const row = db.query("SELECT user_id FROM sessions WHERE token = ?").get(token) as {
    user_id: string;
  } | null;
  return row?.user_id ?? null;
}
export function deleteSession(token: string): void {
  db.run("DELETE FROM sessions WHERE token=?", [token]);
}

// ─────────────────────────── otp (pretend) ───────────────────────────
export function requestOtp(phone: string): string {
  const code = "000000"; // pretend SMS - any 6 digits also accepted on verify
  db.run(
    "INSERT INTO otps (phone, code, created_at) VALUES (?,?,?) ON CONFLICT(phone) DO UPDATE SET code=excluded.code, created_at=excluded.created_at",
    [phone, code, now()],
  );
  return code;
}
export function verifyOtp(_phone: string, code: string): boolean {
  // Pretend integration: accept any 6-digit numeric code.
  return /^\d{6}$/.test(code);
}
export function findUserByPhone(phone: string): UserDTO | null {
  const u = db.query("SELECT * FROM users WHERE phone = ?").get(phone) as UserRow | null;
  return u ? serializeUser(u) : null;
}

// ─────────────────────────── memberships / jars ───────────────────────────
function membershipRow(jarId: string, userId: string): MembershipRow | null {
  return (
    (db
      .query("SELECT * FROM memberships WHERE jar_id=? AND user_id=?")
      .get(jarId, userId) as MembershipRow) ?? null
  );
}
export function isMember(jarId: string, userId: string): boolean {
  return !!membershipRow(jarId, userId);
}
function jarRow(jarId: string): JarRow | null {
  return (db.query("SELECT * FROM jars WHERE id=?").get(jarId) as JarRow) ?? null;
}
function jarRowByCode(code: string): JarRow | null {
  return (
    (db.query("SELECT * FROM jars WHERE invite_code=?").get(code.toUpperCase()) as JarRow) ?? null
  );
}
function membersOf(jarId: string): MembershipRow[] {
  return db.query("SELECT * FROM memberships WHERE jar_id=?").all(jarId) as MembershipRow[];
}
function jarTotal(jarId: string): number {
  const r = db
    .query("SELECT COALESCE(SUM(tally_cents),0) AS t FROM memberships WHERE jar_id=?")
    .get(jarId) as { t: number };
  return r.t;
}

function serializeMember(m: MembershipRow): MemberDTO {
  return {
    user: getUser(m.user_id)!,
    role: m.role as "owner" | "member",
    tallyCents: m.tally_cents,
    daysClean: daysClean(m.streak_start_at),
    shareStreak: !!m.share_streak,
  };
}

export function listJarsForUser(userId: string): JarSummaryDTO[] {
  const rows = db
    .query(
      `SELECT j.* FROM jars j JOIN memberships m ON m.jar_id=j.id WHERE m.user_id=? ORDER BY j.created_at`,
    )
    .all(userId) as JarRow[];
  return rows.map((j) => {
    const members = membersOf(j.id);
    const mine = members.find((m) => m.user_id === userId)!;
    return {
      id: j.id,
      name: j.name,
      rule: j.rule,
      defaultCents: j.default_cents,
      memberIds: members.map((m) => m.user_id),
      memberCount: members.length,
      jarTotalCents: members.reduce((s, m) => s + m.tally_cents, 0),
      myTallyCents: mine.tally_cents,
      myDaysClean: daysClean(mine.streak_start_at),
    };
  });
}

export function getJarDetail(jarId: string, _meId: string): JarDetailDTO | null {
  const j = jarRow(jarId);
  if (!j) return null;
  const members = membersOf(jarId)
    .map(serializeMember)
    .sort((a, b) => b.tallyCents - a.tallyCents);
  return {
    id: j.id,
    name: j.name,
    rule: j.rule,
    defaultCents: j.default_cents,
    inviteCode: j.invite_code,
    jarTotalCents: jarTotal(jarId),
    members,
    activity: activityForJar(jarId, 8),
  };
}

export function getJarPreviewByCode(code: string): {
  id: string;
  name: string;
  rule: string;
  defaultCents: number;
  memberIds: string[];
  memberCount: number;
} | null {
  const j = jarRowByCode(code);
  if (!j) return null;
  const members = membersOf(j.id);
  return {
    id: j.id,
    name: j.name,
    rule: j.rule,
    defaultCents: j.default_cents,
    memberIds: members.map((m) => m.user_id),
    memberCount: members.length,
  };
}

export function createJar(opts: {
  userId: string;
  name: string;
  rule?: string;
  defaultCents?: number;
}): JarSummaryDTO {
  const jid = id("jar");
  let code = inviteCode();
  while (jarRowByCode(code)) code = inviteCode();
  db.run(
    "INSERT INTO jars (id, name, rule, default_cents, currency, created_by, invite_code, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [jid, opts.name, opts.rule ?? "", opts.defaultCents ?? 500, "usd", opts.userId, code, now()],
  );
  addMembership(jid, opts.userId, "owner");
  return listJarsForUser(opts.userId).find((j) => j.id === jid)!;
}

function addMembership(jarId: string, userId: string, role: "owner" | "member"): void {
  db.run(
    "INSERT OR IGNORE INTO memberships (id, jar_id, user_id, role, tally_cents, streak_start_at, share_streak, joined_at) VALUES (?,?,?,?,?,?,?,?)",
    [id("mem"), jarId, userId, role, 0, null, 1, now()],
  );
}

export function joinJarByCode(userId: string, code: string): { jarId: string } | null {
  const j = jarRowByCode(code);
  if (!j) return null;
  const already = isMember(j.id, userId);
  addMembership(j.id, userId, "member");
  if (!already) logActivity({ jarId: j.id, type: "join", actorId: userId });
  return { jarId: j.id };
}

export function setShareStreak(jarId: string, userId: string, val: boolean): void {
  db.run("UPDATE memberships SET share_streak=? WHERE jar_id=? AND user_id=?", [
    val ? 1 : 0,
    jarId,
    userId,
  ]);
}

// ─────────────────────────── slips ───────────────────────────
const MILESTONE_STEP = 5000; // $50

export function logSlip(opts: {
  jarId: string;
  userId: string;
  amountCents: number;
  note?: string | null;
  exLabel?: string | null;
  source?: "self" | "report";
  reportedBy?: string | null;
}): void {
  const j = jarRow(opts.jarId);
  if (!j) throw new Error("jar not found");
  const before = jarTotal(opts.jarId);

  db.run(
    "INSERT INTO slips (id, jar_id, user_id, amount_cents, note, ex_label, source, reported_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      id("slip"),
      opts.jarId,
      opts.userId,
      opts.amountCents,
      opts.note ?? null,
      opts.exLabel ?? null,
      opts.source ?? "self",
      opts.reportedBy ?? null,
      now(),
    ],
  );
  db.run(
    "UPDATE memberships SET tally_cents = tally_cents + ?, streak_start_at = ? WHERE jar_id=? AND user_id=?",
    [opts.amountCents, now(), opts.jarId, opts.userId],
  );

  logActivity({
    jarId: opts.jarId,
    type: "slip",
    actorId: opts.userId,
    amountCents: opts.amountCents,
    exLabel: opts.exLabel ?? null,
    note: opts.note ?? null,
  });

  const after = before + opts.amountCents;
  for (
    let t = (Math.floor(before / MILESTONE_STEP) + 1) * MILESTONE_STEP;
    t <= after;
    t += MILESTONE_STEP
  ) {
    logActivity({
      jarId: opts.jarId,
      type: "milestone",
      text: `The jar just cracked $${t / 100}. Disgraceful.`,
    });
  }
}

// ─────────────────────────── reports ───────────────────────────
export function createReport(opts: {
  jarId: string;
  accuserId: string;
  accusedId: string;
  note?: string | null;
  anonymous: boolean;
  amountCents: number;
  evidence: EvidenceThread[];
}): ReportDTO {
  const rid = id("rpt");
  db.run(
    "INSERT INTO reports (id, jar_id, accuser_id, accused_id, note, is_anonymous, amount_cents, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      rid,
      opts.jarId,
      opts.accuserId,
      opts.accusedId,
      opts.note ?? null,
      opts.anonymous ? 1 : 0,
      opts.amountCents,
      "pending",
      now(),
    ],
  );
  for (const thread of opts.evidence) {
    db.run(
      "INSERT INTO report_evidence (id, report_id, kind, payload, created_at) VALUES (?,?,?,?,?)",
      [id("evi"), rid, "image", JSON.stringify(thread), now()],
    );
  }
  logActivity({
    jarId: opts.jarId,
    type: "report",
    actorId: opts.accusedId,
    targetId: opts.accuserId,
    anonymous: opts.anonymous,
    note: opts.note ?? null,
  });
  return serializeReport(rid)!;
}

function reportRow(reportId: string) {
  return db.query("SELECT * FROM reports WHERE id=?").get(reportId) as {
    id: string;
    jar_id: string;
    accuser_id: string;
    accused_id: string;
    note: string | null;
    is_anonymous: number;
    amount_cents: number;
    status: string;
    created_at: number;
    resolved_at: number | null;
  } | null;
}

function serializeReport(reportId: string): ReportDTO | null {
  const r = reportRow(reportId);
  if (!r) return null;
  const j = jarRow(r.jar_id)!;
  const evidence = (
    db.query("SELECT * FROM report_evidence WHERE report_id=? ORDER BY rowid").all(reportId) as {
      id: string;
      kind: string;
      payload: string;
    }[]
  ).map((e) => ({
    id: e.id,
    kind: "image" as const,
    thread: JSON.parse(e.payload) as EvidenceThread,
  }));
  return {
    id: r.id,
    jarId: r.jar_id,
    jarName: j.name,
    accuser: r.is_anonymous ? null : getUser(r.accuser_id),
    accused: getUser(r.accused_id)!,
    note: r.note,
    anonymous: !!r.is_anonymous,
    amountCents: r.amount_cents,
    status: r.status as "pending" | "owned" | "denied",
    ago: ago(r.created_at),
    evidence,
  };
}

export function pendingReportsForUser(userId: string): ReportDTO[] {
  const rows = db
    .query(
      "SELECT id FROM reports WHERE accused_id=? AND status='pending' ORDER BY created_at DESC",
    )
    .all(userId) as { id: string }[];
  return rows.map((r) => serializeReport(r.id)!).filter(Boolean);
}

export function resolveReport(
  reportId: string,
  userId: string,
  action: "own" | "deny",
): ReportDTO | null {
  const r = reportRow(reportId);
  if (!r || r.accused_id !== userId || r.status !== "pending") return null;
  if (action === "own") {
    logSlip({
      jarId: r.jar_id,
      userId: r.accused_id,
      amountCents: r.amount_cents,
      note: r.note,
      source: "report",
      reportedBy: r.accuser_id,
    });
    db.run("UPDATE reports SET status='owned', resolved_at=? WHERE id=?", [now(), reportId]);
  } else {
    db.run("UPDATE reports SET status='denied', resolved_at=? WHERE id=?", [now(), reportId]);
    logActivity({ jarId: r.jar_id, type: "deny", actorId: r.accused_id });
  }
  return serializeReport(reportId);
}

// ─────────────────────────── activity ───────────────────────────
function logActivity(opts: {
  jarId: string;
  type: ActivityType;
  actorId?: string | null;
  targetId?: string | null;
  text?: string | null;
  amountCents?: number | null;
  exLabel?: string | null;
  note?: string | null;
  anonymous?: boolean;
}): void {
  db.run(
    "INSERT INTO activity (id, jar_id, type, actor_id, target_id, text, amount_cents, ex_label, note, anonymous, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      id("act"),
      opts.jarId,
      opts.type,
      opts.actorId ?? null,
      opts.targetId ?? null,
      opts.text ?? null,
      opts.amountCents ?? null,
      opts.exLabel ?? null,
      opts.note ?? null,
      opts.anonymous ? 1 : 0,
      now(),
    ],
  );
}

type ActivityRow = {
  id: string;
  jar_id: string;
  type: ActivityType;
  actor_id: string | null;
  target_id: string | null;
  text: string | null;
  amount_cents: number | null;
  ex_label: string | null;
  note: string | null;
  anonymous: number;
  created_at: number;
};

function serializeActivity(a: ActivityRow): ActivityDTO {
  const j = jarRow(a.jar_id);
  return {
    id: a.id,
    jarId: a.jar_id,
    jarName: j?.name ?? "",
    type: a.type,
    user: a.actor_id ? getUser(a.actor_id) : null,
    by: a.target_id ? getUser(a.target_id) : null,
    anonymous: !!a.anonymous,
    amountCents: a.amount_cents,
    exLabel: a.ex_label,
    note: a.note,
    text: a.text,
    ago: ago(a.created_at),
  };
}

function activityForJar(jarId: string, limit = 50): ActivityDTO[] {
  return (
    db
      .query("SELECT * FROM activity WHERE jar_id=? ORDER BY created_at DESC LIMIT ?")
      .all(jarId, limit) as ActivityRow[]
  ).map(serializeActivity);
}

export function activityForUser(userId: string, limit = 50): ActivityDTO[] {
  return (
    db
      .query(
        `SELECT a.* FROM activity a JOIN memberships m ON m.jar_id=a.jar_id
     WHERE m.user_id=? ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(userId, limit) as ActivityRow[]
  ).map(serializeActivity);
}
