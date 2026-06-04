/**
 * TEMPORARY diagnostic overlay — prints the surface's real viewport so we can
 * see what the iPad actually reports (Safari toolbar + safe-area often make it
 * smaller than the nominal 1366x1024) and why the bezel rule fires or not.
 * Remove once the bezel threshold is settled.
 */

import { useEffect, useState } from "react";
import { BOARD_H, BOARD_W } from "../lib/grid-constants";

// Must match BEZEL in Board.tsx — the per-side border the bezel rule needs room for.
const BEZEL = 10;

interface Metrics {
  innerW: number;
  innerH: number;
  visualW: number;
  visualH: number;
  screenW: number;
  screenH: number;
  dpr: number;
}

function read(): Metrics {
  const vv = window.visualViewport;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    visualW: Math.round(vv?.width ?? window.innerWidth),
    visualH: Math.round(vv?.height ?? window.innerHeight),
    screenW: window.screen.width,
    screenH: window.screen.height,
    dpr: window.devicePixelRatio,
  };
}

export function ViewportDebug() {
  const [m, setM] = useState<Metrics>(read);

  useEffect(() => {
    const update = () => setM(read());
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  const needW = BOARD_W + 2 * BEZEL;
  const needH = BOARD_H + 2 * BEZEL;
  const bezelOn = m.innerW >= needW && m.innerH >= needH;

  const lines = [
    `inner   ${m.innerW} × ${m.innerH}`,
    `visual  ${m.visualW} × ${m.visualH}`,
    `screen  ${m.screenW} × ${m.screenH}  dpr ${m.dpr}`,
    `panel   ${BOARD_W} × ${BOARD_H}`,
    `bezel   needs ≥ ${needW} × ${needH} → ${bezelOn ? "ON" : "OFF"}`,
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        left: 8,
        zIndex: 99999,
        padding: "6px 8px",
        background: "rgba(0,0,0,0.72)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 6,
        color: bezelOn ? "#5be37d" : "#f4c063",
        font: "11px/1.55 'Space Mono', ui-monospace, monospace",
        whiteSpace: "pre",
        pointerEvents: "none",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
