// Tiny procedural sound: wind, carving swish and a few cute blips. No assets needed.

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private carveGain!: GainNode;
  private humGain!: GainNode;
  private noise!: AudioBuffer;
  muted = false;
  /** Automated test browsers and `?silent` URLs never create an audio context, so nothing plays. */
  readonly silent = navigator.webdriver || new URLSearchParams(location.search).has("silent");

  /** Must be called from a user gesture. */
  start() {
    if (this.silent) return;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // slightly pinkish noise
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 6 + (Math.random() * 2 - 1) * 0.3;
    }

    const loop = (filter: BiquadFilterNode, gain: GainNode) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
    };
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop(this.windFilter, this.windGain);

    const carveFilter = ctx.createBiquadFilter();
    carveFilter.type = "bandpass";
    carveFilter.frequency.value = 2400;
    carveFilter.Q.value = 0.7;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    loop(carveFilter, this.carveGain);

    const hum = ctx.createOscillator();
    hum.type = "triangle";
    hum.frequency.value = 55;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    hum.connect(this.humGain).connect(this.master);
    hum.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** Freeze all sound while the game is paused. */
  setPaused(paused: boolean) {
    if (!this.ctx) return;
    void (paused ? this.ctx.suspend() : this.ctx.resume());
  }

  update(speed: number, skid: number, grounded: boolean, onLift: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = Math.min(1, speed / 32);
    this.windGain.gain.setTargetAtTime(onLift ? 0.04 : s * s * 0.5 + 0.015, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + s * 1600, t, 0.1);
    const carve = grounded && !onLift ? Math.min(1, speed / 8) * (0.04 + skid * 0.35) : 0;
    this.carveGain.gain.setTargetAtTime(carve, t, 0.05);
    this.humGain.gain.setTargetAtTime(onLift ? 0.05 : 0, t, 0.3);
  }

  private tone(freq: number, to: number, dur: number, type: OscillatorType = "sine", vol = 0.25, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private burst(dur: number, freq: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(100, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  jump() {
    this.tone(300, 620, 0.18, "sine", 0.18);
  }
  land(impact: number) {
    this.burst(0.25, 900, Math.min(0.6, 0.15 + impact * 0.04));
    this.tone(120, 60, 0.15, "sine", Math.min(0.4, impact * 0.03));
  }
  swing() {
    this.burst(0.45, 2600, 0.35);
  }
  /** Sprung out of a well-timed turn: each carve in a streak rings a step higher. */
  carve(streak = 1) {
    const up = 2 ** (Math.min(streak - 1, 7) / 12 * 2);
    this.tone(660 * up, 990 * up, 0.12, "triangle", 0.12);
    this.tone(990 * up, 1320 * up, 0.16, "triangle", 0.1, 0.06);
  }
  /** The carve glow going out. */
  fizzle() {
    this.burst(0.22, 3200, 0.12);
  }
  crash() {
    this.burst(0.6, 1500, 0.6);
    this.tone(500, 140, 0.45, "triangle", 0.18);
  }
  /** A body part hitting the snow during a fall. */
  thud(impact: number) {
    this.burst(0.18, 700, Math.min(0.35, impact * 0.03));
    this.tone(95, 50, 0.12, "sine", Math.min(0.3, impact * 0.025));
  }
  trick() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.18, "triangle", 0.12, i * 0.07));
  }
  board() {
    this.tone(880, 880, 0.12, "sine", 0.15);
    this.tone(660, 660, 0.2, "sine", 0.15, 0.12);
  }
  best() {
    [659, 784, 988, 1318].forEach((f, i) => this.tone(f, f, 0.25, "square", 0.05, i * 0.09));
  }
}
