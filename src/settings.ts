// =====================================================================
// settings.ts — Persistent settings via localStorage
// =====================================================================

import { LS_SETTINGS } from './constants';
import type { Settings } from './types';
import { isValidSoundProfileId, DEFAULT_SOUND_PROFILE_ID } from './soundProfiles';

const DEFAULTS: Settings = {
  sensitivity:            0.12,
  fov:                    103,
  crosshairColor:         '#00ff78',
  crosshairSize:          9,
  crosshairGap:           5,
  crosshairThickness:     2,
  crosshairDot:           false,
  volume:                 0.6,
  sfxVolume:              0.8,
  audioMuted:             false,
  soundProfile:           DEFAULT_SOUND_PROFILE_ID,
  killStreakAudioEnabled: true,
  flashIntensity:         0.85,
  reducedEffects:         false,
  highContrast:           false,
  showFps:                true,
  showHitNumbers:         true,
  invertY:                false,
};

export class SettingsManager {
  private data: Settings;

  constructor() {
    this.data = this.load();
  }

  private load(): Settings {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        return this.sanitize(parsed);
      }
    } catch { /* ignore corrupted JSON */ }
    return { ...DEFAULTS };
  }

  private sanitize(input: Partial<Settings>): Settings {
    const s: Settings = { ...DEFAULTS, ...input };

    // Numerical bounds
    s.sensitivity = (typeof s.sensitivity === 'number' && Number.isFinite(s.sensitivity))
      ? Math.max(0.01, Math.min(2.0, s.sensitivity)) : DEFAULTS.sensitivity;

    s.fov = (typeof s.fov === 'number' && Number.isFinite(s.fov))
      ? Math.max(60, Math.min(130, Math.round(s.fov))) : DEFAULTS.fov;

    s.volume = (typeof s.volume === 'number' && Number.isFinite(s.volume))
      ? Math.max(0, Math.min(1.0, s.volume)) : DEFAULTS.volume;

    s.sfxVolume = (typeof s.sfxVolume === 'number' && Number.isFinite(s.sfxVolume))
      ? Math.max(0, Math.min(1.0, s.sfxVolume)) : DEFAULTS.sfxVolume;

    s.flashIntensity = (typeof s.flashIntensity === 'number' && Number.isFinite(s.flashIntensity))
      ? Math.max(0, Math.min(1.0, s.flashIntensity)) : DEFAULTS.flashIntensity;

    // Crosshair numerical bounds
    s.crosshairSize = (typeof s.crosshairSize === 'number' && Number.isFinite(s.crosshairSize))
      ? Math.max(1, Math.min(30, Math.round(s.crosshairSize))) : DEFAULTS.crosshairSize;

    s.crosshairGap = (typeof s.crosshairGap === 'number' && Number.isFinite(s.crosshairGap))
      ? Math.max(0, Math.min(20, Math.round(s.crosshairGap))) : DEFAULTS.crosshairGap;

    s.crosshairThickness = (typeof s.crosshairThickness === 'number' && Number.isFinite(s.crosshairThickness))
      ? Math.max(1, Math.min(10, Math.round(s.crosshairThickness))) : DEFAULTS.crosshairThickness;

    // Crosshair color (hex color validation)
    if (typeof s.crosshairColor !== 'string' || !/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(s.crosshairColor.trim())) {
      s.crosshairColor = DEFAULTS.crosshairColor;
    } else {
      s.crosshairColor = s.crosshairColor.trim();
    }

    // Booleans
    s.audioMuted = typeof s.audioMuted === 'boolean' ? s.audioMuted : DEFAULTS.audioMuted;
    s.killStreakAudioEnabled = typeof s.killStreakAudioEnabled === 'boolean'
      ? s.killStreakAudioEnabled : DEFAULTS.killStreakAudioEnabled;
    s.crosshairDot = typeof s.crosshairDot === 'boolean' ? s.crosshairDot : DEFAULTS.crosshairDot;
    s.showFps = typeof s.showFps === 'boolean' ? s.showFps : DEFAULTS.showFps;
    s.invertY = typeof s.invertY === 'boolean' ? s.invertY : DEFAULTS.invertY;
    s.showHitNumbers = typeof s.showHitNumbers === 'boolean' ? s.showHitNumbers : DEFAULTS.showHitNumbers;
    s.reducedEffects = typeof s.reducedEffects === 'boolean' ? s.reducedEffects : DEFAULTS.reducedEffects;
    s.highContrast = typeof s.highContrast === 'boolean' ? s.highContrast : DEFAULTS.highContrast;

    // Profile ID
    if (!isValidSoundProfileId(s.soundProfile)) {
      s.soundProfile = DEFAULT_SOUND_PROFILE_ID;
    }

    return s;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.data[key] = value;
    this.save();
  }

  getAll(): Readonly<Settings> {
    return { ...this.data };
  }

  reset(): void {
    this.data = { ...DEFAULTS };
    this.save();
  }

  resetAudio(): void {
    this.data.volume = DEFAULTS.volume;
    this.data.sfxVolume = DEFAULTS.sfxVolume;
    this.data.audioMuted = DEFAULTS.audioMuted;
    this.data.soundProfile = DEFAULTS.soundProfile;
    this.data.killStreakAudioEnabled = DEFAULTS.killStreakAudioEnabled;
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(this.data));
    } catch { /* quota exceeded — ignore */ }
  }
}
