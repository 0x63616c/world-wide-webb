/* ============================================================
   ROOMS · VERTICAL MIXER — locking & grouping exploration
   Chosen direction: vertical fader console (was B).
   - faders REORDERED + GROUPED by live group (Line-in cluster)
   - LOCK gangs faders: drag one, all move by same delta,
     offsets preserved, clamped 0–100. Lock per-group OR globally.
   - modals: Mixer (vertical faders) + Per-room Source (default).
     Group Builder dropped.
   ============================================================ */
var useState = React.useState,
  useRef = React.useRef;

/* live topology: Desk (coord) + Bedroom bonded on Line-in & playing.
   Living Room / Bathroom / Kitchen idle. Reordered grouped-first. */
const RoomDefs = [
  { name: "Desk", dev: "Era 300 ×2", group: "linein", coord: true },
  { name: "Bedroom", dev: "Era 300", group: "linein" },
  { name: "Living Room", dev: "Beam", group: null },
  { name: "Bathroom", dev: "Era 100", group: null },
  { name: "Kitchen", dev: "Era 100 SL", group: null },
];
const ORDER = RoomDefs.map((r) => r.name);
const INIT = { Desk: 66, Bedroom: 68, "Living Room": 70, Bathroom: 68, Kitchen: 53 };
const SHORT = {
  Desk: "Desk",
  Bedroom: "Bed",
  "Living Room": "Living",
  Bathroom: "Bath",
  Kitchen: "Kitchen",
};
const GROUPED = RoomDefs.filter((r) => r.group === "linein");
const SOLO = RoomDefs.filter((r) => !r.group);
const isPlaying = (name) => RoomDefs.find((r) => r.name === name).group != null;
const mean = (v) => Math.round(ORDER.reduce((s, n) => s + v[n], 0) / ORDER.length);

/* ---------- shared mixer state + gang-lock logic ---------- */
function useMixer() {
  const [vols, setVols] = useState(INIT);
  const [globalLock, setGL] = useState(false);
  const [groupLock, setGRL] = useState({ linein: false });
  const [mutes, setMutes] = useState({});

  const gangFor = (name) => {
    if (globalLock) return ORDER;
    const def = RoomDefs.find((r) => r.name === name);
    if (def.group && groupLock[def.group])
      return RoomDefs.filter((r) => r.group === def.group).map((r) => r.name);
    return [name];
  };
  const clampDelta = (prev, gang, raw) => {
    let d = Math.round(raw);
    for (const r of gang) {
      d = Math.max(d, -prev[r]);
      d = Math.min(d, 100 - prev[r]);
    }
    return d;
  };
  const setRoomVol = (name, target) =>
    setVols((prev) => {
      const gang = gangFor(name);
      const d = clampDelta(prev, gang, Math.round(Math.max(0, Math.min(100, target))) - prev[name]);
      const next = { ...prev };
      for (const r of gang) next[r] = prev[r] + d;
      return next;
    });
  const nudgeAll = (delta) =>
    setVols((prev) => {
      const d = clampDelta(prev, ORDER, delta);
      const next = { ...prev };
      for (const r of ORDER) next[r] = prev[r] + d;
      return next;
    });
  const lockedFor = (name) => {
    if (globalLock) return true;
    const def = RoomDefs.find((r) => r.name === name);
    return !!(def.group && groupLock[def.group]);
  };
  return {
    vols,
    setRoomVol,
    nudgeAll,
    globalLock,
    setGL,
    groupLock,
    toggleGroup: (g) => setGRL((s) => ({ ...s, [g]: !s[g] })),
    mutes,
    toggleMute: (n) => setMutes((s) => ({ ...s, [n]: !s[n] })),
    lockedFor,
  };
}

/* ---------- dynamic-membership variant: group rooms live from the mixer ---------- */
function useGroupMixer() {
  const [vols, setVols] = useState(INIT);
  const [member, setMember] = useState({
    Desk: "linein",
    Bedroom: "linein",
    "Living Room": null,
    Bathroom: null,
    Kitchen: null,
  });
  const [globalLock, setGL] = useState(false);
  const [groupLock, setGRL] = useState({ linein: false });
  const [mutes, setMutes] = useState({});
  const gangFor = (name) => {
    if (globalLock) return ORDER;
    const g = member[name];
    if (g && groupLock[g]) return ORDER.filter((n) => member[n] === g);
    return [name];
  };
  const clampDelta = (prev, gang, raw) => {
    let d = Math.round(raw);
    for (const r of gang) {
      d = Math.max(d, -prev[r]);
      d = Math.min(d, 100 - prev[r]);
    }
    return d;
  };
  const setRoomVol = (name, target) =>
    setVols((prev) => {
      const gang = gangFor(name);
      const d = clampDelta(prev, gang, Math.round(Math.max(0, Math.min(100, target))) - prev[name]);
      const next = { ...prev };
      for (const r of gang) next[r] = prev[r] + d;
      return next;
    });
  return {
    vols,
    setRoomVol,
    member,
    join: (n) => setMember((s) => ({ ...s, [n]: "linein" })),
    leave: (n) => setMember((s) => ({ ...s, [n]: null })),
    globalLock,
    setGL,
    groupLock,
    toggleGroup: (g) => setGRL((s) => ({ ...s, [g]: !s[g] })),
    mutes,
    toggleMute: (n) => setMutes((s) => ({ ...s, [n]: !s[n] })),
  };
}

/* ---------- draggable vertical fader ---------- */
function Fader({ value, onChange, h = 110, hit = 40, accent, dim, muted, knob = 18, linked }) {
  const ref = useRef(null);
  const apply = (clientY) => {
    const r = ref.current.getBoundingClientRect();
    onChange(Math.max(0, Math.min(100, (1 - (clientY - r.top) / r.height) * 100)));
  };
  const down = (e) => {
    e.preventDefault();
    apply(e.clientY);
    const mv = (ev) => apply(ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  const fill = muted ? T.ink3 : accent ? T.acc : T.ink2;
  return (
    <div
      ref={ref}
      onPointerDown={down}
      style={{
        position: "relative",
        width: hit,
        height: h,
        cursor: "ns-resize",
        touchAction: "none",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 8,
          height: "100%",
          borderRadius: 99,
          background: T.nest,
          opacity: dim ? 0.85 : 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${value}%`,
            borderRadius: 99,
            background: fill,
            opacity: muted ? 0.5 : 1,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: `calc(${value}% - ${knob / 2}px)`,
            transform: "translateX(-50%)",
            width: knob,
            height: knob,
            borderRadius: 99,
            background: "#fff",
            boxShadow: linked
              ? `0 0 0 2px ${T.acc}, 0 1px 4px rgba(0,0,0,0.5)`
              : "0 1px 4px rgba(0,0,0,0.5)",
          }}
        />
      </div>
    </div>
  );
}

/* value + fader + label (+ optional mute / coord) */
function FaderCol({
  name,
  value,
  onChange,
  accent,
  dim,
  muted,
  onMute,
  coord,
  h = 110,
  linked,
  action,
  w = 42,
}) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9, width: w }}
    >
      <span style={{ font: `400 13px ${T.mono}`, color: muted ? T.ink3 : accent ? T.ink : T.ink2 }}>
        {Math.round(value)}
      </span>
      <Fader
        value={value}
        onChange={onChange}
        accent={accent}
        dim={dim}
        muted={muted}
        h={h}
        linked={linked}
      />
      {onMute && (
        <button
          onClick={onMute}
          aria-label={muted ? "unmute" : "mute"}
          title={muted ? "Unmute" : "Mute"}
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            background: muted ? T.accDim : T.nest,
            border: `1px solid ${muted ? T.accLine : T.hair}`,
          }}
        >
          {(muted ? I.speakerMute : I.speaker)({ size: 19, c: muted ? T.acc : T.ink2 })}
        </button>
      )}
      {action}
      <div style={{ textAlign: "center", lineHeight: 1.1 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: accent ? T.ink : T.ink2,
            whiteSpace: "nowrap",
          }}
        >
          {SHORT[name]}
        </div>
        <div
          style={{
            font: `600 7.5px ${T.ui}`,
            letterSpacing: "0.08em",
            marginTop: 2,
            color: coord ? T.acc : "transparent",
          }}
        >
          COORD
        </div>
      </div>
    </div>
  );
}

/* link/unlink a room into the group, from the mixer */
function LinkRoomBtn({ grouped, coord, onClick }) {
  return (
    <button
      onClick={coord ? undefined : onClick}
      title={
        coord
          ? "Coordinator — anchors the group"
          : grouped
            ? "In group — tap to remove"
            : "Tap to add to group"
      }
      aria-label="group toggle"
      style={{
        width: 38,
        height: 32,
        borderRadius: 9,
        cursor: coord ? "default" : "pointer",
        display: "grid",
        placeItems: "center",
        opacity: coord ? 0.65 : 1,
        background: grouped || coord ? T.accDim : T.tile2,
        border: `1px solid ${grouped || coord ? T.accLine : T.hair}`,
      }}
    >
      {I.link({ size: 16, c: grouped || coord ? T.acc : T.ink3 })}
    </button>
  );
}

/* dedicated master fader (gangs all rooms) — no room label */
function MasterFader({ value, onChange, h = 110, showVal = true }) {
  return (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: 42 }}
    >
      {showVal && (
        <span style={{ font: `400 13px ${T.mono}`, color: T.ink }}>{Math.round(value)}</span>
      )}
      <Fader value={value} onChange={onChange} accent h={h} />
    </div>
  );
}

/* lock toggle button (label variant + icon-only variant) */
function LockBtn({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        borderRadius: 9,
        cursor: "pointer",
        background: on ? T.accDim : T.tile2,
        border: `1px solid ${on ? T.accLine : T.hair}`,
        color: on ? T.acc : T.ink2,
        font: `600 10px ${T.ui}`,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {(on ? I.lock : I.unlock)({ size: 14, c: on ? T.acc : T.ink2 })}
      {label}
    </button>
  );
}
function LockIcon({ on, onClick, dimmed }) {
  const active = on || dimmed;
  return (
    <button
      onClick={onClick}
      aria-label="lock group"
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        cursor: dimmed ? "default" : "pointer",
        display: "grid",
        placeItems: "center",
        opacity: dimmed ? 0.6 : 1,
        background: active ? T.accDim : T.tile2,
        border: `1px solid ${active ? T.accLine : T.hair}`,
      }}
    >
      {(active ? I.lock : I.unlock)({ size: 13, c: active ? T.acc : T.ink3 })}
    </button>
  );
}
function GroupCap({ children, right }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        height: 26,
        marginBottom: 10,
      }}
    >
      <span
        style={{
          font: `600 9.5px ${T.ui}`,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: T.ink3,
        }}
      >
        {children}
      </span>
      {right}
    </div>
  );
}

/* icon-only global link/lock — top-right of the tile header */
function GlobalLockBtn({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="link all rooms"
      title="Link all rooms"
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        background: on ? T.accDim : T.tile2,
        border: `1px solid ${on ? T.accLine : T.hair}`,
      }}
    >
      {(on ? I.lock : I.unlock)({ size: 18, c: on ? T.acc : T.ink2 })}
    </button>
  );
}

/* =================== TILE VARIATIONS (4×3 · 431×319) =================== */

/* V1 · Filled group panel — Line-in cluster boxed, lock chip in its cap */
function MixerTileV1() {
  const m = useMixer();
  const gLocked = m.groupLock.linein || m.globalLock;
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Sound System"
        mb={16}
        right={<GlobalLockBtn on={m.globalLock} onClick={() => m.setGL((v) => !v)} />}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
        <div
          style={{
            flex: "2 1 0",
            minWidth: 0,
            borderRadius: 14,
            border: `1px solid ${T.accLine}`,
            background: T.accDim,
            padding: "10px 12px 12px",
          }}
        >
          <GroupCap
            right={
              <LockIcon
                on={m.groupLock.linein}
                dimmed={m.globalLock}
                onClick={() => !m.globalLock && m.toggleGroup("linein")}
              />
            }
          >
            Line-in
          </GroupCap>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            {GROUPED.map((r) => (
              <FaderCol
                key={r.name}
                name={r.name}
                value={m.vols[r.name]}
                accent
                coord={r.coord}
                linked={gLocked}
                onChange={(v) => m.setRoomVol(r.name, v)}
              />
            ))}
          </div>
        </div>
        <div
          style={{
            flex: "3 1 0",
            minWidth: 0,
            borderRadius: 14,
            border: `1px solid ${T.hair}`,
            padding: "10px 12px 12px",
          }}
        >
          <GroupCap>Idle</GroupCap>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            {SOLO.map((r) => (
              <FaderCol
                key={r.name}
                name={r.name}
                value={m.vols[r.name]}
                dim
                linked={m.globalLock}
                onChange={(v) => m.setRoomVol(r.name, v)}
              />
            ))}
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* V2 · Bracket rail — flat row, grouped pair tied by an accent bracket + lock below */
function MixerTileV2() {
  const m = useMixer();
  const gLocked = m.groupLock.linein || m.globalLock;
  return (
    <Tile w={431} h={319}>
      <Header
        icon={I.speaker({ size: 19 })}
        title="Sound System"
        mb={18}
        right={<GlobalLockBtn on={m.globalLock} onClick={() => m.setGL((v) => !v)} />}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {GROUPED.map((r) => (
            <FaderCol
              key={r.name}
              name={r.name}
              value={m.vols[r.name]}
              accent
              coord={r.coord}
              linked={gLocked}
              h={104}
              onChange={(v) => m.setRoomVol(r.name, v)}
            />
          ))}
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: T.hair2, margin: "6px 8px 0" }} />
        <div style={{ display: "flex", gap: 4 }}>
          {SOLO.map((r) => (
            <FaderCol
              key={r.name}
              name={r.name}
              value={m.vols[r.name]}
              dim
              linked={m.globalLock}
              h={104}
              onChange={(v) => m.setRoomVol(r.name, v)}
            />
          ))}
        </div>
      </div>
      {/* accent bracket under the grouped pair */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <div
          style={{
            width: 88,
            height: 8,
            borderLeft: `2px solid ${T.accLine}`,
            borderRight: `2px solid ${T.accLine}`,
            borderBottom: `2px solid ${T.accLine}`,
            borderRadius: "0 0 4px 4px",
          }}
        />
        <LockIcon
          on={m.groupLock.linein}
          dimmed={m.globalLock}
          onClick={() => !m.globalLock && m.toggleGroup("linein")}
        />
        <span
          style={{
            font: `600 9.5px ${T.ui}`,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: gLocked ? T.acc : T.ink3,
          }}
        >
          Line-in {gLocked ? "· linked" : "group"}
        </span>
      </div>
    </Tile>
  );
}

/* V3 · Master + group — a master ALL fader gangs everything; group lock for Line-in */
function MixerTileV3() {
  const m = useMixer();
  const avg = mean(m.vols);
  const gLocked = m.groupLock.linein;
  return (
    <Tile w={431} h={319}>
      <Header icon={I.speaker({ size: 19 })} title="Sound System" mb={16} />
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${T.hair2}`,
            background: T.tile2,
            padding: "10px 14px 12px",
          }}
        >
          <GroupCap>Master · all</GroupCap>
          <MasterFader value={avg} h={110} onChange={(v) => m.nudgeAll(Math.round(v) - avg)} />
        </div>
        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${T.accLine}`,
            background: T.accDim,
            padding: "10px 12px 12px",
          }}
        >
          <GroupCap
            right={<LockIcon on={m.groupLock.linein} onClick={() => m.toggleGroup("linein")} />}
          >
            Line-in
          </GroupCap>
          <div style={{ display: "flex", gap: 4 }}>
            {GROUPED.map((r) => (
              <FaderCol
                key={r.name}
                name={r.name}
                value={m.vols[r.name]}
                accent
                coord={r.coord}
                linked={gLocked}
                onChange={(v) => m.setRoomVol(r.name, v)}
              />
            ))}
          </div>
        </div>
        <div style={{ borderRadius: 14, border: `1px solid ${T.hair}`, padding: "10px 10px 12px" }}>
          <GroupCap>Idle</GroupCap>
          <div style={{ display: "flex", gap: 2 }}>
            {SOLO.map((r) => (
              <FaderCol
                key={r.name}
                name={r.name}
                value={m.vols[r.name]}
                dim
                onChange={(v) => m.setRoomVol(r.name, v)}
              />
            ))}
          </div>
        </div>
      </div>
    </Tile>
  );
}

/* =================== MIXER MODAL VARIATIONS (960×680) =================== */

/* MV1 · Grouped panels — group rooms live, per-group + global lock, mutes */
function MixerModalV1() {
  const m = useGroupMixer();
  const grouped = ORDER.filter((n) => m.member[n] === "linein");
  const ungrouped = ORDER.filter((n) => m.member[n] === null);
  const gLocked = m.groupLock.linein || m.globalLock;
  const isCoord = (n) => !!RoomDefs.find((r) => r.name === n).coord;
  return (
    <ModalPanel
      w={960}
      h={680}
      title="Mixer"
      icon={I.speaker({ size: 20 })}
      headerRight={<GlobalLockBtn on={m.globalLock} onClick={() => m.setGL((v) => !v)} />}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ fontSize: 13.5, color: T.ink3, marginBottom: 14 }}>
          Tap a room’s link to group it. Lock a group — or all rooms — to move its faders together.
        </div>
        <div style={{ flex: 1, display: "flex", gap: 16, alignItems: "stretch" }}>
          {/* grouped panel — flexes with member count */}
          <div
            style={{
              flex: grouped.length,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background: T.accDim,
              border: `1px solid ${T.accLine}`,
              borderRadius: 16,
              padding: "16px 18px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              {I.link({ size: 16, c: T.acc })}
              <span
                style={{
                  font: `600 11px ${T.ui}`,
                  color: T.acc,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Line-in group
              </span>
              <span style={{ font: `400 12px ${T.mono}`, color: T.acc }}>{grouped.length}</span>
              <div style={{ marginLeft: "auto" }}>
                <LockIcon
                  on={m.groupLock.linein}
                  dimmed={m.globalLock}
                  onClick={() => !m.globalLock && m.toggleGroup("linein")}
                />
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", justifyContent: "space-around" }}>
              {grouped.map((r) => (
                <FaderCol
                  key={r}
                  name={r}
                  value={m.vols[r]}
                  accent
                  coord={isCoord(r)}
                  muted={m.mutes[r]}
                  onMute={() => m.toggleMute(r)}
                  linked={gLocked}
                  h={270}
                  w={48}
                  action={<LinkRoomBtn grouped coord={isCoord(r)} onClick={() => m.leave(r)} />}
                  onChange={(v) => m.setRoomVol(r, v)}
                />
              ))}
            </div>
          </div>
          {/* ungrouped panel — flexes with member count */}
          <div
            style={{
              flex: Math.max(ungrouped.length, 1.4),
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              borderRadius: 16,
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 18,
                height: 26,
              }}
            >
              <span
                style={{
                  font: `600 11px ${T.ui}`,
                  color: T.ink3,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Ungrouped · idle
              </span>
            </div>
            {ungrouped.length ? (
              <div style={{ flex: 1, display: "flex", justifyContent: "space-around" }}>
                {ungrouped.map((r) => (
                  <FaderCol
                    key={r}
                    name={r}
                    value={m.vols[r]}
                    dim
                    muted={m.mutes[r]}
                    onMute={() => m.toggleMute(r)}
                    linked={m.globalLock}
                    h={270}
                    w={48}
                    action={<LinkRoomBtn grouped={false} onClick={() => m.join(r)} />}
                    onChange={(v) => m.setRoomVol(r, v)}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "grid",
                  placeItems: "center",
                  color: T.ink3,
                  fontSize: 13,
                }}
              >
                All rooms grouped
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}

/* MV2 · Master + flat row — dedicated ALL master, group ribbon over the faders */
function MixerModalV2() {
  const m = useMixer();
  const avg = mean(m.vols);
  const gLocked = m.groupLock.linein;
  return (
    <ModalPanel w={960} h={680} title="Mixer" icon={I.speaker({ size: 20 })}>
      <div style={{ display: "flex", gap: 20, height: "100%" }}>
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: T.tile2,
            border: `1px solid ${T.hair2}`,
            borderRadius: 16,
            padding: "18px 26px",
          }}
        >
          <span
            style={{
              font: `600 10px ${T.ui}`,
              color: T.ink2,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            All speakers
          </span>
          <span style={{ font: `400 20px ${T.mono}`, color: T.ink, marginBottom: 16 }}>{avg}</span>
          <MasterFader
            value={avg}
            showVal={false}
            h={340}
            onChange={(v) => m.nudgeAll(Math.round(v) - avg)}
          />
          <span
            style={{ fontSize: 11, color: T.ink3, marginTop: 6, maxWidth: 96, textAlign: "center" }}
          >
            moves every room together
          </span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* group ribbon */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                borderRadius: 10,
                background: T.accDim,
                border: `1px solid ${T.accLine}`,
              }}
            >
              {I.link({ size: 15, c: T.acc })}
              <span
                style={{
                  font: `600 10.5px ${T.ui}`,
                  color: T.acc,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Line-in · Desk + Bedroom
              </span>
              <LockIcon on={m.groupLock.linein} onClick={() => m.toggleGroup("linein")} />
            </div>
            <span style={{ marginLeft: "auto", fontSize: 13, color: T.ink3 }}>Ungrouped</span>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "stretch",
              background: T.tile2,
              border: `1px solid ${T.hair}`,
              borderRadius: 16,
              padding: "18px 20px",
            }}
          >
            <div
              style={{
                flex: 2,
                display: "flex",
                justifyContent: "space-around",
                paddingRight: 22,
                borderRight: `1px solid ${T.hair2}`,
              }}
            >
              {GROUPED.map((r) => (
                <FaderCol
                  key={r.name}
                  name={r.name}
                  value={m.vols[r.name]}
                  accent
                  coord={r.coord}
                  muted={m.mutes[r.name]}
                  onMute={() => m.toggleMute(r.name)}
                  linked={gLocked}
                  h={300}
                  w={48}
                  onChange={(v) => m.setRoomVol(r.name, v)}
                />
              ))}
            </div>
            <div
              style={{ flex: 3, display: "flex", justifyContent: "space-around", paddingLeft: 22 }}
            >
              {SOLO.map((r) => (
                <FaderCol
                  key={r.name}
                  name={r.name}
                  value={m.vols[r.name]}
                  dim
                  muted={m.mutes[r.name]}
                  onMute={() => m.toggleMute(r.name)}
                  linked={m.globalLock}
                  h={300}
                  w={48}
                  onChange={(v) => m.setRoomVol(r.name, v)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ModalPanel>
  );
}

/* =================== PER-ROOM SOURCE MODAL (default) =================== */
const SOURCES = ["Line-in", "TV", "Spotify", "AirPlay", "Idle"];
function SourceModal() {
  const [sel, setSel] = useState({
    Desk: "Line-in",
    Bedroom: "Line-in",
    "Living Room": "Idle",
    Bathroom: "Idle",
    Kitchen: "Idle",
  });
  return (
    <ModalPanel w={960} h={680} title="Per-room Source" icon={I.list({ size: 20 })}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          height: "100%",
          overflow: "auto",
        }}
      >
        {ORDER.map((name) => {
          const def = RoomDefs.find((r) => r.name === name);
          return (
            <div
              key={name}
              style={{
                padding: "16px 18px",
                background: T.tile2,
                border: `1px solid ${T.hair}`,
                borderRadius: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
                <span style={{ fontSize: 12, color: T.ink3 }}>{def.dev}</span>
                {def.group && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      marginLeft: 4,
                      font: `500 10px ${T.ui}`,
                      color: T.acc,
                      letterSpacing: "0.06em",
                      padding: "2px 7px",
                      border: `1px solid ${T.accLine}`,
                      borderRadius: 6,
                    }}
                  >
                    {I.link({ size: 11, c: T.acc })} GROUPED
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {SOURCES.map((s) => {
                  const on = sel[name] === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setSel((x) => ({ ...x, [name]: s }))}
                      style={{
                        padding: "9px 16px",
                        borderRadius: 10,
                        cursor: "pointer",
                        font: `500 13px ${T.ui}`,
                        background: on ? T.accDim : T.nest,
                        color: on ? T.acc : T.ink2,
                        border: `1px solid ${on ? T.accLine : T.hair}`,
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ModalPanel>
  );
}

/* =================== EXPORT =================== */
function SoundSystemBody() {
  return (
    <React.Fragment>
      <Section
        title="Tile — grouped + lockable faders"
        note="3 takes on the same feature — V1 is the pick"
      >
        <Frame
          tag="V1"
          name="Filled group panel — Line-in boxed, lock in its cap"
          size="4×3 · 431×319"
          badge={{ text: "Chosen ✓", tone: "selected" }}
        >
          <MixerTileV1 />
        </Frame>
        <Frame
          tag="V2"
          name="Bracket rail — flat row, grouped pair bracketed + lock"
          size="4×3 · 431×319"
          badge={{ text: "Variation", tone: "hold" }}
        >
          <MixerTileV2 />
        </Frame>
        <Frame
          tag="V3"
          name="Master + group — ALL fader gangs everything"
          size="4×3 · 431×319"
          badge={{ text: "Variation", tone: "hold" }}
        >
          <MixerTileV3 />
        </Frame>
      </Section>
      <Section
        title="Modal · Mixer"
        note="960×680 · vertical faders + grouping + lock + mute · group rooms live (MV1)"
      >
        <Frame
          tag="MV1"
          name="Grouped panels — tap-to-group live, per-group & global lock, mutes"
          size="960×680"
        >
          <MixerModalV1 />
        </Frame>
        <Frame
          tag="MV2"
          name="Master + flat row — dedicated ALL master + group ribbon"
          size="960×680"
        >
          <MixerModalV2 />
        </Frame>
      </Section>
      <Section title="Modal · Per-room Source" note="960×680 · the default modal">
        <Frame
          tag="SRC"
          name="Per-room source picker — grouped rooms badged"
          size="960×680"
          badge={{ text: "Default ✓", tone: "selected" }}
        >
          <SourceModal />
        </Frame>
      </Section>
    </React.Fragment>
  );
}
window.SoundSystemCard = {
  id: "sound-system",
  name: "Sound System",
  count: "3 tiles · 2 modals",
  Body: SoundSystemBody,
  title: "Sound System — tile + modal explorations",
  sub: "The multi-room volume console (renamed from Rooms). Vertical faders reordered and grouped by the live group (Desk + Bedroom on Line-in); lock to gang faders so they move together preserving offsets, per group or globally. Two modals only — Mixer (group rooms live, lock, mute) and Per-room Source. Everything here is draggable.",
};
if (window.__SOLO__ !== false && document.getElementById("root")) {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <Stage
      title="Sound System · Vertical Mixer — locking & grouping"
      sub="The vertical fader console, built out as the chosen direction. Faders are reordered and grouped by the live group (Desk + Bedroom on Line-in). Tap a LOCK to gang faders — drag one and the locked set moves together, keeping their offsets and stopping at 0/100. Lock per group or globally. Modals: Mixer + Per-room Source."
    >
      <SoundSystemBody />
    </Stage>,
  );
}
