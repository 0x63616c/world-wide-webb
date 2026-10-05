import { useState } from "react";
import { Button, Field, Skeleton, TextInput } from "@/components/ui";
import { warmAudio } from "@/lib/sound";
import { useTimeZone } from "@/lib/time-zone";
import { type RouterOutputs, trpc } from "@/lib/trpc";
import { type AlarmInput, alarmInputSchema } from "../contract";
import { alarmOnDate } from "../schedule";
import { useAlarms } from "./useAlarms";

type Alarm = RouterOutputs["alarms"]["list"]["alarms"][number];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const controlStyle = {
  background: "var(--nest)",
  color: "var(--ink)",
  border: "1px solid var(--hair)",
  borderRadius: 12,
  padding: 12,
  fontSize: 20,
  width: "100%",
  minHeight: 48,
};

export function AlarmsPage() {
  const query = useAlarms();
  const timeZone = useTimeZone();
  const [editing, setEditing] = useState<Alarm | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const onSuccess = () => {
    setError(null);
    void utils.alarms.list.invalidate();
  };
  const onError = (err: { message: string }) => setError(err.message);
  const enable = trpc.alarms.setEnabled.useMutation({ onSuccess, onError });
  const remove = trpc.alarms.delete.useMutation({ onSuccess, onError });
  const [deleting, setDeleting] = useState<string | null>(null);
  if (editing)
    return (
      <AlarmEditor
        key={editing === "new" ? "new" : editing.id}
        alarm={editing === "new" ? undefined : editing}
        timeZone={timeZone}
        defaults={query.data?.defaults}
        onClose={() => setEditing(null)}
      />
    );

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 24 }}>
      <div
        style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center" }}
      >
        <div>
          <div className="cap acc">Wake up your home</div>
          <h2 style={{ fontSize: 32, margin: "10px 0" }}>A good start, on time.</h2>
          <p style={{ color: "var(--ink-2)", margin: 0 }}>
            The panel rings and your lights come on.
          </p>
        </div>
        <Button
          onClick={() => {
            warmAudio();
            setEditing("new");
          }}
          style={{ width: "auto", minWidth: 112, height: 50 }}
        >
          Add alarm
        </Button>
      </div>
      {(error || query.isError) && (
        <div role="alert" style={{ color: "var(--red)" }}>
          {error ?? "Cannot reach your alarms. Check the connection."}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!query.data && !query.isError && <Skeleton w="100%" h={180} />}
      {query.data?.next && (
        <div
          style={{
            border: "1px solid var(--hair)",
            borderRadius: 20,
            background: "var(--nest)",
            padding: 24,
          }}
        >
          <div className="cap acc">Next alarm</div>
          <div style={{ fontSize: 26, marginTop: 10 }}>{query.data.next.label}</div>
          <div style={{ color: "var(--ink-2)", marginTop: 8 }}>
            {formatDate(query.data.next.at, query.data.next.timeZone)}
          </div>
        </div>
      )}
      {query.data?.alarms.length === 0 && (
        <div style={{ textAlign: "center", padding: "70px 16px", color: "var(--ink-2)" }}>
          <div style={{ fontSize: 26, color: "var(--ink)", marginBottom: 12 }}>No alarms yet</div>
          Set a time for your next morning.
        </div>
      )}
      {query.data?.alarms.map((alarm) => (
        <article
          key={alarm.id}
          style={{
            display: "grid",
            gap: 16,
            borderBottom: "1px solid var(--hair)",
            padding: "12px 0 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 20,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={() => setEditing(alarm)}
              aria-label={`Edit ${alarm.label}`}
              style={{
                textAlign: "left",
                background: "none",
                border: 0,
                color: "var(--ink)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <div className="mono" style={{ fontSize: 48, opacity: alarm.enabled ? 1 : 0.5 }}>
                {alarm.at
                  ? new Intl.DateTimeFormat("en-US", {
                      timeZone: alarm.timeZone,
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(alarm.at))
                  : alarm.time}
              </div>
              <div style={{ fontSize: 19, marginTop: 6 }}>{alarm.label}</div>
              <div style={{ color: "var(--ink-2)", marginTop: 8 }}>
                {alarm.repeatDays.length
                  ? alarm.repeatDays.map((d) => DAYS[d]).join(" · ")
                  : "Once"}{" "}
                · {alarm.timeZone}
              </div>
              {alarm.at && (
                <div style={{ color: "var(--ink-2)", marginTop: 6 }}>
                  {formatDate(alarm.at, alarm.timeZone)}
                </div>
              )}
            </button>
            <Button
              variant={alarm.enabled ? "primary" : "ghost"}
              role="switch"
              aria-checked={alarm.enabled}
              aria-label={`Enable ${alarm.label}`}
              disabled={enable.isPending}
              style={{ width: 80, height: 48 }}
              onClick={() => enable.mutate({ id: alarm.id, enabled: !alarm.enabled })}
            >
              {alarm.enabled ? "On" : "Off"}
            </Button>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <Button variant="ghost" style={{ width: "auto" }} onClick={() => setEditing(alarm)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              style={{ width: "auto" }}
              loading={remove.isPending && deleting === alarm.id}
              onClick={() => {
                if (deleting !== alarm.id) {
                  setDeleting(alarm.id);
                  return;
                }
                remove.mutate({ id: alarm.id }, { onSuccess: () => setDeleting(null) });
              }}
            >
              {deleting === alarm.id ? "Confirm delete" : "Delete"}
            </Button>
            {deleting === alarm.id && (
              <Button variant="ghost" style={{ width: "auto" }} onClick={() => setDeleting(null)}>
                Keep alarm
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function formatDate(at: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(at));
}

function localFields(at: string, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function AlarmEditor({
  alarm,
  timeZone,
  defaults,
  onClose,
}: {
  alarm?: Alarm;
  timeZone: string;
  defaults?: { snoozeMinutes: number; lightTarget: string };
  onClose: () => void;
}) {
  const [input, setInput] = useState<AlarmInput>(() =>
    alarmInputSchema.parse(
      alarm?.at
        ? { ...alarm, time: localFields(alarm.at, alarm.timeZone).time }
        : (alarm ?? { timeZone }),
    ),
  );
  const [date, setDate] = useState(() =>
    alarm?.at ? localFields(alarm.at, alarm.timeZone).date : "",
  );
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const onSuccess = () => {
    void utils.alarms.list.invalidate();
    onClose();
  };
  const onError = (err: { message: string }) => setError(err.message);
  const create = trpc.alarms.create.useMutation({ onSuccess, onError });
  const update = trpc.alarms.update.useMutation({ onSuccess, onError });
  const set = <K extends keyof AlarmInput>(key: K, value: AlarmInput[K]) =>
    setInput((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      style={{ maxWidth: 620, margin: "0 auto", display: "grid", gap: 22 }}
      onSubmit={(event) => {
        event.preventDefault();
        warmAudio();
        const parsed = alarmInputSchema.safeParse({ ...input, at: null });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Check alarm details");
          return;
        }
        if (date) {
          const at = alarmOnDate(date, parsed.data.time, parsed.data.timeZone);
          if (!at) {
            setError(
              "This time does not exist on that date because the clocks change. Choose another time.",
            );
            return;
          }
          parsed.data.at = at.toISOString();
          parsed.data.repeatDays = [];
        }
        setError(null);
        if (alarm) update.mutate({ id: alarm.id, alarm: parsed.data });
        else create.mutate(parsed.data);
      }}
    >
      <h2 style={{ fontSize: 28, margin: 0 }}>{alarm ? "Edit alarm" : "New alarm"}</h2>
      {error && (
        <div role="alert" style={{ color: "var(--red)" }}>
          {error}
        </div>
      )}
      <Field id="alarm-label" label="Label">
        <TextInput
          id="alarm-label"
          label="Label"
          value={input.label}
          onChange={(v) => set("label", v)}
        />
      </Field>
      <Field id="alarm-time" label="Time">
        <input
          id="alarm-time"
          type="time"
          required
          value={input.time}
          style={{ ...controlStyle, fontSize: 44 }}
          onChange={(e) => set("time", e.target.value)}
        />
      </Field>
      <Field id="alarm-date" label="Date · leave blank for the next occurrence or repeating days">
        <input
          id="alarm-date"
          type="date"
          value={date}
          style={controlStyle}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>
      <Field id="alarm-zone" label="Time zone">
        <TextInput
          id="alarm-zone"
          label="Time zone"
          value={input.timeZone}
          onChange={(v) => set("timeZone", v)}
        />
      </Field>
      {!date && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ marginBottom: 12, color: "var(--ink-2)" }}>
            Repeat · no days selected means once
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DAYS.map((day, index) => (
              <Button
                key={day}
                type="button"
                variant={input.repeatDays.includes(index) ? "primary" : "ghost"}
                aria-pressed={input.repeatDays.includes(index)}
                style={{ width: 64, height: 48 }}
                onClick={() =>
                  set(
                    "repeatDays",
                    input.repeatDays.includes(index)
                      ? input.repeatDays.filter((d) => d !== index)
                      : [...input.repeatDays, index],
                  )
                }
              >
                {day}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      <Field id="alarm-snooze" label="Snooze minutes">
        <input
          id="alarm-snooze"
          type="number"
          min={1}
          max={60}
          value={input.snoozeMinutes ?? ""}
          placeholder={String(defaults?.snoozeMinutes ?? 9)}
          style={controlStyle}
          onChange={(e) => set("snoozeMinutes", e.target.value ? Number(e.target.value) : null)}
        />
      </Field>
      <Field id="alarm-lights" label="Light entities or scene · blank uses the home default">
        <TextInput
          id="alarm-lights"
          label="Light entities or scene"
          value={input.lightTarget ?? ""}
          placeholder={defaults?.lightTarget}
          onChange={(v) => set("lightTarget", v || null)}
        />
      </Field>
      {alarm && (
        <p style={{ color: "var(--ink-2)", margin: 0 }}>
          Saving stops any current ring or snooze for this alarm.
        </p>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={create.isPending || update.isPending}>Save alarm</Button>
      </div>
    </form>
  );
}
