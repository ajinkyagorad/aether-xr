/**
 * Ambient bed.
 *
 * Generated with Web Audio rather than streamed, for a practical reason: a
 * WebXR immersive session cannot display an `<iframe>`, and both Spotify and
 * YouTube require their own player surface plus DRM. There is no way to embed
 * either *inside* the session. What does work is playing them from another app
 * on the headset — Quest keeps background audio alive across an immersive
 * session — so this bed ducks itself out of the way if it hears the user is
 * already playing something, and can be muted outright from Settings.
 *
 * Each theme gets its own chord, timbre and movement, so the room sounds like
 * the palette looks.
 */

const BEDS = {
  // root, chord (semitones from root), filter sweep centre, movement rate
  aurora: { root: 174.61, chord: [0, 7, 12, 16, 19], cut: 900, rate: 0.045, noise: 0.012, wave: 'triangle' },
  nebula: { root: 110.0, chord: [0, 7, 10, 15, 19], cut: 620, rate: 0.03, noise: 0.02, wave: 'sawtooth' },
  verdant: { root: 146.83, chord: [0, 5, 12, 17, 21], cut: 740, rate: 0.038, noise: 0.03, wave: 'sine' },
  graphite: { root: 98.0, chord: [0, 7, 12, 14, 19], cut: 480, rate: 0.022, noise: 0.016, wave: 'square' },
};

const semi = (root, n) => root * Math.pow(2, n / 12);

export class Ambient {
  constructor() {
    this.ctx = null;
    this.voices = [];
    this.started = false;
    this.themeId = 'nebula';
    this.volume = 0.35;
  }

  /** Must be called from a user gesture — browsers won't start audio otherwise. */
  async start(themeId, volume) {
    if (this.started) return true;
    try {
      const Ctx = window.AudioContext ?? window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      await this.ctx.resume();

      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);

      // Gentle bus compression so overlapping voices never spike.
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -22;
      this.comp.ratio.value = 4;
      this.comp.connect(this.master);

      // A long reverb tail built from decaying noise — turns the pad into a room.
      this.verb = this.ctx.createConvolver();
      this.verb.buffer = this.impulse(3.4, 2.6);
      this.verbGain = this.ctx.createGain();
      this.verbGain.gain.value = 0.55;
      this.verb.connect(this.verbGain).connect(this.comp);

      this.started = true;
      this.setTheme(themeId);
      this.setVolume(volume);
      return true;
    } catch {
      this.started = false;
      return false;
    }
  }

  impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** Rebuild the voice stack for a theme, crossfading out the old one. */
  setTheme(themeId) {
    this.themeId = themeId;
    if (!this.started) return;
    const spec = BEDS[themeId] ?? BEDS.nebula;
    const now = this.ctx.currentTime;

    for (const v of this.voices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0, now, 0.9);
      v.osc.stop(now + 4);
      if (v.lfo) v.lfo.stop(now + 4);
    }
    this.voices = [];

    spec.chord.forEach((n, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = spec.wave;
      osc.frequency.value = semi(spec.root, n);
      // A few cents of detune per voice keeps the chord from sounding synthetic.
      osc.detune.value = (i - spec.chord.length / 2) * 4;

      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = spec.cut * (1 + i * 0.18);
      filt.Q.value = 0.7;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      // Slow independent swell per voice — nothing ever lands in phase.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = spec.rate * (1 + i * 0.37);
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.5 / spec.chord.length;
      lfo.connect(lfoGain).connect(gain.gain);

      osc.connect(filt).connect(gain);
      gain.connect(this.comp);
      gain.connect(this.verb);
      osc.start();
      lfo.start();
      gain.gain.setTargetAtTime(0.55 / spec.chord.length, this.ctx.currentTime, 2.5);

      this.voices.push({ osc, gain, filt, lfo });
    });

    // Air: filtered noise standing in for wind through the space.
    if (this.noiseSrc) { try { this.noiseSrc.stop(); } catch {} }
    const nb = this.ctx.createBuffer(1, this.ctx.sampleRate * 4, this.ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 620;
    nf.Q.value = 0.5;
    const ng = this.ctx.createGain();
    ng.gain.value = spec.noise;
    src.connect(nf).connect(ng).connect(this.verb);
    src.start();
    this.noiseSrc = src;
  }

  setVolume(v) {
    this.volume = v;
    if (!this.started) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  stop() {
    if (!this.started) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
  }

  resume() {
    if (!this.started) return;
    this.ctx.resume();
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.6);
  }
}
