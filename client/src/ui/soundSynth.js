// Lightweight, dependency-free Web Audio procedural sound synthesizer
// Generates arcade-style background music and rich procedural sound effects

class SoundSynth {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;

    this.isMuted = localStorage.getItem('flagtag_muted') === 'true';
    const savedVol = localStorage.getItem('flagtag_volume');
    this.volume = savedVol !== null ? parseFloat(savedVol) : 0.7;

    // BGM state
    this.bgmTimer = null;
    this.isBgmPlaying = false;
    this.bgmStep = 0;
    this.bgmFilter = null;

    // Setup global interaction listener to unlock audio autoplay
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.init();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();

        // Master Gain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // BGM Sub-bus (balanced so music doesn't drown out SFX)
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.setValueAtTime(0.24, this.ctx.currentTime);

        // BGM Lowpass Filter for warm arcade timbre
        this.bgmFilter = this.ctx.createBiquadFilter();
        this.bgmFilter.type = 'lowpass';
        this.bgmFilter.frequency.setValueAtTime(1600, this.ctx.currentTime);
        this.bgmGain.connect(this.bgmFilter);
        this.bgmFilter.connect(this.masterGain);

        // SFX Sub-bus
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
        this.sfxGain.connect(this.masterGain);
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    localStorage.setItem('flagtag_volume', this.volume);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    return this.volume;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    localStorage.setItem('flagtag_muted', this.isMuted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.volume, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  // --- BACKGROUND MUSIC GENERATOR ---

  /**
   * Starts looping arcade-style instrumental background music during gameplay.
   */
  startBGM() {
    if (this.isBgmPlaying) return;
    this.init();
    if (!this.ctx) return;

    this.isBgmPlaying = true;
    this.bgmStep = 0;

    // 136 BPM energetic platformer arpeggiator (110ms per 16th note step)
    const stepIntervalMs = 110;

    // Upbeat 4-chord progression: Am -> F -> C -> G
    const chords = [
      // Am (A3, C4, E4, A4)
      [220.00, 261.63, 329.63, 440.00],
      // F (F3, A3, C4, F4)
      [174.61, 220.00, 261.63, 349.23],
      // C (C3, G3, C4, E4)
      [130.81, 196.00, 261.63, 329.63],
      // G (G3, B3, D4, G4)
      [196.00, 246.94, 293.66, 392.00],
    ];

    const bassNotes = [110.00, 87.31, 65.41, 98.00]; // A1, F1, C1, G1

    const playBgmStep = () => {
      if (!this.isBgmPlaying || !this.ctx || this.isMuted) return;

      const chordIdx = Math.floor(this.bgmStep / 8) % chords.length;
      const noteInChord = this.bgmStep % 4;
      const chord = chords[chordIdx];
      const freq = chord[noteInChord];

      // Play lead arpeggio note
      try {
        const osc = this.ctx.createOscillator();
        const noteGain = this.ctx.createGain();

        osc.type = this.bgmStep % 2 === 0 ? 'square' : 'triangle';
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        noteGain.gain.setValueAtTime(0.06, this.ctx.currentTime);
        noteGain.gain.exponentialRampToValueAtTime(0.002, this.ctx.currentTime + 0.09);

        osc.connect(noteGain);
        noteGain.connect(this.bgmGain);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.09);

        // Play bass note on measure downbeats
        if (this.bgmStep % 8 === 0) {
          const bassOsc = this.ctx.createOscillator();
          const bassGain = this.ctx.createGain();

          bassOsc.type = 'triangle';
          bassOsc.frequency.setValueAtTime(bassNotes[chordIdx], this.ctx.currentTime);

          bassGain.gain.setValueAtTime(0.12, this.ctx.currentTime);
          bassGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

          bassOsc.connect(bassGain);
          bassGain.connect(this.bgmGain);

          bassOsc.start();
          bassOsc.stop(this.ctx.currentTime + 0.4);
        }
      } catch {
        // AudioContext may be paused/busy
      }

      this.bgmStep = (this.bgmStep + 1) % 32;
    };

    this.bgmTimer = setInterval(playBgmStep, stepIntervalMs);
  }

  /**
   * Stops background music when match ends or player returns to lobby.
   */
  stopBGM() {
    this.isBgmPlaying = false;
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  // --- PROCEDURAL SOUND EFFECTS ---

  playClick() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playJump() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const t = this.ctx.currentTime;
    const duration = 0.11; // 110ms soft, non-fatiguing duration

    // Soft, light, playful electronic blip / gentle upward swoosh
    // Pure sine oscillator: gentle rise from 240 Hz to 400 Hz without harsh frequencies or piercing highs
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(400, t + 0.07);
    osc.frequency.linearRampToValueAtTime(360, t + duration);

    // Warm lowpass filter to remove any digital edge transients or pops
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(750, t);
    filter.frequency.linearRampToValueAtTime(500, t + duration);
    filter.Q.setValueAtTime(0.8, t);

    // Subtle, gentle volume envelope: 12ms smooth attack, exponential decay (peak gain 0.045)
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.045, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start(t);
    osc.stop(t + duration);
  }

  playSpringBounce() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Resonant spring "boing" launch effect
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(680, this.ctx.currentTime + 0.08);
    osc.frequency.linearRampToValueAtTime(380, this.ctx.currentTime + 0.22);

    gain.gain.setValueAtTime(0.28, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.22);

    osc.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.22);
  }

  playPass() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Crisp, punchy upward tag snap (short 0.08s)
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(750, this.ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  playCountdown(isFinal = false) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const freq = isFinal ? 880 : 440;
    const duration = isFinal ? 0.35 : 0.15;

    osc.type = isFinal ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playPhaseWarning() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Urgent two-tone alert chime (880Hz -> 1100Hz)
    [880, 1100].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + idx * 0.1 + 0.12);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + idx * 0.1);
      osc.stop(this.ctx.currentTime + idx * 0.1 + 0.12);
    });
  }

  playPhaseStart() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Triumphant 4-note ascending fanfare: C5, E5, G5, C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.05);

      gain.gain.setValueAtTime(0.16, this.ctx.currentTime + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + idx * 0.05 + 0.3);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + idx * 0.05);
      osc.stop(this.ctx.currentTime + idx * 0.05 + 0.3);
    });
  }

  playSurgeStart() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Radiant, high-energy golden surge fanfare: G4 -> B4 -> D5 -> G5 -> B5 with bright shimmer
    const notes = [392.00, 493.88, 587.33, 783.99, 987.77];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.04);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + idx * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + idx * 0.04 + 0.35);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + idx * 0.04);
      osc.stop(this.ctx.currentTime + idx * 0.04 + 0.35);
    });
  }

  playSurgeEnd() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Gentle descending chime settling back to normal: D5 -> A4 -> F#4
    const notes = [587.33, 440.00, 369.99];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.08);

      gain.gain.setValueAtTime(0.15, this.ctx.currentTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + idx * 0.08 + 0.22);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + idx * 0.08);
      osc.stop(this.ctx.currentTime + idx * 0.08 + 0.22);
    });
  }

  playGameOver() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    // Descending fanfare
    const freqs = [600, 480, 360, 240];
    freqs.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i * 0.1);

      gain.gain.setValueAtTime(0.2, this.ctx.currentTime + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.1 + 0.2);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + i * 0.1);
      osc.stop(this.ctx.currentTime + i * 0.1 + 0.2);
    });
  }

  playTossSpin(step = 0) {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    const baseFreq = 700 + (step % 5) * 60;
    osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, this.ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.sfxGain || this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }

  playTossWin() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const chord = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5
    chord.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + i * 0.05);

      gain.gain.setValueAtTime(0.18, this.ctx.currentTime + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.005, this.ctx.currentTime + i * 0.05 + 0.45);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.ctx.destination);

      osc.start(this.ctx.currentTime + i * 0.05);
      osc.stop(this.ctx.currentTime + i * 0.05 + 0.45);
    });
  }
}

export const soundSynth = new SoundSynth();
