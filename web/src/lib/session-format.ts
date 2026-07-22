/**
 * session-format , turn a raw interaction log entry (`msg` + `data`) into a
 * human sentence for the session transcript.
 *
 * The interaction channel stores a fixed `surface/action` vocabulary plus a
 * dotted `target` id (`tile_climate`, `control.lamp.desk`, `modal.Settings`) and
 * a handful of known detail fields (label, from, to, value, scene, brightness,
 * reason). Those are perfect for grouping/aggregation but read like machine
 * output. This module maps them to a readable line without inventing anything:
 * every mapping falls back to a prettified target, and any detail key it did NOT
 * consume is appended as a compact `k: v` tail so no information is lost.
 *
 * Dependency-free and pure so it is trivially unit-testable and safe to call from
 * a render path.
 */

/** A formatted event: the prominent readable line + an optional muted tail. */
export interface FormattedEvent {
  /** The human sentence, always present. */
  line: string;
  /** Leftover detail as `k: v · k: v`, or null when there is nothing extra. */
  detail: string | null;
}

/** Keys that are structural plumbing, never shown in the detail tail. */
const STRUCTURAL_KEYS = new Set(["target", "interactionSessionId", "idx"]);

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function targetOf(data: Record<string, unknown>): string {
  return typeof data.target === "string" ? data.target : "";
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * Prettify a dotted/underscored id into a sentence fragment: separators become
 * spaces, camelCase is split, and the whole thing is sentence-cased. Used for
 * tiles and settings where the id is a machine token (`idleDimLevel`), NOT for
 * modal names, which are already human ("Settings", "Climate").
 */
function prettify(raw: string): string {
  const spaced = raw
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * A control subject reads most naturally reversed: `control.lamp.desk` is the
 * "desk lamp", not the "lamp desk". Reverse the segments after the `control.`
 * root and sentence-case the result.
 */
function controlSubject(target: string): string {
  const segments = stripPrefix(target, "control.").split(".").filter(Boolean);
  if (segments.length === 0) return "control";
  const phrase = segments.reverse().join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

function formatValue(v: unknown): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "on" : "off";
  return JSON.stringify(v);
}

/** Past-tense verb for an action; falls back to a capitalised action word. */
const ACTION_VERB: Record<string, string> = {
  tap: "Tapped",
  open: "Opened",
  close: "Closed",
  change: "Changed",
  commit: "Committed",
  pan: "Panned",
  jump: "Jumped",
  recenter: "Recentered",
  wake: "Woke",
  idle: "Idle",
};

function verbFor(action: string): string {
  return ACTION_VERB[action] ?? (action ? action.charAt(0).toUpperCase() + action.slice(1) : "Did");
}

/**
 * Build the muted detail tail from any data keys the primary line did not use.
 * Structural plumbing and already-consumed keys are dropped; everything else is
 * rendered `k: v` so an unexpected field is surfaced rather than silently lost.
 */
function detailTail(data: Record<string, unknown>, consumed: Set<string>): string | null {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (STRUCTURAL_KEYS.has(k) || consumed.has(k)) continue;
    if (v === undefined || v === null) continue;
    parts.push(`${k}: ${formatValue(v)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Format one interaction event. `msg` is `surface/action`; `data` carries the
 * target and any detail fields. Returns the readable line + a leftover tail.
 */
export function formatEventLine(msg: string, data: unknown): FormattedEvent {
  const rec = asRecord(data);
  const target = targetOf(rec);
  const [surface, action = ""] = msg.split("/");
  const consumed = new Set<string>();

  const line = ((): string => {
    switch (surface) {
      case "tile": {
        if (action === "tap") {
          const label = typeof rec.label === "string" ? rec.label : "";
          consumed.add("label");
          const name = label || prettify(stripPrefix(target, "tile_"));
          return name ? `Tapped ${name} tile` : "Tapped a tile";
        }
        break;
      }
      case "modal": {
        // Modal names are already human ("Settings", "Climate"); just strip the
        // `modal.` (or `modal.pin.`) prefix and keep the original casing.
        const name = stripPrefix(stripPrefix(target, "modal.pin."), "modal.") || target;
        if (action === "open") return name ? `Opened ${name}` : "Opened a panel";
        if (action === "close") return name ? `Closed ${name}` : "Closed a panel";
        break;
      }
      case "control": {
        if (action === "change" || action === "commit") {
          const subject = controlSubject(target);
          if (typeof rec.scene === "string") {
            consumed.add("scene");
            return `Scene → ${rec.scene}`;
          }
          if (rec.brightness !== undefined && rec.brightness !== null) {
            consumed.add("brightness");
            return `Set ${subject} → ${formatValue(rec.brightness)}%`;
          }
          if (rec.value !== undefined && rec.value !== null) {
            consumed.add("value");
            return `Set ${subject} → ${formatValue(rec.value)}`;
          }
          return `Adjusted ${subject}`;
        }
        break;
      }
      case "settings": {
        if (action === "change") {
          const setting = prettify(stripPrefix(target, "settings."));
          if (rec.from !== undefined && rec.to !== undefined) {
            consumed.add("from");
            consumed.add("to");
            return `Set ${setting} ${formatValue(rec.from)} → ${formatValue(rec.to)}`;
          }
          return `Changed ${setting}`;
        }
        if (action === "commit") {
          const setting = prettify(stripPrefix(target, "settings."));
          return setting ? `Committed ${setting}` : "Committed settings";
        }
        break;
      }
      case "nav": {
        if (action === "jump") return "Jumped on the map";
        if (action === "pan") return "Panned the map";
        if (action === "recenter") return "Recentered the map";
        break;
      }
      case "session": {
        if (action === "wake") return "Woke the panel";
        if (action === "idle") return "Panel went idle";
        if (action === "start") return "Session started";
        if (action === "end") {
          const reason = typeof rec.reason === "string" ? rec.reason : "";
          consumed.add("reason");
          consumed.add("events");
          consumed.add("durationMs");
          return reason ? `Session ended (${reason})` : "Session ended";
        }
        break;
      }
    }
    // Unknown surface/action: title-cased action + prettified target, so a new
    // vocabulary entry still reads sensibly instead of showing raw `msg`.
    const subject = prettify(target);
    return subject ? `${verbFor(action)} ${subject}` : verbFor(action);
  })();

  return { line, detail: detailTail(rec, consumed) };
}
