import pixelFont from "../node_modules/geist/dist/fonts/geist-pixel/GeistPixel-Square.woff2?url";
import monoFont from "../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2?url";
import { SoundEngine } from "./audio";
import { SAVE_SLOT } from "./config";
import { Game, type SaveData } from "./game";
import { PALETTE } from "./palette";
import { Renderer } from "./render";
import "./style.css";
import { UI } from "./ui";

function loadFonts(): void {
  const faces = [
    new FontFace("Geist Pixel", `url(${pixelFont})`),
    new FontFace("Geist Mono", `url(${monoFont})`, { weight: "100 900" }),
  ];
  for (const f of faces) {
    void f.load().then((loaded) => document.fonts.add(loaded));
  }
}

function readSave(): SaveData | undefined {
  try {
    const raw = localStorage.getItem(SAVE_SLOT);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as SaveData;
    return data.version === 1 ? data : undefined;
  } catch {
    return undefined;
  }
}

const params = new URLSearchParams(location.search);
if (params.has("fresh")) localStorage.removeItem(SAVE_SLOT);
loadFonts();
document.documentElement.style.setProperty("--gold", PALETTE.golden);

const saved = readSave();
// The CRT overlay used to default on; saves that never chose it start with it off.
if (saved && !saved.settings.crtChosen) saved.settings.crt = false;
const game = new Game(saved);
const audio = new SoundEngine();
const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new Renderer(canvas, game);
const ui = new UI(game, audio);

function applySettings(): void {
  const s = game.s.settings;
  audio.setVolumes(s.sound, s.music);
  renderer.effects = s.effects;
  renderer.crt = s.crt;
}
applySettings();
ui.onSettings = applySettings;

let resetting = false;
function save(): void {
  if (resetting) return;
  try {
    localStorage.setItem(SAVE_SLOT, JSON.stringify(game.serialize()));
  } catch {
    // Storage full or blocked: the game keeps running without persistence.
  }
}
ui.onReset = () => {
  resetting = true;
  localStorage.removeItem(SAVE_SLOT);
  location.reload();
};

window.addEventListener("resize", () => renderer.resize());
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") save();
  else if (saved || game.s.lifetimeEarned > 0) {
    const off = game.claimOffline(Date.now());
    if (off.amount > 0) ui.openWelcome(off.seconds, off.amount);
  }
});
window.addEventListener("beforeunload", save);
window.setInterval(save, 5000);

canvas.addEventListener("pointerdown", (e) => {
  audio.unlock();
  const p = renderer.screenToWorld(e.clientX, e.clientY);
  game.tap(p.x, p.y);
});

const offline = saved
  ? game.claimOffline(Date.now())
  : { seconds: 0, amount: 0 };
if (!params.has("play")) {
  ui.openTitle(!!saved, () => {
    if (offline.amount > 0) ui.openWelcome(offline.seconds, offline.amount);
  });
}

const STEP = 1 / 120;
let acc = 0;
let last = performance.now();
let lastWork = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  if (!ui.paused || ui.root.querySelector(".title")) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) {
      game.update(STEP);
      acc -= STEP;
      n++;
    }
    if (n === 8) acc = 0;
  }
  renderer.beatAt = audio.beatAt;
  renderer.consume(game.events);
  ui.consume(game.events);
  for (const e of game.events) playSfx(e);
  game.events.length = 0;
  renderer.frame(dt, dt > 0.024 ? Math.max(lastWork, 20) : lastWork);
  ui.update(dt);
  lastWork = performance.now() - t0;
  requestAnimationFrame(frame);
}

function playSfx(e: (typeof game.events)[number]): void {
  switch (e.t) {
    case "hit":
      if (e.broke) audio.brk(e.tier);
      else audio.hit(e.tier, e.crit);
      if (e.broke && e.tier >= 3) audio.coin();
      break;
    case "wall":
      audio.wall();
      break;
    case "zap":
      audio.zap();
      break;
    case "blast":
      audio.boom(e.r);
      break;
    default:
      break;
  }
}

requestAnimationFrame(frame);
(window as unknown as { __game: Game; __renderer: Renderer }).__game = game;
(window as unknown as { __renderer: Renderer }).__renderer = renderer;
