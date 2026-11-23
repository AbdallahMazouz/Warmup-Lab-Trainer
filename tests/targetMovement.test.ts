// =====================================================================
// tests/targetMovement.test.ts — Unit Tests for Sprint 2C: Intelligent Targets & Movement
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager, pausedPingPong, type TargetRenderer } from '../src/targetManager';
import {
  ARENA_COVER_BOXES,
  intersectRayCoverBoxes,
  getCoverExposedX,
  updateTacticalStrafe,
  updateCoverPeek,
  updateSmoothSteering,
  updateMobility,
  type TacticalStrafeState,
  type CoverPeekState,
  type SmoothSteeringState,
  type MobilityState,
} from '../src/movementControllers';
import { applyDifficultyPreset, DIFFICULTY_PRESETS, SCENARIOS, getScenarioById } from '../src/scenarios';
import { Renderer } from '../src/renderer';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { Engine, EngineHUDState } from '../src/engine';
import { UIManager } from '../src/ui';
import { HEAD_LEVEL_Y } from '../src/constants';
import type { ScenarioConfig, SessionResult } from '../src/types';

// Simple deterministic Linear Congruential Generator (LCG)
function createSeededRNG(seed = 123456789): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const baseConfig: ScenarioConfig = {
  id: 'test-strafe',
  name: 'Test Strafe Scenario',
  category: 'tracking',
  description: 'Deterministic movement testing',
  skill: 'tracking',
  difficulty: 'intermediate',
  durationSec: 60,
  targetCount: 1,
  targetSizeMultiplier: 1.0,
  targetSpeedMultiplier: 1.0,
  spawnRadius: 10,
  movementPattern: 'strafe',
  headLevel: true,
  flashEnabled: false,
  flashIntensity: 0,
  flashDurationMs: 0,
  requireSteadyAim: false,
  penalizeMiss: false,
};

function createMockRenderer(): TargetRenderer {
  return {
    addTarget: vi.fn(),
    updateTargetPosition: vi.fn(),
    removeTarget: vi.fn(),
    clearTargets: vi.fn(),
    flashTarget: vi.fn(),
  };
}

describe('Deterministic Target Movement & Waveform', () => {
  it('pausedPingPong waveform is smooth, bounded in [-1, 1], and holds pause at peaks', () => {
    // Test values at key phases
    const pauseRatio = 0.2; // 20% pause
    const halfPeriod = Math.PI;
    const moveWindow = halfPeriod * (1 - pauseRatio);

    // Phase 0: starts at -1.0
    expect(pausedPingPong(0, pauseRatio)).toBeCloseTo(-1.0, 3);

    // End of movement window: reaches +1.0
    expect(pausedPingPong(moveWindow, pauseRatio)).toBeCloseTo(1.0, 3);

    // Inside pause window: holds constant +1.0
    const midPause1 = moveWindow + (halfPeriod - moveWindow) * 0.5;
    expect(pausedPingPong(midPause1, pauseRatio)).toBe(1.0);
    expect(pausedPingPong(halfPeriod - 0.001, pauseRatio)).toBe(1.0);

    // At phase Math.PI: starts reverse movement from +1.0
    expect(pausedPingPong(Math.PI, pauseRatio)).toBeCloseTo(1.0, 3);

    // End of reverse movement window: reaches -1.0
    expect(pausedPingPong(Math.PI + moveWindow, pauseRatio)).toBeCloseTo(-1.0, 3);

    // Inside second pause window: holds constant -1.0
    const midPause2 = Math.PI + moveWindow + (halfPeriod - moveWindow) * 0.5;
    expect(pausedPingPong(midPause2, pauseRatio)).toBe(-1.0);
  });

  it('ensures target movement is frame-rate independent across different delta time steps', () => {
    const tm1 = new TargetManager(createMockRenderer(), createSeededRNG(42));
    const tm2 = new TargetManager(createMockRenderer(), createSeededRNG(42));

    const origin = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
    const t1 = tm1.spawnTarget(baseConfig, origin, 'strafe');
    const t2 = tm2.spawnTarget(baseConfig, origin, 'strafe');

    // Force identical speed and phase
    t1.speed = 3.0;
    t1.phase = 0;
    t2.speed = 3.0;
    t2.phase = 0;

    // Simulation A: 10 steps of 0.016s (60 FPS, total dt = 0.16s)
    for (let i = 0; i < 10; i++) {
      tm1.update(0.016);
    }

    // Simulation B: 5 steps of 0.032s (30 FPS, total dt = 0.16s)
    for (let i = 0; i < 5; i++) {
      tm2.update(0.032);
    }

    // Both simulations must yield identical final positions
    expect(t1.position.x).toBeCloseTo(t2.position.x, 3);
    expect(t1.position.y).toBeCloseTo(t2.position.y, 3);
    expect(t1.position.z).toBeCloseTo(t2.position.z, 3);
  });

  it('keeps targets within valid arena boundaries even under extreme movement ranges', () => {
    const tm = new TargetManager(createMockRenderer());
    const origin = new THREE.Vector3(15, HEAD_LEVEL_Y, -16);
    const target = tm.spawnTarget(baseConfig, origin, 'strafe');
    target.range = 50.0; // extreme range extending far beyond arena walls
    target.speed = 5.0;

    // Advance through multiple full cycles
    for (let i = 0; i < 100; i++) {
      tm.update(0.1);
      // Arena bounds: X in [-18.5, 18.5], Y in [0.4, 6.5], Z in [-18.5, -2.5]
      expect(target.position.x).toBeGreaterThanOrEqual(-18.5);
      expect(target.position.x).toBeLessThanOrEqual(18.5);
      expect(target.position.y).toBeGreaterThanOrEqual(0.4);
      expect(target.position.y).toBeLessThanOrEqual(6.5);
      expect(target.position.z).toBeGreaterThanOrEqual(-18.5);
      expect(target.position.z).toBeLessThanOrEqual(-2.5);
    }
  });

  it('maintains strict synchronization between visual model position and hitbox position', () => {
    const mockRenderer = createMockRenderer();
    const tm = new TargetManager(mockRenderer);
    const origin = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
    const target = tm.spawnTarget(baseConfig, origin, 'strafe');

    // Update simulation
    tm.update(0.25);

    // Visual model must receive the exact position of the target hitbox
    expect(mockRenderer.updateTargetPosition).toHaveBeenCalledWith(
      target.id,
      target.position
    );

    // Shooting directly at target's updated position registers a hit
    const ray = new THREE.Ray(
      new THREE.Vector3(target.position.x, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const hit = tm.checkHit(ray);
    expect(hit.hit).toBe(true);
    expect(hit.targetId).toBe(target.id);
  });

  it('ensures removed and expired targets immediately stop updating', () => {
    const mockRenderer = createMockRenderer();
    const tm = new TargetManager(mockRenderer);
    const target = tm.spawnTarget(baseConfig, new THREE.Vector3(0, HEAD_LEVEL_Y, -10), 'static', 0.5);

    expect(tm.getActiveCount()).toBe(1);

    // Advance time past lifetime expiration (600ms > 500ms)
    tm.update(0.1, target.spawnTime + 600);

    expect(tm.getActiveCount()).toBe(0);
    expect(mockRenderer.removeTarget).toHaveBeenCalledWith(target.id);

    // Subsequent update does not call updateTargetPosition for expired target
    vi.clearAllMocks();
    tm.update(0.1, target.spawnTime + 800);
    expect(mockRenderer.updateTargetPosition).not.toHaveBeenCalledWith(target.id, expect.anything());
  });
});

describe('Seeded Spawning & Overlap Prevention', () => {
  it('produces 100% deterministic target spawns when provided with seeded RNG', () => {
    const rng1 = createSeededRNG(9999);
    const rng2 = createSeededRNG(9999);

    const tm1 = new TargetManager(createMockRenderer(), rng1);
    const tm2 = new TargetManager(createMockRenderer(), rng2);

    for (let i = 0; i < 5; i++) {
      const t1 = tm1.spawnTarget(baseConfig);
      const t2 = tm2.spawnTarget(baseConfig);

      expect(t1.position.x).toBeCloseTo(t2.position.x, 5);
      expect(t1.position.y).toBeCloseTo(t2.position.y, 5);
      expect(t1.position.z).toBeCloseTo(t2.position.z, 5);
      expect(t1.speed).toBeCloseTo(t2.speed, 5);
      expect(t1.range).toBeCloseTo(t2.range, 5);
      expect(t1.phase).toBeCloseTo(t2.phase, 5);
    }
  });

  it('prevents overlapping spawns when spawning multiple targets in the arena', () => {
    const tm = new TargetManager(createMockRenderer());
    const multiConfig: ScenarioConfig = {
      ...baseConfig,
      targetCount: 4,
    };

    // Spawn 4 targets in sequence
    const targets = [];
    for (let i = 0; i < 4; i++) {
      targets.push(tm.spawnTarget(multiConfig));
    }

    // Verify distance between every pair of targets is at least 1.0m
    for (let i = 0; i < targets.length; i++) {
      for (let j = i + 1; j < targets.length; j++) {
        const dist = targets[i].position.distanceTo(targets[j].position);
        expect(dist).toBeGreaterThanOrEqual(1.0);
      }
    }
  });
});

describe('Difficulty Presets & Engine Integration', () => {
  it('produces valid, bounded scenario settings across all difficulty levels', () => {
    const beginner = applyDifficultyPreset(baseConfig, 'beginner');
    expect(beginner.difficulty).toBe('beginner');
    expect(beginner.targetSpeedMultiplier).toBe(0.75);
    expect(beginner.directionChangeMultiplier).toBe(0.7);

    const intermediate = applyDifficultyPreset(baseConfig, 'intermediate');
    expect(intermediate.difficulty).toBe('intermediate');
    expect(intermediate.targetSpeedMultiplier).toBe(1.0);
    expect(intermediate.directionChangeMultiplier).toBe(1.0);

    const advanced = applyDifficultyPreset(baseConfig, 'advanced');
    expect(advanced.difficulty).toBe('advanced');
    expect(advanced.targetSpeedMultiplier).toBe(1.35);
    expect(advanced.directionChangeMultiplier).toBe(1.35);

    // Verify that hitbox dimensions, scoring, headLevel, and steadyAim remain unmodified
    expect(beginner.targetSizeMultiplier).toBe(baseConfig.targetSizeMultiplier);
    expect(advanced.targetSizeMultiplier).toBe(baseConfig.targetSizeMultiplier);
    expect(advanced.headLevel).toBe(baseConfig.headLevel);
    expect(advanced.penalizeMiss).toBe(baseConfig.penalizeMiss);
  });

  it('applies difficulty preset to actual engine scenario and target speeds', () => {
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);

    // Launch with 'advanced' difficulty
    engine.startScenario(baseConfig, 'advanced');

    expect(engine.activeConfig?.difficulty).toBe('advanced');
    expect(engine.activeConfig?.targetSpeedMultiplier).toBe(1.35);

    // Spawned target receives advanced speed scaling
    const targets = engine.targets.getTargets();
    expect(targets.length).toBe(1);
    expect(targets[0].directionChangeMultiplier).toBe(1.35);

    controls.dispose();
  });

  it('records correct scenario and difficulty in final session analytics result', () => {
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);

    let completedSession: SessionResult | null = null;
    engine.callbacks.onScenarioComplete = (res) => {
      completedSession = res;
    };

    // Start with beginner difficulty and 1 second duration
    engine.startScenario(
      {
        ...baseConfig,
        durationSec: 1,
      },
      'beginner'
    );

    // Advance time past 1 second
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1500);
    engine.update();

    expect(completedSession).not.toBeNull();
    expect(completedSession?.difficulty).toBe('beginner');
    expect(completedSession?.scenarioId).toBe(baseConfig.id);

    controls.dispose();
  });
});

describe('Regression Protection & Stationary Dummy Fixes', () => {
  it('verifies all 22 scenarios have properly classified stationary vs moving patterns', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(22);

    const staticIds = [
      'flick-static',
      'flick-micro',
      'flick-wide',
      'flick-multi',
      'flick-precision',
      'flick-reactive',
      'tactical-angle-clear',
      'tactical-counter-strafe',
      'flash-delayed',
      'reaction-visual',
      'reaction-peripheral',
    ];

    const movingIds = [
      'track-smooth',
      'track-reactive',
      'track-strafe',
      'track-vertical',
      'tactical-wideswing',
      'tactical-jiggle',
      'tactical-headlevel',
      'tactical-firstshot',
      'flash-pop',
      'hybrid-tactical-warmup',
      'hybrid-clutch',
    ];

    expect(staticIds.length + movingIds.length).toBe(22);

    for (const id of staticIds) {
      const sc = getScenarioById(id);
      expect(sc, `Scenario ${id} must exist`).toBeDefined();
      expect(sc!.movementPattern, `Scenario ${id} must be static`).toBe('static');
      expect(sc!.targetSpeedMultiplier, `Scenario ${id} speed must be 0`).toBe(0);
    }

    for (const id of movingIds) {
      const sc = getScenarioById(id);
      expect(sc, `Scenario ${id} must exist`).toBeDefined();
      expect(sc!.movementPattern, `Scenario ${id} must not be static`).not.toBe('static');
      expect(sc!.targetSpeedMultiplier, `Scenario ${id} speed must be > 0`).toBeGreaterThan(0);
    }
  });

  it('verifies intended static scenarios remain static and moving scenarios move when active', () => {
    const tm = new TargetManager();

    // 1. Static scenario test
    const staticSc = getScenarioById('flick-static')!;
    const staticTarget = tm.spawnTarget(staticSc, new THREE.Vector3(0, 1.7, -10));
    const staticInitial = staticTarget.position.clone();

    for (let i = 0; i < 30; i++) {
      tm.update(0.016);
    }
    expect(staticTarget.position.distanceTo(staticInitial)).toBe(0);

    // 2. Moving scenario test (track-smooth)
    const movingSc = getScenarioById('track-smooth')!;
    const movingTarget = tm.spawnTarget(movingSc, new THREE.Vector3(0, 1.7, -10));
    const movingInitial = movingTarget.position.clone();

    for (let i = 0; i < 45; i++) {
      tm.update(0.016);
    }
    expect(movingTarget.position.distanceTo(movingInitial)).toBeGreaterThan(0.05);
  });

  it('ensures flash-pop peek targets begin moving immediately upon spawn and repeated spawns', () => {
    const tm = new TargetManager();
    const flashPop = getScenarioById('flash-pop')!;

    // Spawn 1
    const t1 = tm.spawnTarget(flashPop);
    expect(t1.pattern).toBe('peek');
    expect(t1.phase).toBe(0); // must be 0 so it immediately enters active emergence

    const origin1 = t1.position.clone();
    tm.update(0.05);
    expect(t1.position.distanceTo(origin1)).toBeGreaterThan(0);

    // Repeated spawn 2
    const t2 = tm.spawnTarget(flashPop);
    expect(t2.phase).toBe(0);
    const origin2 = t2.position.clone();
    tm.update(0.05);
    expect(t2.position.distanceTo(origin2)).toBeGreaterThan(0);
  });

  it('verifies that paused state halts target movement and dispatches isPaused in onTick', () => {
    const canvas = document.createElement('canvas');
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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);

    const trackSc = getScenarioById('track-smooth')!;
    engine.startScenario(trackSc);

    const target = engine.targets.getTargets()[0];
    const initialPos = target.position.clone();

    // 1. Advance while active -> moves
    let mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
    mockTime += 100;
    engine.update();
    expect(target.position.distanceTo(initialPos)).toBeGreaterThan(0);

    // 2. Pause engine
    engine.pause();
    expect(engine.isPaused).toBe(true);

    const pausedPos = target.position.clone();
    let tickReceived: EngineHUDState | null = null;
    engine.callbacks.onTick = (hud) => {
      tickReceived = hud;
    };

    // Update while paused
    mockTime += 100;
    engine.update();

    // Position MUST NOT move while paused
    expect(target.position.distanceTo(pausedPos)).toBe(0);
    // onTick MUST dispatch isPaused: true
    expect(tickReceived).not.toBeNull();
    expect(tickReceived!.isPaused).toBe(true);

    // 3. Resume engine
    engine.resume();
    expect(engine.isPaused).toBe(false);

    mockTime += 100;
    engine.update();
    expect(target.position.distanceTo(pausedPos)).toBeGreaterThan(0);

    controls.dispose();
  });

  it('verifies UI Quick Play launches flick-static for flick and track-smooth for track', () => {
    const canvas = document.createElement('canvas');
    const appContainer = document.createElement('div');
    document.body.appendChild(appContainer);

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

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    const ui = new UIManager(engine, appContainer, canvas);

    const launchSpy = vi.spyOn(ui, 'launchScenario');

    // Click hero flick button
    const flickBtn = appContainer.querySelector('#btn-hero-play') as HTMLButtonElement;
    expect(flickBtn).not.toBeNull();
    flickBtn.click();
    expect(launchSpy).toHaveBeenLastCalledWith('flick-static');

    // Click hero track button
    const trackBtn = appContainer.querySelector('#btn-hero-track') as HTMLButtonElement;
    expect(trackBtn).not.toBeNull();
    trackBtn.click();
    expect(launchSpy).toHaveBeenLastCalledWith('track-smooth');

    controls.dispose();
  });
});

describe('Hybrid Aim Trainer Controllers & Cover Interactions', () => {
  it('TacticalStrafeController executes acceleration, cruising, deceleration, and deadstop pause', () => {
    const state: TacticalStrafeState = {
      type: 'tactical_strafe',
      direction: 1,
      currentSpeed: 0,
      cruiseSpeed: 3.0,
      accel: 10.0,
      state: 'accelerating',
      stateTimer: 0,
      minStrafeDuration: 0.5,
      maxStrafeDuration: 0.5,
      deadstopDuration: 0.2,
      minX: -10,
      maxX: 10,
    };

    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
    const mockRng = () => 0.5;

    // 1. Accelerate from 0 to cruise speed (at 10 m/s^2, takes 0.3s)
    updateTacticalStrafe(state, pos, 0.1, mockRng);
    expect(state.currentSpeed).toBeCloseTo(1.0, 2);
    expect(state.state).toBe('accelerating');
    expect(pos.x).toBeGreaterThan(0);

    // Reach cruise speed
    updateTacticalStrafe(state, pos, 0.25, mockRng);
    expect(state.currentSpeed).toBe(3.0);
    expect(state.state).toBe('cruising');

    // 2. Cruise until strafe timer expires (timer set to 0.5s)
    updateTacticalStrafe(state, pos, 0.55, mockRng);
    expect(state.state).toBe('stopping');

    // 3. Decelerate to deadstop (accel * 1.6 = 16 m/s^2, 3 / 16 = 0.1875s)
    updateTacticalStrafe(state, pos, 0.2, mockRng);
    expect(state.currentSpeed).toBe(0);
    expect(state.state).toBe('deadstop');

    const deadstopX = pos.x;
    // Position must not move during deadstop
    updateTacticalStrafe(state, pos, 0.1, mockRng);
    expect(pos.x).toBe(deadstopX);
    expect(state.state).toBe('deadstop');

    // 4. Deadstop expires (0.2s total) -> reverses direction (-1) and accelerates
    updateTacticalStrafe(state, pos, 0.15, mockRng);
    expect(state.state).toBe('accelerating');
    expect(state.direction).toBe(-1);
  });

  it('CoverPeekController executes jiggle/wideswing lifecycle from hidden to exposed duel and retreat', () => {
    const state: CoverPeekState = {
      type: 'cover_peek',
      mode: 'wideswing',
      boxId: 'front_right',
      side: 'right',
      state: 'hidden',
      stateTimer: 0.1,
      peekProgress: 0,
      hiddenX: 8.0,
      exposedX: 10.5,
      anchorY: HEAD_LEVEL_Y,
      anchorZ: -8.6,
      emergeSpeed: 4.0, // takes 0.25s to emerge
      retreatSpeed: 4.0,
      exposedDuelDuration: 0.3,
      hiddenDuration: 0.5,
    };

    const pos = new THREE.Vector3(8.0, HEAD_LEVEL_Y, -8.6);
    const mockRng = () => 0.5;

    // 1. Hidden state
    updateCoverPeek(state, pos, 0.05, mockRng);
    expect(pos.x).toBe(8.0);
    expect(state.state).toBe('hidden');

    // Hidden timer expires -> emerges
    updateCoverPeek(state, pos, 0.06, mockRng);
    expect(state.state).toBe('emerging');

    // 2. Emerging towards exposedX
    updateCoverPeek(state, pos, 0.15, mockRng);
    expect(pos.x).toBeGreaterThan(8.0);
    expect(pos.x).toBeLessThan(10.5);

    // Fully emerges -> enters exposed_duel
    updateCoverPeek(state, pos, 0.2, mockRng);
    expect(state.state).toBe('exposed_duel');
    expect(pos.x).toBe(10.5);

    // 3. Exposed duel holds at exposedX
    updateCoverPeek(state, pos, 0.15, mockRng);
    expect(pos.x).toBe(10.5);
    expect(state.state).toBe('exposed_duel');

    // Duel expires -> retreats
    updateCoverPeek(state, pos, 0.2, mockRng);
    expect(state.state).toBe('retreating');

    // Fully retreats -> hidden
    updateCoverPeek(state, pos, 0.3, mockRng);
    expect(state.state).toBe('hidden');
    expect(pos.x).toBe(8.0);
  });

  it('SmoothSteeringController steers 2D velocity continuously and repels from arena boundaries', () => {
    const state: SmoothSteeringState = {
      type: 'smooth_steering',
      vx: 0,
      vz: 0,
      targetVx: 2.0,
      targetVz: -1.0,
      speed: 2.5,
      turnRate: 4.0,
      changeTimer: 1.0,
      isReactive: false,
      minZ: -18.0,
      maxZ: -4.0,
    };

    const pos = new THREE.Vector3(0, HEAD_LEVEL_Y, -10);
    const mockRng = () => 0.5;

    // Smooth update gradually moves velocity towards target
    updateSmoothSteering(state, pos, 0.1, mockRng);
    expect(state.vx).toBeGreaterThan(0);
    expect(state.vz).toBeLessThan(0);
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.z).toBeLessThan(-10);

    // Arena boundary repelling: place target close to left wall (-17.5m)
    pos.x = -17.5;
    updateSmoothSteering(state, pos, 0.05, mockRng);
    // Steering should direct back towards center (positive vx)
    expect(state.targetVx).toBeGreaterThan(0);
  });

  it('MobilityController simulates vertical jump kinematics with parabolic apex and landing crouch', () => {
    const groundLevel = HEAD_LEVEL_Y;
    const state: MobilityState = {
      type: 'mobility',
      vy: 0,
      vx: 0,
      gravity: -18.0,
      jumpImpulse: 6.0,
      groundY: groundLevel,
      maxJumpY: groundLevel + 1.2,
      state: 'ground_crouch',
      stateTimer: 0.1,
      strafeDir: 1,
      driftSpeed: 1.5,
    };

    const pos = new THREE.Vector3(0, groundLevel, -10);
    const mockRng = () => 0.5;

    // 1. Ground crouch dip
    updateMobility(state, pos, 0.05, mockRng);
    expect(state.state).toBe('ground_crouch');
    expect(pos.y).toBeLessThan(groundLevel);

    // Crouch timer expires -> ascends with jumpImpulse
    updateMobility(state, pos, 0.06, mockRng);
    expect(state.state).toBe('ascending');
    expect(state.vy).toBeGreaterThan(0);

    // 2. Ascending slows down due to gravity
    updateMobility(state, pos, 0.2, mockRng);
    expect(pos.y).toBeGreaterThan(groundLevel);
    expect(state.vy).toBeLessThan(6.0);

    // Gravity overcomes impulse -> enters descending
    updateMobility(state, pos, 0.25, mockRng);
    expect(state.state).toBe('descending');
    expect(state.vy).toBeLessThan(0);

    // Falls until ground landing -> resets to ground_crouch
    updateMobility(state, pos, 0.5, mockRng);
    expect(state.state).toBe('ground_crouch');
    expect(pos.y).toBe(groundLevel);
  });

  it('verifies cover obstacles block raycasts when targets are tucked behind geometry', () => {
    const tm = new TargetManager();

    // Spawn a target manually at behind-cover position
    // Front-Right Barrier is center (8, 1, -8), min: (7, 0, -8.2), max: (9, 2, -7.8)
    // Tucking a target at (8.0, 1.7, -8.6) places it directly behind the barrier relative to player at Z=0
    const sc = getScenarioById('tactical-wideswing')!;
    const target = tm.spawnTarget(sc, new THREE.Vector3(8.0, HEAD_LEVEL_Y, -8.6));

    // Force target position behind barrier
    target.position.set(8.0, HEAD_LEVEL_Y, -8.6);

    // Player aiming straight at target from (8.0, HEAD_LEVEL_Y, 0) towards -Z
    const occludedRay = new THREE.Ray(
      new THREE.Vector3(8.0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    // Cover box must be hit before target is reached
    const coverDist = intersectRayCoverBoxes(occludedRay);
    expect(coverDist).toBeLessThan(Infinity);
    expect(coverDist).toBeCloseTo(7.8, 1);

    // Raycast checkHit MUST NOT hit occluded target
    const hitBlocked = tm.checkHit(occludedRay);
    expect(hitBlocked.hit).toBe(false);

    // Now swing target out past the barrier edge to X = 10.0 (beyond max.x = 9.0)
    target.position.set(10.0, HEAD_LEVEL_Y, -8.6);
    const exposedRay = new THREE.Ray(
      new THREE.Vector3(10.0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );

    const hitExposed = tm.checkHit(exposedRay);
    expect(hitExposed.hit).toBe(true);
    expect(hitExposed.targetId).toBe(target.id);
  });

  it('verifies hybrid-clutch spawns 3 targets with heterogeneous threat controllers', () => {
    const tm = new TargetManager();
    const clutchSc = getScenarioById('hybrid-clutch')!;

    expect(clutchSc.targetCount).toBe(3);

    const t1 = tm.spawnTarget(clutchSc);
    const t2 = tm.spawnTarget(clutchSc);
    const t3 = tm.spawnTarget(clutchSc);

    expect(tm.getActiveCount()).toBe(3);

    // Target 1: Cover wide-swinger
    expect(t1.pattern).toBe('wideswing');
    expect(t1.controllerState?.type).toBe('cover_peek');

    // Target 2: Tactical strafer
    expect(t2.pattern).toBe('strafe');
    expect(t2.controllerState?.type).toBe('tactical_strafe');

    // Target 3: Fluid roaming flanker
    expect(t3.pattern).toBe('wander');
    expect(t3.controllerState?.type).toBe('smooth_steering');

    // All three update without error
    for (let i = 0; i < 10; i++) {
      tm.update(0.016);
    }
  });

  it('verifies perspective-corrected line of sight on outside-edge peeks and deep columns', () => {
    const tm = new TargetManager();
    const playerCam = new THREE.Vector3(0, HEAD_LEVEL_Y, 0);

    // 1. Front-Right Barrier outside jiggle peek
    const frontRight = ARENA_COVER_BOXES.find(b => b.id === 'front_right')!;
    const anchorZ = frontRight.max.z - 0.25; // -8.05m
    const exposedX = getCoverExposedX(frontRight, 'right', anchorZ, 0.45);

    // Spawn tactical-jiggle and set to exposed position
    const scJiggle = getScenarioById('tactical-jiggle')!;
    const target = tm.spawnTarget(scJiggle, new THREE.Vector3(exposedX, HEAD_LEVEL_Y, anchorZ));
    target.position.set(exposedX, HEAD_LEVEL_Y, anchorZ);

    const exposedRayDir = new THREE.Vector3().subVectors(target.position, playerCam).normalize();
    const exposedRay = new THREE.Ray(playerCam, exposedRayDir);

    // Must be hittable from player camera
    const hitRes = tm.checkHit(exposedRay);
    expect(hitRes.hit).toBe(true);
    expect(hitRes.targetId).toBe(target.id);

    // 2. Hidden target behind front-right barrier must remain occluded
    target.position.set(frontRight.center.x, HEAD_LEVEL_Y, anchorZ);
    const hiddenRayDir = new THREE.Vector3().subVectors(target.position, playerCam).normalize();
    const hiddenRay = new THREE.Ray(playerCam, hiddenRayDir);

    const hiddenRes = tm.checkHit(hiddenRay);
    expect(hiddenRes.hit).toBe(false);

    // 3. Deep-Right column angle-clear corner placement
    const deepRight = ARENA_COVER_BOXES.find(b => b.id === 'deep_right')!;
    const cornerTarget = tm.spawnTarget(
      getScenarioById('tactical-angle-clear')!,
      new THREE.Vector3(deepRight.rightEdgeX + 0.40, HEAD_LEVEL_Y, deepRight.max.z)
    );

    const angleRayDir = new THREE.Vector3().subVectors(cornerTarget.position, playerCam).normalize();
    const angleRay = new THREE.Ray(playerCam, angleRayDir);

    const angleRes = tm.checkHit(angleRay);
    expect(angleRes.hit).toBe(true);
    expect(angleRes.targetId).toBe(cornerTarget.id);
  });
});
