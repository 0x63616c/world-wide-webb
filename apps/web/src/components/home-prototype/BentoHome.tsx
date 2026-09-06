// Design question: can the requested daily controls fit a calm, non-scrolling
// 1366 × 1024 bento? One direction follows the user's explicit visual reference.
// Initial values are a read-only production snapshot from 2026-09-06 18:54 UTC.
// All subsequent interactions are local; this prototype has no device mutations.
import {
  ArrowDown,
  ArrowUp,
  Check,
  CloudRain,
  Lamp,
  Minus,
  Plug,
  Plus,
  Power,
  Snowflake,
  Sun,
  Tv,
  Wind,
} from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useId, useState } from "react";
import { Button } from "../ui/Button";
import "./bento-home.css";

const MODES = { off: "Off", cool: "Cool", heat: "Heat", heat_cool: "Auto" } as const;
type Mode = keyof typeof MODES;
const HOURS = [
  { label: "Now", temp: 67, feels: 73 },
  { label: "12 PM", temp: 70, feels: 77 },
  { label: "1 PM", temp: 74, feels: 80 },
  { label: "2 PM", temp: 75, feels: 83 },
  { label: "3 PM", temp: 76, feels: 84 },
  { label: "4 PM", temp: 77, feels: 85 },
  { label: "5 PM", temp: 77, feels: 86 },
  { label: "6 PM", temp: 77, feels: 86 },
  { label: "7 PM", temp: 75, feels: 82 },
  { label: "8 PM", temp: 73, feels: 79 },
  { label: "9 PM", temp: 72, feels: 79 },
  { label: "10 PM", temp: 72, feels: 77 },
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
  selected?: boolean | "mixed";
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={`bh-tap ${className}`}
      aria-label={label}
      title={label}
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
  clock: { name: "Clock", width: 456, height: 216 },
  lamps: { name: "Lights", width: 848, height: 216 },
  climate: { name: "Climate", width: 456, height: 334 },
  sonos: { name: "Sonos", width: 518, height: 334 },
  fan: { name: "Fan", width: 316, height: 334 },
  weather: { name: "Weather", width: 662, height: 398 },
  forecast: { name: "Forecast", width: 642, height: 398 },
} as const;
export type TileId = keyof typeof TILE_SIZES;
export function BentoHome({
  tile,
  variation = "a",
  theme = "light",
}: {
  tile?: TileId;
  variation?: "a" | "b" | "c";
  theme?: "light" | "dark";
}) {
  const volumeId = useId();
  const chartId = useId();
  const [now, setNow] = useState(new Date());
  const [clockOrigin] = useState(new Date());
  const [bedroom, setBedroom] = useState(true);
  const [living, setLiving] = useState(true);
  const [bedroomColor, setBedroomColor] = useState("#fff4d4");
  const [livingColor, setLivingColor] = useState("#fff4d4");
  const [colorRoom, setColorRoom] = useState<"bedroom" | "living" | null>(null);
  const [kitchen, setKitchen] = useState(true);
  const [fan, setFan] = useState(true);
  const [mode, setMode] = useState<Mode>("cool");
  const [target, setTarget] = useState(73);
  const [range, setRange] = useState({ low: 70, high: 75 });
  const [rangeSide, setRangeSide] = useState<"low" | "high">("low");
  // Rounded mean of the five room volumes in the captured snapshot.
  const [volume, setVolume] = useState(82);
  const [source, setSource] = useState<"line-in" | "tv">("line-in");
  const [, setForecastHour] = useState<number | null>(null);
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
  const dialValue = mode === "heat_cool" ? range[rangeSide] : target;
  const anyLightsOn = bedroom || living || kitchen;
  const allLightsOn = bedroom && living && kitchen;
  function setDial(value: number) {
    if (mode === "off") return;
    const next = Math.round(Math.min(90, Math.max(50, value)));
    if (mode === "heat_cool")
      setRange((r) =>
        rangeSide === "low"
          ? { ...r, low: Math.min(r.high - 1, next) }
          : { ...r, high: Math.max(r.low + 1, next) },
      );
    else setTarget(next);
    preview("Temperature adjusted");
  }
  function dragDial(event: PointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const angle =
      ((Math.atan2(
        event.clientX - bounds.x - bounds.width / 2,
        -(event.clientY - bounds.y - bounds.height / 2),
      ) *
        180) /
        Math.PI +
        360) %
      360;
    const swept = (angle - 225 + 360) % 360;
    const arc = swept > 270 ? (swept > 315 ? 0 : 270) : swept;
    setDial(50 + (arc / 270) * 40);
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
  }).formatToParts(clockOrigin);
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
      className={`bh-screen bh-theme-${theme} bh-variant-${variation} ${tile ? "bh-single" : "bh-full"}`}
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
              style={{
                animationDelay: `-${(hour % 12) * 3600 + minute * 60 + second + clockOrigin.getMilliseconds() / 1000}s`,
              }}
            />
            <span
              className="bh-minute-hand"
              style={{
                animationDelay: `-${minute * 60 + second + clockOrigin.getMilliseconds() / 1000}s`,
              }}
            />
            <span
              className="bh-second-hand"
              style={{ animationDelay: `-${second + clockOrigin.getMilliseconds() / 1000}s` }}
            />
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
              <Tap
                className="bh-all-power"
                label={anyLightsOn ? "Turn all lights off" : "Turn all lights on"}
                selected={allLightsOn ? true : anyLightsOn ? "mixed" : false}
                onClick={() => {
                  setBedroom(!anyLightsOn);
                  setLiving(!anyLightsOn);
                  setKitchen(!anyLightsOn);
                  preview(`All lights ${anyLightsOn ? "off" : "on"}`);
                }}
              >
                <Power size={17} />
              </Tap>
            </div>
          </div>
          <div className="bh-room-grid">
            <div className={`bh-room bh-bedroom ${bedroom ? "bh-room-on" : ""}`}>
              <div className="bh-bedroom-scene" aria-hidden="true" style={{ color: bedroomColor }}>
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
              <button
                type="button"
                className="bh-room-open"
                aria-label="Bedroom colors"
                onClick={() => setColorRoom("bedroom")}
              >
                Bedroom
              </button>
            </div>
            <div className={`bh-room bh-living ${living ? "bh-room-on" : ""}`}>
              <div className="bh-living-scene" aria-hidden="true" style={{ color: livingColor }}>
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
              <button
                type="button"
                className="bh-room-open"
                aria-label="Living room colors"
                onClick={() => setColorRoom("living")}
              >
                Living room
              </button>
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
          <div className="bh-airflow" aria-hidden="true">
            <span />
            <span />
            <span />
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
              <span>{fan ? "On" : "Off"}</span>
            </Tap>
          </div>
        </section>
        <section className={`bh-card bh-climate bh-mode-${mode} bh-range-${rangeSide}`}>
          <div className="bh-card-head">
            <div className="bh-heading">
              {mode === "heat" ? (
                <Sun />
              ) : mode === "cool" ? (
                <Snowflake />
              ) : mode === "heat_cool" ? (
                <Wind />
              ) : (
                <Power />
              )}
              <h2>Climate</h2>
            </div>
            <span className="bh-temp-unit">°F</span>
          </div>
          <div className="bh-thermostat">
            <input
              className="bh-dial-input"
              type="range"
              aria-label="Temperature dial"
              aria-valuetext={`${dialValue} degrees Fahrenheit`}
              min={mode === "heat_cool" && rangeSide === "high" ? range.low + 1 : 50}
              max={mode === "heat_cool" && rangeSide === "low" ? range.high - 1 : 90}
              step="1"
              value={dialValue}
              disabled={mode === "off"}
              onChange={(e) => setDial(Number(e.target.value))}
              onPointerDown={(e) => {
                if (mode === "off") return;
                e.preventDefault();
                e.currentTarget.focus();
                e.currentTarget.setPointerCapture(e.pointerId);
                dragDial(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.preventDefault();
                  dragDial(e);
                }
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            />
            <div
              className="bh-dial-position"
              aria-hidden="true"
              style={{ transform: `rotate(${225 + ((dialValue - 50) / 40) * 270}deg)` }}
            >
              <span />
            </div>
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
          </div>
          <div className="bh-audio-stage">
            <div>
              <h3>{source === "line-in" ? "Desk line-in" : "TV audio"}</h3>
              <p>{source === "line-in" ? "Line-in" : "TV input"}</p>
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
              <span className="bh-source-title">Desk</span>
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
              <span className="bh-source-title">TV</span>
              <span className="bh-source-caption">
                {source === "tv" ? "All rooms · Preview" : "Join all rooms"}
              </span>
            </Tap>
          </fieldset>
          <div className="bh-volume-label">
            <label htmlFor={volumeId}>Master volume</label>
            <span>{volume}%</span>
          </div>
          <div className="bh-volume">
            <Tap
              className="bh-volume-step"
              label="Decrease master volume"
              onClick={() => {
                setVolume((v) => Math.max(0, v - 5));
                preview("Master volume decreased");
              }}
            >
              <Minus size={19} />
            </Tap>
            <input
              id={volumeId}
              aria-label="Master volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              style={{
                background: `linear-gradient(to right, #e6ded4 ${volume}%, #514d4a ${volume}%)`,
              }}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                preview(`Master volume ${e.target.value}%`);
              }}
            />
            <Tap
              className="bh-volume-step"
              label="Increase master volume"
              onClick={() => {
                setVolume((v) => Math.min(100, v + 5));
                preview("Master volume increased");
              }}
            >
              <Plus size={19} />
            </Tap>
          </div>
        </section>
        <section className="bh-card bh-weather">
          <div className="bh-weather-scene" aria-hidden="true">
            <span className="bh-cloud bh-cloud-back" />
            <span className="bh-cloud bh-cloud-front" />
            <span className="bh-rain">
              {[0, 1, 2, 3, 4, 5].map((drop) => (
                <i
                  key={drop}
                  style={{ left: `${8 + drop * 16}%`, animationDelay: `${-drop * 0.31}s` }}
                />
              ))}
            </span>
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
          <div className="bh-forecast-legend">
            <span>
              <i />
              Temperature
            </span>
            <span>
              <i />
              Feels like
            </span>
          </div>
          <svg
            className="bh-chart"
            viewBox="0 0 590 270"
            role="img"
            aria-label="Hourly temperature and feels-like forecast in Fahrenheit"
          >
            <defs>
              <linearGradient id={chartId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#a8c7d7" stopOpacity=".2" />
                <stop offset="1" stopColor="#a8c7d7" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[70, 80, 90].map((tick) => (
              <g className="bh-chart-grid" key={tick}>
                <line
                  x1="25"
                  y1={240 - (tick - 65) * 9}
                  x2="564"
                  y2={240 - (tick - 65) * 9}
                  stroke="#e9edef"
                />
                <text x="6" y={244 - (tick - 65) * 9}>
                  {tick}°
                </text>
              </g>
            ))}
            <path
              d={`M 25 244 ${HOURS.map((h, i) => `L ${25 + i * 49} ${240 - (h.temp - 65) * 9}`).join(" ")} L 564 244 Z`}
              fill={`url(#${chartId})`}
            />
            <polyline
              className="bh-line-actual"
              points={HOURS.map((h, i) => `${25 + i * 49},${240 - (h.temp - 65) * 9}`).join(" ")}
              fill="none"
              stroke="#7ea1b2"
              strokeWidth="2.5"
            />
            <polyline
              className="bh-line-feels"
              points={HOURS.map((h, i) => `${25 + i * 49},${240 - (h.feels - 65) * 9}`).join(" ")}
              fill="none"
              stroke="#c4a08b"
              strokeWidth="2"
              strokeDasharray="5 5"
            />
            {HOURS.map((h, i) => (
              <g key={h.label}>
                <title>
                  {h.label}: {h.temp}°F, feels like {h.feels}°F
                </title>
                <circle cx={25 + i * 49} cy={240 - (h.temp - 65) * 9} r="3" fill="#7ea1b2" />
                <text
                  x={25 + i * 49}
                  y={227 - (h.temp - 65) * 9}
                  textAnchor="middle"
                  className="bh-chart-value"
                >
                  {h.temp}°
                </text>
                <text
                  x={25 + i * 49}
                  y={227 - (h.feels - 65) * 9}
                  textAnchor="middle"
                  className="bh-chart-feels-value"
                >
                  {h.feels}°
                </text>
                <text x={25 + i * 49} y="260" textAnchor="middle">
                  {h.label}
                </text>
              </g>
            ))}
          </svg>
          <div className="bh-forecast-hitareas">
            {HOURS.map((h, i) => (
              <button
                type="button"
                key={h.label}
                aria-label={`${h.label}: ${h.temp} degrees, feels like ${h.feels}`}
                onMouseEnter={() => setForecastHour(i)}
                onFocus={() => setForecastHour(i)}
                onClick={() => setForecastHour(i)}
              />
            ))}
          </div>
        </section>
      </div>
      {colorRoom && (
        <section
          className="bh-color-detail"
          aria-label={`${colorRoom === "bedroom" ? "Bedroom" : "Living room"} colors`}
        >
          <Tap
            className="bh-color-back"
            label="Back to quick controls"
            onClick={() => setColorRoom(null)}
          >
            ← Back
          </Tap>
          <h2>{colorRoom === "bedroom" ? "Bedroom" : "Living room"}</h2>
          <label className="bh-color-well">
            <span className="bh-sr">Lamp color</span>
            <input
              type="color"
              aria-label="Lamp color"
              value={colorRoom === "bedroom" ? bedroomColor : livingColor}
              onChange={(e) => {
                if (colorRoom === "bedroom") setBedroomColor(e.target.value);
                else setLivingColor(e.target.value);
                preview("Room color changed");
              }}
            />
          </label>
          <div className="bh-color-presets">
            {[
              { name: "White", color: "#ffffff" },
              { name: "Warm", color: "#fff4d4" },
              { name: "Blue", color: "#8ab6ff" },
              { name: "Rose", color: "#f1a7bc" },
            ].map((preset) => (
              <Tap
                key={preset.name}
                onClick={() => {
                  if (colorRoom === "bedroom") setBedroomColor(preset.color);
                  else setLivingColor(preset.color);
                  preview(`${preset.name} selected`);
                }}
              >
                {preset.name}
              </Tap>
            ))}
          </div>
        </section>
      )}
      <span className="bh-sr" aria-live="polite">
        {notice}
      </span>
    </main>
  );
}
