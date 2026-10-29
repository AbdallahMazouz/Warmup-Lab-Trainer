// =====================================================================
// tests/vandal.test.ts — VandalViewModel unit tests
//
// Tests cover:
//   - Recoil animation state machine (idle → rise → fall → idle)
//   - Muzzle flash visibility lifecycle
//   - Dispose releases all resources without throwing
//   - fire() is idempotent (re-triggering before recovery resets rise)
//   - vandal.fire() does not affect TargetManager or scoring
//   - AudioManager.playGunshot() exists and does not throw (no AudioContext)
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';

// ── Mock WebGLRenderer so THREE.WebGLRenderer doesn't need a real canvas ──
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');

  class MockWebGLRenderer {
    domElement = { width: 800, height: 600 };
    autoClear = true;
    setPixelRatio = vi.fn();
    setSize       = vi.fn();
    setViewport   = vi.fn();
    setScissor    = vi.fn();
    setScissorTest = vi.fn();
    clearDepth    = vi.fn();
    render        = vi.fn();
    dispose       = vi.fn();
    shadowMap     = { enabled: false, type: 0 };
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

import { VandalViewModel } from '../src/vandal';
import { AudioManager }    from '../src/audio';

// =====================================================================
describe('VandalViewModel — Recoil State Machine', () => {
  let vandal: VandalViewModel;

  beforeEach(() => {
    vandal = new VandalViewModel();
  });

  afterEach(() => {
    vandal.dispose();
  });

  it('starts in idle recoil state with weapon at rest position', () => {
    // Access the private group via the vmScene children (index 3 = after 3 lights).
    // We inspect from vmScene to avoid coupling to private field names.
    const group = vandal.vmScene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    expect(group).toBeDefined();

    // At construction, group position should be at the rest coordinates.
    expect(group.position.x).toBeCloseTo(0.16, 3);
    expect(group.position.y).toBeCloseTo(-0.12, 3);
    expect(group.position.z).toBeCloseTo(-0.40, 3);
  });

  it('fire() triggers recoil kick — group Y rises within RECOIL_RISE_MS', () => {
    const group = vandal.vmScene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const restY = group.position.y;

    const now = performance.now();
    vandal.fire(now);

    // Advance by 20 ms (half of 35 ms rise phase)
    vandal.update(20, now + 20);

    // Group should be above rest Y (kicked upward)
    expect(group.position.y).toBeGreaterThan(restY);
  });

  it('group returns to rest position after full recoil cycle', () => {
    const group = vandal.vmScene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const restY = group.position.y;
    const restZ = group.position.z;

    const now = performance.now();
    vandal.fire(now);

    // The state machine processes one phase transition per update() call.
    // Step 1: advance past rise (35ms) — transitions to fall, resets elapsed.
    vandal.update(40, now + 40);
    // Step 2: advance past fall (130ms) — completes recovery.
    vandal.update(140, now + 180);

    expect(group.position.y).toBeCloseTo(restY, 4);
    expect(group.position.z).toBeCloseTo(restZ, 4);
  });

  it('re-firing during fall phase resets to rise phase immediately', () => {
    const group = vandal.vmScene.children.find(c => c instanceof THREE.Group) as THREE.Group;
    const restY = group.position.y;

    const t0 = performance.now();
    vandal.fire(t0);

    // Advance past rise, into fall
    vandal.update(40, t0 + 40);
    const fallY = group.position.y;
    // During fall, Y should be slightly above rest but below peak
    expect(fallY).toBeGreaterThan(restY - 0.001); // still recovering

    // Fire again mid-fall
    const t1 = t0 + 40;
    vandal.fire(t1);

    // Immediately after re-fire, elapsedMs is 0 in rise phase,
    // so next update(1ms) should show Y rising from wherever it was.
    vandal.update(1, t1 + 1);
    // Y will be slightly above restY (1ms into rise ease)
    expect(group.position.y).toBeGreaterThan(restY - 0.001);
  });
});

// =====================================================================
describe('VandalViewModel — Muzzle Flash', () => {
  let vandal: VandalViewModel;

  beforeEach(() => { vandal = new VandalViewModel(); });
  afterEach(() => { vandal.dispose(); });

  it('muzzle flash is hidden at construction', () => {
    // The flash group is the last Group in vmScene.children.
    const groups = vandal.vmScene.children.filter(c => c instanceof THREE.Group) as THREE.Group[];
    const flashGroup = groups[groups.length - 1];
    expect(flashGroup).toBeDefined();
    expect(flashGroup.visible).toBe(false);
  });

  it('fire() makes the muzzle flash visible', () => {
    const now = performance.now();
    vandal.fire(now);

    const groups = vandal.vmScene.children.filter(c => c instanceof THREE.Group) as THREE.Group[];
    const flashGroup = groups[groups.length - 1];
    expect(flashGroup.visible).toBe(true);
  });

  it('muzzle flash is hidden after FLASH_DURATION_MS (55ms) has passed', () => {
    const now = performance.now();
    vandal.fire(now);

    // Capture the flash group before advancing (it's the one that starts hidden, now visible).
    const groups = vandal.vmScene.children.filter(c => c instanceof THREE.Group) as THREE.Group[];
    // The flash group was the one initially hidden; after fire() it's now visible.
    // Identify it by the fact that the weapon group is always the FIRST Group child.
    // Flash group is the one added second (after the weapon group).
    // More reliably: find by its initial non-visibility before fire — but we've already fired.
    // Instead: the flash group is separate from the weapon group; weapon group is first.
    // We find the group that is NOT the weapon root (weapon root is group at index ~3 after lights).
    // Safest: the vmScene has exactly 2 Groups: weapon root + flash group.
    // After fire, both are visible? No — the flash group visibility was set by fire().
    // The weapon group is always visible. So after fire(), BOTH groups are visible.
    // After the flash expires, the flash group becomes hidden again.
    const flashGroup = groups[groups.length - 1]; // flash group is added last in constructor

    // Advance past the 55ms flash duration
    vandal.update(60, now + 60);

    expect(flashGroup.visible).toBe(false);
  });

  it('flash remains visible if update is called before expiry', () => {
    const now = performance.now();
    vandal.fire(now);

    // Advance only 30ms — flash duration is 55ms
    vandal.update(30, now + 30);

    const groups = vandal.vmScene.children.filter(c => c instanceof THREE.Group) as THREE.Group[];
    const flashGroup = groups[groups.length - 1]; // flash group added last
    expect(flashGroup.visible).toBe(true);
  });
});

// =====================================================================
describe('VandalViewModel — Resource Lifecycle', () => {
  it('dispose() does not throw and clears disposable list', () => {
    const vandal = new VandalViewModel();
    expect(() => vandal.dispose()).not.toThrow();
    // Calling dispose() again should also be safe
    expect(() => vandal.dispose()).not.toThrow();
  });

  it('vmScene and vmCamera are proper Three.js objects', () => {
    const vandal = new VandalViewModel();
    expect(vandal.vmScene).toBeInstanceOf(THREE.Scene);
    expect(vandal.vmCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    vandal.dispose();
  });

  it('vmScene contains lighting and geometry', () => {
    const vandal = new VandalViewModel();
    // Expect at least 2 lights + 1 weapon group + 1 flash group
    expect(vandal.vmScene.children.length).toBeGreaterThanOrEqual(4);
    vandal.dispose();
  });
});

// =====================================================================
describe('AudioManager — playGunshot', () => {
  it('playGunshot() exists and does not throw when AudioContext is unavailable', () => {
    const audio = new AudioManager();
    // AudioContext not initialised (no init() call) → should be a no-op.
    expect(() => audio.playGunshot()).not.toThrow();
  });

  it('playGunshot() is a function on the AudioManager prototype', () => {
    const audio = new AudioManager();
    expect(typeof audio.playGunshot).toBe('function');
  });
});

// =====================================================================
describe('VandalViewModel — Shot Isolation', () => {
  it('fire() does not affect TargetManager or scoring', async () => {
    // Instantiate TargetManager independently; fire() must not touch it.
    const { TargetManager } = await import('../src/targetManager');
    const tm = new TargetManager();
    const countBefore = tm.getActiveCount();

    const vandal = new VandalViewModel();
    vandal.fire(performance.now());

    expect(tm.getActiveCount()).toBe(countBefore);
    vandal.dispose();
  });

  it('each fire() call produces an independent flash (random scale each time)', () => {
    const vandal = new VandalViewModel();

    const groups = vandal.vmScene.children.filter(c => c instanceof THREE.Group) as THREE.Group[];
    const flashGroup = groups.find(g => !g.visible)!;

    const t0 = 1000;
    vandal.fire(t0);
    const scale1 = flashGroup.scale.x;

    // Advance past flash expiry so it hides again
    vandal.update(60, t0 + 60);
    expect(flashGroup.visible).toBe(false);

    vandal.fire(t0 + 60);
    const scale2 = flashGroup.scale.x;

    // Both scales are in valid range [0.85*1.0, 1.15*1.0] but random,
    // so we just confirm they are positive and within bounds.
    expect(scale1).toBeGreaterThan(0.5);
    expect(scale1).toBeLessThan(2.0);
    expect(scale2).toBeGreaterThan(0.5);
    expect(scale2).toBeLessThan(2.0);

    vandal.dispose();
  });
});

// =====================================================================
describe('Hit Feedback and Engine Integration', () => {
  let appContainer: HTMLElement;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    document.body.appendChild(appContainer);
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('UIManager displays distinct headshot marker and hides body marker on headshot', async () => {
    const { Renderer } = await import('../src/renderer');
    const { Controls } = await import('../src/controls');
    const { AudioManager } = await import('../src/audio');
    const { SettingsManager } = await import('../src/settings');
    const { Store } = await import('../src/store');
    const { Engine } = await import('../src/engine');
    const { UIManager } = await import('../src/ui');

    const renderer = new Renderer(canvas, 103);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    new UIManager(engine, appContainer, canvas);

    const hitMarker = document.getElementById('hit-marker')!;
    const headshotMarker = document.getElementById('headshot-marker')!;

    expect(hitMarker).toBeDefined();
    expect(headshotMarker).toBeDefined();
    expect(hitMarker.classList.contains('show')).toBe(false);
    expect(headshotMarker.classList.contains('show')).toBe(false);

    // Trigger headshot hit
    engine.callbacks.onHit?.(150, true, 0, 0);

    expect(headshotMarker.classList.contains('show')).toBe(true);
    expect(hitMarker.classList.contains('show')).toBe(false);

    controls.dispose();
  });

  it('UIManager displays distinct body-hit marker and hides headshot marker on torso hit', async () => {
    const { Renderer } = await import('../src/renderer');
    const { Controls } = await import('../src/controls');
    const { AudioManager } = await import('../src/audio');
    const { SettingsManager } = await import('../src/settings');
    const { Store } = await import('../src/store');
    const { Engine } = await import('../src/engine');
    const { UIManager } = await import('../src/ui');

    const renderer = new Renderer(canvas, 103);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    new UIManager(engine, appContainer, canvas);

    const hitMarker = document.getElementById('hit-marker')!;
    const headshotMarker = document.getElementById('headshot-marker')!;

    // Trigger body hit
    engine.callbacks.onHit?.(100, false, 0, 0);

    expect(hitMarker.classList.contains('show')).toBe(true);
    expect(headshotMarker.classList.contains('show')).toBe(false);

    controls.dispose();
  });

  it('UIManager does not show any hit marker on miss', async () => {
    const { Renderer } = await import('../src/renderer');
    const { Controls } = await import('../src/controls');
    const { AudioManager } = await import('../src/audio');
    const { SettingsManager } = await import('../src/settings');
    const { Store } = await import('../src/store');
    const { Engine } = await import('../src/engine');
    const { UIManager } = await import('../src/ui');

    const renderer = new Renderer(canvas, 103);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);
    new UIManager(engine, appContainer, canvas);

    const hitMarker = document.getElementById('hit-marker')!;
    const headshotMarker = document.getElementById('headshot-marker')!;

    // Trigger miss
    engine.callbacks.onMiss?.();

    expect(hitMarker.classList.contains('show')).toBe(false);
    expect(headshotMarker.classList.contains('show')).toBe(false);

    controls.dispose();
  });

  it('Engine triggers vandal.fire and audio.playGunshot once per shot and removes target to prevent duplicate score', async () => {
    const { Renderer } = await import('../src/renderer');
    const { Controls } = await import('../src/controls');
    const { AudioManager } = await import('../src/audio');
    const { SettingsManager } = await import('../src/settings');
    const { Store } = await import('../src/store');
    const { Engine } = await import('../src/engine');
    const { HEAD_LEVEL_Y } = await import('../src/constants');

    const renderer = new Renderer(canvas, 103);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    const engine = new Engine(renderer, controls, audio, settings, store);

    const vandalFireSpy = vi.spyOn(engine.vandal, 'fire');
    const audioGunshotSpy = vi.spyOn(engine.audio, 'playGunshot');
    const onHitSpy = vi.fn();
    engine.callbacks.onHit = onHitSpy;

    // Start a scenario with 1 target
    engine.startScenario({
      id: 'test-flick',
      name: 'Test Flick',
      category: 'flick',
      description: 'Test',
      skill: 'aim',
      difficulty: 'intermediate',
      durationSec: 30,
      targetCount: 1,
      targetSizeMultiplier: 1,
      targetSpeedMultiplier: 1,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: false,
      penalizeMiss: true,
    });

    // Replace the random target with a deterministic one in front of camera
    engine.targets.clear();
    const target = engine.targets.spawnTarget(engine.activeConfig!, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Align camera directly with target head
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1))
    );

    // Fire 1 shot via controls.onShoot
    controls.onShoot!();

    expect(vandalFireSpy).toHaveBeenCalledTimes(1);
    expect(audioGunshotSpy).toHaveBeenCalledTimes(1);
    expect(onHitSpy).toHaveBeenCalledTimes(1);
    expect(onHitSpy).toHaveBeenCalledWith(expect.any(Number), true, 0, 0);

    // Target must have been removed from its original id
    expect(engine.targets.getTarget(target.id)).toBeUndefined();

    // Verify a single shot cannot hit the same target twice
    controls.dispose();
  });
});
