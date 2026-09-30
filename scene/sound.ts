// Small synthesised sound pack. Off by default. Nothing loads from the network.

export class SoundPack {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private room: AudioBufferSourceNode | null = null;
  private roomGain: GainNode | null = null;
  private keysAt = 0;
  enabled = false;

  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.startRoomTone();
    else this.stopRoomTone();
  }

  private startRoomTone() {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.room) return;
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // brown noise, soft
      data[i] = last * 3.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 320;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.room = src;
    this.roomGain = gain;
  }

  private stopRoomTone() {
    this.room?.stop();
    this.room?.disconnect();
    this.room = null;
    this.roomGain = null;
  }

  private tone(freq: number, ms: number, gainValue = 0.12, type: OscillatorType = "sine", delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.enabled) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t0 = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainValue, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + ms / 1000);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  // Keyboard clicks scale with how many workers are typing.
  keys(activeWorkers: number, now: number) {
    if (!this.enabled || activeWorkers <= 0) return;
    const interval = Math.max(70, 420 / activeWorkers);
    if (now < this.keysAt) return;
    this.keysAt = now + interval * (0.6 + Math.random() * 0.8);
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.012), ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.05 + Math.random() * 0.04;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800 + Math.random() * 1200;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  liftChime() {
    this.tone(880, 260, 0.08);
    this.tone(1175, 420, 0.07, "sine", 0.18);
  }

  coinClink() {
    this.tone(2400, 90, 0.06, "triangle");
    this.tone(3200, 160, 0.05, "triangle", 0.05);
  }

  // The Run the Tower now bell: a two tone office chime.
  bell() {
    this.tone(659, 380, 0.09, "triangle");
    this.tone(523, 620, 0.09, "triangle", 0.28);
  }

  fanfare() {
    this.tone(523, 180, 0.08, "triangle");
    this.tone(659, 180, 0.08, "triangle", 0.16);
    this.tone(784, 340, 0.09, "triangle", 0.32);
  }
}
