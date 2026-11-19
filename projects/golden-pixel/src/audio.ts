// Layered WebAudio sound: every effect is synthesized, with random pitch so repeats never sound identical.

type Cat = "hit" | "break" | "wall" | "zap" | "boom" | "coin" | "ui";
const LIMIT: Record<Cat, number> = {
  hit: 6,
  break: 6,
  wall: 2,
  zap: 3,
  boom: 3,
  coin: 2,
  ui: 4,
};

export class SoundEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private window: Record<Cat, number> = {
    hit: 0,
    break: 0,
    wall: 0,
    zap: 0,
    boom: 0,
    coin: 0,
    ui: 0,
  };
  private windowStart = 0;
  private nextNote = 0;
  private step = 0;
  private timer = 0;
  beatAt = -10;
  soundVolume = 0.7;
  musicVolume = 0.45;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.soundVolume, this.musicVolume);
    this.nextNote = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  setVolumes(sound: number, music: number): void {
    this.soundVolume = sound;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sound * 0.8, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 0.35, this.ctx.currentTime, 0.2);
  }

  private allow(cat: Cat): boolean {
    if (!this.ctx || this.soundVolume <= 0) return false;
    const now = this.ctx.currentTime;
    if (now - this.windowStart > 0.05) {
      this.windowStart = now;
      for (const k in this.window) this.window[k as Cat] = 0;
    }
    if (this.window[cat] >= LIMIT[cat]) return false;
    this.window[cat]++;
    return true;
  }

  private vary(f: number, amount = 0.08): number {
    return f * (1 + (Math.random() * 2 - 1) * amount);
  }

  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    vol: number,
    bus: AudioNode,
    at = 0,
    slideTo?: number,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(
    dur: number,
    vol: number,
    filter: BiquadFilterType,
    freq: number,
    bus: AudioNode,
    at = 0,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  hit(tier: number, crit: boolean): void {
    if (!this.allow("hit")) return;
    this.tone("triangle", this.vary(520 + tier * 90), 0.05, 0.05, this.sfx);
    if (crit) this.tone("square", this.vary(1400), 0.06, 0.03, this.sfx);
  }

  brk(tier: number): void {
    if (!this.allow("break")) return;
    this.burst(
      0.08 + tier * 0.02,
      0.12,
      "bandpass",
      this.vary(2400 - tier * 300, 0.2),
      this.sfx,
      0,
      1.5,
    );
    this.tone(
      "square",
      this.vary(880 - tier * 110),
      0.07,
      0.035,
      this.sfx,
      0,
      this.vary(440 - tier * 50),
    );
  }

  wall(): void {
    if (!this.allow("wall")) return;
    this.tone("sine", this.vary(180, 0.15), 0.05, 0.03, this.sfx);
  }

  zap(): void {
    if (!this.allow("zap")) return;
    this.burst(0.12, 0.09, "highpass", 3000, this.sfx);
    this.tone(
      "sawtooth",
      this.vary(1600, 0.2),
      0.1,
      0.03,
      this.sfx,
      0,
      this.vary(300),
    );
  }

  boom(size: number): void {
    if (!this.allow("boom")) return;
    this.burst(0.25 + size * 0.05, 0.25, "lowpass", 900, this.sfx);
    this.tone("sine", this.vary(140), 0.25, 0.2, this.sfx, 0, 40);
  }

  coin(): void {
    if (!this.allow("coin")) return;
    this.tone("square", this.vary(1320, 0.03), 0.06, 0.04, this.sfx);
    this.tone("square", this.vary(1760, 0.03), 0.12, 0.04, this.sfx, 0.05);
  }

  chaChing(): void {
    if (!this.ctx) return;
    this.burst(0.1, 0.12, "highpass", 5000, this.sfx);
    [1568, 2093, 2637, 3136].forEach((f, i) =>
      this.tone("triangle", f, 0.35, 0.08, this.sfx, 0.06 + i * 0.05),
    );
  }

  click(): void {
    if (!this.allow("ui")) return;
    this.tone("square", this.vary(660, 0.04), 0.03, 0.04, this.sfx);
  }

  buy(): void {
    if (!this.allow("ui")) return;
    [523, 659, 784].forEach((f, i) =>
      this.tone("square", this.vary(f, 0.01), 0.08, 0.04, this.sfx, i * 0.04),
    );
  }

  deny(): void {
    if (!this.allow("ui")) return;
    this.tone("square", 160, 0.12, 0.04, this.sfx, 0, 110);
  }

  levelUp(): void {
    if (!this.ctx) return;
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
      this.tone("square", f, 0.18, 0.05, this.sfx, i * 0.07);
      this.tone("triangle", f / 2, 0.3, 0.06, this.sfx, i * 0.07);
    });
    this.burst(0.8, 0.08, "highpass", 6000, this.sfx, 0.4);
  }

  unlockSfx(): void {
    if (!this.ctx) return;
    [392, 523, 784, 1047].forEach((f, i) =>
      this.tone("triangle", f, 0.25, 0.07, this.sfx, i * 0.06),
    );
  }

  combo(n: number): void {
    if (!this.ctx) return;
    const base = 660 * Math.pow(2, Math.min(4, Math.log2(n / 25)) / 4);
    [1, 1.25, 1.5].forEach((m, i) =>
      this.tone("square", base * m, 0.1, 0.04, this.sfx, i * 0.04),
    );
  }

  // ---------- music: A minor loop, i-VI-III-VII ----------
  private static CHORDS = [
    [57, 60, 64],
    [53, 57, 60],
    [48, 52, 55],
    [55, 59, 62],
  ];

  private midi(n: number): number {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const sixteenth = 60 / 104 / 4;
    while (this.nextNote < ctx.currentTime + 0.12) {
      const at = this.nextNote - ctx.currentTime;
      const s = this.step % 64;
      const chord = SoundEngine.CHORDS[Math.floor(s / 16)];
      if (this.musicVolume > 0) {
        if (s % 4 === 0) {
          this.tone("sine", 110, 0.18, 0.5, this.musicBus, at, 45);
          window.setTimeout(
            () => (this.beatAt = performance.now()),
            Math.max(0, at * 1000),
          );
        }
        if (s % 4 === 2)
          this.burst(0.03, 0.08, "highpass", 8000, this.musicBus, at);
        if (s % 2 === 0)
          this.tone(
            "triangle",
            this.midi(chord[0] - 24),
            sixteenth * 1.8,
            0.22,
            this.musicBus,
            at,
          );
        const arp = [0, 1, 2, 1, 2, 0, 1, 2][s % 8];
        this.tone(
          "square",
          this.midi(chord[arp] + 12),
          sixteenth * 0.9,
          0.035,
          this.musicBus,
          at,
        );
        if (s % 16 === 0)
          for (const n of chord)
            this.tone(
              "sawtooth",
              this.midi(n),
              sixteenth * 15,
              0.012,
              this.musicBus,
              at,
            );
      }
      this.nextNote += sixteenth;
      this.step++;
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}
