/**
 * ExpandedSchedulesModalView , pure presentational schedules manager.
 *
 * Lists the schedules with an enable toggle each, and an editor form for
 * create/edit. All persistence flows out through the on* callbacks; the only
 * internal state is the editor draft (a form). Mirrors ExpandedControlsModalView's
 * presentational split. Colours are the curated LampScene palette (v1).
 */

import { useState } from "react";
import { Chip, Modal, Segmented, Slider, Switch, TextInput } from "@/components/ui";

// ─── shared shapes (match the schedules tRPC router I/O) ──────────────────────

export type ScheduleTrigger =
  | { type: "fixed"; time: string }
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMin: number };

export type SceneName = "white" | "mood" | "red" | "blue";

export interface ScheduleAction {
  on: boolean;
  scene?: SceneName;
  brightness?: number;
  fadeMinutes?: number;
}

export interface ScheduleInput {
  name: string;
  enabled: boolean;
  days: number[];
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  targetIds: string[];
}

export interface ScheduleItem extends ScheduleInput {
  id: string;
}

export interface LightOption {
  id: string;
  label: string;
  room: string;
  kind: string;
}

export interface ExpandedSchedulesModalViewProps {
  open: boolean;
  onClose: () => void;
  schedules: ScheduleItem[];
  /** id → next fire label (e.g. "21:30"), or null when no upcoming. */
  nextLabelById: Record<string, string | null>;
  lights: LightOption[];
  onCreate: (input: ScheduleInput) => void;
  onUpdate: (id: string, input: ScheduleInput) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const emptyDraft = (): ScheduleInput => ({
  name: "",
  enabled: true,
  days: [...EVERY_DAY],
  trigger: { type: "fixed", time: "07:00" },
  action: { on: true, scene: "white", brightness: 100, fadeMinutes: 0 },
  targetIds: [],
});

// ─── list row ──────────────────────────────────────────────────────────────────

function triggerSummary(t: ScheduleTrigger, next: string | null): string {
  if (t.type === "fixed") return next ?? t.time;
  const off = t.offsetMin === 0 ? "" : ` ${t.offsetMin > 0 ? "+" : ""}${t.offsetMin}m`;
  return `${t.event}${off}`;
}

// ─── editor ────────────────────────────────────────────────────────────────────

interface EditorProps {
  draft: ScheduleInput;
  lights: LightOption[];
  editingId: string | null;
  onChange: (next: ScheduleInput) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function ScheduleEditor({
  draft,
  lights,
  editingId,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: EditorProps) {
  const set = (patch: Partial<ScheduleInput>) => onChange({ ...draft, ...patch });
  const setAction = (patch: Partial<ScheduleAction>) =>
    onChange({ ...draft, action: { ...draft.action, ...patch } });

  const triggerType: "fixed" | "sunrise" | "sunset" =
    draft.trigger.type === "fixed" ? "fixed" : draft.trigger.event;

  const nonBedroomIds = lights.filter((l) => l.room !== "Bedroom").map((l) => l.id);

  const toggleDay = (d: number) =>
    set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] });
  const toggleTarget = (id: string) =>
    set({
      targetIds: draft.targetIds.includes(id)
        ? draft.targetIds.filter((x) => x !== id)
        : [...draft.targetIds, id],
    });

  const rooms = [...new Set(lights.map((l) => l.room))];
  const canSave =
    draft.name.trim().length > 0 && draft.days.length > 0 && draft.targetIds.length > 0;

  const label = (text: string) => (
    <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>{text}</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        {label("Name")}
        <TextInput
          value={draft.name}
          onChange={(name) => set({ name })}
          label="Schedule name"
          placeholder="e.g. Red night"
        />
      </div>

      <div>
        {label("Days")}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAY_LABELS.map((lbl, d) => (
            <Chip key={lbl} active={draft.days.includes(d)} onClick={() => toggleDay(d)}>
              {lbl}
            </Chip>
          ))}
          <Chip active={draft.days.length === 7} onClick={() => set({ days: [...EVERY_DAY] })}>
            Every day
          </Chip>
        </div>
      </div>

      <div>
        {label("When")}
        <Segmented
          label="Trigger type"
          value={triggerType}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "sunrise", label: "Sunrise" },
            { value: "sunset", label: "Sunset" },
          ]}
          onChange={(v) =>
            v === "fixed"
              ? set({
                  trigger: {
                    type: "fixed",
                    time: draft.trigger.type === "fixed" ? draft.trigger.time : "07:00",
                  },
                })
              : set({
                  trigger: {
                    type: "sun",
                    event: v,
                    offsetMin: draft.trigger.type === "sun" ? draft.trigger.offsetMin : 0,
                  },
                })
          }
        />
        <div style={{ marginTop: 10 }}>
          {draft.trigger.type === "fixed" ? (
            <TextInput
              value={draft.trigger.time}
              onChange={(time) => set({ trigger: { type: "fixed", time } })}
              label="Time (HH:MM)"
              placeholder="21:30"
            />
          ) : (
            <Slider
              value={draft.trigger.offsetMin}
              min={-120}
              max={120}
              step={5}
              label="Offset minutes"
              format={(n) => (n === 0 ? "at event" : `${n > 0 ? "+" : ""}${n} min`)}
              onChange={(offsetMin) =>
                set({
                  trigger: {
                    type: "sun",
                    event: draft.trigger.type === "sun" ? draft.trigger.event : "sunrise",
                    offsetMin,
                  },
                })
              }
            />
          )}
        </div>
      </div>

      <div>
        {label("Lights")}
        <div style={{ marginBottom: 8 }}>
          <Chip
            active={
              draft.targetIds.length === nonBedroomIds.length &&
              nonBedroomIds.every((id) => draft.targetIds.includes(id))
            }
            onClick={() => set({ targetIds: nonBedroomIds })}
          >
            Non-bedroom
          </Chip>
        </div>
        {rooms.map((room) => (
          <div key={room} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 4 }}>{room}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lights
                .filter((l) => l.room === room)
                .map((l) => (
                  <Chip
                    key={l.id}
                    active={draft.targetIds.includes(l.id)}
                    onClick={() => toggleTarget(l.id)}
                  >
                    {l.label}
                  </Chip>
                ))}
            </div>
          </div>
        ))}
      </div>

      <div>
        {label("Action")}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Switch checked={draft.action.on} onChange={(on) => setAction({ on })} label="Turn on" />
          <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
            {draft.action.on ? "Turn on" : "Turn off"}
          </span>
        </div>

        {draft.action.on && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              {label("Colour")}
              <Segmented
                label="Scene"
                value={draft.action.scene ?? "white"}
                options={[
                  { value: "white", label: "White" },
                  { value: "mood", label: "Mood" },
                  { value: "red", label: "Red" },
                  { value: "blue", label: "Blue" },
                ]}
                onChange={(scene) => setAction({ scene: scene as SceneName })}
              />
            </div>
            <Slider
              value={draft.action.brightness ?? 100}
              min={0}
              max={100}
              step={1}
              label="Brightness"
              format={(n) => `${n}%`}
              onChange={(brightness) => setAction({ brightness })}
            />
            <Slider
              value={draft.action.fadeMinutes ?? 0}
              min={0}
              max={120}
              step={1}
              label="Fade"
              format={(n) => (n === 0 ? "instant" : `${n} min`)}
              onChange={(fadeMinutes) => setAction({ fadeMinutes })}
            />
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
        {editingId && (
          <button type="button" onClick={onDelete} style={btnStyle("danger")}>
            Delete
          </button>
        )}
        <button type="button" onClick={onCancel} style={btnStyle("ghost")}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          style={btnStyle("primary", !canSave)}
        >
          {editingId ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );
}

function btnStyle(kind: "primary" | "ghost" | "danger", disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 36,
    padding: "0 16px",
    borderRadius: 10,
    font: "inherit",
    fontSize: 14,
    cursor: disabled ? "default" : "pointer",
    border: "1px solid var(--hair)",
    opacity: disabled ? 0.5 : 1,
  };
  if (kind === "primary")
    return { ...base, background: "var(--accent, #3b82f6)", color: "#fff", border: "none" };
  if (kind === "danger") return { ...base, background: "none", color: "#ef4444" };
  return { ...base, background: "none", color: "var(--ink-2)" };
}

// ─── modal ───────────────────────────────────────────────────────────────────

export function ExpandedSchedulesModalView({
  open,
  onClose,
  schedules,
  nextLabelById,
  lights,
  onCreate,
  onUpdate,
  onDelete,
  onToggle,
}: ExpandedSchedulesModalViewProps) {
  // Editor draft: null = list view; { id: null } = new; { id } = editing existing.
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState<ScheduleInput>(emptyDraft);

  const inEditor = editingId !== undefined;

  const openNew = () => {
    setDraft(emptyDraft());
    setEditingId(null);
  };
  const openEdit = (s: ScheduleItem) => {
    const { id: _id, ...input } = s;
    setDraft(input);
    setEditingId(s.id);
  };
  const closeEditor = () => setEditingId(undefined);

  const save = () => {
    if (editingId) onUpdate(editingId, draft);
    else onCreate(draft);
    closeEditor();
  };
  const del = () => {
    if (editingId) onDelete(editingId);
    closeEditor();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedules"
      width={560}
      maxHeight={840}
      scrollbar="visible"
    >
      {inEditor ? (
        <ScheduleEditor
          draft={draft}
          lights={lights}
          editingId={editingId ?? null}
          onChange={setDraft}
          onSave={save}
          onCancel={closeEditor}
          onDelete={del}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {schedules.length === 0 && (
            <div style={{ fontSize: 14, color: "var(--ink-3)", padding: "8px 0" }}>
              No schedules yet.
            </div>
          )}
          {schedules.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 12,
                border: "1px solid var(--hair)",
                background: "var(--nest)",
              }}
            >
              <button
                type="button"
                onClick={() => openEdit(s)}
                style={{
                  flex: 1,
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <div style={{ fontSize: 15, color: "var(--ink-1)", fontWeight: 500 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {triggerSummary(s.trigger, nextLabelById[s.id] ?? null)} ·{" "}
                  {s.days.length === 7 ? "every day" : s.days.map((d) => DAY_LABELS[d]).join(" ")} ·{" "}
                  {s.action.on ? (s.action.scene ?? "on") : "off"}
                </div>
              </button>
              <Switch
                checked={s.enabled}
                onChange={(enabled) => onToggle(s.id, enabled)}
                label={`Enable ${s.name}`}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={openNew}
            style={{ ...btnStyle("primary"), marginTop: 6, alignSelf: "flex-start" }}
          >
            New schedule
          </button>
        </div>
      )}
    </Modal>
  );
}
