import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { UIManager, type TimingClock } from '../src/ui';
import { Engine } from '../src/engine';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { SCENARIOS, TRAINING_ROUTINES } from '../src/scenarios';
import type { SessionResult, RecommendationResult } from '../src/types';

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

function createDummySession(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    id: `session_${Math.random()}`,
    scenarioId: 'flick-static',
    scenarioName: 'Static Flicks',
    category: 'flick',
    difficulty: 'intermediate',
    timestamp: Date.now(),
    durationSec: 60,
    score: 1000,
    hits: 20,
    misses: 5,
    headshots: 10,
    shotsFired: 25,
    accuracy: 80.0,
    headshotPct: 50.0,
    avgReactionMs: 220,
    medianReactionMs: 220,
    bestReactionMs: 190,
    targetsPerSecond: 0.33,
    ...overrides,
  };
}

describe('Sprint 3B-B — Training Intelligence UI Integration', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;
  let ui: UIManager;
  let clock: MockTimingClock;

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

    clock = new MockTimingClock();
    renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    controls = new Controls(renderer.camera, canvas);
    audio = new AudioManager();
    settings = new SettingsManager();
    store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
    ui = new UIManager(engine, appContainer, canvas, clock);
  });

  afterEach(() => {
    ui.exitToMenu();
    controls.dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders cold-start diagnostic recommendation on empty dashboard and launches routine', () => {
    ui.navigateTo('stats');

    const container = document.getElementById('page-container')!;
    expect(container.innerHTML).toContain('DIAGNOSTIC BASELINE RECOMMENDED');
    expect(container.innerHTML).toContain('NO TRAINING SESSIONS RECORDED YET');

    const diagBtn = container.querySelector('#btn-empty-diagnostic') as HTMLButtonElement | null;
    expect(diagBtn).not.toBeNull();
    expect(diagBtn?.textContent).toContain('START 5-MIN DIAGNOSTIC ROUTINE');

    const startRoutineSpy = vi.spyOn(ui, 'startRoutine');

    diagBtn?.click();

    expect(startRoutineSpy).toHaveBeenCalledTimes(1);
    expect(startRoutineSpy.mock.calls[0][0].id).toBe('routine-5m');
  });

  it('renders Training Intelligence section and skill dimension bars with established sessions', () => {
    // Add 3 sessions to exit cold start
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      category: 'flick',
      accuracy: 50.0, // weak flick accuracy (< 70)
    }));
    store.addSession(createDummySession({
      scenarioId: 'flick-micro',
      category: 'flick',
      accuracy: 55.0, // weak flick accuracy
    }));
    store.addSession(createDummySession({
      scenarioId: 'track-smooth',
      category: 'tracking',
      timeOnTarget: 75.0, // solid tracking (>= 65)
    }));

    ui.navigateTo('stats');

    const container = document.getElementById('page-container')!;
    expect(container.innerHTML).toContain('TRAINING INTELLIGENCE &amp; RECOMMENDATIONS');
    expect(container.innerHTML).toContain('DEFICIT FOCUS: FLICK ACCURACY');

    // Recommendation launch button exists
    const recBtn = container.querySelector('#btn-rec-launch') as HTMLButtonElement | null;
    expect(recBtn).not.toBeNull();

    // Verify dimension evaluations rendering
    expect(container.innerHTML).toContain('Flick Accuracy');
    expect(container.innerHTML).toContain('DEFICIT');

    // Untested dimension must show UNTESTED / NO DATA, never 0 score weakness
    expect(container.innerHTML).toContain('Steady Aim &amp; Movement Discipline');
    expect(container.innerHTML).toContain('UNTESTED');
    expect(container.innerHTML).toContain('NO DATA');

    // Tracking should show ON TARGET
    expect(container.innerHTML).toContain('Tracking Smoothness');
  });

  it('viewing the dashboard does not mutate stored history', () => {
    store.addSession(createDummySession({ scenarioId: 'flick-static' }));
    const countBefore = store.totalSessions();
    const pbsBefore = Object.keys(store.getAllPBs()).length;

    ui.navigateTo('stats');
    ui.navigateTo('stats');

    expect(store.totalSessions()).toBe(countBefore);
    expect(Object.keys(store.getAllPBs()).length).toBe(pbsBefore);
  });

  it('drill result screen displays recommended next training step for standalone drills', () => {
    const result = createDummySession({
      scenarioId: 'flick-static',
      score: 1100,
      difficulty: 'advanced',
    });

    ui.showResultsScreen(result, false);

    const overlay = document.getElementById('result-overlay')!;
    expect(overlay.classList.contains('visible')).toBe(true);
    expect(overlay.innerHTML).toContain('NEXT TRAINING STEP');

    const launchRecBtn = overlay.querySelector('#btn-res-rec-launch') as HTMLButtonElement | null;
    expect(launchRecBtn).not.toBeNull();
  });

  it('in-routine drills do not show standalone recommendation card to preserve routine flow', () => {
    const routine = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    const result = createDummySession({
      scenarioId: routine.scenarioIds[0],
      score: 800,
    });

    ui.showResultsScreen(result, false);

    const overlay = document.getElementById('result-overlay')!;
    expect(overlay.innerHTML).toContain(`ROUTINE: ${routine.name.toUpperCase()}`);
    // Should NOT contain standalone recommendation next step card
    expect(overlay.querySelector('#btn-res-rec-launch')).toBeNull();
  });

  it('executeRecommendationLaunch launches valid drill and propagates difficulty', () => {
    const launchSpy = vi.spyOn(ui, 'launchScenario');

    const rec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'tactical-counter-strafe',
      recommendedScenarioName: 'Counter-Strafe Practice',
      targetDifficulty: 'advanced',
      primaryDimension: 'steady_aim_discipline',
      confidence: 0.5,
      title: 'Focus Drill: Counter-Strafe Practice',
      rationale: 'Stop before firing.',
      evidence: 'Stationary ratio was 30%.',
      benchmarkTarget: '>= 75%',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(rec);

    expect(launchSpy).toHaveBeenCalledWith('tactical-counter-strafe', 'advanced');
  });

  it('executeRecommendationLaunch launches valid routine for cold-start recommendations', () => {
    const startRoutineSpy = vi.spyOn(ui, 'startRoutine');

    const rec: RecommendationResult = {
      isColdStart: true,
      recommendationType: 'routine',
      recommendedRoutineId: 'routine-5m',
      recommendedRoutineName: 'Quick 5-Minute Warm-Up',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0,
      title: 'Diagnostic Baseline Recommended',
      rationale: 'Complete baseline.',
      evidence: '0 sessions recorded.',
      benchmarkTarget: 'Complete 5m routine.',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(rec);

    expect(startRoutineSpy).toHaveBeenCalledTimes(1);
    expect(startRoutineSpy.mock.calls[0][0].id).toBe('routine-5m');
    expect(startRoutineSpy.mock.calls[0][1]).toBe('intermediate');
  });

  it('safely rejects invalid scenario or routine IDs without throwing or corrupting state', () => {
    const launchSpy = vi.spyOn(ui, 'launchScenario');
    const startRoutineSpy = vi.spyOn(ui, 'startRoutine');

    const invalidDrillRec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'nonexistent-scenario-id-xyz',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0,
      title: 'Bad Drill',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    expect(() => ui.executeRecommendationLaunch(invalidDrillRec)).not.toThrow();
    expect(launchSpy).not.toHaveBeenCalled();

    const invalidRoutineRec: RecommendationResult = {
      isColdStart: true,
      recommendationType: 'routine',
      recommendedRoutineId: 'nonexistent-routine-id-xyz',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0,
      title: 'Bad Routine',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    expect(() => ui.executeRecommendationLaunch(invalidRoutineRec)).not.toThrow();
    expect(startRoutineSpy).not.toHaveBeenCalled();
  });

  it('prevents duplicate launch execution when called in rapid succession', () => {
    const launchSpy = vi.spyOn(ui, 'launchScenario');

    const rec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'flick-static',
      targetDifficulty: 'intermediate',
      primaryDimension: 'flick_accuracy',
      confidence: 0.5,
      title: 'Drill',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(rec);
    ui.executeRecommendationLaunch(rec); // Rapid duplicate call

    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('validate before mutation: invalid recommendation does not hide visible result overlay or clear timers', () => {
    const dummyResult = createDummySession({ scenarioId: 'flick-static' });
    ui.showResultsScreen(dummyResult, false);

    const overlay = document.getElementById('result-overlay')!;
    expect(overlay.classList.contains('visible')).toBe(true);

    const invalidRec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'nonexistent-scenario-xyz',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0,
      title: 'Bad Rec',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(invalidRec);

    // Overlay must remain visible and usable after invalid launch attempt
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('failure recovery: rejected recommendation launch immediately unblocks the launch guard', () => {
    const launchSpy = vi.spyOn(ui, 'launchScenario');

    const invalidRec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'nonexistent-scenario-xyz',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0,
      title: 'Bad Rec',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    const validRec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'flick-static',
      targetDifficulty: 'intermediate',
      primaryDimension: 'flick_accuracy',
      confidence: 0.5,
      title: 'Valid Rec',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    // First attempt fails validation
    ui.executeRecommendationLaunch(invalidRec);
    expect(launchSpy).not.toHaveBeenCalled();

    // Second attempt with valid rec must immediately succeed without waiting for 300ms clock tick
    ui.executeRecommendationLaunch(validRec);
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(launchSpy).toHaveBeenCalledWith('flick-static', 'intermediate');
  });

  it('failure recovery: an exception during launch releases the launch guard immediately', () => {
    let callCount = 0;
    const launchSpy = vi.spyOn(ui, 'launchScenario').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Simulated hardware/webgl failure');
      }
    });

    const rec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'flick-static',
      targetDifficulty: 'intermediate',
      primaryDimension: 'flick_accuracy',
      confidence: 0.5,
      title: 'Drill',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    // First launch throws error
    expect(() => ui.executeRecommendationLaunch(rec)).toThrow('Simulated hardware/webgl failure');

    // Second launch must not be locked out by a stuck launch guard
    expect(() => ui.executeRecommendationLaunch(rec)).not.toThrow();
    expect(launchSpy).toHaveBeenCalledTimes(2);
  });

  it('stale routine transition timer cannot advance a newly launched routine', () => {
    const r5 = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m')!;
    const r10 = TRAINING_ROUTINES.find((r) => r.id === 'routine-10m')!;

    // Start routine 5m
    ui.startRoutine(r5, 'intermediate');
    expect(ui.activeRoutine?.id).toBe('routine-5m');

    // Drill completes, triggering result screen and 5s auto-transition timer
    const dummyResult = createDummySession({ scenarioId: r5.scenarioIds[0] });
    ui.showResultsScreen(dummyResult, false);

    // Now, launch a new routine (routine-10m) via recommendation
    const recRoutine10: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'routine',
      recommendedRoutineId: 'routine-10m',
      targetDifficulty: 'intermediate',
      primaryDimension: null,
      confidence: 0.5,
      title: 'Switch to 10m Routine',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };
    ui.executeRecommendationLaunch(recRoutine10);

    expect(ui.activeRoutine?.id).toBe('routine-10m');
    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Fast-forward clock past the original 5s transition time
    clock.tick(6000);

    // Routine-10m must STILL be on drill index 0, not advanced by stale Routine-5m timer!
    expect(ui.activeRoutine?.id).toBe('routine-10m');
    expect(ui.activeRoutine?.currentIndex).toBe(0);
  });

  it('handles denied or throwing pointer lock safely during recommendation launch', () => {
    // Simulate pointer lock rejecting or throwing
    canvas.requestPointerLock = vi.fn().mockImplementation(() => {
      throw new Error('Pointer lock denied by browser policy');
    });

    const rec: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'flick-static',
      targetDifficulty: 'intermediate',
      primaryDimension: 'flick_accuracy',
      confidence: 0.5,
      title: 'Drill',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    // Launch must proceed and start engine without throwing
    expect(() => ui.executeRecommendationLaunch(rec)).not.toThrow();
    expect(engine.isRunning).toBe(true);
    expect(engine.activeConfig?.id).toBe('flick-static');
  });

  it('difficulty propagation falls back safely for unrecognized difficulty inputs', () => {
    const launchSpy = vi.spyOn(ui, 'launchScenario');
    const startRoutineSpy = vi.spyOn(ui, 'startRoutine');

    const drillWithBogusDiff: RecommendationResult = {
      isColdStart: false,
      recommendationType: 'drill',
      recommendedScenarioId: 'flick-static',
      targetDifficulty: 'invalid_tier_123' as any,
      primaryDimension: null,
      confidence: 0,
      title: 'Bogus Drill',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(drillWithBogusDiff);
    // Should fall back to flick-static's native difficulty ('intermediate')
    expect(launchSpy).toHaveBeenCalledWith('flick-static', 'intermediate');

    // Advance clock past debounce guard
    clock.tick(300);

    const routineWithBogusDiff: RecommendationResult = {
      isColdStart: true,
      recommendationType: 'routine',
      recommendedRoutineId: 'routine-5m',
      targetDifficulty: 'invalid_tier_456' as any,
      primaryDimension: null,
      confidence: 0,
      title: 'Bogus Routine',
      rationale: '',
      evidence: '',
      benchmarkTarget: '',
      dimensionEvaluations: [],
    };

    ui.executeRecommendationLaunch(routineWithBogusDiff);
    expect(startRoutineSpy).toHaveBeenCalledWith(expect.anything(), 'intermediate');
  });

  it('renders NO DATA, PRELIMINARY, DEFICIT, and ON TARGET accurately for skill dimension badges', () => {
    // 1 flick drill with poor accuracy (1 sample < 2 => PRELIMINARY)
    store.addSession(createDummySession({
      scenarioId: 'flick-static',
      category: 'flick',
      accuracy: 45.0, // below 70 benchmark
    }));

    // 2 tracking drills with poor uptime (2 samples >= 2 and < 65 benchmark => DEFICIT)
    store.addSession(createDummySession({
      scenarioId: 'track-smooth',
      category: 'tracking',
      timeOnTarget: 40.0,
    }));
    store.addSession(createDummySession({
      scenarioId: 'track-strafe',
      category: 'tracking',
      timeOnTarget: 42.0,
    }));

    ui.navigateTo('stats');
    const container = document.getElementById('page-container')!;

    // Flick Accuracy has 1 sample: must be PRELIMINARY, never DEFICIT
    expect(container.innerHTML).toContain('PRELIMINARY');

    // Tracking has 2 samples below benchmark: must be DEFICIT
    expect(container.innerHTML).toContain('DEFICIT');

    // Untested dimensions (steady aim, reaction, headshot) must be UNTESTED and NO DATA
    expect(container.innerHTML).toContain('UNTESTED');
    expect(container.innerHTML).toContain('NO DATA');

    // Add 2 good headshot sessions (>= 45.5 benchmark => ON TARGET)
    store.addSession(createDummySession({
      scenarioId: 'tactical-headlevel',
      category: 'tactical',
      hits: 10,
      headshots: 9, // 90% HS
      headshotPct: 90.0,
    }));
    store.addSession(createDummySession({
      scenarioId: 'tactical-headlevel',
      category: 'tactical',
      hits: 10,
      headshots: 8, // 80% HS
      headshotPct: 80.0,
    }));

    ui.navigateTo('stats');
    const updatedContainer = document.getElementById('page-container')!;
    expect(updatedContainer.innerHTML).toContain('ON TARGET');
  });

  it('pointer lock failure via rejected promise shows lock overlay and pauses engine', async () => {
    canvas.requestPointerLock = vi.fn().mockReturnValue(Promise.reject(new Error('Permission denied')));

    ui.launchScenario('flick-static', 'intermediate');
    await Promise.resolve(); // Allow promise rejection handler to run

    const lockOverlay = document.getElementById('lock-overlay')!;
    expect(lockOverlay.classList.contains('visible')).toBe(true);
    expect(engine.isPaused).toBe(true);
    expect(controls.isLocked).toBe(false);
  });

  it('pointer lock failure via pointerlockerror event shows lock overlay and pauses engine', () => {
    canvas.requestPointerLock = vi.fn(); // sync return, no change yet

    ui.launchScenario('flick-static', 'intermediate');

    // Simulate browser dispatching pointerlockerror
    document.dispatchEvent(new Event('pointerlockerror'));

    const lockOverlay = document.getElementById('lock-overlay')!;
    expect(lockOverlay.classList.contains('visible')).toBe(true);
    expect(engine.isPaused).toBe(true);
    expect(controls.isLocked).toBe(false);
  });

  it('late pointer lock success after initial failure hides overlay and resumes engine cleanly', async () => {
    // Initial failure
    canvas.requestPointerLock = vi.fn().mockImplementation(() => {
      throw new Error('Immediate gesture required');
    });

    ui.launchScenario('flick-static', 'intermediate');

    const lockOverlay = document.getElementById('lock-overlay')!;
    expect(lockOverlay.classList.contains('visible')).toBe(true);
    expect(engine.isPaused).toBe(true);

    // Now simulate late successful lock acquisition
    Object.defineProperty(document, 'pointerLockElement', {
      value: canvas,
      configurable: true,
      writable: true,
    });
    document.dispatchEvent(new Event('pointerlockchange'));

    expect(lockOverlay.classList.contains('visible')).toBe(false);
    expect(engine.isPaused).toBe(false);
    expect(controls.isLocked).toBe(true);

    // Clean up pointerLockElement property
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      configurable: true,
      writable: true,
    });
  });

  it('routine transition cancellation on retry: retrying a drill invalidates stale auto-transition timer and does not advance routine', () => {
    const r5 = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m')!;
    ui.startRoutine(r5, 'intermediate');

    expect(ui.activeRoutine?.currentIndex).toBe(0);

    // Drill completes, triggering results screen and 5s auto-transition timer
    const dummyResult = createDummySession({ scenarioId: r5.scenarioIds[0] });
    ui.showResultsScreen(dummyResult, false);

    // User clicks RETRY DRILL before transition completes
    const retryBtn = document.getElementById('btn-res-retry') as HTMLButtonElement | null;
    expect(retryBtn).not.toBeNull();
    retryBtn?.click();

    expect(ui.activeRoutine?.currentIndex).toBe(0);
    expect(ui.activeRoutine?.retriesCount).toBe(1);

    // Fast-forward past the original 5s transition timer
    clock.tick(6000);

    // Routine must still be on drill index 0, not advanced to drill index 1 by stale timer
    expect(ui.activeRoutine?.currentIndex).toBe(0);
  });

  it('routine transition cancellation on exit: exiting routine invalidates stale transition timer', () => {
    const r5 = TRAINING_ROUTINES.find((r) => r.id === 'routine-5m')!;
    ui.startRoutine(r5, 'intermediate');

    const dummyResult = createDummySession({ scenarioId: r5.scenarioIds[0] });
    ui.showResultsScreen(dummyResult, false);

    // User clicks EXIT ROUTINE
    const exitBtn = document.getElementById('btn-res-menu') as HTMLButtonElement | null;
    expect(exitBtn).not.toBeNull();
    exitBtn?.click();

    expect(ui.activeRoutine).toBeNull();

    // Fast-forward past the original 5s transition timer
    clock.tick(6000);

    expect(ui.activeRoutine).toBeNull();
    expect(engine.isRunning).toBe(false);
  });
});
