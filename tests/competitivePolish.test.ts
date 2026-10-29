import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { getScenarioById, TRAINING_ROUTINES } from '../src/scenarios';
import { Store } from '../src/store';
import { SettingsManager } from '../src/settings';
import { AudioManager } from '../src/audio';
import { Controls } from '../src/controls';
import { Renderer } from '../src/renderer';
import { Engine } from '../src/engine';
import { TargetManager } from '../src/targetManager';
import { UIManager, TimingClock } from '../src/ui';
import type { SessionResult, RoutineSummary } from '../src/types';

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

describe('Sprint 2F — Target Teardown & Lifecycle Hardening', () => {
  let mockTargetRenderer: any;
  let targetManager: TargetManager;

  beforeEach(() => {
    mockTargetRenderer = {
      addTarget: vi.fn(),
      updateTargetPosition: vi.fn(),
      removeTarget: vi.fn(),
      clearTargets: vi.fn(),
    };
    targetManager = new TargetManager(mockTargetRenderer);
  });

  afterEach(() => {
    targetManager.clear();
  });

  it('unconditionally clears all targets on clear()', () => {
    const config = getScenarioById('flick-static')!;
    targetManager.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));
    targetManager.spawnTarget(config, new THREE.Vector3(2, 1.6, -10));

    expect(targetManager.getTargets().length).toBe(2);

    targetManager.clear();

    expect(targetManager.getTargets().length).toBe(0);
    expect(mockTargetRenderer.clearTargets).toHaveBeenCalled();
  });

  it('Engine.stopScenario unconditionally clears targets even if isRunning is false', () => {
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);

    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    // Spawn target
    engine.targets.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));
    expect(engine.targets.getTargets().length).toBeGreaterThan(0);

    // Simulate scenario completing (completeScenario sets isRunning = false)
    (engine as any).isRunning = false;

    // stopScenario must still clear targets when returning to menu or retrying
    engine.stopScenario();
    expect(engine.targets.getTargets().length).toBe(0);
    expect(engine.activeConfig).toBeNull();
    expect(engine.isPaused).toBe(false);

    engine.dispose();
  });
});

describe('Sprint 2F — Resource Management & Disposal Tests', () => {
  it('Renderer.dispose() cleans up arena meshes and WebGL context', () => {
    const canvas = document.createElement('canvas');
    const disposeFn = vi.fn();
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
      dispose: disposeFn,
    } as unknown as THREE.WebGLRenderer;

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    expect((renderer as any).arenaMeshes.length).toBeGreaterThan(0);
    expect((renderer as any).arenaDisposables.length).toBeGreaterThan(0);

    renderer.dispose();

    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect((renderer as any).arenaMeshes.length).toBe(0);
    expect((renderer as any).arenaDisposables.length).toBe(0);
  });

  it('Controls.dispose() cleans up all event listeners and resets keys', () => {
    const canvas = document.createElement('canvas');
    const camera = new THREE.PerspectiveCamera();
    const controls = new Controls(camera, canvas);

    const removeWindowSpy = vi.spyOn(window, 'removeEventListener');
    const removeDocSpy = vi.spyOn(document, 'removeEventListener');

    controls.dispose();

    expect(removeDocSpy).toHaveBeenCalledWith('keydown', expect.any(Function), false);
    expect(removeDocSpy).toHaveBeenCalledWith('keyup', expect.any(Function), false);
    expect(removeWindowSpy).toHaveBeenCalledWith('blur', expect.any(Function), false);
    expect(removeDocSpy).toHaveBeenCalledWith('pointerlockchange', expect.any(Function), false);
    expect(removeDocSpy).toHaveBeenCalledWith('mousedown', expect.any(Function), false);
  });

  it('UIManager.dispose() clears timeouts, intervals, and window listeners', () => {
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const mockClock = new MockTimingClock();

    const ui = new UIManager(engine, appContainer, canvas, mockClock);

    const removeWindowSpy = vi.spyOn(window, 'removeEventListener');

    ui.dispose();

    expect(removeWindowSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(removeWindowSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    engine.dispose();
    document.body.removeChild(appContainer);
  });
});

describe('Sprint 2F — Input Integrity, Blur Reset & Allocation Safety', () => {
  it('Controls ignores keyboard event repeat to prevent rapid key-repeat firing', () => {
    const canvas = document.createElement('canvas');
    const camera = new THREE.PerspectiveCamera();
    const controls = new Controls(camera, canvas);
    controls.isLocked = true;

    // Initial keydown
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: false }));
    expect(controls.moveForward).toBe(true);

    // Repeating keydown should be safely ignored
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: true }));
    expect(controls.moveForward).toBe(true);

    controls.dispose();
  });

  it('Controls resets movement keys when window loses focus (blur event)', () => {
    const canvas = document.createElement('canvas');
    const camera = new THREE.PerspectiveCamera();
    const controls = new Controls(camera, canvas);
    controls.isLocked = true;

    // Simulate holding movement keys
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', repeat: false }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', repeat: false }));
    expect(controls.moveForward).toBe(true);
    expect(controls.moveLeft).toBe(true);

    // Trigger window blur (Alt-Tab or clicking out)
    window.dispatchEvent(new Event('blur'));

    expect(controls.moveForward).toBe(false);
    expect(controls.moveLeft).toBe(false);

    controls.dispose();
  });

  it('Controls.getRay() reuses cached ray object avoiding GC pressure', () => {
    const canvas = document.createElement('canvas');
    const camera = new THREE.PerspectiveCamera();
    const controls = new Controls(camera, canvas);

    const ray1 = controls.getRay();
    const ray2 = controls.getRay();

    // Must return the same pre-allocated instance on hot path
    expect(ray1).toBe(ray2);

    controls.dispose();
  });

  it('TargetManager.intersectHead uses scratch vectors without errors', () => {
    const tm = new TargetManager();
    const config = getScenarioById('flick-static')!;

    const target = tm.spawnTarget(config, new THREE.Vector3(0, 1.6, -10));

    const directHeadRay = new THREE.Ray(
      new THREE.Vector3(0, 1.6 + target.dimensions.headOffsetY, 0),
      new THREE.Vector3(0, 0, -1).normalize()
    );

    const hit = (tm as any).intersectHead(directHeadRay, target);
    expect(hit).not.toBeNull();
    expect(hit?.distance).toBeCloseTo(10 - target.dimensions.headRadius, 1);

    const fullHit = tm.intersectTarget(directHeadRay, target);
    expect(fullHit).not.toBeNull();
    expect(fullHit?.bodyPart).toBe('head');

    tm.clear();
  });
});

describe('Sprint 2F — 3D Audio & Positional Web Audio Fallback', () => {
  it('handles AudioManager safely when Web Audio is mock or available', () => {
    const audio = new AudioManager();
    audio.init();

    expect(() => {
      audio.playHit(true, new THREE.Vector3(1, 1.6, -5));
      audio.playHit(false, new THREE.Vector3(-1, 1.2, -8));
      audio.playSpawn(new THREE.Vector3(0, 1.6, -10));
      audio.playGunshot();
    }).not.toThrow();

    audio.dispose();
  });

  it('creates PannerNode when hitPos is provided and AudioContext supports createPanner', () => {
    const audio = new AudioManager();

    const mockPanner = {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 100,
      rolloffFactor: 1,
      positionX: { setValueAtTime: vi.fn() },
      positionY: { setValueAtTime: vi.fn() },
      positionZ: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
    };

    const mockCtx = {
      state: 'running',
      currentTime: 10,
      destination: {},
      createGain: vi.fn().mockReturnValue({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      }),
      createOscillator: vi.fn().mockReturnValue({
        frequency: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        type: 'sine',
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createPanner: vi.fn().mockReturnValue(mockPanner),
      close: vi.fn().mockResolvedValue(undefined),
    };

    (audio as any).ctx = mockCtx;
    (audio as any).ready = true;

    audio.playHit(true, new THREE.Vector3(2, 1.6, -5));

    expect(mockCtx.createPanner).toHaveBeenCalled();
    expect(mockPanner.positionX.setValueAtTime).toHaveBeenCalledWith(2, 10);
    expect(mockPanner.positionY.setValueAtTime).toHaveBeenCalledWith(1.6, 10);
    expect(mockPanner.positionZ.setValueAtTime).toHaveBeenCalledWith(-5, 10);
  });
});

describe('Sprint 2F — Routine Retry Tracking & Drill Session History', () => {
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
    ui.dispose();
    engine.dispose();
    document.body.innerHTML = '';
  });

  it('increments retriesCount when retrying a drill within an active routine', () => {
    const routine = TRAINING_ROUTINES.find(r => r.id === 'routine-5m')!;
    ui.startRoutine(routine, 'intermediate');

    expect(ui.activeRoutine?.retriesCount).toBe(0);

    const firstAttempt: SessionResult = {
      id: 'sess_retry_1',
      scenarioId: routine.scenarioIds[0],
      scenarioName: routine.scenarioIds[0],
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: mockClock.now(),
      durationSec: 60,
      score: 300,
      hits: 3,
      misses: 2,
      accuracy: 60,
      headshots: 2,
      bodyHits: 1,
      headshotPct: 66.7,
      shotsFired: 5,
      avgReactionMs: 250,
      medianReactionMs: 245,
    };

    // Store records individual session
    store.addSession(firstAttempt);
    // UI displays results
    (ui as any).showResultsScreen(firstAttempt, false);

    // User clicks RETRY DRILL
    const retryBtn = document.getElementById('btn-res-retry');
    expect(retryBtn).not.toBeNull();
    retryBtn?.click();

    expect(ui.activeRoutine?.retriesCount).toBe(1);

    // Second (successful) attempt for drill 0
    const secondAttempt: SessionResult = {
      ...firstAttempt,
      id: 'sess_retry_2',
      score: 800,
      hits: 8,
      misses: 0,
      accuracy: 100,
      headshots: 6,
    };
    store.addSession(secondAttempt);
    (ui as any).showResultsScreen(secondAttempt, false);

    // Both individual drill attempts exist in session history for transparency
    const history = store.getRecentSessions(10);
    expect(history.length).toBe(2);

    // But routine only holds the latest result at index 0
    expect(ui.activeRoutine?.results[0].score).toBe(800);
  });

  it('persists retriesCount in RoutineSummary and displays it in Completed Routines table', () => {
    const summary: RoutineSummary = {
      id: 'summary_with_retries',
      routineId: 'routine-5m',
      routineName: '5-Minute Sharpness',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      totalDurationSec: 300,
      activeDurationSec: 300,
      totalElapsedSec: 350,
      transitionSec: 16,
      pausedSec: 0,
      retriesCount: 2,
      drillsCompleted: 5,
      totalDrills: 5,
      totalScore: 4500,
      overallAccuracy: 88.5,
      totalHits: 45,
      totalHeadshots: 35,
      totalShotsFired: 51,
    };

    store.addRoutineSummary(summary);

    const summaries = store.getRoutineSummaries(5);
    expect(summaries[0].retriesCount).toBe(2);

    ui.navigateTo('stats');
    const pageHTML = document.getElementById('page-container')!.innerHTML;

    expect(pageHTML).toContain('COMPLETED WARM-UP ROUTINES');
    expect(pageHTML).toContain('Retries');
    expect(pageHTML).toContain('>2<'); // Value rendered in table cell
  });
});

describe('Sprint 2F — Dashboard Sample Size & Ranking Integrity', () => {
  let store: Store;

  beforeEach(() => {
    localStorage.clear();
    store = new Store();
  });

  it('computes avgScore alongside bestScore in getBestPerformingScenarios', () => {
    // 3 runs for flick-static: 400, 600, 800 (avg = 600)
    store.addSession({
      id: 's1',
      scenarioId: 'flick-static',
      scenarioName: 'Flick Static',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
      durationSec: 60,
      score: 400,
      hits: 4,
      misses: 1,
      accuracy: 80,
      headshots: 3,
    });
    store.addSession({
      id: 's2',
      scenarioId: 'flick-static',
      scenarioName: 'Flick Static',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 2000,
      durationSec: 60,
      score: 600,
      hits: 6,
      misses: 0,
      accuracy: 100,
      headshots: 4,
    });
    store.addSession({
      id: 's3',
      scenarioId: 'flick-static',
      scenarioName: 'Flick Static',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 3000,
      durationSec: 60,
      score: 800,
      hits: 8,
      misses: 0,
      accuracy: 100,
      headshots: 6,
    });

    const best = store.getBestPerformingScenarios(5);
    expect(best.length).toBe(1);
    expect(best[0].bestScore).toBe(800);
    expect(best[0].avgScore).toBe(600);
    expect(best[0].playCount).toBe(3);
  });

  it('getConsistentPerformingScenarios filters out scenarios below minSamples threshold', () => {
    // Scenario A has 1 lucky attempt: 1000 score
    store.addSession({
      id: 'a1',
      scenarioId: 'flick-reflex',
      scenarioName: 'Reflex Flick',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
      durationSec: 60,
      score: 1000,
      hits: 10,
      misses: 0,
      accuracy: 100,
      headshots: 8,
    });

    // Scenario B has 2 consistent attempts: 700, 750 (avg = 725)
    store.addSession({
      id: 'b1',
      scenarioId: 'strafe-track',
      scenarioName: 'Strafe Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: 2000,
      durationSec: 60,
      score: 700,
      hits: 7,
      misses: 1,
      accuracy: 87.5,
      headshots: 4,
    });
    store.addSession({
      id: 'b2',
      scenarioId: 'strafe-track',
      scenarioName: 'Strafe Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      timestamp: 3000,
      durationSec: 60,
      score: 750,
      hits: 8,
      misses: 1,
      accuracy: 88.8,
      headshots: 5,
    });

    // Best scenarios lists both
    const allBest = store.getBestPerformingScenarios(5);
    expect(allBest.length).toBe(2);

    // Consistent scenarios requires minSamples >= 2
    const consistent = store.getConsistentPerformingScenarios(2, 5);
    expect(consistent.length).toBe(1);
    expect(consistent[0].scenarioId).toBe('strafe-track');
    expect(consistent[0].avgScore).toBe(725);
  });

  it('renders Single-Session Best, Average Score, and Attempts in stats page', () => {
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const mockClock = new MockTimingClock();
    const ui = new UIManager(engine, appContainer, canvas, mockClock);

    // Add 1 drill
    store.addSession({
      id: 'drill1',
      scenarioId: 'flick-static',
      scenarioName: 'Flick Static',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: 1000,
      durationSec: 60,
      score: 550,
      hits: 5,
      misses: 0,
      accuracy: 100,
      headshots: 4,
    });

    ui.navigateTo('stats');
    const html = document.getElementById('page-container')!.innerHTML;

    expect(html).toContain('HIGHEST SINGLE-SESSION SCORES (BY SCENARIO)');
    expect(html).toContain('Single-Session Best');
    expect(html).toContain('Average Score');
    expect(html).toContain('Attempts (Sample Size)');
    expect(html).toContain('1 drill (single run)');

    ui.dispose();
    engine.dispose();
    document.body.removeChild(appContainer);
  });
});
