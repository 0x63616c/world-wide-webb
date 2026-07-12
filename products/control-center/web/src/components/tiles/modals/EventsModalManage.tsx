/**
 * EventsModalManage , the CRUD ("Manage") variant for the Events tile.
 *
 * WHY this exists: the other four variants are read-only presentations of the
 * agenda. This one is the write surface , add a new event, edit an existing
 * one inline, or delete it. It is the only Events modal that mutates.
 *
 * PURE view: all data + effects arrive via props. The parent (live wiring)
 * owns the tRPC mutations and passes plain callbacks + a `busy` flag; this
 * component owns only ephemeral form state (the add-form fields and which row
 * is being edited). That keeps it fully exercisable in Storybook/tests with
 * no network, matching the sibling modals' pure-view contract.
 *
 * Location is optional: it maps to the event's `place` column. Blank is fine.
 */

import { useState } from "react";
import { Modal } from "@/components/ui";

// ─── types ────────────────────────────────────────────────────────────────────

export interface ManageEventRow {
  id: number;
  name: string;
  place: string;
  days: number;
  /** ISO-8601 date string from the API. */
  date: string;
}

/** Writable payload shared by create + update. */
export interface EventDraft {
  name: string;
  place: string;
  /** ISO-8601 string (UTC/offset form) ready for the API. */
  date: string;
}

export interface EventsModalManageProps {
  open: boolean;
  onClose: () => void;
  events: ManageEventRow[];
  onCreate: (draft: EventDraft) => void;
  onUpdate: (id: number, draft: EventDraft) => void;
  onDelete: (id: number) => void;
  /** True while any mutation is in flight; disables the action buttons. */
  busy?: boolean;
}

// ─── date helpers ───────────────────────────────────────────────────────────

/** ISO string → value for <input type="datetime-local"> (local wall time). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Shift by the local tz offset so toISOString's slice reads as local time.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** datetime-local value → ISO string (offset form) for the API. Empty → null. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local); // interpreted in the browser's local tz
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Compact human date for a read row, e.g. "Sat Jul 11, 2026 · 8:00 PM". */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// ─── shared field styles ────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 11px",
  fontSize: 13.5,
  fontFamily: "var(--ui)",
  color: "var(--ink)",
  background: "var(--nest)",
  border: "1px solid var(--hair)",
  borderRadius: 10,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10.5,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  marginBottom: 4,
  display: "block",
};

function actionButtonStyle(kind: "primary" | "ghost" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "8px 14px",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: "var(--ui)",
    borderRadius: 10,
    cursor: "pointer",
    border: "1px solid var(--hair)",
    background: "var(--nest)",
    color: "var(--ink)",
  };
  if (kind === "primary") {
    return {
      ...base,
      background: "var(--acc-dim)",
      borderColor: "var(--acc-line)",
      color: "var(--acc)",
    };
  }
  if (kind === "danger") {
    return { ...base, color: "#ff6b6b", borderColor: "rgba(255,107,107,0.35)" };
  }
  return base;
}

// ─── editable field group (used by both the add form and the inline editor) ──

interface DraftFieldsProps {
  name: string;
  place: string;
  local: string;
  onName: (v: string) => void;
  onPlace: (v: string) => void;
  onLocal: (v: string) => void;
}

function DraftFields({ name, place, local, onName, onPlace, onLocal }: DraftFieldsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label style={labelStyle} htmlFor="ev-name">
          Name
        </label>
        <input
          id="ev-name"
          style={inputStyle}
          value={name}
          placeholder="Event name"
          onChange={(e) => onName(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="ev-place">
            Location <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span>
          </label>
          <input
            id="ev-place"
            style={inputStyle}
            value={place}
            placeholder="Venue / city"
            onChange={(e) => onPlace(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="ev-date">
            Date &amp; time
          </label>
          <input
            id="ev-date"
            type="datetime-local"
            style={inputStyle}
            value={local}
            onChange={(e) => onLocal(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function EventsModalManage({
  open,
  onClose,
  events,
  onCreate,
  onUpdate,
  onDelete,
  busy = false,
}: EventsModalManageProps) {
  // Add-form state.
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [local, setLocal] = useState("");

  // Inline-edit state: which row + its working values.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPlace, setEditPlace] = useState("");
  const [editLocal, setEditLocal] = useState("");

  const addValid = name.trim().length > 0 && localInputToIso(local) !== null;

  function submitAdd() {
    const iso = localInputToIso(local);
    if (!name.trim() || !iso) return;
    onCreate({ name: name.trim(), place: place.trim(), date: iso });
    setName("");
    setPlace("");
    setLocal("");
  }

  function beginEdit(ev: ManageEventRow) {
    setEditingId(ev.id);
    setEditName(ev.name);
    setEditPlace(ev.place);
    setEditLocal(isoToLocalInput(ev.date));
  }

  function submitEdit() {
    if (editingId === null) return;
    const iso = localInputToIso(editLocal);
    if (!editName.trim() || !iso) return;
    onUpdate(editingId, { name: editName.trim(), place: editPlace.trim(), date: iso });
    setEditingId(null);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage events"
      width={620}
      maxHeight={840}
      scrollbar="visible"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── Add form ───────────────────────────────────────────────── */}
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 16,
            borderRadius: 14,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
          }}
        >
          <span className="cap" style={{ letterSpacing: "0.12em", color: "var(--ink-2)" }}>
            Add event
          </span>
          <DraftFields
            name={name}
            place={place}
            local={local}
            onName={setName}
            onPlace={setPlace}
            onLocal={setLocal}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={!addValid || busy}
              onClick={submitAdd}
              style={{ ...actionButtonStyle("primary"), opacity: !addValid || busy ? 0.5 : 1 }}
            >
              Add event
            </button>
          </div>
        </section>

        {/* ── Existing events list ───────────────────────────────────── */}
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="cap" style={{ letterSpacing: "0.12em", color: "var(--ink-2)" }}>
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>

          {events.length === 0 ? (
            <div
              style={{
                padding: "24px 0",
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 13,
              }}
            >
              No events yet , add one above.
            </div>
          ) : (
            events.map((ev) =>
              editingId === ev.id ? (
                // Inline editor for this row.
                <div
                  key={ev.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: 14,
                    borderRadius: 14,
                    background: "var(--acc-dim)",
                    border: "1px solid var(--acc-line)",
                  }}
                >
                  <DraftFields
                    name={editName}
                    place={editPlace}
                    local={editLocal}
                    onName={setEditName}
                    onPlace={setEditPlace}
                    onLocal={setEditLocal}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      style={actionButtonStyle("ghost")}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={busy || !editName.trim() || localInputToIso(editLocal) === null}
                      onClick={submitEdit}
                      style={actionButtonStyle("primary")}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                // Read row with edit/delete affordances.
                <div
                  key={ev.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 14,
                    background: "var(--nest)",
                    border: "1px solid var(--hair)",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ev.name}
                    </span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                      {formatDate(ev.date)}
                      {ev.place ? ` · ${ev.place}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => beginEdit(ev)}
                    style={actionButtonStyle("ghost")}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete ${ev.name}`}
                    onClick={() => onDelete(ev.id)}
                    style={actionButtonStyle("danger")}
                  >
                    Delete
                  </button>
                </div>
              ),
            )
          )}
        </section>
      </div>
    </Modal>
  );
}
