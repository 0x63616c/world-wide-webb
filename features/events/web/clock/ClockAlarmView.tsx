/**
 * ClockAlarmView , "Alarm" variant of the Clock detail page (Apple Clock
 * "Alarms" mental model, on-theme).
 *
 * PURE view: alarms/firing/nowMs and every mutation arrive via props so
 * Storybook and RTL exercise it with fixtures and spies , no store import here
 * (AlarmVariant is the zero-prop wrapper that wires the alarm store in).
 *
 * Layout (plan §8): each alarm is a rounded row , big thin tabular-numeral
 * time, `nextFireDescription` subtitle, `Switch` on the right; tapping the row
 * body expands an INLINE editor panel (not a modal , full-screen pages over
 * modals, and the editor is small enough to live in place): hour + minute
 * `WheelPicker` columns + `Segmented` AM/PM (the panel's one time-entry
 * mechanism , TextInput is banned for time entry on the kiosk), 7 day `Chip`s
 * in 44 px wrappers, an optional label `TextInput` in a `Field` (the one
 * sanctioned free-text TextInput), Delete gated by `ConfirmDialog`, and
 * Save/Cancel. A firing alarm renders a full-width accent Stop bar at top.
 *
 * Hit-area law: every tappable (rows, day chips via wrapper, wheel rows,
 * toolbar "+", Stop) gets a ≥44 px effective target.
 */

import { useState } from "react";
import {
  Button,
  Chip,
  ConfirmDialog,
  Field,
  Segmented,
  Switch,
  TextInput,
  WheelPicker,
} from "@/components/ui";
import type { AlarmInput } from "@/lib/time-suite/alarm-store";
import { formatAlarmTime, nextFireDescription } from "@/lib/time-suite/pure";
import type { AlarmRecord, AlarmStoreState } from "@/lib/time-suite/types";

// ─── props ────────────────────────────────────────────────────────────────────

export interface ClockAlarmViewProps {
  alarms: AlarmRecord[];
  firing: AlarmStoreState["firing"];
  /** Current instant , drives the `nextFireDescription` subtitles. Passed in
   *  (not Date.now()) so stories/tests pin a fixed moment. */
  nowMs: number;
  onAdd: (input: AlarmInput) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<AlarmRecord, "label" | "hour" | "minute" | "repeatDays" | "enabled">>,
  ) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDismissFiring: () => void;
}

// ─── editor draft (12-hour wall-time form of an AlarmRecord) ──────────────────

type Meridiem = "AM" | "PM";

interface Draft {
  hour12: number; // 1-12
  minute: number; // 0-59
  meridiem: Meridiem;
  days: number[]; // ISO 1-7 Mon..Sun; [] = one-shot
  label: string; // free text; "" persists as null
}

/** `id: null` = composing a NEW alarm; otherwise editing that alarm in place. */
interface Editing {
  id: string | null;
  draft: Draft;
}

function to24Hour(hour12: number, meridiem: Meridiem): number {
  return (hour12 % 12) + (meridiem === "PM" ? 12 : 0);
}

function draftFromAlarm(alarm: AlarmRecord): Draft {
  return {
    hour12: alarm.hour % 12 === 0 ? 12 : alarm.hour % 12,
    minute: alarm.minute,
    meridiem: alarm.hour < 12 ? "AM" : "PM",
    days: alarm.repeatDays,
    label: alarm.label ?? "",
  };
}

/** Fresh-draft default: 7:00 AM one-shot , a sane wall-clock starting point. */
function newDraft(): Draft {
  return { hour12: 7, minute: 0, meridiem: "AM", days: [], label: "" };
}

// ─── wheel + chip fixtures (static option lists, not data) ────────────────────

const HOUR_VALUES = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}));
const MINUTE_VALUES = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0"),
}));
const MERIDIEM_OPTIONS = [
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
] as const;
const DAY_CHIPS: { day: number; label: string }[] = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 7, label: "Sun" },
];

// ─── firing bar ───────────────────────────────────────────────────────────────

function FiringBar({
  alarm,
  onDismissFiring,
}: {
  alarm: AlarmRecord | null;
  onDismissFiring: () => void;
}) {
  const time = alarm !== null ? formatAlarmTime(alarm.hour, alarm.minute) : null;
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 20px",
        borderRadius: 14,
        background: "var(--acc)",
        color: "var(--bg)",
      }}
    >
      <span
        style={{
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        Alarm — {time ?? "ringing"}
        {alarm?.label ? ` · ${alarm.label}` : ""}
      </span>
      <button
        type="button"
        onClick={onDismissFiring}
        style={{
          flexShrink: 0,
          minHeight: 44,
          padding: "0 24px",
          borderRadius: 10,
          border: "none",
          background: "var(--bg)",
          color: "var(--acc)",
          font: "inherit",
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Stop
      </button>
    </div>
  );
}

// ─── inline editor ────────────────────────────────────────────────────────────

function AlarmEditor({
  editing,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  editing: Editing;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Present only when editing an existing alarm. */
  onDelete?: () => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { draft } = editing;
  const fieldId = `alarm-label-${editing.id ?? "new"}`;

  const toggleDay = (day: number) => {
    const days = draft.days.includes(day)
      ? draft.days.filter((d) => d !== day)
      : [...draft.days, day];
    onChange({ ...draft, days });
  };

  const buttonStyle = { width: "auto", minHeight: 44, padding: "0 22px" } as const;

  return (
    <div
      style={{
        borderTop: "1px solid var(--hair)",
        padding: "16px 16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Time entry , the pinned wheel mechanism, never a TextInput. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <WheelPicker
          values={HOUR_VALUES}
          value={draft.hour12}
          onChange={(hour12) => onChange({ ...draft, hour12 })}
          label="Hour"
        />
        <span
          aria-hidden
          style={{ fontSize: 26, fontWeight: 300, color: "var(--ink-2)", lineHeight: 1 }}
        >
          :
        </span>
        <WheelPicker
          values={MINUTE_VALUES}
          value={draft.minute}
          onChange={(minute) => onChange({ ...draft, minute })}
          label="Minute"
        />
        {/* Hit-area law: Segmented's default segments are ~30px tall; a fixed
            50px flex wrapper stretches the control so each segment clears 44px
            (50 minus the bar's 2px padding + 1px border per side). */}
        <div style={{ width: 118, height: 50, marginLeft: 8, display: "flex" }}>
          <Segmented
            options={MERIDIEM_OPTIONS}
            value={draft.meridiem}
            onChange={(meridiem) => onChange({ ...draft, meridiem })}
            label="AM or PM"
          />
        </div>
      </div>

      {/* Repeat days , each Chip stretched inside a 44 px wrapper (the raw chip
          is under the panel's minimum hit target). */}
      <div style={{ display: "flex", gap: 8 }}>
        {DAY_CHIPS.map(({ day, label }) => (
          <div key={day} style={{ flex: 1, minWidth: 0, display: "flex", minHeight: 44 }}>
            <Chip active={draft.days.includes(day)} onClick={() => toggleDay(day)}>
              {label}
            </Chip>
          </div>
        ))}
      </div>

      {/* The one sanctioned TextInput , free-text label, never time entry. */}
      <Field id={fieldId} label="Label" optional>
        <TextInput
          id={fieldId}
          value={draft.label}
          onChange={(label) => onChange({ ...draft, label })}
          label="Label"
          placeholder="Alarm"
        />
      </Field>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {onDelete !== undefined && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmingDelete(true)}
            style={{ ...buttonStyle, color: "var(--red)" }}
          >
            Delete
          </Button>
        )}
        <div style={{ flex: 1 }} />
        <Button type="button" variant="ghost" onClick={onCancel} style={buttonStyle}>
          Cancel
        </Button>
        <Button type="button" onClick={onSave} style={buttonStyle}>
          Save
        </Button>
      </div>

      {onDelete !== undefined && (
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete alarm?"
          message="This alarm will be removed from the panel."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

// ─── alarm row ────────────────────────────────────────────────────────────────

function AlarmRow({
  alarm,
  nowMs,
  expanded,
  onOpenEditor,
  onToggle,
}: {
  alarm: AlarmRecord;
  nowMs: number;
  expanded: boolean;
  onOpenEditor: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 16px" }}>
      <button
        type="button"
        onClick={onOpenEditor}
        aria-expanded={expanded}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          padding: "6px 0",
          minHeight: 44,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
      >
        {alarm.label !== null && (
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: alarm.enabled ? "var(--ink-2)" : "var(--ink-3)",
            }}
          >
            {alarm.label}
          </span>
        )}
        <span
          style={{
            fontSize: 44,
            fontWeight: 200,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            fontVariantNumeric: "tabular-nums",
            color: alarm.enabled ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          {formatAlarmTime(alarm.hour, alarm.minute)}
        </span>
        <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
          {nextFireDescription(alarm, nowMs)}
        </span>
      </button>
      {/* Hit-area law: the raw Switch is 44x26 , this wrapper stretches its
          effective target past 44px tall (the padded-wrapper mechanism, same
          as the day chips). Taps on the padding forward to the toggle; taps on
          the switch itself already fire onChange, so the closest() guard keeps
          it to one toggle per tap. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the inner Switch carries the real switch role, accessible name, and keyboard path; this div only fattens its touch target. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users toggle the focusable Switch inside; the wrapper's click is a touch-target enlargement only. */}
      <div
        onClick={(e) => {
          if (e.target instanceof HTMLElement && e.target.closest("[role='switch']") !== null) {
            return;
          }
          onToggle(!alarm.enabled);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          alignSelf: "stretch",
          minHeight: 44,
          padding: "0 12px",
          margin: "0 -12px",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <Switch
          checked={alarm.enabled}
          onChange={onToggle}
          label={`Alarm ${formatAlarmTime(alarm.hour, alarm.minute)}`}
        />
      </div>
    </div>
  );
}

// ─── view ─────────────────────────────────────────────────────────────────────

export function ClockAlarmView({
  alarms,
  firing,
  nowMs,
  onAdd,
  onUpdate,
  onDelete,
  onToggle,
  onDismissFiring,
}: ClockAlarmViewProps) {
  const [editing, setEditing] = useState<Editing | null>(null);

  const firingAlarm =
    firing !== null ? (alarms.find((a) => a.id === firing.alarmId) ?? null) : null;

  const save = () => {
    if (editing === null) return;
    const { id, draft } = editing;
    const hour = to24Hour(draft.hour12, draft.meridiem);
    const label = draft.label.trim();
    if (id === null) {
      onAdd({
        hour,
        minute: draft.minute,
        repeatDays: draft.days,
        ...(label !== "" ? { label } : {}),
      });
    } else {
      onUpdate(id, {
        hour,
        minute: draft.minute,
        repeatDays: draft.days,
        label: label !== "" ? label : null,
      });
    }
    setEditing(null);
  };

  const editorFor = (id: string | null) =>
    editing !== null && editing.id === id ? (
      <AlarmEditor
        editing={editing}
        onChange={(draft) => setEditing({ id: editing.id, draft })}
        onSave={save}
        onCancel={() => setEditing(null)}
        onDelete={
          id !== null
            ? () => {
                setEditing(null);
                onDelete(id);
              }
            : undefined
        }
      />
    ) : null;

  return (
    <div
      style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}
    >
      {firing !== null && <FiringBar alarm={firingAlarm} onDismissFiring={onDismissFiring} />}

      {/* Slim toolbar , the one entry point for composing a new alarm. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditing({ id: null, draft: newDraft() })}
          style={{ width: "auto", minHeight: 44, padding: "0 22px" }}
        >
          + New Alarm
        </Button>
      </div>

      {/* New-alarm composer expands directly under the toolbar. */}
      {editing !== null && editing.id === null && (
        <div
          style={{
            borderRadius: 14,
            background: "var(--nest)",
            border: "1px solid var(--hair)",
          }}
        >
          {editorFor(null)}
        </div>
      )}

      {alarms.length === 0 && editing === null && (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            fontSize: 15,
            color: "var(--ink-3)",
          }}
        >
          No alarms
        </div>
      )}

      {alarms.map((alarm) => (
        <div
          key={alarm.id}
          style={{
            borderRadius: 14,
            background: "var(--nest)",
            border: `1px solid ${firing?.alarmId === alarm.id ? "var(--acc-line)" : "var(--hair)"}`,
          }}
        >
          <AlarmRow
            alarm={alarm}
            nowMs={nowMs}
            expanded={editing?.id === alarm.id}
            onOpenEditor={() =>
              setEditing(
                editing?.id === alarm.id ? null : { id: alarm.id, draft: draftFromAlarm(alarm) },
              )
            }
            onToggle={(enabled) => onToggle(alarm.id, enabled)}
          />
          {editorFor(alarm.id)}
        </div>
      ))}
    </div>
  );
}
