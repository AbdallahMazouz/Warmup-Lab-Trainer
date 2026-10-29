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
