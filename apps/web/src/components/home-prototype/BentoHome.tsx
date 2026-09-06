// Design question: can the requested daily controls fit a calm, non-scrolling
// 1366 × 1024 bento? One direction follows the user's explicit visual reference.
// Initial values are a read-only production snapshot from 2026-09-06 18:54 UTC.
// All subsequent interactions are local; this prototype has no device mutations.
import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudRain,
  Fan,
  Lamp,
  Minus,
  Plug,
  Plus,
  Power,
  Snowflake,
  Sun,
  Tv,
  Volume2,
  Wind,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "../ui/Button";
import "./bento-home.css";

const MODES = { off: "Off", cool: "Cool", heat: "Heat", heat_cool: "Auto" } as const;
type Mode = keyof typeof MODES;
const HOURS = [
  { label: "Now", temp: 67 },
  { label: "12 PM", temp: 70 },
  { label: "1 PM", temp: 74 },
  { label: "2 PM", temp: 75 },
  { label: "3 PM", temp: 76 },
  { label: "4 PM", temp: 77 },
  { label: "5 PM", temp: 77 },
  { label: "6 PM", temp: 77 },
  { label: "7 PM", temp: 75 },
  { label: "8 PM", temp: 73 },
  { label: "9 PM", temp: 72 },
  { label: "10 PM", temp: 72 },
];
function Tap({
  children,
  onClick,
  label,
  selected = false,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  label?: string;
  selected?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`bh-tap ${className}`}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: undefined,
        height: undefined,
        display: undefined,
        alignItems: undefined,
        justifyContent: undefined,
        gap: undefined,
        padding: undefined,
        borderRadius: undefined,
        border: undefined,
        background: undefined,
        color: undefined,
        fontFamily: undefined,
        fontSize: undefined,
        fontWeight: undefined,
        letterSpacing: undefined,
      }}
    >
      {children}
    </Button>
  );
}
function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <Tap className={`bh-switch ${on ? "is-on" : ""}`} selected={on} onClick={onClick} label={label}>
      <span />
    </Tap>
  );
}
export const TILE_SIZES = {
  clock: { name: "Clock", width: 562, height: 233.5 },
  lamps: { name: "Lights", width: 742, height: 233.5 },
  climate: { name: "Climate", width: 652, height: 481 },
  sonos: { name: "Sonos", width: 652, height: 233.5 },
  fan: { name: "Fan", width: 319, height: 233.5 },
  weather: { name: "Weather", width: 319, height: 481 },
  forecast: { name: "Forecast", width: 985, height: 233.5 },
} as const;
export type TileId = keyof typeof TILE_SIZES;
export function BentoHome({
  tile,
  variation = "a",
}: {
  tile?: TileId;
  variation?: "a" | "b" | "c";
}) {
  const volumeId = useId();
  const chartId = useId();
  const [now, setNow] = useState(new Date());
  const [bedroom, setBedroom] = useState(true);
  const [living, setLiving] = useState(true);
  const [kitchen, setKitchen] = useState(true);
  const [fan, setFan] = useState(true);
  const [mode, setMode] = useState<Mode>("cool");
  const [target, setTarget] = useState(73);
  const [range, setRange] = useState({ low: 70, high: 75 });
  const [rangeSide, setRangeSide] = useState<"low" | "high">("low");
  const [volume, setVolume] = useState(90);
  const [source, setSource] = useState<"line-in" | "tv">("line-in");
  const [notice, setNotice] = useState("Read-only snapshot · Sep 6, 11:54 AM");
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const preview = (message: string) => setNotice(`Preview · ${message}`);
  function step(delta: number) {
    if (mode === "off") return;
    if (mode === "heat_cool") {
      setRange((r) =>
        rangeSide === "low"
          ? { ...r, low: Math.max(50, Math.min(r.high - 1, r.low + delta)) }
          : { ...r, high: Math.min(90, Math.max(r.low + 1, r.high + delta)) },
      );
    } else setTarget((t) => Math.min(90, Math.max(50, t + delta)));
    preview("Temperature adjusted");
  }
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  }).format(now);
  const pacificClock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    timeZone: "America/Los_Angeles",
  }).formatToParts(now);
  const hour = Number(pacificClock.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(pacificClock.find((part) => part.type === "minute")?.value ?? 0);
  const second = Number(pacificClock.find((part) => part.type === "second")?.value ?? 0);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(now);
  return (
    <main
      className={`bh-screen bh-variant-${variation} ${tile ? "bh-single" : ""}`}
      data-tile={tile}
      style={tile ? { width: TILE_SIZES[tile].width, height: TILE_SIZES[tile].height } : undefined}
    >
      <div className="bh-grid">
        <section className="bh-card bh-clock" aria-label="Time and date">
          <span className="bh-eyebrow">{date}</span>
          <div className="bh-analog" aria-hidden="true">
            <div className="bh-analog-marks" />
            <span
              className="bh-hour-hand"
              style={{ transform: `rotate(${hour * 30 + minute / 2}deg)` }}
            />
            <span className="bh-minute-hand" style={{ transform: `rotate(${minute * 6}deg)` }} />
            <span className="bh-second-hand" style={{ transform: `rotate(${second * 6}deg)` }} />
            <span className="bh-clock-pin" />
          </div>
          <div className="bh-time">
            {clock.replace(/\s[AP]M/, "")}
            <span>{clock.includes("AM") ? "AM" : "PM"}</span>
          </div>
          <div className="bh-clock-bottom">
            <span className="bh-dot" /> Los Angeles · Pacific time
          </div>
        </section>
        <section className="bh-card bh-lamps">
          <div className="bh-card-head">
            <div className="bh-heading">
              <Lamp />
              <h2>Lights</h2>
            </div>
            <div className="bh-master">
              <Tap
                selected={bedroom && living}
                onClick={() => {
                  setBedroom(true);
                  setLiving(true);
                  preview("All lamps on");
                }}
              >
                Lamps on
              </Tap>
              <Tap
                selected={!bedroom && !living}
                onClick={() => {
                  setBedroom(false);
                  setLiving(false);
                  preview("All lamps off");
                }}
              >
                Lamps off
              </Tap>
            </div>
          </div>
          <div className="bh-room-grid">
            <div className={`bh-room bh-bedroom ${bedroom ? "bh-room-on" : ""}`}>
              <div className="bh-bedroom-scene" aria-hidden="true">
                <span className="bh-bed" />
                <span className="bh-bedside bh-left" />
                <span className="bh-bedside bh-right" />
                <span className="bh-strip" />
              </div>
              <Switch
                on={bedroom}
                label="Bedroom lamps"
                onClick={() => {
                  setBedroom(!bedroom);
                  preview(`Bedroom lamps ${bedroom ? "off" : "on"}`);
                }}
              />
              <h3>Bedroom</h3>
            </div>
            <div className={`bh-room bh-living ${living ? "bh-room-on" : ""}`}>
              <div className="bh-living-scene" aria-hidden="true">
                <span className="bh-sofa" />
                <span className="bh-floor-lamp" />
              </div>
              <Switch
                on={living}
                label="Living room lamps"
                onClick={() => {
                  setLiving(!living);
                  preview(`Living room lamps ${living ? "off" : "on"}`);
                }}
              />
              <h3>Living room</h3>
            </div>
            <div className={`bh-room bh-kitchen ${kitchen ? "bh-room-on" : ""}`}>
              <div className="bh-kitchen-scene" aria-hidden="true">
                <span className="bh-pendant" />
                <span className="bh-island" />
              </div>
              <Switch
                on={kitchen}
                label="Kitchen lights"
                onClick={() => {
                  setKitchen(!kitchen);
                  preview(`Kitchen lights ${kitchen ? "off" : "on"}`);
                }}
              />
              <h3>Kitchen</h3>
            </div>
          </div>
        </section>
        <section className={`bh-card bh-fan ${fan ? "bh-fan-on" : ""}`}>
          <div className="bh-card-head">
            <h2>Fan</h2>
            <span className="bh-fan-status">{fan ? "On" : "Off"}</span>
          </div>
          <div className="bh-fan-object" aria-hidden="true">
            <span className="bh-fan-stand" />
            <div className="bh-fan-housing">
              <Fan className="bh-fan-art" strokeWidth={1.8} />
              <span className="bh-fan-grille" />
              <span className="bh-fan-hub" />
            </div>
          </div>
          <div className="bh-fan-label">
            <span>Air circulation</span>
            <Tap
              className="bh-fan-power"
              selected={fan}
              label="Fan"
              onClick={() => {
                setFan(!fan);
                preview(`Fan ${fan ? "off" : "on"}`);
              }}
            >
              <Power size={20} />
            </Tap>
          </div>
        </section>
        <section className={`bh-card bh-climate bh-mode-${mode}`}>
          <div className="bh-card-head">
            <div className="bh-heading">
              <Snowflake />
              <h2>Climate</h2>
            </div>
            <span className="bh-temp-unit">°F</span>
          </div>
          <div className="bh-thermostat">
            <div className="bh-dial-ticks" />
            <div className="bh-dial-center">
              {mode === "heat_cool" ? (
                <div className="bh-range">
                  <Tap
                    selected={rangeSide === "low"}
                    onClick={() => setRangeSide("low")}
                    label="Select heating limit"
                  >
                    <small>HEAT TO</small>
                    {range.low}°
                  </Tap>
                  <Tap
                    selected={rangeSide === "high"}
                    onClick={() => setRangeSide("high")}
                    label="Select cooling limit"
                  >
                    <small>COOL TO</small>
                    {range.high}°
                  </Tap>
                </div>
              ) : (
                <>
                  <span className="bh-set-label">{mode === "off" ? "LAST SET TO" : "SET TO"}</span>
                  <div className="bh-target">
                    {target}
                    <sup>°</sup>
                  </div>
                </>
              )}
              <span className="bh-ambient">Inside 74°</span>
            </div>
          </div>
          <div className="bh-stepper">
            <Tap disabled={mode === "off"} onClick={() => step(-1)} label="Decrease temperature">
              <Minus size={26} />
            </Tap>
            <Tap disabled={mode === "off"} onClick={() => step(1)} label="Increase temperature">
              <Plus size={26} />
            </Tap>
          </div>
          <div className="bh-modes">
            {Object.entries(MODES).map(([key, label]) => (
              <Tap
                key={key}
                selected={key === mode}
                onClick={() => {
                  if (key === "off" || key === "cool" || key === "heat" || key === "heat_cool")
                    setMode(key);
                  preview(
                    `${label} mode${key === "heat_cool" ? " · range shown for design exploration" : ""}`,
                  );
                }}
              >
                {key === "off" ? (
                  <Power size={17} />
                ) : key === "cool" ? (
                  <Snowflake size={17} />
                ) : key === "heat" ? (
                  <Sun size={17} />
                ) : (
                  <Wind size={17} />
                )}
                {label}
              </Tap>
            ))}
          </div>
        </section>
        <section className="bh-card bh-sonos">
          <div className="bh-card-head">
            <h2>Sonos</h2>
            <span className="bh-group-status">
              <span className="bh-dot" />5 rooms together
            </span>
          </div>
          <div className="bh-audio-stage">
            <div>
              <h3>{source === "line-in" ? "Desk line-in" : "TV audio"}</h3>
              <p>{source === "line-in" ? "Paused · All 5 rooms" : "All rooms · Preview"}</p>
            </div>
          </div>
          <fieldset className="bh-sonos-sources" aria-label="Play across all rooms">
            <Tap
              className="bh-source-choice"
              label="Join all to line-in"
              selected={source === "line-in"}
              onClick={() => {
                setSource("line-in");
                preview("All rooms joined to Desk line-in");
              }}
            >
              <span className="bh-source-choice-top">
                <Plug size={22} strokeWidth={1.5} />
                {source === "line-in" && <Check size={16} />}
              </span>
              <span className="bh-source-title">Join line-in</span>
              <span className="bh-source-caption">
                {source === "line-in" ? "All rooms · Paused" : "Join all rooms"}
              </span>
            </Tap>
            <Tap
              className="bh-source-choice"
              label="Join all to TV"
              selected={source === "tv"}
              onClick={() => {
                setSource("tv");
                preview("All rooms joined to TV");
              }}
            >
              <span className="bh-source-choice-top">
                <Tv size={22} strokeWidth={1.5} />
                {source === "tv" && <Check size={16} />}
              </span>
              <span className="bh-source-title">Join TV</span>
              <span className="bh-source-caption">
                {source === "tv" ? "All rooms · Preview" : "Join all rooms"}
              </span>
            </Tap>
          </fieldset>
          <div className="bh-volume-label">
            <label htmlFor={volumeId}>Desk volume</label>
            <span>{volume}%</span>
          </div>
          <div className="bh-volume">
            <Volume2 size={18} strokeWidth={1.5} />
            <input
              id={volumeId}
              aria-label="Desk volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              style={{
                background: `linear-gradient(to right, #d9e4da ${volume}%, #4a504d ${volume}%)`,
              }}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                preview(`Desk volume ${e.target.value}%`);
              }}
            />
          </div>
        </section>
        <section className="bh-card bh-weather">
          <div className="bh-weather-scene" aria-hidden="true">
            <span className="bh-cloud bh-cloud-back" />
            <span className="bh-cloud bh-cloud-front" />
            <span className="bh-rain" />
          </div>
          <div className="bh-card-head">
            <h2>Weather</h2>
            <CloudRain size={26} strokeWidth={1.5} />
          </div>
          <div className="bh-weather-temp">67°</div>
          <h3>Slight rain</h3>
          <div className="bh-weather-range">
            <span>
              <ArrowUp size={14} />
              77°
            </span>
            <span>
              <ArrowDown size={14} />
              65°
            </span>
          </div>
          <div className="bh-weather-foot">
            Feels like 73°<span>Rain 84%</span>
          </div>
        </section>
        <section className="bh-card bh-forecast">
          <div className="bh-card-head">
            <div>
              <h2>Forecast</h2>
              <p>Warming to 77° by 4 PM</p>
            </div>
            <span className="bh-forecast-unit">°F</span>
          </div>
          <svg
            className="bh-chart"
            viewBox="0 0 790 140"
            role="img"
            aria-label="Hourly forecast: 67 degrees now, rising to 77 at 4 PM, then falling to 72 by 10 PM"
          >
            <defs>
              <linearGradient id={chartId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#a8c7c7" stopOpacity=".25" />
                <stop offset="1" stopColor="#a8c7c7" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={`M 25 109 ${HOURS.map((h, i) => `L ${25 + i * 67} ${95 - (h.temp - 65) * 5}`).join(" ")} L 762 109 Z`}
              fill={`url(#${chartId})`}
            />
            <line x1="25" y1="108" x2="762" y2="108" stroke="#e9edec" />
            <polyline
              points={HOURS.map((h, i) => `${25 + i * 67},${95 - (h.temp - 65) * 5}`).join(" ")}
              fill="none"
              stroke="#669292"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {HOURS.map((h, i) => (
              <g key={h.label}>
                <title>
                  {h.label}: {h.temp}°F
                </title>
                <circle
                  cx={25 + i * 67}
                  cy={95 - (h.temp - 65) * 5}
                  r={i === 0 ? 4 : 2.5}
                  fill="#669292"
                />
                <text
                  x={25 + i * 67}
                  y={79 - (h.temp - 65) * 5}
                  textAnchor="middle"
                  className="bh-chart-value"
                >
                  {h.temp}°
                </text>
                <text x={25 + i * 67} y="132" textAnchor="middle">
                  {h.label}
                </text>
              </g>
            ))}
          </svg>
        </section>
      </div>
      <span className="bh-sr" aria-live="polite">
        {notice}
      </span>
    </main>
  );
}
