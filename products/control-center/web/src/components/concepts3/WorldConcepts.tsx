// Round-3 experimental dashboard concepts: SPATIAL WORLDS & CHARACTERS.
// Throwaway Storybook prototypes - local state only, no network, no images.
// Fixed wall-panel canvas: 1366x1024.

import { useState } from "react";
import { Icon } from "../Icon";

// ---------------------------------------------------------------------------
// Shared css (keyframes + reduced-motion guard), scoped under .w3root
// ---------------------------------------------------------------------------

const CONCEPT_CSS = `
.w3root{position:relative;width:1366px;height:1024px;overflow:hidden;
  font-family:ui-rounded,"SF Pro Rounded","Space Grotesk Variable",system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;}
.w3root *{box-sizing:border-box;}
@keyframes w3note{0%{opacity:0;transform:translate(0,8px) scale(.8)}18%{opacity:.95}
  100%{opacity:0;transform:translate(14px,-58px) scale(1.1)}}
@keyframes w3bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes w3pulse{0%,100%{opacity:.5}50%{opacity:.85}}
@keyframes w3spin{to{transform:rotate(360deg)}}
@keyframes w3drift{0%,100%{transform:translateX(0)}50%{transform:translateX(30px)}}
@keyframes w3wag{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(16deg)}}
@keyframes w3puff{0%{opacity:.65;transform:translateY(0) scale(.6)}
  100%{opacity:0;transform:translateY(-34px) scale(1.3)}}
@keyframes w3blink{0%,92%,100%{transform:scaleY(1)}95.5%{transform:scaleY(.06)}}
@keyframes w3bounce{0%{transform:scale(1)}28%{transform:scale(1.08,.88)}
  55%{transform:scale(.94,1.07)}76%{transform:scale(1.03,.97)}100%{transform:scale(1)}}
@keyframes w3breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.014)}}
@keyframes w3pop{0%{opacity:0;transform:translate(-50%,10px) scale(.88)}
  100%{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes w3chip{0%{opacity:0;transform:translate(-50%,-90%)}
  100%{opacity:1;transform:translate(-50%,-100%)}}
@keyframes w3twinkle{0%,100%{opacity:.25}50%{opacity:.9}}
@keyframes w3wisp{0%{opacity:0;transform:translate(0,0)}30%{opacity:.7}
  100%{opacity:0;transform:translate(-26px,18px)}}
.w3-spin-slow{animation:w3spin 26s linear infinite;transform-box:fill-box;transform-origin:center;}
.w3-spin-ring{animation:w3spin 40s linear infinite;transform-box:fill-box;transform-origin:center;}
.w3-blink{animation:w3blink 5.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center;}
.w3-wag{animation:w3wag 1.1s ease-in-out infinite;transform-box:fill-box;transform-origin:left center;}
@media (prefers-reduced-motion: reduce){
  .w3root *{animation:none !important;transition:none !important;}}
`;

// ===========================================================================
// A. WorldIsoHouse - isometric cutaway house
// ===========================================================================

// 2:1-ish dimetric projection helpers. Plan units -> screen px.
const CX = 640;
const CY = 505;
const UX = 24;
const UY = 12;
const UZ = 24;

const px = (x: number, y: number): number => CX + (x - y) * UX;
const py = (x: number, y: number, z: number): number => CY + (x + y) * UY - z * UZ;
const pt = (x: number, y: number, z = 0): string =>
  `${px(x, y).toFixed(1)},${py(x, y, z).toFixed(1)}`;

type P3 = readonly [number, number, number];
const poly = (pts: readonly P3[]): string => pts.map(([x, y, z]) => pt(x, y, z)).join(" ");

/** Flat quad on the floor plane (z=0 unless given). */
const flat = (x: number, y: number, w: number, d: number, z = 0): string =>
  poly([
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
  ]);

interface IsoBoxProps {
  x: number;
  y: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  /** Face tones: consistent light from upper-left. */
  top: string;
  left: string;
  right: string;
  opacity?: number;
}

/** Axis-aligned iso box drawn as three flat-shaded faces. */
function IsoBox({ x, y, z = 0, w, d, h, top, left, right, opacity }: IsoBoxProps) {
  return (
    <g opacity={opacity}>
      <polygon
        points={poly([
          [x, y + d, z + h],
          [x + w, y + d, z + h],
          [x + w, y + d, z],
          [x, y + d, z],
        ])}
        fill={left}
      />
      <polygon
        points={poly([
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x + w, y + d, z],
          [x + w, y, z],
        ])}
        fill={right}
      />
      <polygon
        points={poly([
          [x, y, z + h],
          [x + w, y, z + h],
          [x + w, y + d, z + h],
          [x, y + d, z + h],
        ])}
        fill={top}
      />
    </g>
  );
}

/** Window cut into the y=const back wall (interior side). */
function WallWindowY({ x1, x2, z1, z2 }: { x1: number; x2: number; z1: number; z2: number }) {
  const yp = 0.03;
  return (
    <g>
      <polygon
        points={poly([
          [x1 - 0.12, yp, z1 - 0.12],
          [x2 + 0.12, yp, z1 - 0.12],
          [x2 + 0.12, yp, z2 + 0.12],
          [x1 - 0.12, yp, z2 + 0.12],
        ])}
        fill="#b8a8d9"
      />
      <polygon
        points={poly([
          [x1, yp, z1],
          [x2, yp, z1],
          [x2, yp, z2],
          [x1, yp, z2],
        ])}
        fill="url(#w3aSky)"
      />
      <line
        x1={px((x1 + x2) / 2, 0)}
        y1={py((x1 + x2) / 2, yp, z1)}
        x2={px((x1 + x2) / 2, 0)}
        y2={py((x1 + x2) / 2, yp, z2)}
        stroke="#b8a8d9"
        strokeWidth={2}
      />
    </g>
  );
}

const WALL_H = 3.1;

interface IsoRoom {
  id: string;
  name: string;
  temp: number;
  detail: string;
  x: number;
  y: number;
  w: number;
  d: number;
  floor: string;
}

const ISO_ROOMS: readonly IsoRoom[] = [
  {
    id: "bedroom",
    name: "Bedroom",
    temp: 71,
    detail: "Quiet · winding down",
    x: 0,
    y: 0,
    w: 6,
    d: 4,
    floor: "#6d5f94",
  },
  {
    id: "office",
    name: "Office",
    temp: 72,
    detail: "Cooling to 72°",
    x: 6,
    y: 0,
    w: 8,
    d: 4,
    floor: "#5b7a92",
  },
  {
    id: "living",
    name: "Living room",
    temp: 74,
    detail: "♪ Khruangbin — So We Won't Forget",
    x: 0,
    y: 4,
    w: 8,
    d: 6,
    floor: "#a06b45",
  },
  {
    id: "bath",
    name: "Bathroom",
    temp: 75,
    detail: "46% humidity · fan auto",
    x: 8,
    y: 4,
    w: 6,
    d: 6,
    floor: "#8ea9b5",
  },
];

const NOTE_SPRITES = [
  { id: "note-a", glyph: "♪", dx: 0, delay: "0s" },
  { id: "note-b", glyph: "♫", dx: 14, delay: "1.15s" },
  { id: "note-c", glyph: "♪", dx: -10, delay: "2.3s" },
] as const;

/** Low interior divider walls (cutaway height). */
function Divider({ x, y, w, d }: { x: number; y: number; w: number; d: number }) {
  return <IsoBox x={x} y={y} w={w} d={d} h={0.85} top="#cdc3e8" left="#9385bd" right="#736699" />;
}

function LivingFurniture() {
  return (
    <g>
      {/* rug */}
      <ellipse
        cx={px(4.4, 7.6)}
        cy={py(4.4, 7.6, 0)}
        rx={78}
        ry={38}
        fill="#c48a5e"
        opacity={0.55}
      />
      <ellipse
        cx={px(4.4, 7.6)}
        cy={py(4.4, 7.6, 0)}
        rx={58}
        ry={28}
        fill="#d9a06e"
        opacity={0.5}
      />
      {/* sofa: back + seat + arms, against the x=0 wall */}
      <IsoBox
        x={0.55}
        y={5.1}
        w={0.45}
        d={3.2}
        h={1.25}
        top="#e0705f"
        left="#c95a4c"
        right="#a8483d"
      />
      <IsoBox
        x={1.0}
        y={5.1}
        w={1.15}
        d={3.2}
        h={0.62}
        top="#ef8570"
        left="#d96a58"
        right="#b35244"
      />
      <IsoBox
        x={0.55}
        y={4.75}
        w={1.6}
        d={0.38}
        h={0.95}
        top="#e0705f"
        left="#c95a4c"
        right="#a8483d"
      />
      <IsoBox
        x={0.55}
        y={8.28}
        w={1.6}
        d={0.38}
        h={0.95}
        top="#e0705f"
        left="#c95a4c"
        right="#a8483d"
      />
      {/* coffee table */}
      <IsoBox
        x={3.4}
        y={6.6}
        w={1.5}
        d={1.0}
        h={0.42}
        top="#8a5a38"
        left="#6f462b"
        right="#5c3a24"
      />
      <ellipse cx={px(4.15, 7.1)} cy={py(4.15, 7.1, 0.42)} rx={10} ry={5} fill="#f4c98e" />
      {/* speaker */}
      <IsoBox
        x={6.9}
        y={4.9}
        w={0.72}
        d={0.72}
        h={1.35}
        top="#4a4560"
        left="#3a3550"
        right="#2c2840"
      />
      <circle cx={px(7.26, 5.65)} cy={py(7.26, 5.65, 0.95)} r={4.5} fill="#241f36" />
      <circle cx={px(7.26, 5.65)} cy={py(7.26, 5.65, 0.45)} r={3} fill="#241f36" />
    </g>
  );
}

function BedroomFurniture() {
  return (
    <g>
      {/* bed: frame, mattress, pillow, blanket */}
      <IsoBox
        x={1.1}
        y={0.5}
        w={2.3}
        d={2.7}
        h={0.45}
        top="#7a5a3e"
        left="#634832"
        right="#513a28"
      />
      <IsoBox
        x={1.18}
        y={0.58}
        w={2.14}
        d={2.54}
        h={0.3}
        z={0.45}
        top="#efe6da"
        left="#d8cec0"
        right="#c2b7a8"
      />
      <IsoBox
        x={1.3}
        y={0.68}
        w={0.85}
        d={0.6}
        h={0.2}
        z={0.75}
        top="#fdfaf4"
        left="#e8e2d6"
        right="#d5cec2"
      />
      <polygon points={flat(1.18, 1.65, 2.14, 1.47, 0.76)} fill="#8f7cc2" />
      <polygon points={flat(1.18, 1.65, 2.14, 0.28, 0.76)} fill="#a493d4" />
      {/* nightstand + tiny lamp */}
      <IsoBox
        x={3.9}
        y={0.6}
        w={0.7}
        d={0.7}
        h={0.62}
        top="#7a5a3e"
        left="#634832"
        right="#513a28"
      />
      <circle cx={px(4.25, 0.95)} cy={py(4.25, 0.95, 0.95)} r={5} fill="#b7a8dd" />
    </g>
  );
}

function OfficeFurniture() {
  return (
    <g>
      {/* AC unit on the back wall, with cool wisps */}
      <polygon
        points={poly([
          [11.6, 0.03, 2.25],
          [13.1, 0.03, 2.25],
          [13.1, 0.03, 2.8],
          [11.6, 0.03, 2.8],
        ])}
        fill="#e8eef4"
      />
      <line
        x1={px(11.75, 0)}
        y1={py(11.75, 0.03, 2.38)}
        x2={px(12.95, 0)}
        y2={py(12.95, 0.03, 2.38)}
        stroke="#a9bfd2"
        strokeWidth={2}
      />
      <line
        x1={px(11.75, 0)}
        y1={py(11.75, 0.03, 2.5)}
        x2={px(12.95, 0)}
        y2={py(12.95, 0.03, 2.5)}
        stroke="#a9bfd2"
        strokeWidth={2}
      />
      <path
        d={`M ${pt(12.0, 0.2, 2.1)} q -8 10 -2 20`}
        stroke="#9fd8f2"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        style={{ animation: "w3wisp 2.6s ease-out infinite" }}
      />
      <path
        d={`M ${pt(12.7, 0.2, 2.1)} q -8 10 -2 20`}
        stroke="#9fd8f2"
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        style={{ animation: "w3wisp 2.6s ease-out 1.2s infinite" }}
      />
      {/* desk against back wall */}
      <IsoBox
        x={8.2}
        y={0.55}
        w={3.1}
        d={1.15}
        h={1.0}
        top="#9a6b44"
        left="#7d5535"
        right="#66452b"
      />
      {/* monitor */}
      <IsoBox
        x={9.3}
        y={0.7}
        w={1.0}
        d={0.16}
        h={0.72}
        z={1.0}
        top="#3a3550"
        left="#2c2840"
        right="#221e33"
      />
      <polygon
        points={poly([
          [9.38, 0.9, 1.1],
          [10.22, 0.9, 1.1],
          [10.22, 0.9, 1.64],
          [9.38, 0.9, 1.64],
        ])}
        fill="#8fe0f4"
        opacity={0.9}
      />
      {/* chair */}
      <IsoBox
        x={9.35}
        y={2.3}
        w={0.95}
        d={0.95}
        h={0.52}
        top="#4a4560"
        left="#3a3550"
        right="#2c2840"
      />
      <IsoBox
        x={10.12}
        y={2.3}
        w={0.2}
        d={0.95}
        h={1.15}
        top="#4a4560"
        left="#3a3550"
        right="#2c2840"
      />
      {/* plant in the corner */}
      <IsoBox
        x={13.2}
        y={3.15}
        w={0.55}
        d={0.55}
        h={0.5}
        top="#c67b52"
        left="#a86340"
        right="#8a5033"
      />
      <circle cx={px(13.48, 3.42)} cy={py(13.48, 3.42, 1.05)} r={13} fill="#4d8a63" />
      <circle cx={px(13.48, 3.42) - 9} cy={py(13.48, 3.42, 0.85)} r={9} fill="#3f7452" />
      <circle cx={px(13.48, 3.42) + 9} cy={py(13.48, 3.42, 0.85)} r={9} fill="#3f7452" />
    </g>
  );
}

function BathroomFurniture() {
  return (
    <g>
      {/* bathmat */}
      <ellipse
        cx={px(11.4, 7.6)}
        cy={py(11.4, 7.6, 0)}
        rx={34}
        ry={16}
        fill="#c6dbe2"
        opacity={0.7}
      />
      {/* tub with water */}
      <IsoBox
        x={8.7}
        y={4.9}
        w={1.5}
        d={2.8}
        h={0.85}
        top="#f2f5f7"
        left="#d8e0e6"
        right="#bcc8d0"
      />
      <polygon points={flat(8.85, 5.05, 1.2, 2.5, 0.85)} fill="#8fd0e8" />
      <ellipse cx={px(9.45, 5.5)} cy={py(9.45, 5.5, 0.86)} rx={7} ry={3.4} fill="#c4ecf8" />
      {/* toilet */}
      <IsoBox
        x={12.45}
        y={5.1}
        w={0.62}
        d={0.62}
        h={0.55}
        top="#f2f5f7"
        left="#d8e0e6"
        right="#bcc8d0"
      />
      <IsoBox
        x={13.07}
        y={5.06}
        w={0.24}
        d={0.7}
        h={1.05}
        top="#f2f5f7"
        left="#d8e0e6"
        right="#bcc8d0"
      />
      {/* sink */}
      <IsoBox
        x={12.4}
        y={8.3}
        w={0.85}
        d={0.62}
        h={0.95}
        top="#f2f5f7"
        left="#d8e0e6"
        right="#bcc8d0"
      />
      <ellipse cx={px(12.82, 8.61)} cy={py(12.82, 8.61, 0.96)} rx={8} ry={4} fill="#a9c4ce" />
    </g>
  );
}

function Driveway() {
  return (
    <g>
      <polygon points={flat(14.6, 5.4, 5.6, 4.0)} fill="#544e70" />
      <polygon points={flat(14.6, 7.2, 5.6, 0.4)} fill="#645d84" opacity={0.6} />
      {/* bushes */}
      <ellipse cx={px(15.4, 4.7)} cy={py(15.4, 4.7, 0.35)} rx={17} ry={12} fill="#3e6b56" />
      <ellipse cx={px(16.2, 4.5)} cy={py(16.2, 4.5, 0.3)} rx={12} ry={9} fill="#2f5343" />
      <ellipse cx={px(19.9, 9.0)} cy={py(19.9, 9.0, 0.3)} rx={14} ry={10} fill="#3e6b56" />
      {/* tiny Tesla: body, cabin, wheels, headlight */}
      <IsoBox
        x={15.5}
        y={6.5}
        w={2.7}
        d={1.25}
        h={0.55}
        z={0.16}
        top="#e0566a"
        left="#c23f52"
        right="#9e3243"
      />
      <IsoBox
        x={16.1}
        y={6.62}
        w={1.35}
        d={1.0}
        h={0.5}
        z={0.71}
        top="#f0788a"
        left="#3c3654"
        right="#2c2840"
      />
      <circle cx={px(16.05, 7.75)} cy={py(16.05, 7.75, 0.28)} r={6.5} fill="#241f36" />
      <circle cx={px(16.05, 7.75)} cy={py(16.05, 7.75, 0.28)} r={2.6} fill="#6d6690" />
      <circle cx={px(17.7, 7.75)} cy={py(17.7, 7.75, 0.28)} r={6.5} fill="#241f36" />
      <circle cx={px(17.7, 7.75)} cy={py(17.7, 7.75, 0.28)} r={2.6} fill="#6d6690" />
      <circle cx={px(18.2, 7.3)} cy={py(18.2, 7.3, 0.5)} r={2.6} fill="#ffe9b0" />
      <circle cx={px(18.2, 7.3)} cy={py(18.2, 7.3, 0.5)} r={5.5} fill="#ffe9b0" opacity={0.25} />
    </g>
  );
}

function DogSprite() {
  const cx = px(4.9, 8.4);
  const cy = py(4.9, 8.4, 0.28);
  return (
    <g style={{ animation: "w3bob 2.6s ease-in-out infinite" }}>
      {/* tail */}
      <g className="w3-wag">
        <path
          d={`M ${cx - 17} ${cy - 2} q -10 -8 -8 -16`}
          stroke="#a4744a"
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
        />
      </g>
      {/* body + legs */}
      <ellipse cx={cx} cy={cy} rx={16} ry={9.5} fill="#b98a5e" />
      <rect x={cx - 12} y={cy + 5} width={4.5} height={7} rx={2} fill="#a4744a" />
      <rect x={cx + 7} y={cy + 5} width={4.5} height={7} rx={2} fill="#a4744a" />
      {/* head, ear, nose, eye */}
      <circle cx={cx + 15} cy={cy - 9} r={8.5} fill="#b98a5e" />
      <path d={`M ${cx + 9} ${cy - 16} q -1 -7 4 -8 q 3 4 1 9 z`} fill="#8a5f3c" />
      <circle cx={cx + 22} cy={cy - 8} r={2.4} fill="#3a2a1c" />
      <circle cx={cx + 16.5} cy={cy - 11} r={1.7} fill="#3a2a1c" />
    </g>
  );
}

function IsoLamp({ on }: { on: boolean }) {
  const bx = px(1.6, 8.9);
  const base = py(1.6, 8.9, 0);
  const top = py(1.6, 8.9, 1.55);
  return (
    <g>
      {on ? (
        <circle
          cx={bx}
          cy={top + 6}
          r={56}
          fill="url(#w3aLampGlow)"
          style={{ animation: "w3pulse 3.2s ease-in-out infinite" }}
        />
      ) : null}
      <line
        x1={bx}
        y1={base}
        x2={bx}
        y2={top + 10}
        stroke="#3f3a55"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <ellipse cx={bx} cy={base} rx={9} ry={4} fill="#3f3a55" />
      <polygon
        points={`${bx - 12},${top + 12} ${bx + 12},${top + 12} ${bx + 7},${top - 4} ${bx - 7},${top - 4}`}
        fill={on ? "#ffce7a" : "#8d80ab"}
      />
    </g>
  );
}

interface RoomChipProps {
  room: IsoRoom;
  lightOn: boolean;
  onToggle: () => void;
}

function RoomChip({ room, lightOn, onToggle }: RoomChipProps) {
  const ax = px(room.x + room.w / 2, room.y + room.d / 2);
  const ay = py(room.x + room.w / 2, room.y + room.d / 2, 0) - 46;
  return (
    <div
      style={{
        position: "absolute",
        left: ax,
        top: ay,
        transform: "translate(-50%,-100%)",
        animation: "w3chip .28s ease-out both",
        background: "rgba(24,20,44,0.92)",
        border: "1px solid rgba(255,255,255,0.16)",
        borderRadius: 18,
        padding: "14px 16px 12px",
        minWidth: 236,
        color: "#f2eefc",
        boxShadow: "0 18px 40px rgba(8,5,20,0.55)",
        zIndex: 5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 14,
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 700 }}>{room.name}</span>
        <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          {room.temp}°
        </span>
      </div>
      <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 3 }}>{room.detail}</div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          border: "none",
          cursor: "pointer",
          borderRadius: 12,
          padding: "8px 12px",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 700,
          color: lightOn ? "#3a2c10" : "#cfc8e6",
          background: lightOn ? "linear-gradient(180deg,#ffd98a,#f2b95a)" : "rgba(255,255,255,0.1)",
        }}
      >
        <Icon name={lightOn ? "bulb" : "bulb-off"} s={16} sw={2} />
        {lightOn ? "Lamp on — tap to dim" : "Lamp off — tap to light"}
      </button>
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -7,
          transform: "translateX(-50%) rotate(45deg)",
          width: 14,
          height: 14,
          background: "rgba(24,20,44,0.92)",
          borderRight: "1px solid rgba(255,255,255,0.16)",
          borderBottom: "1px solid rgba(255,255,255,0.16)",
        }}
      />
    </div>
  );
}

const HUD_PILL: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(20,16,40,0.6)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 999,
  padding: "8px 16px",
  color: "#f4efe6",
  backdropFilter: "blur(6px)",
};

export function WorldIsoHouse() {
  const [selected, setSelected] = useState<string | null>(null);
  const [lights, setLights] = useState<Record<string, boolean>>({
    bedroom: false,
    office: false,
    living: true,
    bath: false,
  });

  const selectedRoom = ISO_ROOMS.find((r) => r.id === selected) ?? null;
  const toggleLight = (id: string) => setLights((prev) => ({ ...prev, [id]: !prev[id] }));
  const pickRoom = (id: string) => setSelected((prev) => (prev === id ? null : id));

  return (
    <div
      className="w3root"
      style={{
        background:
          "linear-gradient(180deg,#181438 0%,#2c2258 34%,#553a72 58%,#a25c74 76%,#e08d72 92%,#f4ac7d 100%)",
        color: "#f4efe6",
      }}
    >
      <style>{CONCEPT_CSS}</style>

      <svg
        viewBox="0 0 1366 1024"
        width={1366}
        height={1024}
        style={{ position: "absolute", inset: 0 }}
        role="img"
        aria-label="Isometric cutaway of the house"
      >
        <defs>
          <linearGradient id="w3aSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8d6bb0" />
            <stop offset="100%" stopColor="#f0a884" />
          </linearGradient>
          <radialGradient id="w3aLampGlow">
            <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.85" />
            <stop offset="55%" stopColor="#ffb95e" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#ffb95e" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="w3aRoomGlow">
            <stop offset="0%" stopColor="#ffcf8a" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ffcf8a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="w3aSunGlow">
            <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffd98a" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* --- sky décor --- */}
        <g transform="translate(1040,212)">
          <circle r={64} fill="url(#w3aSunGlow)" />
          <g className="w3-spin-slow">
            {[0, 45, 90, 135].map((deg) => (
              <g key={`ray-${deg}`} transform={`rotate(${deg})`}>
                <line
                  x1={-52}
                  y1={0}
                  x2={-42}
                  y2={0}
                  stroke="#ffd98a"
                  strokeWidth={4}
                  strokeLinecap="round"
                />
                <line
                  x1={42}
                  y1={0}
                  x2={52}
                  y2={0}
                  stroke="#ffd98a"
                  strokeWidth={4}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
          <circle r={32} fill="#ffcf7e" />
          <circle r={32} fill="#ffe3ad" opacity={0.55} />
        </g>
        <g style={{ animation: "w3drift 14s ease-in-out infinite" }} opacity={0.5}>
          <ellipse cx={300} cy={188} rx={54} ry={15} fill="#cbb6e0" />
          <ellipse cx={338} cy={176} rx={34} ry={12} fill="#d9c7ea" />
        </g>
        <g style={{ animation: "w3drift 19s ease-in-out infinite reverse" }} opacity={0.4}>
          <ellipse cx={880} cy={130} rx={44} ry={13} fill="#cbb6e0" />
        </g>

        {/* --- ground shadow + base slab --- */}
        <ellipse
          cx={px(8.5, 5)}
          cy={py(8.5, 5, 0) + 26}
          rx={430}
          ry={104}
          fill="#0e0a24"
          opacity={0.4}
        />
        <IsoBox
          x={-0.6}
          y={-0.6}
          w={15.2}
          d={11.2}
          z={-0.55}
          h={0.55}
          top="#7d7099"
          left="#4e4468"
          right="#3c3454"
        />

        {/* --- back walls (cutaway: front walls removed) --- */}
        <IsoBox
          x={-0.35}
          y={-0.35}
          w={14.35}
          d={0.35}
          h={WALL_H}
          top="#d9cfec"
          left="#9c8dc4"
          right="#5f5384"
        />
        <IsoBox
          x={-0.35}
          y={0}
          w={0.35}
          d={10}
          h={WALL_H}
          top="#d9cfec"
          left="#9c8dc4"
          right="#786aa4"
        />
        {/* windows on back walls */}
        <WallWindowY x1={1.6} x2={3.4} z1={1.3} z2={2.5} />
        <WallWindowY x1={8.6} x2={10.4} z1={1.3} z2={2.5} />
        {/* window on the x=0 wall (living room) */}
        <g>
          <polygon
            points={poly([
              [0.03, 5.9, 1.18],
              [0.03, 8.5, 1.18],
              [0.03, 8.5, 2.62],
              [0.03, 5.9, 2.62],
            ])}
            fill="#9c8dc4"
          />
          <polygon
            points={poly([
              [0.03, 6.02, 1.3],
              [0.03, 8.38, 1.3],
              [0.03, 8.38, 2.5],
              [0.03, 6.02, 2.5],
            ])}
            fill="url(#w3aSky)"
          />
        </g>
        {/* framed picture in the bedroom */}
        <polygon
          points={poly([
            [4.4, 0.03, 1.7],
            [5.3, 0.03, 1.7],
            [5.3, 0.03, 2.35],
            [4.4, 0.03, 2.35],
          ])}
          fill="#e8ddc4"
        />
        <polygon
          points={poly([
            [4.5, 0.03, 1.8],
            [5.2, 0.03, 1.8],
            [5.2, 0.03, 2.25],
            [4.5, 0.03, 2.25],
          ])}
          fill="#7a9e8a"
        />

        {/* --- room floors --- */}
        {ISO_ROOMS.map((room) => (
          <polygon
            key={`floor-${room.id}`}
            points={flat(room.x, room.y, room.w, room.d)}
            fill={room.floor}
          />
        ))}
        {/* living room plank lines */}
        {[5, 6, 7, 8, 9].map((yy) => (
          <line
            key={`plank-${yy}`}
            x1={px(0, yy)}
            y1={py(0, yy, 0)}
            x2={px(8, yy)}
            y2={py(8, yy, 0)}
            stroke="#8a5a38"
            strokeWidth={1.4}
            opacity={0.5}
          />
        ))}
        {/* bathroom tile lines */}
        {[9.5, 11, 12.5].map((xx) => (
          <line
            key={`tile-${xx}`}
            x1={px(xx, 4)}
            y1={py(xx, 4, 0)}
            x2={px(xx, 10)}
            y2={py(xx, 10, 0)}
            stroke="#7d98a5"
            strokeWidth={1.2}
            opacity={0.6}
          />
        ))}

        {/* --- furniture, painter's order back to front --- */}
        <BedroomFurniture />
        <OfficeFurniture />
        <Divider x={0} y={3.85} w={14} d={0.3} />
        <LivingFurniture />
        <BathroomFurniture />
        <Divider x={7.85} y={4.15} w={0.3} d={5.85} />

        {/* --- state tints (after furniture, like light in the air) --- */}
        {/* office A/C zone: cool blue */}
        <polygon points={flat(6, 0, 8, 4)} fill="#6fc4e8" opacity={0.2} />
        {/* rooms with lamp off get dim; lamp on gets a warm wash */}
        {ISO_ROOMS.map((room) =>
          lights[room.id] ? (
            <polygon
              key={`tint-${room.id}`}
              points={flat(room.x, room.y, room.w, room.d)}
              fill="url(#w3aRoomGlow)"
              opacity={0.85}
            />
          ) : (
            <polygon
              key={`tint-${room.id}`}
              points={flat(room.x, room.y, room.w, room.d)}
              fill="#171233"
              opacity={0.28}
            />
          ),
        )}

        {/* --- living room lamp + glow, dog, floating notes --- */}
        <IsoLamp on={lights.living === true} />
        <DogSprite />
        {NOTE_SPRITES.map((note) => (
          <text
            key={note.id}
            x={px(7.26, 5.2) + note.dx}
            y={py(7.26, 5.2, 1.7)}
            fontSize={17}
            fill="#ffd9b0"
            style={{ animation: `w3note 3.4s ease-out ${note.delay} infinite` }}
          >
            {note.glyph}
          </text>
        ))}

        {/* --- outside: driveway + Tesla --- */}
        <Driveway />

        {/* --- selection highlight + invisible tap targets on top --- */}
        {selectedRoom ? (
          <polygon
            points={flat(selectedRoom.x, selectedRoom.y, selectedRoom.w, selectedRoom.d)}
            fill="none"
            stroke="#ffe9b0"
            strokeWidth={2.5}
            strokeDasharray="7 6"
            opacity={0.9}
          />
        ) : null}
        {ISO_ROOMS.map((room) => (
          // biome-ignore lint/a11y/useSemanticElements: an in-scene SVG hit area cannot be a native <button>
          <polygon
            key={`hit-${room.id}`}
            points={flat(room.x, room.y, room.w, room.d)}
            fill="transparent"
            role="button"
            tabIndex={0}
            aria-label={`Select ${room.name}`}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => pickRoom(room.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") pickRoom(room.id);
            }}
          />
        ))}
      </svg>

      {/* --- floating room chip --- */}
      {selectedRoom ? (
        <RoomChip
          room={selectedRoom}
          lightOn={lights[selectedRoom.id] === true}
          onToggle={() => toggleLight(selectedRoom.id)}
        />
      ) : null}

      {/* --- HUD --- */}
      <div style={{ position: "absolute", top: 26, left: 30, ...HUD_PILL }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: 0.5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          14:32
        </span>
        <span style={{ fontSize: 13, opacity: 0.75, marginTop: 6 }}>Friday</span>
      </div>
      <div style={{ position: "absolute", top: 26, right: 30, ...HUD_PILL }}>
        <Icon name="sun" s={20} sw={2} />
        <span style={{ fontSize: 22, fontWeight: 800 }}>81°</span>
        <span style={{ fontSize: 13, opacity: 0.75 }}>sunny outside · 74° in</span>
      </div>
      {selected === null ? (
        <div
          style={{
            position: "absolute",
            top: 96,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 13.5,
            letterSpacing: 0.4,
            opacity: 0.62,
          }}
        >
          tap a room to peek inside
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: "50%",
          transform: "translateX(-50%)",
          ...HUD_PILL,
          gap: 22,
          padding: "10px 24px",
          fontSize: 14.5,
          fontWeight: 600,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="car" s={17} sw={2} />
          Tesla 81% · 240 mi
        </span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="wifi" s={17} sw={2} />
          884 Mbps
        </span>
        <span style={{ opacity: 0.35 }}>·</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="calendar" s={17} sw={2} />
          Dinner with Sam 17:30
        </span>
      </div>
    </div>
  );
}

// ===========================================================================
// B. WorldHouseBuddy - the house as a tamagotchi character
// ===========================================================================

type BuddyMood = "content" | "excited" | "starry";

interface BuddyLine {
  id: string;
  text: string;
  mood: BuddyMood;
}

const BUDDY_LINES: readonly BuddyLine[] = [
  { id: "cooling", text: "Cooling to 72° — Sam arrives at 5:30! 🍜", mood: "content" },
  { id: "vibing", text: "Vibing to Khruangbin with all 12 devices ♪", mood: "excited" },
  { id: "cosmic", text: "Tesla is at 81% and it is 81° outside. Cosmic ✨", mood: "starry" },
];

const BUDDY_STARS = [
  { id: "star-aa", x: 140, y: 150, s: 5 },
  { id: "star-ab", x: 320, y: 90, s: 3 },
  { id: "star-ac", x: 520, y: 190, s: 4 },
  { id: "star-ad", x: 860, y: 110, s: 3 },
  { id: "star-ae", x: 1120, y: 170, s: 5 },
  { id: "star-af", x: 1250, y: 330, s: 3 },
  { id: "star-ag", x: 110, y: 430, s: 3 },
  { id: "star-ah", x: 1290, y: 640, s: 4 },
  { id: "star-ai", x: 200, y: 820, s: 4 },
  { id: "star-aj", x: 1150, y: 880, s: 3 },
] as const;

function BuddyEyes({ mood }: { mood: BuddyMood }) {
  const eyeAt = (cx: number) => (
    <g key={`eye-${cx}`}>
      <rect
        x={cx - 27}
        y={272}
        width={54}
        height={60}
        rx={17}
        fill="#fff8ee"
        stroke="#eab896"
        strokeWidth={4}
      />
      <g className="w3-blink">
        {mood === "content" ? (
          <path
            d={`M ${cx - 13} 304 Q ${cx} 314 ${cx + 13} 304`}
            stroke="#4a3f66"
            strokeWidth={6}
            fill="none"
            strokeLinecap="round"
          />
        ) : null}
        {mood === "excited" ? <circle cx={cx} cy={302} r={11} fill="#4a3f66" /> : null}
        {mood === "starry" ? (
          <path
            d={`M ${cx} 288 L ${cx + 4.5} 298 L ${cx + 15} 302 L ${cx + 4.5} 306 L ${cx} 316 L ${cx - 4.5} 306 L ${cx - 15} 302 L ${cx - 4.5} 298 Z`}
            fill="#f2b544"
          />
        ) : null}
        {mood === "excited" ? <circle cx={cx + 4} cy={298} r={3.5} fill="#fff8ee" /> : null}
      </g>
    </g>
  );
  return (
    <g>
      {eyeAt(233)}
      {eyeAt(327)}
    </g>
  );
}

function BuddyMouth({ mood }: { mood: BuddyMood }) {
  if (mood === "excited") {
    return (
      <g>
        <path d="M 250 432 L 250 392 Q 280 356 310 392 L 310 432 Z" fill="#7c4234" />
        <path d="M 262 432 Q 280 414 298 432 Z" fill="#f78ba0" />
        <circle cx={303} cy={398} r={3.2} fill="#f4c9a6" />
      </g>
    );
  }
  if (mood === "starry") {
    return (
      <g>
        <ellipse cx={280} cy={406} rx={17} ry={21} fill="#7c4234" />
        <ellipse cx={280} cy={414} rx={9} ry={8} fill="#f78ba0" />
      </g>
    );
  }
  return (
    <g>
      <path d="M 254 430 L 254 396 Q 280 368 306 396 L 306 430 Z" fill="#8a4a3a" />
      <path
        d="M 262 380 Q 280 394 298 380"
        stroke="#4a3f66"
        strokeWidth={5.5}
        fill="none"
        strokeLinecap="round"
      />
      <circle cx={298} cy={410} r={3.5} fill="#f4c9a6" />
    </g>
  );
}

function BuddySvg({ mood }: { mood: BuddyMood }) {
  return (
    <svg viewBox="0 0 560 560" width={560} height={560} role="img" aria-label="House buddy">
      <defs>
        <linearGradient id="w3bRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7de8b2" />
          <stop offset="50%" stopColor="#a9f0c4" />
          <stop offset="100%" stopColor="#5ecf9a" />
        </linearGradient>
        <linearGradient id="w3bBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe6cb" />
          <stop offset="100%" stopColor="#f6c69c" />
        </linearGradient>
      </defs>
      {/* mood ring: all green */}
      <g className="w3-spin-ring">
        <circle
          cx={280}
          cy={290}
          r={248}
          fill="none"
          stroke="url(#w3bRing)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray="150 26"
          opacity={0.85}
        />
      </g>
      <circle
        cx={280}
        cy={290}
        r={248}
        fill="none"
        stroke="#7de8b2"
        strokeWidth={1.5}
        opacity={0.25}
      />
      {/* ground shadow + bushes feet */}
      <ellipse cx={280} cy={452} rx={150} ry={22} fill="#0c0a1c" opacity={0.5} />
      <ellipse cx={172} cy={432} rx={30} ry={20} fill="#4d8a63" />
      <ellipse cx={388} cy={432} rx={30} ry={20} fill="#4d8a63" />
      <ellipse cx={196} cy={442} rx={22} ry={14} fill="#3f7452" />
      <ellipse cx={364} cy={442} rx={22} ry={14} fill="#3f7452" />
      {/* chimney + puffs */}
      <rect x={352} y={148} width={34} height={70} rx={9} fill="#e88aa2" />
      <circle
        cx={369}
        cy={140}
        r={9}
        fill="#efe6f4"
        opacity={0.6}
        style={{ animation: "w3puff 3.2s ease-out infinite" }}
      />
      <circle
        cx={378}
        cy={132}
        r={6}
        fill="#efe6f4"
        opacity={0.5}
        style={{ animation: "w3puff 3.2s ease-out 1.5s infinite" }}
      />
      {/* roof (fat stroke for soft corners) */}
      <path
        d="M 150 250 L 262 142 Q 280 126 298 142 L 410 250 Z"
        fill="#f79ab0"
        stroke="#f79ab0"
        strokeWidth={22}
        strokeLinejoin="round"
      />
      <path d="M 176 244 L 384 244" stroke="#e2809a" strokeWidth={8} strokeLinecap="round" />
      {/* body */}
      <rect x={166} y={244} width={228} height={198} rx={30} fill="url(#w3bBody)" />
      <rect
        x={166}
        y={244}
        width={228}
        height={198}
        rx={30}
        fill="none"
        stroke="#e8b28a"
        strokeWidth={3}
        opacity={0.7}
      />
      {/* face */}
      <BuddyEyes mood={mood} />
      <circle cx={202} cy={348} r={13} fill="#f79ab0" opacity={0.55} />
      <circle cx={358} cy={348} r={13} fill="#f79ab0" opacity={0.55} />
      <BuddyMouth mood={mood} />
      {/* doorstep */}
      <rect x={244} y={432} width={72} height={10} rx={5} fill="#d9a678" />
    </svg>
  );
}

function HeartBattery({ pct }: { pct: number }) {
  const gray = 1 - pct / 100;
  return (
    <svg viewBox="0 0 24 22" width={26} height={24} role="img" aria-label={`Battery ${pct}%`}>
      <defs>
        <linearGradient id="w3bHeart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4462" />
          <stop offset={gray} stopColor="#4a4462" />
          <stop offset={gray} stopColor="#ff7d9e" />
          <stop offset="1" stopColor="#ff7d9e" />
        </linearGradient>
      </defs>
      <path
        d="M12 20 C 5 15 1.5 11 1.5 7 C 1.5 3.9 4 1.5 6.9 1.5 C 9 1.5 10.9 2.7 12 4.5 C 13.1 2.7 15 1.5 17.1 1.5 C 20 1.5 22.5 3.9 22.5 7 C 22.5 11 19 15 12 20 Z"
        fill="url(#w3bHeart)"
      />
    </svg>
  );
}

function Droplet() {
  return (
    <svg viewBox="0 0 20 26" width={20} height={26} role="img" aria-label="Humidity">
      <path d="M10 1.5 C 14 8 18 12 18 17 A 8 8 0 1 1 2 17 C 2 12 6 8 10 1.5 Z" fill="#7ec8f0" />
      <path
        d="M6.5 17.5 A 3.6 3.6 0 0 0 10 21.4"
        stroke="#d6effc"
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface BuddyBadge {
  id: string;
  x: number;
  y: number;
  delay: string;
  art: React.ReactNode;
  big: string;
  sub: string;
  tint: string;
}

const BUDDY_BADGES: readonly BuddyBadge[] = [
  {
    id: "tesla",
    x: 1004,
    y: 318,
    delay: "0s",
    art: <HeartBattery pct={81} />,
    big: "81%",
    sub: "Tesla · 240 mi · parked",
    tint: "#ff7d9e",
  },
  {
    id: "music",
    x: 254,
    y: 318,
    delay: "0.6s",
    art: (
      <span
        style={{
          fontSize: 24,
          lineHeight: 1,
          color: "#c9a6ff",
          animation: "w3bob 1.6s ease-in-out infinite",
          display: "inline-block",
        }}
      >
        ♪
      </span>
    ),
    big: "Khruangbin",
    sub: "So We Won't Forget",
    tint: "#c9a6ff",
  },
  {
    id: "wifi",
    x: 1004,
    y: 626,
    delay: "1.2s",
    art: (
      <span style={{ display: "flex", alignItems: "center", color: "#8ce0d2" }}>
        <Icon name="wifi" s={22} sw={2.2} />
        <Icon name="sparkles" s={13} sw={2.2} />
      </span>
    ),
    big: "884 Mbps",
    sub: "12 devices happy",
    tint: "#8ce0d2",
  },
  {
    id: "humidity",
    x: 254,
    y: 626,
    delay: "1.8s",
    art: <Droplet />,
    big: "46%",
    sub: "humidity · just right",
    tint: "#7ec8f0",
  },
];

export function WorldHouseBuddy() {
  const [lineIdx, setLineIdx] = useState(0);
  const line = BUDDY_LINES[lineIdx % BUDDY_LINES.length] ?? BUDDY_LINES[0];
  if (line === undefined) return null;

  return (
    <div
      className="w3root"
      style={{
        background:
          "radial-gradient(900px 700px at 50% 42%, #2b2450 0%, #1c1738 55%, #120e26 100%)",
        color: "#f4eefc",
      }}
    >
      <style>{CONCEPT_CSS}</style>

      {/* twinkling stars */}
      {BUDDY_STARS.map((star) => (
        <span
          key={star.id}
          style={{
            position: "absolute",
            left: star.x,
            top: star.y,
            width: star.s,
            height: star.s,
            borderRadius: "50%",
            background: "#e9dffc",
            animation: `w3twinkle ${3 + star.s}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* HUD corners */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 34,
          display: "flex",
          alignItems: "baseline",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
          14:32
        </span>
        <span style={{ fontSize: 14, opacity: 0.65 }}>Friday afternoon</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 32,
          right: 34,
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: 0.9,
        }}
      >
        <Icon name="sun" s={20} sw={2} />
        <span style={{ fontSize: 20, fontWeight: 700 }}>81° out · 74° in</span>
      </div>

      {/* speech bubble */}
      <div
        key={`bubble-${line.id}`}
        style={{
          position: "absolute",
          top: 96,
          left: "50%",
          transform: "translateX(-50%)",
          animation: "w3pop .32s ease-out both",
          background: "#fdf6ea",
          color: "#3a3152",
          borderRadius: 26,
          padding: "18px 30px",
          fontSize: 23,
          fontWeight: 700,
          boxShadow: "0 16px 40px rgba(8,5,20,0.5)",
          whiteSpace: "nowrap",
        }}
      >
        {line.text}
        <span
          style={{
            position: "absolute",
            left: "50%",
            bottom: -10,
            transform: "translateX(-50%) rotate(45deg)",
            width: 22,
            height: 22,
            background: "#fdf6ea",
            borderRadius: 4,
          }}
        />
      </div>

      {/* the buddy (button so a tap reacts) */}
      <button
        type="button"
        onClick={() => setLineIdx((idx) => (idx + 1) % BUDDY_LINES.length)}
        aria-label="Poke the house buddy"
        style={{
          position: "absolute",
          left: "50%",
          top: 212,
          transform: "translateX(-50%)",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div key={`buddy-${line.id}`} style={{ animation: "w3bounce .7s ease-out both" }}>
          <div style={{ animation: "w3breathe 4.5s ease-in-out infinite" }}>
            <BuddySvg mood={line.mood} />
          </div>
        </div>
      </button>

      {/* mood label under the ring */}
      <div
        style={{
          position: "absolute",
          top: 806,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 15,
          fontWeight: 700,
          color: "#a9f0c4",
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#7de8b2",
            animation: "w3pulse 2.6s ease-in-out infinite",
          }}
        />
        house mood: content — everything is green
      </div>

      {/* orbiting stat badges */}
      {BUDDY_BADGES.map((badge) => (
        <div
          key={badge.id}
          style={{
            position: "absolute",
            left: badge.x,
            top: badge.y,
            transform: "translate(-50%,-50%)",
            animation: `w3bob 3.6s ease-in-out ${badge.delay} infinite`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              background: "rgba(255,255,255,0.06)",
              border: `1.5px solid ${badge.tint}44`,
              borderRadius: 24,
              padding: "16px 22px",
              minWidth: 250,
              boxShadow: "0 12px 30px rgba(8,5,20,0.4)",
            }}
          >
            <span style={{ display: "flex", width: 34, justifyContent: "center" }}>
              {badge.art}
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 21, fontWeight: 800, color: badge.tint }}>{badge.big}</span>
              <span style={{ fontSize: 13, opacity: 0.7 }}>{badge.sub}</span>
            </span>
          </div>
        </div>
      ))}

      {/* footer schedule */}
      <div
        style={{
          position: "absolute",
          bottom: 30,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 15,
          fontWeight: 600,
          opacity: 0.75,
        }}
      >
        <Icon name="calendar" s={17} sw={2} />
        Dinner with Sam · 17:30
        <span style={{ opacity: 0.4 }}>·</span>
        Farmers market · Saturday
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 62,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 12.5,
          letterSpacing: 0.4,
          opacity: 0.4,
        }}
      >
        tap the house — it likes that
      </div>
    </div>
  );
}
