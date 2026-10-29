// =====================================================================
// tests/targetMovement.test.ts — Unit Tests for Sprint 2C: Intelligent Targets & Movement
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager, pausedPingPong, type TargetRenderer } from '../src/targetManager';
import { applyDifficultyPreset, DIFFICULTY_PRESETS } from '../src/scenarios';
import { Renderer } from '../src/renderer';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { Engine } from '../src/engine';
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
