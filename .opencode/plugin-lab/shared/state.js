import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR =
  globalThis.Bun?.env?.OPENCODE_PLUGIN_LAB_STATE_DIR ??
  path.join(os.homedir(), ".local", "state", "opencode-plugin-lab");
const STATE_FILE = path.join(STATE_DIR, "state.json");

function emptyState() {
  return { sessions: {} };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyState();
  }

  const sessions =
    value.sessions && typeof value.sessions === "object" && !Array.isArray(value.sessions)
      ? value.sessions
      : {};
  return { sessions };
}

function sessionKey(sessionID) {
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : "session_unknown";
}

function nowISO() {
  return new Date().toISOString();
}

export function statePaths() {
  return { dir: STATE_DIR, file: STATE_FILE };
}

export async function readPluginLabState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error instanceof SyntaxError)) {
      return emptyState();
    }
    throw error;
  }
}

export async function readPluginLabStateResult() {
  try {
    return { state: await readPluginLabState(), error: null };
  } catch (error) {
    return { state: emptyState(), error };
  }
}

export async function writePluginLabState(state) {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  try {
    await fs.chmod(STATE_DIR, 0o700);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const normalized = normalizeState(state);
  const tmp = path.join(
    STATE_DIR,
    `.state.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  await fs.writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, STATE_FILE);
  try {
    await fs.chmod(STATE_FILE, 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return normalized;
}

export async function setSessionGoal(sessionID, text) {
  const key = sessionKey(sessionID);
  const state = await readPluginLabState();
  state.sessions[key] = {
    ...(state.sessions[key] ?? {}),
    goal: {
      text: String(text),
      active: true,
      updatedAt: nowISO(),
      clearedAt: null,
    },
  };
  await writePluginLabState(state);
  return state.sessions[key].goal;
}

export async function getSessionGoal(sessionID) {
  const state = await readPluginLabState();
  return state.sessions[sessionKey(sessionID)]?.goal ?? null;
}

export async function getSessionGoalStatus(sessionID) {
  const goal = await getSessionGoal(sessionID);
  if (!goal) {
    return { state: "none", goal: null };
  }
  return { state: goal.active ? "active" : "cleared", goal };
}

export async function getSessionGoalStatusResult(sessionID) {
  try {
    return { ...(await getSessionGoalStatus(sessionID)), error: null };
  } catch (error) {
    return { state: "error", goal: null, error };
  }
}

export async function clearSessionGoal(sessionID) {
  const key = sessionKey(sessionID);
  const state = await readPluginLabState();
  const existing = state.sessions[key]?.goal;
  const goal = {
    text: existing?.text ?? "",
    active: false,
    updatedAt: existing?.updatedAt ?? nowISO(),
    clearedAt: nowISO(),
  };
  state.sessions[key] = { ...(state.sessions[key] ?? {}), goal };
  await writePluginLabState(state);
  return goal;
}
