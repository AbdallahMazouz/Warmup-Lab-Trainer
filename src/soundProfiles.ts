// =====================================================================
// soundProfiles.ts — Typed Sound Profiles for Vandal Procedural Audio
// =====================================================================
// All sound designs are original procedural syntheses generated via Web Audio API.
// No extracted, ripped, or official Valorant assets are used.
// Profiles provide distinct acoustic timbres (attack, body, harmonics, decay)
// and ascending harmonic stages for kill-streak confirmations.

export type SoundProfileId =
  | 'classic'
  | 'cyber-pulse'
  | 'shadow-flame'
  | 'neo-arcade'
  | 'celestial-brass';

export interface SoundProfile {
  id: SoundProfileId;
  name: string;
  badgeLabel: string;
  shortDescription: string;
  designNotes: string;

  // Gunshot procedural parameters
  gunshot: {
    noiseDuration: number;
    noiseDecay: number;
    filterCutoff: number;
    filterQ?: number;
    crackFreqStart: number;
    crackFreqEnd: number;
    crackDuration: number;
    crackWave: OscillatorType;
    bodySubFreq?: number;
  };

  // Hit confirmation parameters
  hit: {
    torsoFreq: number;
    torsoWave: OscillatorType;
    torsoDuration: number;
    headshotFreq: number;
    headshotHarmonicFreq?: number;
    headshotWave: OscillatorType;
    headshotDuration: number;
  };

  // Kill confirmation parameters
  kill: {
    baseWave: OscillatorType;
    duration: number;
    // Ascending harmonic root notes for streak stages 1, 2, 3, 4, 5+
    streakStages: {
      stage: number;
      frequencies: number[];
      label: string;
    }[];
  };
}

export const SOUND_PROFILES: Record<SoundProfileId, SoundProfile> = {
  'classic': {
    id: 'classic',
    name: 'Standard Issue (Classic)',
    badgeLabel: 'TACTICAL BASELINE',
    shortDescription: 'Crisp mechanical transient, resonant low-end thump, and sharp metallic hit confirmations.',
    designNotes: 'Original procedural tactical assault rifle synthesis. Emphasizes clean mechanical punch and clear spatial feedback.',
    gunshot: {
      noiseDuration: 0.18,
      noiseDecay: 0.08,
      filterCutoff: 420,
      crackFreqStart: 3200,
      crackFreqEnd: 200,
      crackDuration: 0.045,
      crackWave: 'sawtooth',
      bodySubFreq: 95,
    },
    hit: {
      torsoFreq: 880,
      torsoWave: 'sine',
      torsoDuration: 0.07,
      headshotFreq: 1320,
      headshotHarmonicFreq: 1760,
      headshotWave: 'square',
      headshotDuration: 0.065,
    },
    kill: {
      baseWave: 'sine',
      duration: 0.28,
      streakStages: [
        { stage: 1, frequencies: [523.25], label: 'Stage 1 (1 Kill)' },
        { stage: 2, frequencies: [659.25], label: 'Stage 2 (2 Kills)' },
        { stage: 3, frequencies: [783.99], label: 'Stage 3 (3 Kills)' },
        { stage: 4, frequencies: [987.77], label: 'Stage 4 (4 Kills)' },
        { stage: 5, frequencies: [1046.50, 1318.51, 1567.98], label: 'Stage 5+ (Ace / 5+ Kills)' },
      ],
    },
  },

  'cyber-pulse': {
    id: 'cyber-pulse',
    name: 'Cyber Pulse (Original)',
    badgeLabel: 'SYNTHETIC ENERGY',
    shortDescription: 'High-tech laser crack, bandpass energy pop, and crisp digital telemetry chimes.',
    designNotes: 'Original synthetic energy synthesis with frequency-swept transients and shimmering digital harmonics.',
    gunshot: {
      noiseDuration: 0.14,
      noiseDecay: 0.06,
      filterCutoff: 1100,
      filterQ: 2.5,
      crackFreqStart: 2800,
      crackFreqEnd: 350,
      crackDuration: 0.04,
      crackWave: 'triangle',
      bodySubFreq: 120,
    },
    hit: {
      torsoFreq: 950,
      torsoWave: 'triangle',
      torsoDuration: 0.06,
      headshotFreq: 1580,
      headshotHarmonicFreq: 2100,
      headshotWave: 'sine',
      headshotDuration: 0.07,
    },
    kill: {
      baseWave: 'triangle',
      duration: 0.32,
      streakStages: [
        { stage: 1, frequencies: [587.33], label: 'Stage 1 (1 Kill)' },
        { stage: 2, frequencies: [739.99], label: 'Stage 2 (2 Kills)' },
        { stage: 3, frequencies: [880.00], label: 'Stage 3 (3 Kills)' },
        { stage: 4, frequencies: [1174.66], label: 'Stage 4 (4 Kills)' },
        { stage: 5, frequencies: [1174.66, 1479.98, 1760.00], label: 'Stage 5+ (Ace / 5+ Kills)' },
      ],
    },
  },

  'shadow-flame': {
    id: 'shadow-flame',
    name: 'Shadow Flame (Original)',
    badgeLabel: 'DARK HARMONICS',
    shortDescription: 'Deep sub-bass rumble, heavy gravelly punch, and spectral bell confirmation tones.',
    designNotes: 'Original dark acoustic synthesis utilizing sub-bass sine drop and minor third bell resonance overtones.',
    gunshot: {
      noiseDuration: 0.22,
      noiseDecay: 0.10,
      filterCutoff: 340,
      crackFreqStart: 1800,
      crackFreqEnd: 90,
      crackDuration: 0.055,
      crackWave: 'sawtooth',
      bodySubFreq: 65,
    },
    hit: {
      torsoFreq: 520,
      torsoWave: 'sawtooth',
      torsoDuration: 0.07,
      headshotFreq: 880,
      headshotHarmonicFreq: 1320,
      headshotWave: 'sine',
      headshotDuration: 0.09,
    },
    kill: {
      baseWave: 'sawtooth',
      duration: 0.38,
      streakStages: [
        { stage: 1, frequencies: [440.00], label: 'Stage 1 (1 Kill)' },
        { stage: 2, frequencies: [523.25], label: 'Stage 2 (2 Kills)' },
        { stage: 3, frequencies: [659.25], label: 'Stage 3 (3 Kills)' },
        { stage: 4, frequencies: [880.00], label: 'Stage 4 (4 Kills)' },
        { stage: 5, frequencies: [440.00, 659.25, 880.00, 1318.51], label: 'Stage 5+ (Ace / 5+ Kills)' },
      ],
    },
  },

  'neo-arcade': {
    id: 'neo-arcade',
    name: 'Neo Arcade (Original)',
    badgeLabel: 'CHIPTUNE RETRO',
    shortDescription: 'Punchy 8-bit FM transient sweep, crisp bit-style crackle, and retro arcade powerup tones.',
    designNotes: 'Original retro chiptune procedural synthesis featuring square-wave arpeggios and bright game fanfares.',
    gunshot: {
      noiseDuration: 0.12,
      noiseDecay: 0.05,
      filterCutoff: 1600,
      crackFreqStart: 2400,
      crackFreqEnd: 150,
      crackDuration: 0.035,
      crackWave: 'square',
      bodySubFreq: 110,
    },
    hit: {
      torsoFreq: 987,
      torsoWave: 'square',
      torsoDuration: 0.045,
      headshotFreq: 1568,
      headshotHarmonicFreq: 1975,
      headshotWave: 'square',
      headshotDuration: 0.06,
    },
    kill: {
      baseWave: 'square',
      duration: 0.25,
      streakStages: [
        { stage: 1, frequencies: [659.25], label: 'Stage 1 (1 Kill)' },
        { stage: 2, frequencies: [830.61], label: 'Stage 2 (2 Kills)' },
        { stage: 3, frequencies: [987.77], label: 'Stage 3 (3 Kills)' },
        { stage: 4, frequencies: [1318.51], label: 'Stage 4 (4 Kills)' },
        { stage: 5, frequencies: [1318.51, 1661.22, 1975.53], label: 'Stage 5+ (Ace / 5+ Kills)' },
      ],
    },
  },

  'celestial-brass': {
    id: 'celestial-brass',
    name: 'Celestial Brass (Original)',
    badgeLabel: 'RESONANT BELL',
    shortDescription: 'Radiant brass hammer strike, singing bell decay, and uplifting majestic confirmation chords.',
    designNotes: 'Original brassy metallic synthesis combining rich harmonic overtones and pure crystalline bell ringing.',
    gunshot: {
      noiseDuration: 0.16,
      noiseDecay: 0.07,
      filterCutoff: 650,
      crackFreqStart: 3400,
      crackFreqEnd: 280,
      crackDuration: 0.045,
      crackWave: 'triangle',
      bodySubFreq: 85,
    },
    hit: {
      torsoFreq: 1046,
      torsoWave: 'sine',
      torsoDuration: 0.06,
      headshotFreq: 1648,
      headshotHarmonicFreq: 2093,
      headshotWave: 'sine',
      headshotDuration: 0.08,
    },
    kill: {
      baseWave: 'sine',
      duration: 0.35,
      streakStages: [
        { stage: 1, frequencies: [523.25], label: 'Stage 1 (1 Kill)' },
        { stage: 2, frequencies: [659.25], label: 'Stage 2 (2 Kills)' },
        { stage: 3, frequencies: [783.99], label: 'Stage 3 (3 Kills)' },
        { stage: 4, frequencies: [1046.50], label: 'Stage 4 (4 Kills)' },
        { stage: 5, frequencies: [1046.50, 1318.51, 1567.98, 2093.00], label: 'Stage 5+ (Ace / 5+ Kills)' },
      ],
    },
  },
};

export const DEFAULT_SOUND_PROFILE_ID: SoundProfileId = 'classic';

export function isValidSoundProfileId(id: unknown): id is SoundProfileId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SOUND_PROFILES, id);
}

export function getSoundProfile(id?: string | null): SoundProfile {
  if (id && isValidSoundProfileId(id)) {
    return SOUND_PROFILES[id];
  }
  return SOUND_PROFILES[DEFAULT_SOUND_PROFILE_ID];
}

export function getAllSoundProfiles(): SoundProfile[] {
  return Object.values(SOUND_PROFILES);
}
