import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  SCENARIOS,
  TRAINING_ROUTINES,
  getScenarioById,
  getScenariosByCategory,
  applyDifficultyPreset,
  getRoutineDuration,
  DIFFICULTY_PRESETS,
} from '../src/scenarios';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { UIManager } from '../src/ui';
import type { ScenarioConfig, SessionResult, RoutineSummary, DifficultyId } from '../src/types';

describe('Sprint 2D — Scenario Configuration & Distinct Drill Design', () => {
  it('all scenarios have unique IDs, non-empty names, descriptions, and skills', () => {
    const ids = new Set<string>();
    for (const sc of SCENARIOS) {
      expect(sc.id).toBeDefined();
      expect(ids.has(sc.id)).toBe(false);
      ids.add(sc.id);

      expect(sc.name.trim().length).toBeGreaterThan(0);
      expect(sc.description.trim().length).toBeGreaterThan(0);
      expect(sc.skill.trim().length).toBeGreaterThan(0);
      expect(sc.durationSec).toBe(60);
      expect(sc.targetCount).toBeGreaterThanOrEqual(1);
      expect(sc.spawnRadius).toBeGreaterThan(0);
    }
  });

  it('all scenarios explicitly define Sprint 2D flags', () => {
    for (const sc of SCENARIOS) {
      expect(typeof sc.meaningfulReactionTime).toBe('boolean');
      expect(typeof sc.meaningfulTracking).toBe('boolean');
      expect(typeof sc.allowInRoutines).toBe('boolean');
      expect(sc.allowInRoutines).toBe(true);
    }
  });

  it('tracking scenarios have meaningfulTracking = true and meaningfulReactionTime = false', () => {
    const trackingDrills = getScenariosByCategory('tracking');
    expect(trackingDrills.length).toBeGreaterThanOrEqual(4);
    for (const sc of trackingDrills) {
      expect(sc.meaningfulTracking).toBe(true);
      expect(sc.meaningfulReactionTime).toBe(false);
    }
  });

  it('flick, tactical, and reaction scenarios have meaningfulReactionTime = true', () => {
    const flickDrills = getScenariosByCategory('flick');
    for (const sc of flickDrills) {
      expect(sc.meaningfulReactionTime).toBe(true);
      expect(sc.meaningfulTracking).toBe(false);
    }

    const tacticalDrills = getScenariosByCategory('tactical');
    for (const sc of tacticalDrills) {
      expect(sc.meaningfulReactionTime).toBe(true);
    }
  });

  it('drills have distinct functional mechanics', () => {
    const micro = getScenarioById('flick-micro')!;
    const wide = getScenarioById('flick-wide')!;
    const precision = getScenarioById('flick-precision')!;
    const counterStrafe = getScenarioById('tactical-counter-strafe')!;
    const smooth = getScenarioById('track-smooth')!;

    // Micro flick has smaller radius and small target
    expect(micro.spawnRadius).toBeLessThan(wide.spawnRadius);
    expect(micro.targetSizeMultiplier).toBeLessThan(wide.targetSizeMultiplier);

    // Precision penalizes misses and has tight size
    expect(precision.penalizeMiss).toBe(true);
    expect(precision.targetSizeMultiplier).toBeLessThan(1.0);

    // Counter-strafe requires steady aim
    expect(counterStrafe.requireSteadyAim).toBe(true);

    // Smooth tracking uses wander pattern and movement
    expect(smooth.movementPattern).toBe('wander');
    expect(smooth.targetSpeedMultiplier).toBeGreaterThan(0);
  });
});

describe('Sprint 2D — Difficulty Presets & Immutability', () => {
  it('base configurations are immutable and not mutated by applyDifficultyPreset', () => {
    const base = getScenarioById('track-smooth')!;
    const originalSpeed = base.targetSpeedMultiplier;
    const originalDiff = base.difficulty;

    const proConfig = applyDifficultyPreset(base, 'pro');
    expect(proConfig.difficulty).toBe('pro');
    expect(proConfig.targetSpeedMultiplier).toBeGreaterThan(originalSpeed);

    // Ensure base in SCENARIOS array was NOT mutated
    expect(base.targetSpeedMultiplier).toBe(originalSpeed);
    expect(base.difficulty).toBe(originalDiff);
  });

  it('applying difficulty repeatedly does not compound multipliers', () => {
    const base = getScenarioById('track-smooth')!;
    const once = applyDifficultyPreset(base, 'advanced');
    const twice = applyDifficultyPreset(once, 'advanced');
    const thrice = applyDifficultyPreset(twice, 'advanced');

    expect(once.targetSpeedMultiplier).toBe(twice.targetSpeedMultiplier);
    expect(twice.targetSpeedMultiplier).toBe(thrice.targetSpeedMultiplier);
  });

  it('difficulty preset values remain within sensible bounded ranges', () => {
    for (const sc of SCENARIOS) {
      for (const diff of ['beginner', 'intermediate', 'advanced', 'pro'] as DifficultyId[]) {
        const scaled = applyDifficultyPreset(sc, diff);
        expect(scaled.targetSpeedMultiplier).toBeGreaterThanOrEqual(0);
        expect(scaled.targetSpeedMultiplier).toBeLessThanOrEqual(3.5);

        if (scaled.directionChangeMultiplier !== undefined) {
          expect(scaled.directionChangeMultiplier).toBeGreaterThanOrEqual(0.2);
          expect(scaled.directionChangeMultiplier).toBeLessThanOrEqual(3.0);
        }

        if (scaled.targetLifetimeSec !== undefined) {
          expect(scaled.targetLifetimeSec).toBeGreaterThanOrEqual(0.3);
          expect(scaled.targetLifetimeSec).toBeLessThanOrEqual(10.0);
        }
      }
    }
  });

  it('difficulty presets preserve hitbox dimensions, recoil, and sensitivity invariants', () => {
    const base = getScenarioById('flick-static')!;
    const pro = applyDifficultyPreset(base, 'pro');

    // Head-level and dimensions remain invariant
    expect(pro.headLevel).toBe(base.headLevel);
    expect(pro.targetSizeMultiplier).toBe(base.targetSizeMultiplier);
    expect(pro.requireSteadyAim).toBe(base.requireSteadyAim);
    expect(pro.penalizeMiss).toBe(base.penalizeMiss);
  });
});

describe('Sprint 2D — Routine Durations & Structure', () => {
  it('5-minute warm-up routine strictly sums to 300 seconds (5 min)', () => {
    const r5 = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    expect(r5).toBeDefined();
    expect(r5.scenarioIds.length).toBe(5);

    const sum = getRoutineDuration(r5);
    expect(sum).toBe(300);
    expect(r5.totalDurationSec).toBe(300);
  });

  it('10-minute warm-up routine strictly sums to 600 seconds (10 min)', () => {
    const r10 = TRAINING_ROUTINES.find(r => r.id === 'routine-10m')!;
    expect(r10).toBeDefined();
    expect(r10.scenarioIds.length).toBe(10);

    const sum = getRoutineDuration(r10);
    expect(sum).toBe(600);
    expect(r10.totalDurationSec).toBe(600);
  });

  it('20-minute warm-up routine strictly sums to 1200 seconds (20 min)', () => {
    const r20 = TRAINING_ROUTINES.find(r => r.id === 'routine-20m')!;
    expect(r20).toBeDefined();
    expect(r20.scenarioIds.length).toBe(20);

    const sum = getRoutineDuration(r20);
    expect(sum).toBe(1200);
    expect(r20.totalDurationSec).toBe(1200);
  });

  it('every drill in routine-5m and routine-10m exists in SCENARIOS and has allowInRoutines = true', () => {
    for (const routine of TRAINING_ROUTINES) {
      for (const sid of routine.scenarioIds) {
        const sc = getScenarioById(sid);
        expect(sc).toBeDefined();
        expect(sc!.allowInRoutines).toBe(true);
      }
    }
  });
});

describe('Sprint 2D — End-to-End Routine Orchestration', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;
  let ui: UIManager;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    canvas.requestPointerLock = vi.fn();
    document.exitPointerLock = vi.fn();
    document.body.appendChild(appContainer);
    document.body.appendChild(canvas);

    const mockWebGLRenderer = {
      domElement: { width: 800, height: 600 },
      shadowMap: { enabled: false, type: 0 },
      autoClear: true,
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
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
    ui = new UIManager(engine, appContainer, canvas);
  });

  afterEach(() => {
    ui.exitToMenu();
    controls.dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('startRoutine initializes activeRoutine state and launches first drill with selected difficulty', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'advanced');

    expect(ui.activeRoutine).toBeDefined();
    expect(ui.activeRoutine?.id).toBe('routine-5m');
    expect(ui.activeRoutine?.difficulty).toBe('advanced');
    expect(ui.activeRoutine?.currentIndex).toBe(0);
    expect(engine.isRunning).toBe(true);
    expect(engine.activeConfig?.id).toBe(routine.scenarioIds[0]);
    expect(engine.activeConfig?.difficulty).toBe('advanced');
  });

  it('advanceRoutine advances in strict sequence without double-advancing', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'pro');

    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Advance to next drill
    ui.advanceRoutine();
    expect(ui.activeRoutine?.currentIndex).toBe(1);
    expect(engine.activeConfig?.id).toBe(routine.scenarioIds[1]);
    expect(engine.activeConfig?.difficulty).toBe('pro');

    // Test atomic guard preventing double-advancement
    ui.activeRoutine!.isAdvancing = true;
    ui.advanceRoutine(); // should be blocked
    expect(ui.activeRoutine?.currentIndex).toBe(1);
    ui.activeRoutine!.isAdvancing = false;
  });

  it('exitToMenu clears active routine and stops engine cleanly without recording incomplete session as PB', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    expect(ui.activeRoutine).not.toBeNull();
    expect(engine.isRunning).toBe(true);

    ui.exitToMenu();

    expect(ui.activeRoutine).toBeNull();
    expect(engine.isRunning).toBe(false);
    expect(store.totalSessions()).toBe(0);
    expect(store.getAllPBs()['flick-static']).toBeUndefined();
  });

  it('displays N/A for reaction time when meaningfulReactionTime is false', () => {
    const trackingResult: SessionResult = {
      id: 'sess_track_1',
      scenarioId: 'track-smooth',
      scenarioName: 'Smooth Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1250,
      hits: 0,
      misses: 0,
      headshots: 0,
      accuracy: 78.5,
      avgReactionMs: 0,
      medianReactionMs: 0,
      bestReactionMs: 0,
      targetsPerSecond: 0,
      timeOnTarget: 78.5,
    };

    engine.callbacks.onScenarioComplete?.(trackingResult, false);

    const content = document.getElementById('result-modal-content')!;
    expect(content.innerHTML).toContain('N/A');
    expect(content.innerHTML).toContain('78.5%');
  });

  it('routine completion triggers Routine Complete modal and saves RoutineSummary to store', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    // Simulate completion of all 5 drills
    for (let i = 0; i < routine.scenarioIds.length; i++) {
      const mockResult: SessionResult = {
        id: `sess_routine_${i}`,
        scenarioId: routine.scenarioIds[i],
        scenarioName: routine.scenarioIds[i],
        category: 'flick',
        difficulty: 'intermediate',
        timestamp: Date.now(),
        durationSec: 60,
        score: 500,
        hits: 5,
        misses: 1,
        headshots: 3,
        shotsFired: 6,
        accuracy: 83.3,
        avgReactionMs: 200,
        medianReactionMs: 195,
        bestReactionMs: 180,
        targetsPerSecond: 0.08,
      };

      engine.callbacks.onScenarioComplete?.(mockResult, false);

      if (i < routine.scenarioIds.length - 1) {
        ui.advanceRoutine();
      }
    }

    const content = document.getElementById('result-modal-content')!;
    expect(content.innerHTML).toContain('WARM-UP ROUTINE COMPLETE');
    expect(content.innerHTML).toContain('5/5 DRILLS FINISHED');

    const summaries = store.getRoutineSummaries();
    expect(summaries.length).toBe(1);
    expect(summaries[0].routineId).toBe('routine-5m');
    expect(summaries[0].totalScore).toBe(2500); // 5 * 500
    expect(summaries[0].totalHits).toBe(25);     // 5 * 5
    expect(summaries[0].totalHeadshots).toBe(15); // 5 * 3
    expect(summaries[0].drillsCompleted).toBe(5);
  });
});

describe('Sprint 2D — Store Robustness & PB Matching', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('caps sessions at 50 and ignores duplicate session IDs', () => {
    for (let i = 0; i < 60; i++) {
      store.addSession({
        id: `sess_${i}`,
        scenarioId: 'flick-static',
        scenarioName: 'Static Flicks',
        category: 'flick',
        difficulty: 'intermediate',
        timestamp: Date.now() + i,
        durationSec: 60,
        score: 100 + i,
        hits: 10,
        misses: 2,
        headshots: 5,
        accuracy: 83.3,
        avgReactionMs: 200,
        medianReactionMs: 200,
        bestReactionMs: 180,
        targetsPerSecond: 0.16,
      });
    }

    expect(store.totalSessions()).toBe(50);

    // Attempt to add duplicate ID
    const dupRes = store.addSession({
      id: 'sess_59',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 9999,
      hits: 10,
      misses: 0,
      headshots: 10,
      accuracy: 100,
      avgReactionMs: 150,
      medianReactionMs: 150,
      bestReactionMs: 150,
      targetsPerSecond: 0.2,
    });

    expect(dupRes.isPB).toBe(false);
    expect(store.totalSessions()).toBe(50);
  });

  it('strictly compares like-for-like scenario and difficulty for personal bests', () => {
    store.addSession({
      id: 'pb_test_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 600,
      hits: 6,
      misses: 0,
      headshots: 4,
      accuracy: 100,
      avgReactionMs: 210,
      medianReactionMs: 200,
      bestReactionMs: 190,
      targetsPerSecond: 0.1,
    });

    expect(store.getPB('flick-static')?.score).toBe(600);
    expect(store.getPB('flick-static', 'intermediate')?.score).toBe(600);

    // Higher score in advanced difficulty
    store.addSession({
      id: 'pb_test_2',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'advanced',
      timestamp: Date.now(),
      durationSec: 60,
      score: 800,
      hits: 8,
      misses: 0,
      headshots: 6,
      accuracy: 100,
      avgReactionMs: 190,
      medianReactionMs: 185,
      bestReactionMs: 170,
      targetsPerSecond: 0.13,
    });

    expect(store.getPB('flick-static')?.score).toBe(800);
    expect(store.getPB('flick-static', 'advanced')?.score).toBe(800);
    expect(store.getPB('flick-static', 'intermediate')?.score).toBe(600);
  });

  it('safely handles malformed and legacy localStorage data without throwing', () => {
    localStorage.setItem('vwt_sessions_v2', 'invalid json {{{');
    localStorage.setItem('vwt_pbs_v2', JSON.stringify({ 'broken': null, 123: 'str' }));
    localStorage.setItem('vwt_routines_v2', '[null, { "corrupt": true }]');

    expect(() => new Store()).not.toThrow();
    const safeStore = new Store();
    expect(safeStore.totalSessions()).toBe(0);
    expect(safeStore.getRoutineSummaries()).toEqual([]);
  });
});
