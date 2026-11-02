import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import {
  SCENARIOS,
  TRAINING_ROUTINES,
  getScenarioById,
  getRoutineActiveDuration,
  getRoutineTransitionDuration,
  getRoutineTotalElapsedDuration,
  ROUTINE_TRANSITION_SEC,
} from '../src/scenarios';
import { LS_SESSIONS, LS_PERSONAL_BESTS, LS_ROUTINES } from '../src/constants';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { UIManager, generateSparklineSVG, TimingClock } from '../src/ui';
import type { SessionResult, RoutineSummary, DifficultyId } from '../src/types';

// Mock clock for deterministic timing verification
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
    const targetTime = this.currentTime + ms;
    this.currentTime = targetTime;

    // Trigger timeouts
    for (const [id, t] of Array.from(this.activeTimeouts.entries())) {
      if (this.currentTime >= t.dueTime) {
        this.activeTimeouts.delete(id);
        t.fn();
      }
    }

    // Trigger intervals
    for (const [, inv] of Array.from(this.activeIntervals.entries())) {
      while (this.currentTime >= inv.nextDue) {
        inv.nextDue += inv.intervalMs;
        inv.fn();
      }
    }
  }

  clearAll(): void {
    this.activeTimeouts.clear;
    this.activeIntervals.clear;
  }
}

describe('Sprint 2E — Routine Timing Integrity & Architecture', () => {
  it('correctly calculates active, transition, and total elapsed durations for all routines', () => {
    const r5 = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    const r10 = TRAINING_ROUTINES.find(r => r.id === 'routine-10m')!;
    const r20 = TRAINING_ROUTINES.find(r => r.id === 'routine-20m')!;

    // 5-minute routine: 5 drills
    expect(r5.scenarioIds.length).toBe(5);
    expect(getRoutineActiveDuration(r5)).toBe(300); // 5 * 60s
    expect(getRoutineTransitionDuration(r5)).toBe(16); // 4 * 4s
    expect(getRoutineTotalElapsedDuration(r5)).toBe(316); // 300 + 16
    expect(r5.activeDurationSec).toBe(300);
    expect(r5.totalElapsedSec).toBe(316);

    // 10-minute routine: 10 drills
    expect(r10.scenarioIds.length).toBe(10);
    expect(getRoutineActiveDuration(r10)).toBe(600); // 10 * 60s
    expect(getRoutineTransitionDuration(r10)).toBe(36); // 9 * 4s
    expect(getRoutineTotalElapsedDuration(r10)).toBe(636); // 600 + 36
    expect(r10.activeDurationSec).toBe(600);
    expect(r10.totalElapsedSec).toBe(636);

    // 20-minute routine: 20 drills
    expect(r20.scenarioIds.length).toBe(20);
    expect(getRoutineActiveDuration(r20)).toBe(1200); // 20 * 60s
    expect(getRoutineTransitionDuration(r20)).toBe(76); // 19 * 4s
    expect(getRoutineTotalElapsedDuration(r20)).toBe(1276); // 1200 + 76
    expect(r20.activeDurationSec).toBe(1200);
    expect(r20.totalElapsedSec).toBe(1276);
  });

  it('transition constant is strictly 4 seconds', () => {
    expect(ROUTINE_TRANSITION_SEC).toBe(4);
  });
});

describe('Sprint 2E — Routine Lifecycle, Pause & Retry Semantics', () => {
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

    canvas.requestPointerLock = vi.fn().mockImplementation(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });
    document.exitPointerLock = vi.fn().mockImplementation(() => {
      document.dispatchEvent(new Event('pointerlockchange'));
    });

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
    ui.exitToMenu();
    controls.dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('excludes menu time before routine start from the routine clock', () => {
    mockClock.currentTime = 50000; // Simulated wall-clock before start
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    expect(ui.activeRoutine?.routineStartTime).toBe(50000);
    expect(ui.activeRoutine?.currentDrillStartTime).toBe(50000);
    expect(ui.activeRoutine?.totalPausedMs).toBe(0);
  });

  it('auto-advances to next drill using mock clock without manual delays', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    const firstResult: SessionResult = {
      id: 'sess_1',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: mockClock.now(),
      durationSec: 60,
      score: 500,
      hits: 5,
      misses: 0,
      headshots: 3,
      shotsFired: 5,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 200,
      targetsPerSecond: 0.1,
    };

    engine.callbacks.onScenarioComplete?.(firstResult, false);

    expect(ui.activeRoutine?.currentIndex).toBe(0);
    expect(mockClock.activeTimeouts.size).toBeGreaterThan(0);

    // Advance clock by 4 seconds (ROUTINE_TRANSITION_SEC)
    mockClock.tick(4000);

    // Drill should have automatically transitioned to index 1
    expect(ui.activeRoutine?.currentIndex).toBe(1);
    expect(engine.activeConfig?.id).toBe(routine.scenarioIds[1]);
  });

  it('clicking next drill manually cancels transition timer and prevents double-advancing', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    const result: SessionResult = {
      id: 'sess_click_test',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: mockClock.now(),
      durationSec: 60,
      score: 400,
      hits: 4,
      misses: 1,
      headshots: 2,
      shotsFired: 5,
      accuracy: 80,
      avgReactionMs: 220,
      medianReactionMs: 220,
      bestReactionMs: 200,
      targetsPerSecond: 0.08,
    };

    engine.callbacks.onScenarioComplete?.(result, false);

    // Click next drill button immediately
    const nextBtn = document.getElementById('btn-res-next') as HTMLButtonElement;
    expect(nextBtn).not.toBeNull();
    nextBtn.click();

    expect(ui.activeRoutine?.currentIndex).toBe(1);
    expect(mockClock.activeTimeouts.size).toBe(0); // Transition timer cleared!

    // Tick the clock past the previous 4s duration to verify no second advancement occurs
    mockClock.tick(5000);
    expect(ui.activeRoutine?.currentIndex).toBe(1);
  });

  it('retrying a drill replaces prior attempt without duplicating drill count or inflating results', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    // Attempt 1 for drill 0: poor score
    const attempt1: SessionResult = {
      id: 'drill_0_att_1',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: mockClock.now(),
      durationSec: 60,
      score: 200,
      hits: 2,
      misses: 5,
      headshots: 0,
      shotsFired: 7,
      accuracy: 28.6,
      avgReactionMs: 300,
      medianReactionMs: 300,
      bestReactionMs: 280,
      targetsPerSecond: 0.04,
    };
    engine.callbacks.onScenarioComplete?.(attempt1, false);

    expect(ui.activeRoutine?.results.length).toBe(1);
    expect(ui.activeRoutine?.results[0].score).toBe(200);

    // Player clicks "RETRY DRILL"
    const retryBtn = document.getElementById('btn-res-retry') as HTMLButtonElement;
    expect(retryBtn).not.toBeNull();
    retryBtn.click();

    expect(ui.activeRoutine?.currentIndex).toBe(0);
    expect(mockClock.activeTimeouts.size).toBe(0); // Timers cleared on retry!

    // Attempt 2 for drill 0: improved score
    const attempt2: SessionResult = {
      id: 'drill_0_att_2',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: mockClock.now(),
      durationSec: 60,
      score: 750,
      hits: 8,
      misses: 0,
      headshots: 6,
      shotsFired: 8,
      accuracy: 100,
      avgReactionMs: 190,
      medianReactionMs: 190,
      bestReactionMs: 180,
      targetsPerSecond: 0.15,
    };
    engine.callbacks.onScenarioComplete?.(attempt2, false);

    // Results length MUST remain 1 and contain the retried score!
    expect(ui.activeRoutine?.results.length).toBe(1);
    expect(ui.activeRoutine?.results[0].score).toBe(750);
    expect(ui.activeRoutine?.results[0].id).toBe('drill_0_att_2');
  });

  it('exitToMenu clears timers and does not record incomplete routine as completed', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    // Complete 2 drills out of 5
    for (let i = 0; i < 2; i++) {
      const res: SessionResult = {
        id: `drill_${i}`,
        scenarioId: routine.scenarioIds[i],
        scenarioName: routine.scenarioIds[i],
        category: 'flick',
        difficulty: 'intermediate',
        timestamp: mockClock.now(),
        durationSec: 60,
        score: 500,
        hits: 5,
        misses: 0,
        headshots: 3,
        shotsFired: 5,
        accuracy: 100,
        avgReactionMs: 200,
        medianReactionMs: 200,
        bestReactionMs: 200,
        targetsPerSecond: 0.1,
      };
      engine.callbacks.onScenarioComplete?.(res, false);
      if (i < 1) ui.advanceRoutine();
    }

    // Early exit
    ui.exitToMenu();

    expect(ui.activeRoutine).toBeNull();
    expect(mockClock.activeTimeouts.size).toBe(0);
    expect(mockClock.activeIntervals.size).toBe(0);
    expect(store.getRoutineSummaries().length).toBe(0); // NOT saved as completed!
  });

  it('engine pause and resume correctly affects remaining time and pause duration', () => {
    const sc = getScenarioById('flick-static')!;
    engine.startScenario(sc);

    expect(engine.isRunning).toBe(true);
    expect(engine.isPaused).toBe(false);

    // Pause engine
    engine.pause();
    expect(engine.isPaused).toBe(true);
    expect(engine.getPausedDurationMs()).toBeGreaterThanOrEqual(0);

    // Calling pause while already paused is a no-op
    engine.pause();
    expect(engine.isPaused).toBe(true);

    // Resume engine
    engine.resume();
    expect(engine.isPaused).toBe(false);

    // Calling resume while running is a no-op
    engine.resume();
    expect(engine.isPaused).toBe(false);
  });

  it('routine completion records honest active training duration and elapsed duration', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    mockClock.currentTime = 10000;
    ui.startRoutine(routine, 'pro');

    // 5 drills completed: 60s each = 300s active
    for (let i = 0; i < routine.scenarioIds.length; i++) {
      mockClock.tick(60000); // 60s drill
      const res: SessionResult = {
        id: `sess_5m_${i}`,
        scenarioId: routine.scenarioIds[i],
        scenarioName: routine.scenarioIds[i],
        category: 'flick',
        difficulty: 'pro',
        timestamp: mockClock.now(),
        durationSec: 60,
        score: 600,
        hits: 6,
        misses: 2,
        headshots: 4,
        shotsFired: 8,
        accuracy: 75,
        avgReactionMs: 180,
        medianReactionMs: 180,
        bestReactionMs: 170,
        targetsPerSecond: 0.1,
      };

      engine.callbacks.onScenarioComplete?.(res, false);

      if (i < routine.scenarioIds.length - 1) {
        mockClock.tick(4000); // 4s transition automatically advances via clock
      }
    }

    const summaries = store.getRoutineSummaries();
    expect(summaries.length).toBe(1);
    const summary = summaries[0];

    expect(summary.routineId).toBe('routine-5m');
    expect(summary.difficulty).toBe('pro');
    expect(summary.drillsCompleted).toBe(5);
    expect(summary.totalDrills).toBe(5);
    expect(summary.activeDurationSec).toBe(300); // Exact 5 * 60s active aim time
    expect(summary.transitionSec).toBe(16); // 4 transitions * 4s
    expect(summary.totalElapsedSec).toBeGreaterThanOrEqual(316); // Active + transitions
    expect(summary.overallAccuracy).toBe(75); // 30 hits / 40 shots = 75%
  });
});

describe('Sprint 2E — Dashboard True Aggregates & Store Math', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('calculates aggregate accuracy using true total hits and shots, not average of percentages', () => {
    // Session 1: 10 hits / 10 shots = 100%
    store.addSession({
      id: 'acc_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      headshots: 5,
      shotsFired: 10,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.2,
    });

    // Session 2: 10 hits / 90 shots (10 hits + 80 misses) = 11.1%
    store.addSession({
      id: 'acc_2',
      scenarioId: 'flick-micro',
      scenarioName: 'Micro Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + 1,
      durationSec: 60,
      score: 200,
      hits: 10,
      misses: 80,
      headshots: 5,
      shotsFired: 90,
      accuracy: 11.1,
      avgReactionMs: 250,
      medianReactionMs: 250,
      bestReactionMs: 220,
      targetsPerSecond: 0.2,
    });

    // Total hits = 20, Total shots = 100 -> True accuracy = 20.0%
    // If it mistakenly averaged (100 + 11.1) / 2 it would be ~55.5%
    const agg = store.getAggregateStats();
    expect(agg.overallAccuracy).toBe(20.0);
    expect(agg.totalHits).toBe(20);
    expect(agg.totalShots).toBe(100);
  });

  it('calculates aggregate headshot percentage using total headshots and total hits', () => {
    // Session 1: 10 hits, 10 headshots = 100%
    store.addSession({
      id: 'hs_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      headshots: 10,
      shotsFired: 10,
      accuracy: 100,
      headshotPct: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.2,
    });

    // Session 2: 90 hits, 0 headshots = 0%
    store.addSession({
      id: 'hs_2',
      scenarioId: 'flick-wide',
      scenarioName: 'Wide Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + 1,
      durationSec: 60,
      score: 900,
      hits: 90,
      misses: 10,
      headshots: 0,
      shotsFired: 100,
      accuracy: 90,
      headshotPct: 0,
      avgReactionMs: 210,
      medianReactionMs: 210,
      bestReactionMs: 190,
      targetsPerSecond: 1.5,
    });

    // Total headshots = 10, Total hits = 100 -> True HS% = 10.0%
    // Averaging percentages would incorrectly yield 50.0%
    const agg = store.getAggregateStats();
    expect(agg.overallHeadshotPct).toBe(10.0);
    expect(agg.totalHeadshots).toBe(10);
    expect(agg.totalHits).toBe(100);
  });

  it('getBestPerformingScenarios returns top scenarios ranked by highest PB score', () => {
    store.addSession({
      id: 'top_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1500,
      hits: 15,
      misses: 0,
      headshots: 10,
      shotsFired: 15,
      accuracy: 100,
      avgReactionMs: 190,
      medianReactionMs: 190,
      bestReactionMs: 170,
      targetsPerSecond: 0.25,
    });

    store.addSession({
      id: 'top_2',
      scenarioId: 'flick-wide',
      scenarioName: 'Wide Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + 1,
      durationSec: 60,
      score: 2500, // higher score
      hits: 25,
      misses: 2,
      headshots: 15,
      shotsFired: 27,
      accuracy: 92.6,
      avgReactionMs: 180,
      medianReactionMs: 180,
      bestReactionMs: 160,
      targetsPerSecond: 0.42,
    });

    const best = store.getBestPerformingScenarios(5);
    expect(best.length).toBe(2);
    expect(best[0].scenarioId).toBe('flick-wide');
    expect(best[0].bestScore).toBe(2500);
    expect(best[1].scenarioId).toBe('flick-static');
    expect(best[1].bestScore).toBe(1500);
  });
});

describe('Sprint 2E — Like-for-Like Trends & Reaction Disablement', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('requires at least 2 sessions of matching scenario and difficulty before calculating trends', () => {
    // Only 1 session exists
    store.addSession({
      id: 't_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 800,
      hits: 8,
      misses: 2,
      headshots: 4,
      shotsFired: 10,
      accuracy: 80,
      avgReactionMs: 220,
      medianReactionMs: 220,
      bestReactionMs: 200,
      targetsPerSecond: 0.13,
    });

    const trendSingle = store.getScenarioTrend('flick-static', 'intermediate');
    expect(trendSingle.hasEnoughData).toBe(false);
    expect(trendSingle.sampleCount).toBe(1);

    // Add session for different difficulty ('advanced')
    store.addSession({
      id: 't_2',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'advanced',
      timestamp: Date.now() + 10,
      durationSec: 60,
      score: 900,
      hits: 9,
      misses: 1,
      headshots: 6,
      shotsFired: 10,
      accuracy: 90,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.15,
    });

    // Like-for-like check for 'intermediate' still has only 1 sample
    const trendDiff = store.getScenarioTrend('flick-static', 'intermediate');
    expect(trendDiff.hasEnoughData).toBe(false);
    expect(trendDiff.sampleCount).toBe(1);

    // Add 2nd session for 'intermediate'
    store.addSession({
      id: 't_3',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + 20,
      durationSec: 60,
      score: 1100,
      hits: 10,
      misses: 0,
      headshots: 8,
      shotsFired: 10,
      accuracy: 100,
      avgReactionMs: 190,
      medianReactionMs: 190,
      bestReactionMs: 170,
      targetsPerSecond: 0.16,
    });

    const trendReady = store.getScenarioTrend('flick-static', 'intermediate');
    expect(trendReady.hasEnoughData).toBe(true);
    expect(trendReady.sampleCount).toBe(2);
    expect(trendReady.scoreDelta).toBe(300); // 1100 - 800
    expect(trendReady.accuracyDelta).toBe(20.0); // 100 - 80
    expect(trendReady.headshotDelta).toBe(30.0); // 80% - 50% = 30%
    expect(trendReady.reactionDelta).toBe(-30); // 190 - 220 = -30ms (faster!)
  });

  it('marks reaction time delta as not meaningful for tracking scenarios', () => {
    const sc = getScenarioById('track-smooth')!;
    expect(sc.meaningfulReactionTime).toBe(false);

    store.addSession({
      id: 'track_1',
      scenarioId: 'track-smooth',
      scenarioName: 'Smooth Strafe Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1000,
      hits: 0,
      misses: 0,
      headshots: 0,
      accuracy: 70,
      avgReactionMs: 0,
      medianReactionMs: 0,
      bestReactionMs: 0,
      targetsPerSecond: 0,
      timeOnTarget: 70,
    });

    store.addSession({
      id: 'track_2',
      scenarioId: 'track-smooth',
      scenarioName: 'Smooth Strafe Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: Date.now() + 10,
      durationSec: 60,
      score: 1300,
      hits: 0,
      misses: 0,
      headshots: 0,
      accuracy: 85,
      avgReactionMs: 0,
      medianReactionMs: 0,
      bestReactionMs: 0,
      targetsPerSecond: 0,
      timeOnTarget: 85,
    });

    const trend = store.getScenarioTrend('track-smooth', 'intermediate');
    expect(trend.hasEnoughData).toBe(true);
    expect(trend.meaningfulReactionTime).toBe(false);
    expect(trend.reactionDelta).toBeNull();
  });
});

describe('Sprint 2E — Dashboard UI Rendering & Sparklines', () => {
  it('generateSparklineSVG produces valid zero-dependency inline SVG string', () => {
    const svgEmpty = generateSparklineSVG([]);
    expect(svgEmpty).toBe('');

    const svgSingle = generateSparklineSVG([500]);
    expect(svgSingle).toContain('<svg');
    expect(svgSingle).toContain('<circle');

    const svgUp = generateSparklineSVG([100, 200, 300, 400]);
    expect(svgUp).toContain('<svg');
    expect(svgUp).toContain('<polyline');
    expect(svgUp).toContain('points=');
    expect(svgUp).toContain('var(--teal)'); // Up trend is teal/green

    const svgDown = generateSparklineSVG([400, 300, 200, 100]);
    expect(svgDown).toContain('var(--red)'); // Down trend is red
  });

  it('renders Dashboard empty state when zero sessions and routines exist', () => {
    localStorage.clear();
    document.body.innerHTML = '';
    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    appContainer.appendChild(canvas);

    const renderer = new Renderer(canvas, 103, {
      domElement: canvas,
      shadowMap: { enabled: false },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as any);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    ui.navigateTo('stats');

    const container = document.getElementById('page-container')!;
    expect(container.innerHTML).toContain('NO TRAINING SESSIONS RECORDED YET');
    expect(container.querySelector('#btn-empty-play')).not.toBeNull();
    expect(container.querySelector('#btn-empty-plans')).not.toBeNull();
  });

  it('renders Dashboard populated state with isolated routines table and lifetime benchmarks', () => {
    localStorage.clear();
    document.body.innerHTML = '';
    const store = new Store();

    // Add session
    store.addSession({
      id: 'dash_sess_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1200,
      hits: 12,
      misses: 2,
      headshots: 8,
      shotsFired: 14,
      accuracy: 85.7,
      avgReactionMs: 195,
      medianReactionMs: 195,
      bestReactionMs: 180,
      targetsPerSecond: 0.2,
    });

    // Add routine summary
    store.addRoutineSummary({
      id: 'dash_rout_1',
      routineId: 'routine-5m',
      routineName: '5-Minute Rapid Primer',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      totalDurationSec: 300,
      activeDurationSec: 300,
      totalElapsedSec: 316,
      transitionSec: 16,
      pausedSec: 0,
      drillsCompleted: 5,
      totalDrills: 5,
      totalScore: 5500,
      overallAccuracy: 88.0,
      totalHits: 50,
      totalHeadshots: 35,
      totalShotsFired: 57,
    });

    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    appContainer.appendChild(canvas);

    const renderer = new Renderer(canvas, 103, {
      domElement: canvas,
      shadowMap: { enabled: false },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as any);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    ui.navigateTo('stats');

    const container = document.getElementById('page-container')!;
    expect(container.innerHTML).toContain('TRAINING PROGRESS DASHBOARD');
    expect(container.innerHTML).toContain('Total Drills Completed');
    expect(container.innerHTML).toContain('Warm-Up Routines Completed');
    expect(container.innerHTML).toContain('COMPLETED WARM-UP ROUTINES');
    expect(container.innerHTML).toContain('5-Minute Rapid Primer');
    expect(container.innerHTML).toContain('5m 00s'); // Active aim time
    expect(container.innerHTML).toContain('5m 16s'); // Total elapsed time
    expect(container.innerHTML).toContain('LIKE-FOR-LIKE PERFORMANCE TRENDS');
  });

  it('opening the dashboard does not mutate storage or records (pure read-only)', () => {
    localStorage.clear();
    document.body.innerHTML = '';
    const store = new Store();
    store.addSession({
      id: 'readonly_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      headshots: 5,
      shotsFired: 10,
      accuracy: 100,
      avgReactionMs: 200,
      medianReactionMs: 200,
      bestReactionMs: 180,
      targetsPerSecond: 0.16,
    });

    const initialSessions = store.totalSessions();
    const initialRoutines = store.totalRoutines();

    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    appContainer.appendChild(canvas);

    const renderer = new Renderer(canvas, 103, {
      domElement: canvas,
      shadowMap: { enabled: false },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as any);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    // Navigate to stats multiple times
    ui.navigateTo('stats');
    ui.navigateTo('home');
    ui.navigateTo('stats');

    expect(store.totalSessions()).toBe(initialSessions);
    expect(store.totalRoutines()).toBe(initialRoutines);
  });
});

describe('Sprint 4 — Session History Management, Pagination & Diagnostics Export', () => {
  let store: Store;

  function createTestSession(id: string, scenarioId = 'flick-static', score = 1000, overrides: Partial<SessionResult> = {}): SessionResult {
    return {
      id,
      scenarioId,
      scenarioName: scenarioId,
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + Math.floor(Math.random() * 1000),
      durationSec: 60,
      score,
      hits: 20,
      misses: 5,
      headshots: 10,
      shotsFired: 25,
      accuracy: 80,
      avgReactionMs: 220,
      medianReactionMs: 220,
      bestReactionMs: 190,
      targetsPerSecond: 0.33,
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('exportSessionsJSON exports all stored sessions with metadata envelope', () => {
    for (let i = 0; i < 25; i++) {
      store.addSession(createTestSession(`sess_${i}`, 'flick-static', 1000 + i * 10));
    }

    const exported = store.exportSessionsJSON();
    expect(typeof exported).toBe('string');

    const parsed = JSON.parse(exported);
    expect(parsed.version).toBe('vwt-history-v1');
    expect(typeof parsed.exportedAt).toBe('number');
    expect(parsed.totalSessions).toBe(25);
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.sessions.length).toBe(25);
    expect(parsed.sessions[0].scenarioId).toBe('flick-static');
    expect(parsed.sessions[0].score).toBeDefined();
  });

  it('importSessionsJSON safely imports valid envelope and deduplicates existing records', () => {
    const s1 = createTestSession('sess_1', 'flick-static', 1100);
    const s2 = createTestSession('sess_2', 'track-smooth', 1200, { category: 'tracking' });

    store.addSession(s1);
    expect(store.totalSessions()).toBe(1);

    const importPayload = {
      version: 'vwt-history-v1',
      exportedAt: Date.now(),
      totalSessions: 2,
      sessions: [s1, s2], // s1 is a duplicate, s2 is new
    };

    const res = store.importSessionsJSON(JSON.stringify(importPayload));
    expect(res.success).toBe(true);
    expect(res.importedCount).toBe(1);
    expect(res.duplicateCount).toBe(1);
    expect(res.invalidCount).toBe(0);
    expect(store.totalSessions()).toBe(2);
  });

  it('importSessionsJSON handles mixed records: imports valid, skips duplicates, discards invalid', () => {
    const existing = createTestSession('existing_1', 'flick-static', 800);
    store.addSession(existing);

    const validNew1 = createTestSession('new_1', 'flick-static', 1200);
    const validNew2 = createTestSession('new_2', 'tactical-counter-strafe', 900, { category: 'tactical' });
    const duplicate = createTestSession('existing_1', 'flick-static', 800);
    const invalidNoScenario = { score: 500, hits: 10 };
    const invalidNull = null;
    const invalidMalformed = 'not-an-object';

    const payload = [
      validNew1,
      duplicate,
      invalidNoScenario,
      invalidNull,
      validNew2,
      invalidMalformed,
    ];

    const res = store.importSessionsJSON(JSON.stringify(payload));
    expect(res.success).toBe(true);
    expect(res.importedCount).toBe(2);
    expect(res.duplicateCount).toBe(1);
    expect(res.invalidCount).toBe(3);
    expect(store.totalSessions()).toBe(3);
  });

  it('importSessionsJSON rejects payloads with zero valid records without mutating existing history', () => {
    store.addSession(createTestSession('keep_1', 'flick-static', 1000));
    expect(store.totalSessions()).toBe(1);

    const res = store.importSessionsJSON(JSON.stringify([
      null,
      {},
      { score: 500 },
      'invalid',
    ]));

    expect(res.success).toBe(false);
    expect(res.error).toContain('No valid session records found');
    expect(store.totalSessions()).toBe(1);
  });

  it('importSessionsJSON rejects invalid JSON syntax without mutating storage', () => {
    store.addSession(createTestSession('keep_1', 'flick-static', 1000));

    const res = store.importSessionsJSON('{ invalid json syntax ');
    expect(res.success).toBe(false);
    expect(res.error).toContain('JSON parse error');
    expect(store.totalSessions()).toBe(1);
  });

  it('importSessionsJSON clamps to MAX_SESSIONS = 100', () => {
    const batch120: SessionResult[] = [];
    for (let i = 0; i < 120; i++) {
      batch120.push(createTestSession(`import_${i}`, 'flick-static', 500 + i, { timestamp: 1000000 + i }));
    }

    const res = store.importSessionsJSON(JSON.stringify(batch120));
    expect(res.success).toBe(true);
    expect(res.importedCount).toBe(120);
    expect(res.retainedCount).toBe(100);
    expect(res.excludedByCapCount).toBe(20);
    expect(store.totalSessions()).toBe(100);
  });

  it('accurately distinguishes retained records from cap-excluded records when merging history', () => {
    const store = new Store();
    for (let i = 0; i < 90; i++) {
      store.addSession(createTestSession(`exist_${i}`, 'flick-static', 800, { timestamp: 2000000 + i }));
    }
    expect(store.totalSessions()).toBe(90);

    // Import 25 older sessions (timestamp: 1000000 + i)
    const older25: SessionResult[] = [];
    for (let i = 0; i < 25; i++) {
      older25.push(createTestSession(`old_${i}`, 'flick-static', 700, { timestamp: 1000000 + i }));
    }

    const res = store.importSessionsJSON(JSON.stringify(older25));
    expect(res.success).toBe(true);
    expect(res.importedCount).toBe(25);
    expect(res.retainedCount).toBe(10);
    expect(res.excludedByCapCount).toBe(15);
    expect(store.totalSessions()).toBe(100);
  });

  it('importSessionsJSON handles storage failure atomically without partial updates', () => {
    store.addSession(createTestSession('initial_1', 'flick-static', 1000));
    const countBefore = store.totalSessions();

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });

    const newSession = createTestSession('will_fail_1', 'track-smooth', 1200);
    const res = store.importSessionsJSON(JSON.stringify([newSession]));

    expect(res.success).toBe(false);
    expect(res.error).toContain('Storage failure');
    expect(store.totalSessions()).toBe(countBefore);

    setItemSpy.mockRestore();
  });

  it('clearSessions selectively deletes drill sessions while strictly preserving personal bests and routines', () => {
    // Add drill session that establishes a PB
    store.addSession(createTestSession('sess_pb_1', 'flick-static', 1500, { difficulty: 'intermediate' }));
    expect(store.getPB('flick-static')?.score).toBe(1500);

    // Add a routine summary
    store.addRoutineSummary({
      id: 'routine_sum_1',
      routineId: 'routine-5m',
      routineName: 'Quick 5-Minute Warm-Up',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      totalDurationSec: 300,
      activeDurationSec: 300,
      totalElapsedSec: 316,
      transitionSec: 16,
      pausedSec: 0,
      retriesCount: 0,
      drillsCompleted: 5,
      totalDrills: 5,
      totalScore: 5000,
      overallAccuracy: 85,
      totalHits: 50,
      totalHeadshots: 25,
      totalShotsFired: 60,
    });

    expect(store.totalSessions()).toBe(1);
    expect(store.totalRoutines()).toBe(1);

    // Clear sessions
    store.clearSessions();

    // Sessions are wiped
    expect(store.totalSessions()).toBe(0);
    expect(store.getSessions().length).toBe(0);
    expect(localStorage.getItem(LS_SESSIONS)).toBeNull();

    // Personal bests and routine records are PRESERVED!
    expect(store.getPB('flick-static')?.score).toBe(1500);
    expect(store.totalRoutines()).toBe(1);
    expect(store.getRoutineSummaries().length).toBe(1);
    expect(localStorage.getItem(LS_PERSONAL_BESTS)).not.toBeNull();
    expect(localStorage.getItem(LS_ROUTINES)).not.toBeNull();
  });

  it('getFilteredSessions supports pagination, filtering by category and difficulty, and sorting', () => {
    // Add 25 sessions: 10 flick, 10 tracking, 5 tactical
    for (let i = 0; i < 10; i++) {
      store.addSession(createTestSession(`flick_${i}`, 'flick-static', 800 + i * 20, { category: 'flick', difficulty: 'intermediate', timestamp: 1000 + i }));
    }
    for (let i = 0; i < 10; i++) {
      store.addSession(createTestSession(`track_${i}`, 'track-smooth', 600 + i * 30, { category: 'tracking', difficulty: 'advanced', timestamp: 2000 + i }));
    }
    for (let i = 0; i < 5; i++) {
      store.addSession(createTestSession(`tac_${i}`, 'tactical-counter-strafe', 1200 + i * 10, { category: 'tactical', difficulty: 'pro', timestamp: 3000 + i }));
    }

    expect(store.totalSessions()).toBe(25);

    // Page 1 with pageSize 10
    const p1 = store.getFilteredSessions({ page: 1, pageSize: 10 });
    expect(p1.sessions.length).toBe(10);
    expect(p1.totalPages).toBe(3);
    expect(p1.currentPage).toBe(1);
    expect(p1.totalRecords).toBe(25);

    // Page 3 with pageSize 10
    const p3 = store.getFilteredSessions({ page: 3, pageSize: 10 });
    expect(p3.sessions.length).toBe(5);
    expect(p3.currentPage).toBe(3);

    // Out-of-bounds page clamping (page 99 -> page 3)
    const pClamp = store.getFilteredSessions({ page: 99, pageSize: 10 });
    expect(pClamp.currentPage).toBe(3);

    // Category filter: tracking only (10 records)
    const trackOnly = store.getFilteredSessions({ category: 'tracking' });
    expect(trackOnly.totalRecords).toBe(10);
    expect(trackOnly.sessions.every((s) => s.category === 'tracking')).toBe(true);

    // Difficulty filter: pro only (5 records)
    const proOnly = store.getFilteredSessions({ difficulty: 'pro' });
    expect(proOnly.totalRecords).toBe(5);
    expect(proOnly.sessions.every((s) => s.difficulty === 'pro')).toBe(true);

    // Sorting by score desc
    const sorted = store.getFilteredSessions({ sortBy: 'score_desc', pageSize: 25 });
    for (let i = 0; i < sorted.sessions.length - 1; i++) {
      expect(sorted.sessions[i].score).toBeGreaterThanOrEqual(sorted.sessions[i + 1].score);
    }
  });

  it('UI mounts Session History controls, opens clear confirmation modal, and cancels safely', () => {
    store.addSession(createTestSession('ui_sess_1', 'flick-static', 1000));

    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    appContainer.appendChild(canvas);

    const renderer = new Renderer(canvas, 103, {
      domElement: canvas,
      shadowMap: { enabled: false },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    } as any);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    ui.navigateTo('stats');

    // Controls must be present
    const exportBtn = document.getElementById('btn-export-history') as HTMLButtonElement;
    const importBtn = document.getElementById('btn-import-history') as HTMLButtonElement;
    const clearBtn = document.getElementById('btn-clear-history') as HTMLButtonElement;
    const modal = document.getElementById('modal-clear-history') as HTMLElement;

    expect(exportBtn).not.toBeNull();
    expect(importBtn).not.toBeNull();
    expect(clearBtn).not.toBeNull();
    expect(modal).not.toBeNull();
    expect(modal.style.display).toBe('none');

    // Click Clear History -> modal opens
    clearBtn.click();
    const modalOpen = document.getElementById('modal-clear-history') as HTMLElement;
    expect(modalOpen.style.display).toBe('flex');

    // Click Cancel -> modal closes, history untouched
    const cancelBtn = document.getElementById('btn-cancel-clear') as HTMLButtonElement;
    cancelBtn.click();
    const modalClosed = document.getElementById('modal-clear-history') as HTMLElement;
    expect(modalClosed.style.display).toBe('none');
    expect(store.totalSessions()).toBe(1);

    // Open modal again and confirm clear
    const clearBtn2 = document.getElementById('btn-clear-history') as HTMLButtonElement;
    clearBtn2.click();
    const confirmBtn = document.getElementById('btn-confirm-clear') as HTMLButtonElement;
    confirmBtn.click();

    expect(store.totalSessions()).toBe(0);
    const feedbackToast = document.body.innerHTML;
    expect(feedbackToast).toContain('All drill session history cleared');
    ui.dispose();
  });
});

describe('Sprint 5 — Release Hardening, Performance & Accessibility', () => {
  function createTestSession(id: string, scenarioId = 'flick-static', score = 1000, overrides: Partial<SessionResult> = {}): SessionResult {
    return {
      id,
      scenarioId,
      scenarioName: scenarioId,
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now() + Math.floor(Math.random() * 1000),
      durationSec: 60,
      score,
      hits: 20,
      misses: 5,
      headshots: 10,
      shotsFired: 25,
      accuracy: 80,
      avgReactionMs: 220,
      medianReactionMs: 220,
      bestReactionMs: 190,
      targetsPerSecond: 0.33,
      ...overrides,
    };
  }

  function createMockRenderer(canvas: HTMLCanvasElement): Renderer {
    return new Renderer(canvas, 103, {
      domElement: canvas,
      shadowMap: { enabled: false },
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      clearDepth: vi.fn(),
      setViewport: vi.fn(),
      setScissor: vi.fn(),
      setScissorTest: vi.fn(),
    } as any);
  }

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips WebGL rendering when drill is inactive and resumes when active (C-1)', () => {
    const store = new Store();
    const canvas = document.createElement('canvas');
    const renderer = createMockRenderer(canvas);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);

    const renderSpy = vi.spyOn(renderer, 'render');

    // Inactive drill — should skip rendering
    expect(engine.isRunning).toBe(false);
    engine.update();
    expect(renderSpy).not.toHaveBeenCalled();

    // Active drill — should execute render
    const sc = getScenarioById('flick-static')!;
    engine.startScenario(sc, 'intermediate');
    expect(engine.isRunning).toBe(true);
    engine.update();
    expect(renderSpy).toHaveBeenCalledTimes(1);

    // Stop scenario — should skip rendering again
    engine.stopScenario();
    engine.update();
    expect(renderSpy).toHaveBeenCalledTimes(1);

    renderer.dispose();
    controls.dispose();
  });

  it('reuses normalized unit geometries across multiple target spawns without buffer re-instantiation (C-2)', () => {
    const canvas = document.createElement('canvas');
    const renderer = createMockRenderer(canvas);

    renderer.addTarget('t1', new THREE.Vector3(0, 1.7, -10), 0.22);
    renderer.addTarget('t2', new THREE.Vector3(2, 1.7, -10), 0.35);
    renderer.addTarget('t3', new THREE.Vector3(-2, 1.7, -10), 0.15);

    const v1 = renderer.getTargetVisual('t1')!;
    const v2 = renderer.getTargetVisual('t2')!;
    const v3 = renderer.getTargetVisual('t3')!;

    // Geometries must be strictly identical references to the shared unit geometries
    expect(v1.headMesh.geometry).toBe(renderer.sharedHeadGeo);
    expect(v2.headMesh.geometry).toBe(renderer.sharedHeadGeo);
    expect(v3.headMesh.geometry).toBe(renderer.sharedHeadGeo);

    expect(v1.torsoMesh.geometry).toBe(renderer.sharedTorsoGeo);
    expect(v2.torsoMesh.geometry).toBe(renderer.sharedTorsoGeo);
    expect(v3.torsoMesh.geometry).toBe(renderer.sharedTorsoGeo);

    expect(v1.shoulderMesh!.geometry).toBe(renderer.sharedShoulderGeo);
    expect(v2.shoulderMesh!.geometry).toBe(renderer.sharedShoulderGeo);

    // Each target mesh must have its own material clone (no cross-target flash mutation)
    expect(v1.headMesh.material).not.toBe(v2.headMesh.material);

    // Dynamic scale transforms must match target dimensions
    const expectedHeadR1 = 0.13 * (0.22 / 0.22);
    const expectedHeadR2 = 0.13 * (0.35 / 0.22);
    expect(v1.headMesh.scale.x).toBeCloseTo(expectedHeadR1);
    expect(v2.headMesh.scale.x).toBeCloseTo(expectedHeadR2);

    // Remove target 1 — shared unit geometries must not be disposed
    renderer.removeTarget('t1');
    expect(renderer.getTargetVisual('t1')).toBeUndefined();
    expect(v2.headMesh.geometry).toBe(renderer.sharedHeadGeo);

    // Cleanup
    renderer.dispose();
  });

  it('caches noise buffer pool per sound profile to prevent repeated AudioBuffer allocations (C-2)', () => {
    const audio = new AudioManager();
    audio.init();

    const ctx = (audio as any).ctx;
    if (ctx && typeof ctx.createBuffer === 'function') {
      const createBufferSpy = vi.spyOn(ctx, 'createBuffer');

      // Firing 6 shots in profile 'tactical-clean'
      for (let i = 0; i < 6; i++) {
        audio.playGunshot('tactical-clean');
      }

      // Initial pool of 4 buffers was created on first call
      expect(createBufferSpy).toHaveBeenCalledTimes(4);

      // Subsequent shots reuse the cached 4-buffer pool without further allocations
      for (let i = 0; i < 10; i++) {
        audio.playGunshot('tactical-clean');
      }
      expect(createBufferSpy).toHaveBeenCalledTimes(4);
    }

    audio.dispose();
  });

  it('navigates via semantic button nav links and activates scenario cards on Enter and Space (H-1)', () => {
    const store = new Store();
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    const renderer = createMockRenderer(canvas);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    // Find Scenarios nav button
    const scenNavBtn = appContainer.querySelector('button.nav-link[data-page="scenarios"]') as HTMLButtonElement;
    expect(scenNavBtn).not.toBeNull();
    expect(scenNavBtn.tagName).toBe('BUTTON');

    scenNavBtn.click();
    expect(appContainer.innerHTML).toContain('TRAINING SCENARIOS');

    // Find first scenario card
    const firstCard = appContainer.querySelector('.scenario-card[data-scen]') as HTMLElement;
    expect(firstCard).not.toBeNull();
    expect(firstCard.getAttribute('role')).toBe('button');
    expect(firstCard.getAttribute('tabindex')).toBe('0');

    const launchSpy = vi.spyOn(ui, 'launchScenario');

    // Keydown Enter on card
    firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(launchSpy).toHaveBeenCalledTimes(1);

    // Keydown Space on card
    firstCard.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(launchSpy).toHaveBeenCalledTimes(2);

    ui.dispose();
    controls.dispose();
    renderer.dispose();
    appContainer.remove();
    canvas.remove();
  });

  it('traps focus in clear confirmation modal and dismisses safely on Escape key without clearing data (H-2)', () => {
    const store = new Store();
    store.addSession({
      id: 'sess_preserve_1',
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1500,
      hits: 15,
      misses: 2,
      headshots: 10,
      accuracy: 88.2,
      avgReactionMs: 210,
      medianReactionMs: 205,
      bestReactionMs: 180,
      targetsPerSecond: 0.25,
    });

    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);

    const renderer = createMockRenderer(canvas);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    ui.navigateTo('stats');

    // Open Clear History modal
    const clearBtn = document.getElementById('btn-clear-history') as HTMLButtonElement;
    clearBtn.click();

    const modal = document.getElementById('modal-clear-history') as HTMLElement;
    expect(modal.style.display).toBe('flex');
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');

    const cancelBtn = document.getElementById('btn-cancel-clear') as HTMLButtonElement;
    const confirmBtn = document.getElementById('btn-confirm-clear') as HTMLButtonElement;

    // Focus starts on cancel
    expect(document.activeElement).toBe(cancelBtn);

    // Tab key cycling: shift-tab from cancel goes to confirm
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(confirmBtn);

    // Escape key dismissal
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

    // Modal must be closed and data must be preserved
    const closedModal = document.getElementById('modal-clear-history') as HTMLElement;
    expect(closedModal.style.display).toBe('none');
    expect(store.totalSessions()).toBe(1);

    ui.dispose();
    controls.dispose();
    renderer.dispose();
    appContainer.remove();
    canvas.remove();
  });

  it('executes 150 sequential target spawns and gunshots stably', () => {
    const store = new Store();
    const canvas = document.createElement('canvas');
    const renderer = createMockRenderer(canvas);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);

    const sc = getScenarioById('flick-static')!;
    engine.startScenario(sc, 'intermediate');

    // Rapidly spawn, shoot and remove 150 targets
    for (let i = 0; i < 150; i++) {
      engine.targets.spawnTarget(sc);
      (engine as any).handleShoot();
      const targets = engine.targets.getTargets();
      if (targets.length > 5) {
        engine.targets.removeTarget(targets[0].id);
      }
    }

    expect(engine.isRunning).toBe(true);
    expect(engine.targets.getActiveCount()).toBeLessThanOrEqual(6);

    engine.stopScenario();
    expect(engine.isRunning).toBe(false);
    expect(engine.targets.getActiveCount()).toBe(0);

    renderer.dispose();
    controls.dispose();
    audio.dispose();
  });

  it('wraps all dashboard tables in .table-scroll-wrapper with horizontal overflow capability', () => {
    const store = new Store();
    store.addSession(createTestSession('pb_check_1', 'flick-static', 1500));
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const renderer = createMockRenderer(canvas);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    ui.navigateTo('stats');

    const tableWrappers = appContainer.querySelectorAll('.table-scroll-wrapper');
    expect(tableWrappers.length).toBeGreaterThanOrEqual(2);
    tableWrappers.forEach((w) => {
      expect((w as HTMLElement).style.overflowX).toBe('auto');
    });

    ui.dispose();
    controls.dispose();
    renderer.dispose();
  });
});
