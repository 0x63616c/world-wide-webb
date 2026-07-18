/**
 * ExpandedSchedulesModalView , pure presentational schedules manager.
 *
 * Lists the schedules with an enable toggle each, and an editor form for
 * create/edit. All persistence flows out through the on* callbacks; the only
 * internal state is the editor draft (a form). Mirrors ExpandedControlsModalView's
 * presentational split. Colours are the curated LampScene palette (v1).
 */

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Chip,
  formatHHMM,
  Modal,
  parseHHMM,
  Segmented,
  Slider,
  Switch,
  TextInput,
  TimeWheel,
} from "@/components/ui";
import { Icon } from "../../Icon";
import {
  type DisplayScene,
  daysSummary,
  displayScene,
  SceneChip,
  SECTION_LABEL,
  triggerTimeLabel,
} from "../schedule-scene";

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
  /** The single soonest upcoming fire, spotlighted in the "Up next" card. */
  nextUp?: { name: string; time: string; scene: DisplayScene } | null;
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

// ─── settings-style list sections ────────────────────────────────────────────

/** A grouped inset card with a mono uppercase section label above it. */
function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div style={SECTION_LABEL}>{title}</div>
      <div
        style={{
          background: "var(--nest)",
          border: "1px solid var(--hair)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </section>
  );
}

/** A hairline-separated row inside a SectionCard. */
function RowWrap({ first, children }: { first?: boolean; children: ReactNode }) {
  return (
    <div style={{ padding: "12px 16px", borderTop: first ? "none" : "1px solid var(--hair)" }}>
      {children}
    </div>
  );
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
            <div style={{ display: "flex", justifyContent: "center" }}>
              <TimeWheel
                value={parseHHMM(draft.trigger.time)}
                // minuteStep 1 preserves the arbitrary-minute precision the old
                // free-text HH:MM field allowed.
                minuteStep={1}
                onChange={(t) => set({ trigger: { type: "fixed", time: formatHHMM(t) } })}
              />
            </div>
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
  nextUp,
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
      width={620}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {nextUp && (
            <SectionCard title="Up next">
              <RowWrap first>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <SceneChip scene={nextUp.scene} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 500 }}>
                      {nextUp.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Fires next</div>
                  </div>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 20, color: "var(--ink)" }}>
                    {nextUp.time}
                  </span>
                </div>
              </RowWrap>
            </SectionCard>
          )}

          <SectionCard title="Active schedules">
            {schedules.length === 0 ? (
              <RowWrap first>
                <div style={{ fontSize: 14, color: "var(--ink-3)" }}>No schedules yet.</div>
              </RowWrap>
            ) : (
              schedules.map((s, i) => (
                <RowWrap key={s.id} first={i === 0}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <SceneChip scene={displayScene(s.action)} />
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        font: "inherit",
                        padding: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          color: s.enabled ? "var(--ink)" : "var(--ink-3)",
                          fontWeight: 500,
                        }}
                      >
                        {s.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                        <span style={{ fontFamily: "var(--mono)" }}>
                          {triggerTimeLabel(s.trigger, nextLabelById[s.id] ?? null)}
                        </span>{" "}
                        · {daysSummary(s.days)}
                      </div>
                    </button>
                    <Switch
                      checked={s.enabled}
                      onChange={(enabled) => onToggle(s.id, enabled)}
                      label={`Enable ${s.name}`}
                    />
                  </div>
                </RowWrap>
              ))
            )}
          </SectionCard>

          <SectionCard title="Add">
            <RowWrap first>
              <button
                type="button"
                onClick={openNew}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    border: "1px dashed var(--hair)",
                    color: "var(--ink-3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon name="plus" s={18} sw={2} />
                </span>
                <span style={{ fontSize: 15, color: "var(--ink-2)" }}>New schedule</span>
              </button>
            </RowWrap>
          </SectionCard>
        </div>
      )}
    </Modal>
  );
}
