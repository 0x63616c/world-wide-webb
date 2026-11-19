import { SoundEngine } from "./audio";
import {
  BALL_BY_ID,
  BALL_TYPES,
  GAME_NAME,
  SKILL_BY_ID,
  SKILLS,
  SPEC_MILESTONE,
  STAT_MAX,
  type BallTypeId,
  type StatId,
} from "./config";
import { canBuySkill, canSpecialize, formatNumber as fmt } from "./economy";
import type { Game, GameEvent, Settings } from "./game";
import { FINAL_LEVEL } from "./levels";
import { PALETTE } from "./palette";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  html = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** Smoothly counts a displayed number towards its target. */
class CountUp {
  shown = 0;
  constructor(
    private node: HTMLElement,
    private format: (n: number) => string = fmt,
  ) {}
  update(target: number, dt: number): void {
    const prev = this.shown;
    this.shown += (target - this.shown) * Math.min(1, dt * 9);
    if (Math.abs(target - this.shown) < 0.5) this.shown = target;
    const text = this.format(this.shown);
    if (this.node.textContent !== text) this.node.textContent = text;
    if (target > prev + 0.5 && !this.node.classList.contains("tick")) {
      this.node.classList.add("tick");
      window.setTimeout(() => this.node.classList.remove("tick"), 90);
    }
  }
  snap(v: number): void {
    this.shown = v;
    this.node.textContent = this.format(v);
  }
}

function spring(node: HTMLElement): void {
  node.classList.remove("spring");
  void node.offsetWidth;
  node.classList.add("spring");
}

const STAT_LABEL: Record<StatId, string> = {
  speed: "Speed",
  damage: "Damage",
  special: "",
};

export class UI {
  root = document.getElementById("ui")!;
  private money!: CountUp;
  private moneyBox!: HTMLElement;
  private pixelsLeft!: CountUp;
  private levelName!: HTMLElement;
  private ballButtons = new Map<BallTypeId, HTMLButtonElement>();
  private comboBox!: HTMLElement;
  private comboNum!: HTMLElement;
  private comboMult!: HTMLElement;
  private comboBar!: HTMLElement;
  private spBadge!: HTMLElement;
  private starBtn!: HTMLButtonElement;
  private ballCount!: HTMLElement;
  private toasts!: HTMLElement;
  private modal: HTMLElement | null = null;
  private modalKind = "";
  private upgradeType: BallTypeId | null = null;
  private lastCombo = 0;
  private refreshTimer = 0;
  paused = false;
  onSettings: (s: Settings) => void = () => {};
  onReset: () => void = () => {};

  constructor(
    private game: Game,
    private audio: SoundEngine,
  ) {
    this.build();
  }

  private build(): void {
    const top = el("div", "hud-top");
    this.moneyBox = el(
      "div",
      "money panel",
      `<span class="money-num">0</span><span class="coin"></span>`,
    );
    this.money = new CountUp(this.moneyBox.querySelector(".money-num")!);
    const center = el("div", "hud-center");
    this.levelName = el("div", "level-name");
    const left = el("div", "pixels-left", `Pixels left: <b>0</b>`);
    this.pixelsLeft = new CountUp(left.querySelector("b")!);
    center.append(this.levelName, left);
    top.append(this.moneyBox, center);

    const bar = el("div", "ball-bar");
    for (const t of BALL_TYPES) {
      const b = el("button", "ball-btn") as HTMLButtonElement;
      b.style.setProperty("--c", PALETTE.balls[t.id]);
      b.innerHTML = `<span class="count"></span><span class="dot"></span><span class="price"></span><span class="up" title="Upgrades">+</span><span class="lock">LOCKED</span><span class="spec-dot"></span>`;
      b.title = `${t.name}: ${t.blurb}`;
      b.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        if (target.classList.contains("up")) {
          this.openUpgrades(t.id);
          return;
        }
        this.buyBall(t.id, ev.shiftKey ? 10 : 1, b);
      });
      b.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        this.openUpgrades(t.id);
      });
      this.ballButtons.set(t.id, b);
      bar.append(b);
    }

    const right = el("div", "right-bar");
    this.starBtn = el(
      "button",
      "icon-btn star-btn",
      `<span class="glyph">✦</span><span class="badge">0</span>`,
    ) as HTMLButtonElement;
    this.starBtn.title = "Prestige";
    this.starBtn.onclick = () => this.openPrestige();
    const skillBtn = el(
      "button",
      "icon-btn skill-btn",
      `<span class="glyph">⌬</span><span class="badge sp">0</span>`,
    ) as HTMLButtonElement;
    skillBtn.title = "Skill tree (T)";
    skillBtn.onclick = () => this.openSkills();
    this.spBadge = skillBtn.querySelector(".sp")!;
    const setBtn = el(
      "button",
      "icon-btn",
      `<span class="glyph">⚙</span>`,
    ) as HTMLButtonElement;
    setBtn.title = "Settings (Esc)";
    setBtn.onclick = () => this.openSettings();
    this.ballCount = el(
      "div",
      "ball-count panel",
      `<span class="n">1</span><span class="dot"></span>`,
    );
    right.append(this.starBtn, skillBtn, setBtn, this.ballCount);

    this.comboBox = el(
      "div",
      "combo",
      `<div class="combo-num">x0</div><div class="combo-mult"></div><div class="combo-bar"><i></i></div>`,
    );
    this.comboNum = this.comboBox.querySelector(".combo-num")!;
    this.comboMult = this.comboBox.querySelector(".combo-mult")!;
    this.comboBar = this.comboBox.querySelector("i")!;
    this.toasts = el("div", "toasts");
    const hint = el(
      "div",
      "hint",
      "Click pixels to chip them · Shift-click buys 10 · Right-click a ball for upgrades",
    );
    this.root.append(top, bar, right, this.comboBox, this.toasts, hint);
    for (const b of this.root.querySelectorAll("button"))
      b.addEventListener("pointerdown", () => this.audio.click());

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.modal && this.modalKind !== "title") this.close();
        else if (!this.modal) this.openSettings();
      }
      if (this.modal) return;
      const n = Number(e.key);
      if (n >= 1 && n <= BALL_TYPES.length) {
        const t = BALL_TYPES[n - 1].id;
        this.buyBall(t, e.shiftKey ? 10 : 1, this.ballButtons.get(t)!);
      }
      if (e.key === "t" || e.key === "T") this.openSkills();
    });
  }

  private buyBall(t: BallTypeId, times: number, b: HTMLElement): void {
    spring(b);
    if (!this.game.mods.unlocked.has(t)) {
      this.audio.deny();
      this.toast(
        `${BALL_BY_ID[t].name} ball is locked`,
        "Unlock it in the skill tree",
        "muted",
      );
      return;
    }
    let bought = 0;
    for (let k = 0; k < times; k++) if (this.game.buyBall(t)) bought++;
    if (!bought) {
      this.audio.deny();
      b.classList.add("deny");
      window.setTimeout(() => b.classList.remove("deny"), 300);
    }
  }

  // ---------- per-frame ----------

  update(dt: number): void {
    const g = this.game;
    this.money.update(g.s.money, dt);
    this.pixelsLeft.update(g.grid.pixelsLeft, dt);
    const name = `${g.s.level > FINAL_LEVEL ? "∞" : `Level ${g.s.level}`} · ${g.def.name}`;
    if (this.levelName.textContent !== name) this.levelName.textContent = name;
    this.refreshTimer -= dt;
    if (this.refreshTimer <= 0) {
      this.refreshTimer = 0.1;
      this.refreshButtons();
      if (this.modalKind === "upgrades" && this.upgradeType)
        this.renderUpgrades(this.upgradeType, false);
      if (this.modalKind === "skills") this.renderSkillState();
    }
    const combo = g.combo;
    if (combo >= 5) {
      this.comboBox.classList.add("on");
      if (combo !== this.lastCombo) {
        this.comboNum.textContent = `x${combo}`;
        this.comboMult.textContent = `${Math.min(3, 1 + combo * 0.01).toFixed(2)}× money`;
        if (combo > this.lastCombo) spring(this.comboNum);
      }
      this.comboBar.style.transform = `scaleX(${Math.max(0, g.comboTimer / g.mods.comboWindow)})`;
      this.comboBox.style.setProperty(
        "--heat",
        String(Math.min(1, combo / 250)),
      );
    } else this.comboBox.classList.remove("on");
    this.lastCombo = combo;
  }

  private refreshButtons(): void {
    const g = this.game;
    for (const t of BALL_TYPES) {
      const b = this.ballButtons.get(t.id)!;
      const p = g.s.balls[t.id];
      const unlocked = g.mods.unlocked.has(t.id);
      const price = g.ballPrice(t.id);
      b.classList.toggle("locked", !unlocked);
      b.classList.toggle("afford", unlocked && g.s.money >= price);
      b.classList.toggle("can-spec", unlocked && canSpecialize(p));
      b.classList.toggle("has-spec", !!p.spec);
      (b.querySelector(".count") as HTMLElement).textContent = String(p.owned);
      (b.querySelector(".price") as HTMLElement).textContent = fmt(price);
    }
    this.spBadge.textContent = String(g.s.skillPoints);
    this.spBadge.parentElement!.classList.toggle(
      "ready",
      SKILLS.some((s) => canBuySkill(s.id, g.s.skillRanks, g.s.skillPoints)),
    );
    const stars = g.prestigeStars();
    (this.starBtn.querySelector(".badge") as HTMLElement).textContent = String(
      g.s.stars,
    );
    this.starBtn.classList.toggle("ready", stars > 0);
    (this.ballCount.querySelector(".n") as HTMLElement).textContent = String(
      g.totalBalls(),
    );
  }

  // ---------- events ----------

  consume(events: GameEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case "level-clear":
          this.audio.levelUp();
          this.toast(
            `Golden pixel found!`,
            `${e.name} cleared · +${e.sp} skill points`,
            "gold big",
          );
          break;
        case "level-start":
          if (e.level > 1)
            window.setTimeout(
              () => this.toast(`Level ${e.level}`, e.name, "level"),
              700,
            );
          break;
        case "win":
          window.setTimeout(() => this.openWin(), 900);
          break;
        case "combo":
          this.audio.combo(e.n);
          this.toast(
            `${e.n} combo!`,
            `${Math.min(3, 1 + e.n * 0.01).toFixed(2)}× money while it lasts`,
            "combo",
          );
          break;
        case "milestone":
          this.audio.chaChing();
          spring(this.moneyBox);
          this.moneyBox.classList.add("milestone");
          window.setTimeout(
            () => this.moneyBox.classList.remove("milestone"),
            900,
          );
          this.toast(
            `Cha-ching! ${fmt(e.amount)} earned`,
            "Lifetime milestone",
            "money",
          );
          break;
        case "buy":
          this.audio.buy();
          spring(this.ballButtons.get(e.ball)!);
          break;
        case "upgrade":
          this.audio.buy();
          break;
        case "unlock":
          this.audio.unlockSfx();
          this.toast(
            `Unlocked: ${e.name}`,
            "Buy it from the left bar",
            "unlock big",
          );
          break;
        case "spec":
          this.audio.unlockSfx();
          this.toast(
            `${BALL_BY_ID[e.ball].name} → ${e.name}`,
            "Specialization chosen",
            "unlock big",
          );
          break;
        case "skill":
          this.audio.buy();
          break;
        case "prestige":
          this.audio.levelUp();
          this.toast(
            `Prestige! +${e.stars} ✦`,
            "Permanent money and damage boost",
            "gold big",
          );
          break;
        default:
          break;
      }
    }
  }

  toast(title: string, sub: string, cls = ""): void {
    const t = el(
      "div",
      `toast ${cls}`,
      `<div class="t-title">${title}</div><div class="t-sub">${sub}</div>`,
    );
    this.toasts.prepend(t);
    while (this.toasts.children.length > 4)
      this.toasts.lastElementChild!.remove();
    window.setTimeout(
      () => t.classList.add("out"),
      cls.includes("big") ? 2800 : 2000,
    );
    window.setTimeout(() => t.remove(), 3400);
  }

  // ---------- modals ----------

  private open(kind: string, content: HTMLElement, cls = ""): void {
    this.close();
    const m = el("div", `modal-backdrop ${cls}`);
    m.addEventListener("pointerdown", (e) => {
      if (e.target === m && kind !== "title" && kind !== "welcome")
        this.close();
    });
    const card = el("div", "modal panel");
    card.append(content);
    m.append(card);
    this.root.append(m);
    this.modal = m;
    this.modalKind = kind;
    this.paused = kind === "title" || kind === "settings";
    for (const b of m.querySelectorAll("button"))
      b.addEventListener("pointerdown", () => this.audio.click());
  }

  close(): void {
    if (!this.modal) return;
    const m = this.modal;
    m.classList.add("closing");
    window.setTimeout(() => m.remove(), 180);
    this.modal = null;
    this.modalKind = "";
    this.upgradeType = null;
    this.paused = false;
  }

  openTitle(hasSave: boolean, onPlay: () => void): void {
    const c = el(
      "div",
      "title-screen",
      `<div class="logo"><span class="gp-pixel"></span><h1>${GAME_NAME.replace(" ", "<br>")}</h1></div>
       <p class="tag">Break pixels. Buy balls. Find the golden one.</p>
       <div class="title-actions"><button class="btn primary play">${hasSave ? "Continue" : "Play"}</button><button class="btn settings">Settings</button></div>
       <p class="keys">1–7 buy balls · T skill tree · Esc settings</p>`,
    );
    c.querySelector<HTMLButtonElement>(".play")!.onclick = () => {
      this.audio.unlock();
      this.close();
      onPlay();
    };
    c.querySelector<HTMLButtonElement>(".settings")!.onclick = () => {
      this.audio.unlock();
      this.openSettings(() => this.openTitle(hasSave, onPlay));
    };
    this.open("title", c, "title");
  }

  openWelcome(seconds: number, amount: number): void {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const away = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    const c = el(
      "div",
      "welcome",
      `<h2>Welcome back</h2><p>Your balls kept bouncing for <b>${away}</b>.</p>
       <div class="big-num"><span class="n">0</span><span class="coin"></span></div>
       <button class="btn primary">Collect</button>`,
    );
    const counter = new CountUp(c.querySelector(".n")!);
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      counter.update(amount, (now - last) / 1000 / 2.5);
      last = now;
      if (counter.shown < amount && this.modalKind === "welcome")
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    c.querySelector<HTMLButtonElement>("button")!.onclick = () => {
      this.audio.unlock();
      this.audio.chaChing();
      this.close();
    };
    this.open("welcome", c);
  }

  openSettings(back?: () => void): void {
    const s = this.game.s.settings;
    const c = el(
      "div",
      "settings",
      `<h2>Settings</h2>
       <label>Sound <input type="range" min="0" max="1" step="0.05" name="sound" value="${s.sound}"></label>
       <label>Music <input type="range" min="0" max="1" step="0.05" name="music" value="${s.music}"></label>
       <label>Effects <input type="range" min="0" max="1" step="0.05" name="effects" value="${s.effects}"></label>
       <label class="toggle">CRT glow <input type="checkbox" name="crt" ${s.crt ? "checked" : ""}></label>
       <div class="row"><button class="btn danger reset">Reset save</button><button class="btn primary done">Done</button></div>`,
    );
    const apply = () => {
      const q = (n: string) =>
        c.querySelector<HTMLInputElement>(`[name=${n}]`)!;
      s.sound = Number(q("sound").value);
      s.music = Number(q("music").value);
      s.effects = Number(q("effects").value);
      if (s.crt !== q("crt").checked) s.crtChosen = true;
      s.crt = q("crt").checked;
      this.onSettings(s);
    };
    c.querySelectorAll("input").forEach((i) =>
      i.addEventListener("input", apply),
    );
    const reset = c.querySelector<HTMLButtonElement>(".reset")!;
    reset.onclick = () => {
      if (reset.dataset.armed) {
        this.onReset();
        return;
      }
      reset.dataset.armed = "1";
      reset.textContent = "Click again: erase everything";
    };
    c.querySelector<HTMLButtonElement>(".done")!.onclick = () =>
      back ? back() : this.close();
    this.open("settings", c);
  }

  openPrestige(): void {
    const g = this.game;
    const stars = g.prestigeStars();
    const c = el(
      "div",
      "prestige",
      `<h2><span class="star">✦</span> Prestige</h2>
       <p>Reset money, balls, upgrades and level for permanent stars. Skills and skill points stay.</p>
       <p>Each star: <b>+10% money</b> and <b>+5% damage</b>, forever. You have <b>${g.s.stars} ✦</b>.</p>
       <div class="big-num">+${stars} ✦</div>
       <p class="muted">${g.s.maxLevel < 3 ? "Reach level 3 to prestige." : stars === 0 ? "Earn more this run to gain a star." : ""}</p>
       <div class="row"><button class="btn cancel">Not yet</button><button class="btn primary go" ${stars > 0 ? "" : "disabled"}>Prestige</button></div>`,
    );
    c.querySelector<HTMLButtonElement>(".cancel")!.onclick = () => this.close();
    c.querySelector<HTMLButtonElement>(".go")!.onclick = () => {
      this.close();
      g.prestige();
    };
    this.open("prestige", c);
  }

  openWin(): void {
    const g = this.game;
    const c = el(
      "div",
      "win",
      `<div class="logo"><span class="gp-pixel"></span></div><h2>You found every golden pixel</h2>
       <p>All ${FINAL_LEVEL} levels cleared. Lifetime earnings: <b>${fmt(g.s.lifetimeEarned)}</b>.</p>
       <p>Keep going into endless levels, or prestige for stars.</p>
       <div class="row"><button class="btn primary">Keep breaking</button></div>`,
    );
    c.querySelector<HTMLButtonElement>("button")!.onclick = () => this.close();
    this.open("win", c, "celebrate");
  }

  // ---------- upgrades ----------

  openUpgrades(t: BallTypeId): void {
    if (!this.game.mods.unlocked.has(t)) {
      this.audio.deny();
      this.toast(
        `${BALL_BY_ID[t].name} ball is locked`,
        "Unlock it in the skill tree",
        "muted",
      );
      return;
    }
    const c = el("div", "upgrades");
    this.open("upgrades", c, "side");
    this.upgradeType = t;
    this.renderUpgrades(t, true);
  }

  private renderUpgrades(t: BallTypeId, full: boolean): void {
    const g = this.game;
    const type = BALL_BY_ID[t];
    const p = g.s.balls[t];
    const c = this.modal?.querySelector(".upgrades") as HTMLElement | null;
    if (!c) return;
    if (full) {
      c.innerHTML = `<h2 style="--c:${PALETTE.balls[t]}"><span class="dot"></span>${type.name} ball</h2><p class="muted">${type.blurb}</p><div class="stats"></div><div class="spec"></div>`;
      for (const stat of ["speed", "damage", "special"] as StatId[]) {
        const row = el(
          "div",
          "stat-row",
          `<div class="stat-name"></div><div class="pips"></div><button class="btn buy"></button>`,
        );
        row.dataset.stat = stat;
        row.querySelector<HTMLButtonElement>(".buy")!.onclick = () => {
          spring(row);
          if (!g.buyUpgrade(t, stat)) this.audio.deny();
          this.renderUpgrades(t, false);
        };
        c.querySelector(".stats")!.append(row);
      }
    }
    for (const row of c.querySelectorAll<HTMLElement>(".stat-row")) {
      const stat = row.dataset.stat as StatId;
      const lvl = p[stat];
      const label = stat === "special" ? type.special.name : STAT_LABEL[stat];
      let value = "";
      if (stat === "speed") value = g.ballSpeed(t).toFixed(1) + " c/s";
      if (stat === "damage") value = g.ballDamage(t).toFixed(1);
      if (stat === "special") {
        const v = g.special(t);
        value =
          type.special.unit === "%"
            ? `${Math.round(v * 100)}%`
            : `${+v.toFixed(2)}${type.special.unit}`;
      }
      row.querySelector(".stat-name")!.innerHTML =
        `${label} <span class="v">${value}</span>`;
      const pips = row.querySelector(".pips")!;
      const max = STAT_MAX[stat];
      if (pips.children.length !== max) pips.innerHTML = "<i></i>".repeat(max);
      [...pips.children].forEach((pip, k) =>
        pip.classList.toggle("on", k < lvl),
      );
      const price = g.upgradePrice(t, stat);
      const btn = row.querySelector<HTMLButtonElement>(".buy")!;
      btn.textContent = price === null ? "MAX" : fmt(price);
      btn.disabled = price === null;
      btn.classList.toggle("afford", price !== null && g.s.money >= price);
    }
    const spec = c.querySelector(".spec") as HTMLElement;
    const total = p.speed + p.damage + p.special;
    const key = `${p.spec}|${canSpecialize(p)}|${Math.min(total, SPEC_MILESTONE)}`;
    if (spec.dataset.key === key) return;
    spec.dataset.key = key;
    if (p.spec) {
      const s = type.specs.find((x) => x.id === p.spec)!;
      spec.innerHTML = `<h3>Specialization</h3><div class="spec-card chosen"><b>${s.name}</b><span>${s.text}</span></div>`;
    } else if (canSpecialize(p)) {
      spec.innerHTML = `<h3>Choose a specialization</h3><div class="spec-choices"></div>`;
      for (const s of type.specs) {
        const card = el(
          "button",
          "spec-card pick",
          `<b>${s.name}</b><span>${s.text}</span>`,
        );
        card.onclick = () => {
          g.specialize(t, s.id);
          this.renderUpgrades(t, false);
        };
        spec.querySelector(".spec-choices")!.append(card);
      }
    } else {
      spec.innerHTML = `<h3>Specialization</h3><p class="muted">${total}/${SPEC_MILESTONE} upgrades to unlock: ${type.specs.map((s) => s.name).join(" or ")}</p><div class="progress"><i style="transform:scaleX(${total / SPEC_MILESTONE})"></i></div>`;
    }
  }

  // ---------- skill tree ----------

  openSkills(): void {
    const c = el("div", "skills");
    c.innerHTML = `<h2>Skill tree <span class="sp-left"></span></h2><div class="tree"><svg viewBox="0 0 1000 620" preserveAspectRatio="none"></svg></div><div class="skill-info muted">Hover a node to see what it does.</div>`;
    const svg = c.querySelector("svg")!;
    const tree = c.querySelector(".tree") as HTMLElement;
    for (const s of SKILLS) {
      for (const r of s.requires) {
        const a = SKILL_BY_ID[r];
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        line.setAttribute("x1", String(a.x * 1000));
        line.setAttribute("y1", String(a.y * 620));
        line.setAttribute("x2", String(s.x * 1000));
        line.setAttribute("y2", String(s.y * 620));
        line.dataset.from = r;
        line.dataset.to = s.id;
        svg.append(line);
      }
    }
    const info = c.querySelector(".skill-info") as HTMLElement;
    for (const s of SKILLS) {
      const n = el(
        "button",
        "node",
        `<span class="n-name">${s.name}</span><span class="n-rank"></span>`,
      );
      n.dataset.id = s.id;
      n.style.left = `${s.x * 100}%`;
      n.style.top = `${s.y * 100}%`;
      if (s.effect.kind === "unlock") {
        n.classList.add("unlock-node");
        n.style.setProperty("--c", PALETTE.balls[s.effect.ball]);
      }
      const show = () => {
        const r = this.game.s.skillRanks[s.id] ?? 0;
        info.innerHTML = `<b>${s.name}</b> · ${s.text} · rank ${r}/${s.ranks} · cost ${s.cost} SP${s.requires.length ? ` · needs ${s.requires.map((x) => SKILL_BY_ID[x].name).join(" + ")}` : ""}`;
      };
      n.addEventListener("pointerenter", show);
      n.onclick = () => {
        spring(n);
        if (this.game.buySkill(s.id)) {
          n.classList.add("bought-pop");
          window.setTimeout(() => n.classList.remove("bought-pop"), 600);
        } else this.audio.deny();
        this.renderSkillState();
        show();
      };
      tree.append(n);
    }
    this.open("skills", c, "wide");
    this.renderSkillState();
  }

  private renderSkillState(): void {
    const c = this.modal?.querySelector(".skills");
    if (!c) return;
    const g = this.game;
    (c.querySelector(".sp-left") as HTMLElement).textContent =
      `${g.s.skillPoints} SP`;
    for (const n of c.querySelectorAll<HTMLElement>(".node")) {
      const s = SKILL_BY_ID[n.dataset.id!];
      const r = g.s.skillRanks[s.id] ?? 0;
      n.classList.toggle("owned", r > 0);
      n.classList.toggle("maxed", r >= s.ranks);
      n.classList.toggle(
        "available",
        canBuySkill(s.id, g.s.skillRanks, g.s.skillPoints),
      );
      n.classList.toggle(
        "reachable",
        s.requires.every((x) => (g.s.skillRanks[x] ?? 0) > 0),
      );
      (n.querySelector(".n-rank") as HTMLElement).textContent =
        `${r}/${s.ranks}`;
    }
    for (const l of c.querySelectorAll<SVGLineElement>("line")) {
      const lit =
        (g.s.skillRanks[l.dataset.from!] ?? 0) > 0 &&
        (g.s.skillRanks[l.dataset.to!] ?? 0) > 0;
      l.classList.toggle("lit", lit);
    }
  }
}
