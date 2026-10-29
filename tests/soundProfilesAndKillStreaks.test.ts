import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  SOUND_PROFILES,
  DEFAULT_SOUND_PROFILE_ID,
  getSoundProfile,
  getAllSoundProfiles,
  isValidSoundProfileId,
} from '../src/soundProfiles';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Engine } from '../src/engine';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Store } from '../src/store';
import { UIManager, TimingClock } from '../src/ui';
import { getScenarioById, TRAINING_ROUTINES } from '../src/scenarios';
import { LS_SETTINGS } from '../src/constants';
import type { SessionResult } from '../src/types';

class MockTimingClock implements TimingClock {
  public currentTime = 1000;
  private timerIdCounter = 1;
  public activeTimeouts = new Map<number, { fn: () => void; dueTime: number }>();
  public activeIntervals = new Map<number, { fn: () => void; intervalMs: number; nextDue: number }>();

  now(): number {
    return this.currentTime;
  }

  setTimeout(fn: () => void, ms: number): any {
    const id = this.timerIdCounter++;
    this.activeTimeouts.set(id, { fn, dueTime: this.currentTime + ms });
    return id;
  }

  clearTimeout(id: any): void {
    this.activeTimeouts.delete(id);
  }

  setInterval(fn: () => void, ms: number): any {
    const id = this.timerIdCounter++;
    this.activeIntervals.set(id, { fn, intervalMs: ms, nextDue: this.currentTime + ms });
    return id;
  }

  clearInterval(id: any): void {
    this.activeIntervals.delete(id);
  }

  tick(ms: number): void {
    this.currentTime += ms;
    for (const [id, t] of Array.from(this.activeTimeouts.entries())) {
      if (this.currentTime >= t.dueTime) {
        this.activeTimeouts.delete(id);
        t.fn();
      }
    }
    for (const [, inv] of Array.from(this.activeIntervals.entries())) {
      while (this.currentTime >= inv.nextDue) {
        inv.nextDue += inv.intervalMs;
        inv.fn();
      }
    }
  }
}

describe('Sprint 2G — Sound Profile Registry & Default Selection', () => {
  it('contains all required typed original sound profiles with stable IDs', () => {
    const profiles = getAllSoundProfiles();
    expect(profiles.length).toBe(5);

    const ids = profiles.map(p => p.id);
    expect(ids).toContain('classic');
    expect(ids).toContain('cyber-pulse');
    expect(ids).toContain('shadow-flame');
    expect(ids).toContain('neo-arcade');
    expect(ids).toContain('celestial-brass');
  });

  it('default profile is strictly classic', () => {
    expect(DEFAULT_SOUND_PROFILE_ID).toBe('classic');
    const defaultProfile = getSoundProfile();
    expect(defaultProfile.id).toBe('classic');
  });

  it('falls back safely to default profile on unknown, empty, or malformed ID', () => {
    expect(getSoundProfile('unknown_skin').id).toBe('classic');
    expect(getSoundProfile(null).id).toBe('classic');
    expect(getSoundProfile(undefined).id).toBe('classic');
    expect(getSoundProfile('').id).toBe('classic');
  });

  it('validates profile IDs strictly with isValidSoundProfileId', () => {
    expect(isValidSoundProfileId('classic')).toBe(true);
    expect(isValidSoundProfileId('cyber-pulse')).toBe(true);
    expect(isValidSoundProfileId('shadow-flame')).toBe(true);
    expect(isValidSoundProfileId('neo-arcade')).toBe(true);
    expect(isValidSoundProfileId('celestial-brass')).toBe(true);
    expect(isValidSoundProfileId('elderflame')).toBe(false);
    expect(isValidSoundProfileId(null)).toBe(false);
    expect(isValidSoundProfileId(123)).toBe(false);
  });

  it('all profiles define design notes clearly documenting original procedural synthesis', () => {
    for (const p of getAllSoundProfiles()) {
      expect(p.name).toBeTruthy();
      expect(p.shortDescription).toBeTruthy();
      expect(p.designNotes).toContain('Original');
      expect(p.gunshot.noiseDuration).toBeGreaterThan(0);
      expect(p.hit.torsoFreq).toBeGreaterThan(0);
      expect(p.hit.headshotFreq).toBeGreaterThan(p.hit.torsoFreq);
      expect(p.kill.streakStages.length).toBe(5);
    }
  });
});

describe('Sprint 2G — Settings Model, Sanitization & Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads sensible defaults when localStorage is empty', () => {
    const sm = new SettingsManager();
    const s = sm.getAll();

    expect(s.volume).toBe(0.6);
    expect(s.sfxVolume).toBe(0.8);
    expect(s.audioMuted).toBe(false);
    expect(s.soundProfile).toBe('classic');
    expect(s.killStreakAudioEnabled).toBe(true);
  });

  it('sanitizes malformed, out-of-bounds, or corrupted values', () => {
    localStorage.setItem(LS_SETTINGS, JSON.stringify({
      volume: 99.5,            // out of bounds
      sfxVolume: -5,           // out of bounds
      audioMuted: 'not_bool',  // invalid type
      soundProfile: 'fake_vandal_skin', // invalid profile
      killStreakAudioEnabled: null,
      sensitivity: 0.15,
    }));

    const sm = new SettingsManager();
    const s = sm.getAll();

    expect(s.volume).toBe(1.0); // clamped
    expect(s.sfxVolume).toBe(0.0); // clamped
    expect(s.audioMuted).toBe(false); // default fallback
    expect(s.soundProfile).toBe('classic'); // default fallback
    expect(s.killStreakAudioEnabled).toBe(true); // default fallback
    expect(s.sensitivity).toBe(0.15); // preserved
  });

  it('resetAudio restores audio settings to defaults while preserving crosshair and mouse settings', () => {
    const sm = new SettingsManager();
    sm.set('sensitivity', 0.45);
    sm.set('crosshairColor', '#ff4655');
    sm.set('volume', 0.2);
    sm.set('sfxVolume', 0.3);
    sm.set('audioMuted', true);
    sm.set('soundProfile', 'shadow-flame');

    sm.resetAudio();
    const s = sm.getAll();

    // Audio reset to defaults
    expect(s.volume).toBe(0.6);
    expect(s.sfxVolume).toBe(0.8);
    expect(s.audioMuted).toBe(false);
    expect(s.soundProfile).toBe('classic');
    expect(s.killStreakAudioEnabled).toBe(true);

    // Gameplay and visual settings preserved
    expect(s.sensitivity).toBe(0.45);
    expect(s.crosshairColor).toBe('#ff4655');
  });
});

describe('Sprint 2G — Audio Engine Volume, Mute & Safe Silencing', () => {
  it('calculates effective volume as masterVolume * sfxVolume', () => {
    const audio = new AudioManager();
    audio.setMasterVolume(0.5);
    audio.setSfxVolume(0.8);
    audio.setMuted(false);

    expect(audio.getEffectiveVolume()).toBeCloseTo(0.4, 2);
  });

  it('calculates effective volume as strictly 0 when muted', () => {
    const audio = new AudioManager();
    audio.setMasterVolume(1.0);
    audio.setSfxVolume(1.0);
    audio.setMuted(true);

    expect(audio.getEffectiveVolume()).toBe(0);
  });

  it('clamps volume bounds between 0.0 and 1.0', () => {
    const audio = new AudioManager();
    audio.setMasterVolume(2.5);
    expect(audio.getMasterVolume()).toBe(1.0);

    audio.setMasterVolume(-1.0);
    expect(audio.getMasterVolume()).toBe(0.0);

    audio.setSfxVolume(5.0);
    expect(audio.getSfxVolume()).toBe(1.0);

    audio.setSfxVolume(-0.5);
    expect(audio.getSfxVolume()).toBe(0.0);
  });

  it('updateMasterGain updates gain immediately when Web Audio is active', () => {
    const audio = new AudioManager();
    const mockGainNode = {
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
    const mockCtx = {
      state: 'running',
      currentTime: 5,
      destination: {},
      createGain: vi.fn().mockReturnValue(mockGainNode),
    };

    (audio as any).ctx = mockCtx;
    (audio as any).masterGainNode = mockGainNode;

    audio.setMasterVolume(0.5);
    audio.setSfxVolume(0.6);

    expect(mockGainNode.gain.cancelScheduledValues).toHaveBeenCalledWith(5);
    expect(mockGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0.3, 5);
  });
});

describe('Sprint 2G — Kill-Streak Progression & Audio Stages', () => {
  it('maps streaks 1 to 5+ deterministically to stages 1 to 5', () => {
    const audio = new AudioManager();
    (audio as any).ready = true;
    (audio as any).masterVolume = 1.0;
    (audio as any).sfxVolume = 1.0;
    (audio as any).muted = false;

    const createdOscillators: any[] = [];
    const mockCtx = {
      state: 'running',
      sampleRate: 44100,
      currentTime: 10,
      destination: {},
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createOscillator: vi.fn().mockImplementation(() => {
        const osc = {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        createdOscillators.push(osc);
        return osc;
      }),
    };
    (audio as any).ctx = mockCtx;

    // Stage 1 (1 Kill): C5 (523.25 Hz)
    audio.playKill(1, false, undefined, 'classic');
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(523.25, 10);

    // Stage 2 (2 Kills): E5 (659.25 Hz)
    createdOscillators.length = 0;
    audio.playKill(2, false, undefined, 'classic');
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(659.25, 10);

    // Stage 3 (3 Kills): G5 (783.99 Hz)
    createdOscillators.length = 0;
    audio.playKill(3, false, undefined, 'classic');
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(783.99, 10);

    // Stage 4 (4 Kills): B5 (987.77 Hz)
    createdOscillators.length = 0;
    audio.playKill(4, false, undefined, 'classic');
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(987.77, 10);

    // Stage 5 (5 Kills): C6 chord (3 frequencies)
    createdOscillators.length = 0;
    audio.playKill(5, false, undefined, 'classic');
    expect(createdOscillators.length).toBe(3);
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(1046.50, 10);
    expect(createdOscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(1318.51, 10);
    expect(createdOscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(1567.98, 10);

    // Streak > 5 stays capped at Stage 5+ chord
    createdOscillators.length = 0;
    audio.playKill(8, false, undefined, 'classic');
    expect(createdOscillators.length).toBe(3);
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(1046.50, 10);
  });

  it('keeps kill audio at Stage 1 when killStreakAudioEnabled is false', () => {
    const audio = new AudioManager();
    (audio as any).ready = true;
    (audio as any).masterVolume = 1.0;
    (audio as any).sfxVolume = 1.0;
    (audio as any).muted = false;
    audio.setKillStreakAudioEnabled(false);

    const createdOscillators: any[] = [];
    const mockCtx = {
      state: 'running',
      currentTime: 10,
      destination: {},
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createOscillator: vi.fn().mockImplementation(() => {
        const osc = {
          type: 'sine',
          frequency: { setValueAtTime: vi.fn() },
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        createdOscillators.push(osc);
        return osc;
      }),
    };
    (audio as any).ctx = mockCtx;

    // Even on 5 kills, with streak progression disabled it plays Stage 1 root note
    audio.playKill(5, false, undefined, 'classic');
    expect(createdOscillators.length).toBe(1);
    expect(createdOscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(523.25, 10);
  });
});

describe('Sprint 2G — Engine Streak Tracking & Boundary Resets', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;

  beforeEach(() => {
    localStorage.clear();
    canvas = document.createElement('canvas');

    const mockWebGLRenderer = {
      domElement: canvas,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('advances streak exactly once per confirmed target kill', () => {
    const playKillSpy = vi.spyOn(audio, 'playKill');
    const onKillCallback = vi.fn();
    engine.callbacks.onKill = onKillCallback;

    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    expect(engine.getKillStreak()).toBe(0);

    const target1 = engine.targets.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(true);
    const checkHitSpy = vi.spyOn(engine.targets, 'checkHit').mockReturnValue({
      hit: true,
      headshot: false,
      targetId: target1.id,
      distanceMetres: 10,
      reactionMs: 200,
      accuracyScore: 0.9,
    });

    (engine as any).handleShoot();

    expect(engine.getKillStreak()).toBe(1);
    expect(playKillSpy).toHaveBeenCalledWith(1, false, expect.anything());
    expect(onKillCallback).toHaveBeenCalledWith({
      targetId: target1.id,
      headshot: false,
      position: expect.anything(),
      streak: 1,
    });

    // Spawn a second live target for second shot
    const target2 = engine.targets.spawnTarget(config, new THREE.Vector3(2, 1.6, -10));
    checkHitSpy.mockReturnValue({
      hit: true,
      headshot: false,
      targetId: target2.id,
      distanceMetres: 10,
      reactionMs: 180,
      accuracyScore: 0.95,
    });

    // Second hit advances to streak 2
    (engine as any).handleShoot();
    expect(engine.getKillStreak()).toBe(2);
    expect(playKillSpy).toHaveBeenLastCalledWith(2, false, expect.anything());
  });

  it('misses never advance the streak', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    const target1 = engine.targets.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));

    // Hit 1 -> streak 1
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(true);
    const checkHitSpy = vi.spyOn(engine.targets, 'checkHit').mockReturnValue({
      hit: true,
      headshot: false,
      targetId: target1.id,
      distanceMetres: 10,
      reactionMs: 200,
      accuracyScore: 0.8,
    });
    (engine as any).handleShoot();
    expect(engine.getKillStreak()).toBe(1);

    // Miss 1
    checkHitSpy.mockReturnValue({
      hit: false,
      headshot: false,
      targetId: '',
      distanceMetres: 0,
      reactionMs: 0,
      accuracyScore: 0,
    });
    (engine as any).handleShoot();

    // Streak was NOT advanced
    expect(engine.getKillStreak()).toBe(1);
  });

  it('movement inaccurate shots never advance the streak', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    // Moving shot when steady aim is required
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(false);
    (engine as any).handleShoot();

    expect(engine.getKillStreak()).toBe(0);
  });

  it('resets streak to 0 at well-defined lifecycle boundaries', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    // Simulate active streak
    (engine as any).currentKillStreak = 4;
    expect(engine.getKillStreak()).toBe(4);

    // Boundary 1: stopScenario
    engine.stopScenario();
    expect(engine.getKillStreak()).toBe(0);

    // Boundary 2: startScenario
    (engine as any).currentKillStreak = 3;
    engine.startScenario(config);
    expect(engine.getKillStreak()).toBe(0);
  });
});

describe('Sprint 2G — Settings UI, Audio Previews & State Non-Mutation', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;
  let ui: UIManager;
  let mockClock: MockTimingClock;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';

    appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);

    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    appContainer.appendChild(canvas);

    const mockWebGLRenderer = {
      domElement: canvas,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    mockClock = new MockTimingClock();
    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
    ui = new UIManager(engine, appContainer, canvas, mockClock);
  });

  afterEach(() => {
    ui.dispose();
    engine.dispose();
    document.body.innerHTML = '';
  });

  it('renders dedicated audio settings with all profiles and controls', () => {
    ui.navigateTo('settings');
    const html = document.getElementById('page-container')!.innerHTML;

    expect(html).toContain('VANDAL SOUND PROFILES &amp; KILL-STREAK AUDIO');
    expect(html).toContain('Cyber Pulse (Original)');
    expect(html).toContain('Shadow Flame (Original)');
    expect(html).toContain('PREVIEW FIRING');
    expect(html).toContain('PREVIEW BODY HIT');
    expect(html).toContain('PREVIEW HEADSHOT');
    expect(html).toContain('PREVIEW KILL STREAK');
    expect(html).toContain('Sound Effects (SFX) Volume');
    expect(html).toContain('Mute All Audio');
    expect(html).toContain('Kill-Streak Audio Progression');
  });

  it('sound previews do not mutate engine kills, score, streak, or routine state', () => {
    ui.navigateTo('settings');

    const previewGunshotSpy = vi.spyOn(engine.audio, 'previewGunshot');
    const previewHitSpy = vi.spyOn(engine.audio, 'previewHit');
    const previewKillSpy = vi.spyOn(engine.audio, 'previewKill');

    // Click previews
    document.getElementById('btn-prev-fire')?.click();
    expect(previewGunshotSpy).toHaveBeenCalledWith('classic');

    document.getElementById('btn-prev-hit')?.click();
    expect(previewHitSpy).toHaveBeenCalledWith('classic', false);

    document.getElementById('btn-prev-head')?.click();
    expect(previewHitSpy).toHaveBeenCalledWith('classic', true);

    document.getElementById('btn-prev-kill')?.click();
    expect(previewKillSpy).toHaveBeenCalledWith('classic', 5);

    // Gameplay state remains strictly unchanged
    expect(engine.getKillStreak()).toBe(0);
    expect(engine.score).toBe(0);
    expect(engine.hits).toBe(0);
    expect(engine.misses).toBe(0);
    expect(ui.activeRoutine).toBeNull();
  });

  it('routine retry and routine drill advance reset kill streak to 0', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    // Simulate kill streak during drill 0
    (engine as any).currentKillStreak = 3;
    expect(engine.getKillStreak()).toBe(3);

    const drillResult: SessionResult = {
      id: 'res_drill_0',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
      durationSec: 60,
      score: 500,
      hits: 5,
      misses: 0,
      accuracy: 100,
      headshots: 4,
      avgReactionMs: 220,
      medianReactionMs: 215,
      bestReactionMs: 190,
      targetsPerSecond: 0.8,
    };

    // Show result and click retry
    (ui as any).showResultsScreen(drillResult, false);
    document.getElementById('btn-res-retry')?.click();

    // Streak must be cleanly reset for the retry
    expect(engine.getKillStreak()).toBe(0);

    // Simulate streak in drill 0, then advance to drill 1
    (engine as any).currentKillStreak = 5;
    (ui as any).showResultsScreen(drillResult, false);
    document.getElementById('btn-res-next')?.click();

    // Streak must be cleanly reset for the next drill
    expect(engine.getKillStreak()).toBe(0);
  });
});

describe('Sprint 2G Final Gap Audit — Lifecycle Hardening, Volume Independence & Node Cleanup', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;

  beforeEach(() => {
    localStorage.clear();
    canvas = document.createElement('canvas');

    const mockWebGLRenderer = {
      domElement: canvas,
      shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
      clearDepth: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('persists master volume and SFX volume independently', () => {
    const sm = new SettingsManager();
    sm.set('volume', 0.45);
    sm.set('sfxVolume', 0.75);

    // Re-instantiate to simulate page reload from storage
    const smReloaded = new SettingsManager();
    expect(smReloaded.get('volume')).toBe(0.45);
    expect(smReloaded.get('sfxVolume')).toBe(0.75);

    // Updating one does not alter the other
    smReloaded.set('volume', 0.9);
    expect(smReloaded.get('volume')).toBe(0.9);
    expect(smReloaded.get('sfxVolume')).toBe(0.75);
  });

  it('mute overrides both master and SFX volumes without erasing saved volume levels', () => {
    audio.setMasterVolume(0.8);
    audio.setSfxVolume(0.5);
    expect(audio.getEffectiveVolume()).toBeCloseTo(0.4, 2);

    // Mute on
    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.getEffectiveVolume()).toBe(0);

    // Original levels are retained
    expect(audio.getMasterVolume()).toBe(0.8);
    expect(audio.getSfxVolume()).toBe(0.5);

    // Unmute restores calculated product
    audio.setMuted(false);
    expect(audio.getEffectiveVolume()).toBeCloseTo(0.4, 2);
  });

  it('rejects duplicate or stale target hit callbacks once target is eliminated', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    const target = engine.targets.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));
    vi.spyOn(controls, 'isCounterStrafed').mockReturnValue(true);

    const checkHitSpy = vi.spyOn(engine.targets, 'checkHit').mockReturnValue({
      hit: true,
      headshot: false,
      targetId: target.id,
      distanceMetres: 10,
      reactionMs: 200,
      accuracyScore: 0.9,
    });

    // First trigger pull eliminates target
    (engine as any).handleShoot();
    expect(engine.hits).toBe(1);
    expect(engine.getKillStreak()).toBe(1);

    // Second trigger pull receives stale hit callback with same target ID
    (engine as any).handleShoot();

    // Streak and hits must NOT increment again for the already-dead target
    expect(engine.hits).toBe(1);
    expect(engine.getKillStreak()).toBe(1);
  });

  it('resets kill streak to 0 upon scenario completion in completeScenario', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    // Simulate active streak
    (engine as any).currentKillStreak = 4;
    expect(engine.getKillStreak()).toBe(4);

    // Scenario timer finishes
    (engine as any).completeScenario();

    expect(engine.getKillStreak()).toBe(0);
    expect(engine.isRunning).toBe(false);
  });

  it('resets kill streak to 0 when drill is abandoned via exitToMenu', () => {
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const mockClock = new MockTimingClock();
    const ui = new UIManager(engine, appContainer, canvas, mockClock);

    ui.launchScenario('flick-static');
    (engine as any).currentKillStreak = 3;
    expect(engine.getKillStreak()).toBe(3);

    ui.exitToMenu();

    expect(engine.getKillStreak()).toBe(0);
    expect(engine.isRunning).toBe(false);

    ui.dispose();
    document.body.removeChild(appContainer);
  });

  it('tracks temporary PannerNodes in activePanners and disconnects them on disposal', () => {
    const testAudio = new AudioManager();
    const mockPanner = {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 3,
      maxDistance: 30,
      rolloffFactor: 1,
      positionX: { setValueAtTime: vi.fn() },
      positionY: { setValueAtTime: vi.fn() },
      positionZ: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockCtx = {
      state: 'running',
      currentTime: 10,
      destination: {},
      createGain: vi.fn().mockReturnValue({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createOscillator: vi.fn().mockReturnValue({
        frequency: { setValueAtTime: vi.fn() },
        type: 'sine',
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createPanner: vi.fn().mockReturnValue(mockPanner),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (testAudio as any).ctx = mockCtx;
    (testAudio as any).ready = true;
    (testAudio as any).masterGainNode = mockCtx.createGain();

    // Play positional hit -> creates and tracks panner
    testAudio.playHit(false, new THREE.Vector3(1, 1.6, -5));
    expect((testAudio as any).activePanners.size).toBe(1);

    // Calling dispose disconnects all active panner nodes safely
    testAudio.dispose();
    expect(mockPanner.disconnect).toHaveBeenCalled();
    expect((testAudio as any).activePanners.size).toBe(0);
  });

  it('safely handles missing or blocked Web Audio without throwing across all public methods', () => {
    const testAudio = new AudioManager();
    // Do not call init() -> context is null

    expect(() => {
      testAudio.playGunshot('cyber-pulse');
      testAudio.playHit(true, { x: 0, y: 1, z: -5 });
      testAudio.playKill(3, true, { x: 0, y: 1, z: -5 });
      testAudio.playMiss();
      testAudio.playFlash();
      testAudio.playSpawn();
      testAudio.playPB();
      testAudio.playStart();
      testAudio.playEnd();
      testAudio.resume();
      testAudio.dispose();
    }).not.toThrow();
  });
});
