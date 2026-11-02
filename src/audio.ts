// =====================================================================
// audio.ts — Procedural Audio Engine for Vandal & Kill-Streak Cues
// =====================================================================
// Original procedural sound synthesis using Web Audio API.
// No external, extracted, or copyrighted game audio assets are used.

import type { SoundProfileId } from './soundProfiles';
import {
  getSoundProfile,
  DEFAULT_SOUND_PROFILE_ID,
} from './soundProfiles';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGainNode: GainNode | null = null;

  private masterVolume = 0.6;
  private sfxVolume = 0.8;
  private muted = false;

  private activeProfileId: SoundProfileId = DEFAULT_SOUND_PROFILE_ID;
  private killStreakAudioEnabled = true;
  private ready = false;
  private activePanners = new Set<PannerNode>();

  // Cached noise buffer pool per sound profile (4 distinct buffers per profile for natural shot variation)
  private gunshotNoiseCache = new Map<SoundProfileId, AudioBuffer[]>();
  private gunshotBufferIndex = 0;

  init(): void {
    try {
      const AudioCtx = typeof window !== 'undefined'
        ? (window.AudioContext || (window as any).webkitAudioContext)
        : (typeof AudioContext !== 'undefined' ? AudioContext : null);

      if (!AudioCtx) {
        return;
      }

      if (!this.ctx) {
        this.ctx = new AudioCtx();
        if (this.ctx && typeof this.ctx.createGain === 'function') {
          this.masterGainNode = this.ctx.createGain();
          this.updateMasterGain();
          if (this.ctx.destination) {
            this.masterGainNode.connect(this.ctx.destination);
          }
        }
      }

      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.ready = true;
    } catch {
      // AudioContext unavailable or autoplay-blocked
    }
  }

  isReady(): boolean {
    return this.ready && this.ctx !== null && this.ctx.state === 'running';
  }

  getContextState(): string {
    if (!this.ctx) return 'unavailable';
    return this.ctx.state;
  }

  // ── Volume & Configuration ──────────────────────────────────────────

  getEffectiveVolume(): number {
    if (this.muted) return 0;
    return Math.max(0, Math.min(1.0, this.masterVolume * this.sfxVolume));
  }

  private updateMasterGain(): void {
    if (!this.ctx || !this.masterGainNode) return;
    try {
      const eff = this.getEffectiveVolume();
      const now = this.ctx.currentTime;
      if (this.masterGainNode.gain.cancelScheduledValues) {
        this.masterGainNode.gain.cancelScheduledValues(now);
      }
      this.masterGainNode.gain.setValueAtTime(eff, now);
    } catch { /* ignore in non-standard audio test environments */ }
  }

  setVolume(v: number): void {
    // Legacy alias to setMasterVolume
    this.setMasterVolume(v);
  }

  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1.0, v));
    this.updateMasterGain();
  }

  getMasterVolume(): number {
    return this.masterVolume;
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1.0, v));
    this.updateMasterGain();
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  setMuted(m: boolean): void {
    this.muted = !!m;
    this.updateMasterGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setSoundProfile(id: SoundProfileId): void {
    this.activeProfileId = id;
  }

  getSoundProfileId(): SoundProfileId {
    return this.activeProfileId;
  }

  setKillStreakAudioEnabled(enabled: boolean): void {
    this.killStreakAudioEnabled = !!enabled;
  }

  isKillStreakAudioEnabled(): boolean {
    return this.killStreakAudioEnabled;
  }

  // ── Destination & Spatial Helper ────────────────────────────────────

  private getDestination(position?: { x: number; y: number; z: number }): AudioNode | null {
    if (!this.ctx) return null;
    const finalTarget: AudioNode = this.masterGainNode || this.ctx.destination;

    if (position && typeof this.ctx.createPanner === 'function') {
      try {
        const panner = this.ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 3;
        panner.maxDistance = 30;
        panner.rolloffFactor = 1;
        const now = this.ctx.currentTime;

        if (panner.positionX) {
          panner.positionX.setValueAtTime(position.x, now);
          panner.positionY.setValueAtTime(position.y, now);
          panner.positionZ.setValueAtTime(position.z, now);
        } else if ((panner as any).setPosition) {
          (panner as any).setPosition(position.x, position.y, position.z);
        }
        panner.connect(finalTarget);
        this.activePanners.add(panner);
        return panner;
      } catch {
        return finalTarget;
      }
    }

    return finalTarget;
  }

  private cleanupDestination(dest: AudioNode | null, delayMs = 0): void {
    if (!dest || dest === this.masterGainNode || (this.ctx && dest === this.ctx.destination)) {
      return;
    }
    const disconnectFn = () => {
      try {
        (dest as any).disconnect();
      } catch {}
      this.activePanners.delete(dest as any);
    };

    if (delayMs > 0) {
      setTimeout(disconnectFn, delayMs);
    } else {
      disconnectFn();
    }
  }

  // ── Procedural Sound Synthesis ──────────────────────────────────────

  private getGunshotNoiseBuffer(profileId: SoundProfileId): AudioBuffer | null {
    if (!this.ctx) return null;
    let pool = this.gunshotNoiseCache.get(profileId);
    if (!pool || pool.length === 0) {
      pool = [];
      const profile = getSoundProfile(profileId);
      const g = profile.gunshot;
      const bufLen = Math.max(128, Math.floor(this.ctx.sampleRate * g.noiseDuration));
      const poolSize = 4;
      for (let p = 0; p < poolSize; p++) {
        const buf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * g.noiseDecay));
        }
        pool.push(buf);
      }
      this.gunshotNoiseCache.set(profileId, pool);
    }
    this.gunshotBufferIndex = (this.gunshotBufferIndex + 1) % pool.length;
    return pool[this.gunshotBufferIndex];
  }

  /**
   * Procedural Vandal Gunshot:
   * Layer 1: Filtered burst of noise (body rumble + acoustic air displacement)
   * Layer 2: Pitch-swept high frequency crack / transient snap
   * Layer 3: Sub-bass resonance thump
   */
  playGunshot(profileId?: SoundProfileId): void {
    if (!this.ready || !this.ctx || this.getEffectiveVolume() <= 0.0001) return;
    const effectiveProfileId = profileId || this.activeProfileId;
    const profile = getSoundProfile(effectiveProfileId);
    const now = this.ctx.currentTime;
    const targetDest = this.getDestination();
    if (!targetDest) return;

    try {
      // 1. Noise body from cached multi-buffer pool (preserves acoustic variance with zero per-shot allocations)
      const g = profile.gunshot;
      const cachedBuf = this.getGunshotNoiseBuffer(effectiveProfileId);
      if (!cachedBuf) return;

      const noiseSrc = this.ctx.createBufferSource();
      noiseSrc.buffer = cachedBuf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(g.filterCutoff, now);
      if (g.filterQ) filter.Q.setValueAtTime(g.filterQ, now);

      const noiseGain = this.ctx.createGain();
      noiseGain.gain.setValueAtTime(0.55, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + g.noiseDuration);

      noiseSrc.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(targetDest);
      noiseSrc.start(now);

      // Clean up noise source safely
      noiseSrc.onended = () => {
        try {
          noiseSrc.disconnect();
          filter.disconnect();
          noiseGain.disconnect();
        } catch {}
      };

      // 2. High-frequency crack transient
      const crackOsc = this.ctx.createOscillator();
      crackOsc.type = g.crackWave;
      crackOsc.frequency.setValueAtTime(g.crackFreqStart, now);
      crackOsc.frequency.exponentialRampToValueAtTime(Math.max(20, g.crackFreqEnd), now + g.crackDuration);

      const crackGain = this.ctx.createGain();
      crackGain.gain.setValueAtTime(0.24, now);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, now + g.crackDuration + 0.01);

      crackOsc.connect(crackGain);
      crackGain.connect(targetDest);
      crackOsc.start(now);
      crackOsc.stop(now + g.crackDuration + 0.02);

      crackOsc.onended = () => {
        try {
          crackOsc.disconnect();
          crackGain.disconnect();
        } catch {}
      };

      // 3. Sub-bass thump (optional body anchor)
      if (g.bodySubFreq) {
        const subOsc = this.ctx.createOscillator();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(g.bodySubFreq, now);
        subOsc.frequency.exponentialRampToValueAtTime(30, now + 0.09);

        const subGain = this.ctx.createGain();
        subGain.gain.setValueAtTime(0.25, now);
        subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

        subOsc.connect(subGain);
        subGain.connect(targetDest);
        subOsc.start(now);
        subOsc.stop(now + 0.11);

        subOsc.onended = () => {
          try {
            subOsc.disconnect();
            subGain.disconnect();
          } catch {}
        };
      }
    } catch {}
  }

  /**
   * Hit confirmation sound (non-kill hit or headshot hit).
   */
  playHit(
    headshot = false,
    position?: { x: number; y: number; z: number },
    profileId?: SoundProfileId
  ): void {
    if (!this.ready || !this.ctx || this.getEffectiveVolume() <= 0.0001) return;
    const profile = getSoundProfile(profileId || this.activeProfileId);
    const dest = this.getDestination(position);
    if (!dest) return;

    try {
      const now = this.ctx.currentTime;
      const h = profile.hit;
      const freq = headshot ? h.headshotFreq : h.torsoFreq;
      const wave = headshot ? h.headshotWave : h.torsoWave;
      const dur = headshot ? h.headshotDuration : h.torsoDuration;
      const vol = headshot ? 0.22 : 0.16;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(now);
      osc.stop(now + dur + 0.01);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      // Shimmering second harmonic for headshot
      if (headshot && h.headshotHarmonicFreq) {
        const hOsc = this.ctx.createOscillator();
        const hGain = this.ctx.createGain();
        hOsc.type = 'sine';
        hOsc.frequency.setValueAtTime(h.headshotHarmonicFreq, now);
        hGain.gain.setValueAtTime(vol * 0.45, now);
        hGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        hOsc.connect(hGain);
        hGain.connect(dest);
        hOsc.start(now);
        hOsc.stop(now + dur + 0.01);

        hOsc.onended = () => {
          try {
            hOsc.disconnect();
            hGain.disconnect();
          } catch {}
        };
      }

      this.cleanupDestination(dest, Math.ceil((dur + 0.1) * 1000));
    } catch {}
  }

  /**
   * Confirmed target elimination kill sound with ascending kill-streak progression cues.
   * Stage 1: 1 kill
   * Stage 2: 2 kills
   * Stage 3: 3 kills
   * Stage 4: 4 kills
   * Stage 5+: 5 or more kills (Ace chord)
   */
  playKill(
    streak = 1,
    headshot = false,
    position?: { x: number; y: number; z: number },
    profileId?: SoundProfileId
  ): void {
    if (!this.ready || !this.ctx || this.getEffectiveVolume() <= 0.0001) return;
    const profile = getSoundProfile(profileId || this.activeProfileId);
    const dest = this.getDestination(position);
    if (!dest) return;

    try {
      const now = this.ctx.currentTime;
      const k = profile.kill;
      const safeStreak = Math.max(1, Math.floor(streak));
      // Clamp stage index between 0 and 4 (Stages 1..5+)
      const stageIdx = this.killStreakAudioEnabled
        ? Math.min(safeStreak - 1, k.streakStages.length - 1)
        : 0;

      const stageInfo = k.streakStages[stageIdx] || k.streakStages[0];
      const freqs = stageInfo.frequencies;
      const dur = k.duration + (stageIdx >= 4 ? 0.12 : 0);

      // Play harmonic tones for this kill stage
      freqs.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = k.baseWave;
        osc.frequency.setValueAtTime(freq, now);

        // Balance chord volumes so multi-tone chords don't clip
        const chordFactor = 1 / Math.sqrt(freqs.length);
        const baseVol = (0.24 * chordFactor) * (idx === 0 ? 1.0 : 0.7);

        gain.gain.setValueAtTime(baseVol, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(gain);
        gain.connect(dest);
        osc.start(now);
        osc.stop(now + dur + 0.01);

        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        };
      });

      // Distinct headshot resonance if kill was a headshot
      if (headshot && profile.hit.headshotHarmonicFreq) {
        const sparkOsc = this.ctx.createOscillator();
        const sparkGain = this.ctx.createGain();
        sparkOsc.type = 'triangle';
        sparkOsc.frequency.setValueAtTime(profile.hit.headshotHarmonicFreq * 1.25, now);
        sparkGain.gain.setValueAtTime(0.12, now);
        sparkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

        sparkOsc.connect(sparkGain);
        sparkGain.connect(dest);
        sparkOsc.start(now);
        sparkOsc.stop(now + 0.13);

        sparkOsc.onended = () => {
          try {
            sparkOsc.disconnect();
            sparkGain.disconnect();
          } catch {}
        };
      }

      this.cleanupDestination(dest, Math.ceil((dur + 0.1) * 1000));
    } catch {}
  }

  // ── Sound Preview APIs (Does not affect gameplay state) ─────────────

  previewGunshot(profileId: SoundProfileId): void {
    this.init();
    this.resume();
    this.playGunshot(profileId);
  }

  previewHit(profileId: SoundProfileId, headshot: boolean): void {
    this.init();
    this.resume();
    this.playHit(headshot, undefined, profileId);
  }

  previewKill(profileId: SoundProfileId, stage = 1): void {
    this.init();
    this.resume();
    this.playKill(stage, false, undefined, profileId);
  }

  // ── Existing General Feedback Sounds ────────────────────────────────

  playMiss(): void {
    this._beep(180, 0.05, 'sawtooth', 0.08);
  }

  playFlash(): void {
    this._noise(0.3, 0.6);
  }

  playSpawn(position?: { x: number; y: number; z: number }): void {
    this._beep(440, 0.03, 'sine', 0.07, position);
  }

  playPB(): void {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => this._beep(f, 0.12, 'sine', 0.25), i * 90);
    });
  }

  playStart(): void {
    this._beep(660, 0.08, 'sine', 0.2);
  }

  playEnd(): void {
    this._beep(330, 0.2, 'sine', 0.2);
  }

  // ── Private synthesis utilities ─────────────────────────────────────

  private _beep(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    vol: number = 0.1,
    position?: { x: number; y: number; z: number }
  ): void {
    if (!this.ready || !this.ctx || this.getEffectiveVolume() <= 0.0001) return;
    try {
      const dest = this.getDestination(position);
      if (!dest) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(dest);

      osc.start();
      osc.stop(this.ctx.currentTime + dur + 0.01);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };

      this.cleanupDestination(dest, Math.ceil((dur + 0.1) * 1000));
    } catch {}
  }

  private _noise(dur: number, vol: number): void {
    if (!this.ready || !this.ctx || this.getEffectiveVolume() <= 0.0001) return;
    try {
      const dest = this.getDestination();
      if (!dest) return;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src  = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 800;
      src.buffer = buf;
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      src.connect(filt);
      filt.connect(gain);
      gain.connect(dest);
      src.start();

      src.onended = () => {
        try {
          src.disconnect();
          filt.disconnect();
          gain.disconnect();
        } catch {}
      };

      this.cleanupDestination(dest, Math.ceil((dur + 0.1) * 1000));
    } catch {}
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  dispose(): void {
    this.gunshotNoiseCache.clear();
    for (const panner of this.activePanners) {
      try { panner.disconnect(); } catch {}
    }
    this.activePanners.clear();
    if (this.masterGainNode) {
      try { this.masterGainNode.disconnect(); } catch {}
      this.masterGainNode = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.ready = false;
  }
}
