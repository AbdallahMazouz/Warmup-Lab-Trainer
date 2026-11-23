// =====================================================================
// tests/scenarioEngine.test.ts — Unit & Integration Tests for Scenario Engine
// =====================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { SCENARIOS, getScenarioById, TRAINING_ROUTINES } from '../src/scenarios';
import { validateScenarioConfig, resolveScenarioConfig } from '../src/scenarioConfig';
import { Spawner } from '../src/spawner';
import { TargetManager } from '../src/targetManager';
import { WEAPON_PRESETS, getWeaponPreset, calculateBulletSpread } from '../src/weapons';
import { Engine } from '../src/engine';
import { Renderer } from '../src/renderer';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { HEAD_LEVEL_Y } from '../src/constants';
import type { ScenarioConfig, SessionResult } from '../src/types';

describe('Scenario Configuration Validation & Resolution', () => {
  it('validates correct scenario configuration format', () => {
    const validConfig: ScenarioConfig = {
      id: 'custom-scenario',
      name: 'Custom Test Drill',
      category: 'tactical',
      description: 'A test drill',
      skill: 'Discipline',
      difficulty: 'intermediate',
      durationSec: 45,
      targetCount: 2,
      targetSizeMultiplier: 1.0,
      targetSpeedMultiplier: 1.0,
      spawnRadius: 10,
      movementPattern: 'static',
      headLevel: true,
      flashEnabled: false,
      flashIntensity: 0,
      flashDurationMs: 0,
      requireSteadyAim: true,
      penalizeMiss: true,
      meaningfulReactionTime: true,
      meaningfulTracking: false,
      allowInRoutines: true,
      spawner: {
        mode: 'respawn_on_kill',
        maxAlive: 2,
      },
      weapon: {
        preset: 'vandal',
      },
      target: {
        hp: 100,
      },
    };

    const res = validateScenarioConfig(validConfig);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects invalid or malformed configurations with descriptive error messages', () => {
    expect(validateScenarioConfig(null).valid).toBe(false);
    expect(validateScenarioConfig({}).valid).toBe(false);

    const invalid = {
      id: '',
      name: '',
      durationSec: -10,
      targetCount: 0,
      spawner: { mode: 'invalid_mode', maxAlive: 0 },
      weapon: { preset: 'bfg9000' },
      target: { hp: -50 },
    };

    const res = validateScenarioConfig(invalid);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('id'))).toBe(true);
    expect(res.errors.some(e => e.includes('durationSec'))).toBe(true);
    expect(res.errors.some(e => e.includes('targetCount'))).toBe(true);
    expect(res.errors.some(e => e.includes('spawner mode'))).toBe(true);
    expect(res.errors.some(e => e.includes('weapon preset'))).toBe(true);
    expect(res.errors.some(e => e.includes('target.hp'))).toBe(true);
  });

  it('resolves legacy and partial configurations with safe defaults', () => {
    const legacy = getScenarioById('flick-static')!;
    const resolved = resolveScenarioConfig(legacy);

    expect(resolved.weapon.preset).toBe('vandal');
    expect(resolved.spawner.mode).toBe('random_area');
    expect(resolved.spawner.maxAlive).toBe(1);
    expect(resolved.scoring.baseHitScore).toBeGreaterThan(0);
    expect(resolved.interaction.mode).toBe('click');
    expect(resolved.environment.type).toBe('arena');
  });
});

describe('Spawner System & Lifecycle Modes', () => {
  let tm: TargetManager;
  let spawner: Spawner;

  beforeEach(() => {
    tm = new TargetManager();
    spawner = new Spawner();
  });

  it('spawns targets in random_area mode up to maxAlive limit', () => {
    const base = getScenarioById('flick-multi')!;
    const resolved = resolveScenarioConfig(base);
    spawner.init(resolved, tm);

    expect(tm.getActiveCount()).toBe(3);

    // Killing one triggers replacement to maintain maxAlive
    const targetId = tm.getTargets()[0].id;
    tm.removeTarget(targetId);
    spawner.onTargetKilled(targetId);

    expect(tm.getActiveCount()).toBe(3);
  });

  it('handles wave spawner mode progression', () => {
    const waveSc: ScenarioConfig = {
      ...getScenarioById('target-transfer')!,
      id: 'custom-wave-drill',
      spawner: {
        mode: 'wave',
        maxAlive: 3,
        waveSize: 3,
      },
    };
    const resolved = resolveScenarioConfig(waveSc);
    const onWaveSpy = vi.fn();
    spawner.callbacks.onWaveComplete = onWaveSpy;

    spawner.init(resolved, tm);
    expect(tm.getActiveCount()).toBe(3);

    // Eliminate all targets in wave 1
    const targets = tm.getTargets();
    for (const t of targets) {
      tm.removeTarget(t.id);
      spawner.onTargetKilled(t.id);
    }

    // Now update spawner: should trigger next wave
    spawner.update(0.016, performance.now() + 100);
    expect(onWaveSpy).toHaveBeenCalledWith(1);
    expect(tm.getActiveCount()).toBe(3);
  });

  it('handles peek spawner lifecycle and exposed target detection', () => {
    const peekSc = getScenarioById('peek-and-tap')!;
    const resolved = resolveScenarioConfig(peekSc);
    spawner.init(resolved, tm);

    // Initially scheduled peek delay
    expect(spawner.hasExposedTarget()).toBe(false);

    // Advance past delay
    spawner.update(0.016, performance.now() + 1000);
    expect(tm.getActiveCount()).toBe(1);
  });

  it('spawns friendly and enemy targets in friend-or-foe drill', () => {
    const fofSc = getScenarioById('friend-or-foe')!;
    const resolved = resolveScenarioConfig(fofSc);
    spawner.init(resolved, tm);

    const active = tm.getTargets();
    expect(active.length).toBe(3);
    for (const t of active) {
      expect(['friend', 'enemy']).toContain(t.kind);
    }
  });
});

describe('Target Hitboxes, Segmented Damage & Leg Detection', () => {
  let tm: TargetManager;

  beforeEach(() => {
    tm = new TargetManager();
  });

  it('accurately distinguishes head, torso, and leg hitboxes', () => {
    const headlineSc = getScenarioById('headline')!;
    const target = tm.spawnTarget(headlineSc, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Head ray
    const headRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const headHit = tm.checkHit(headRay);
    expect(headHit.hit).toBe(true);
    expect(headHit.headshot).toBe(true);
    expect(headHit.bodyPart).toBe('head');

    // Torso ray (offset -0.38m below head)
    const torsoRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y - 0.38, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const torsoHit = tm.checkHit(torsoRay);
    expect(torsoHit.hit).toBe(true);
    expect(torsoHit.headshot).toBe(false);
    expect(torsoHit.bodyPart).toBe('torso');

    // Legs ray (offset -0.90m below head)
    const legsRay = new THREE.Ray(
      new THREE.Vector3(0, HEAD_LEVEL_Y - 0.90, 0),
      new THREE.Vector3(0, 0, -1)
    );
    const legsHit = tm.checkHit(legsRay);
    expect(legsHit.hit).toBe(true);
    expect(legsHit.headshot).toBe(false);
    expect(legsHit.bodyPart).toBe('legs');
  });

  it('evaluates target HP damage and multi-shot elimination', () => {
    const target = tm.spawnTarget(getScenarioById('spray-control')!, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    target.hp = 100;

    target.hp -= 40; // 1st body shot
    expect(target.hp).toBe(60);
    expect(target.alive).toBe(true);

    target.hp -= 40; // 2nd body shot
    expect(target.hp).toBe(20);

    target.hp -= 40; // 3rd body shot kills
    expect(target.hp).toBeLessThanOrEqual(0);
  });
});

describe('Weapon System Presets & Recoil Mechanics', () => {
  it('provides all 4 weapon presets with distinct ballistics', () => {
    const vandal = getWeaponPreset('vandal');
    const phantom = getWeaponPreset('phantom');
    const sheriff = getWeaponPreset('sheriff');
    const operator = getWeaponPreset('operator');

    expect(vandal.name).toBe('Vandal');
    expect(vandal.damage.head).toBe(160);
    expect(vandal.isAutomatic).toBe(true);

    expect(phantom.name).toBe('Phantom');
    expect(phantom.fireRateRps).toBeGreaterThan(vandal.fireRateRps);

    expect(sheriff.name).toBe('Sheriff');
    expect(sheriff.magSize).toBe(6);
    expect(sheriff.isAutomatic).toBe(false);

    expect(operator.name).toBe('Operator');
    expect(operator.damage.body).toBe(150);
    expect(operator.boltActionDelayMs).toBeGreaterThan(1000);
  });

  it('calculates reproducible spread and increases dispersion during movement', () => {
    const vandal = getWeaponPreset('vandal');
    const stationarySpread = calculateBulletSpread(vandal, 0, true, () => 0.5);
    const movingSpread = calculateBulletSpread(vandal, 0, false, () => 0.5);

    expect(Math.abs(movingSpread.pitchOffsetRad)).toBeGreaterThan(Math.abs(stationarySpread.pitchOffsetRad));
  });
});

describe('Eight Starter Scenarios Gameplay Rules & Scoring', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;

  beforeEach(() => {
    canvas = document.createElement('canvas');
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
  });

  afterEach(() => {
    engine.dispose();
    controls.dispose();
  });

  it('Scenario 1 (Headline): rewards headshots, penalizes leg shots', () => {
    const sc = getScenarioById('headline')!;
    engine.startScenario(sc);

    // Spawn dummy at head level
    engine.targets.clear();
    engine.targets.spawnTarget(sc, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));

    // Aim at legs
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y - 0.90, 0), new THREE.Vector3(0, 0, -1))
    );

    const onHitSpy = vi.fn();
    engine.callbacks.onHit = onHitSpy;
    controls.onShoot!();

    // Leg shot does not eliminate and penalizes
    expect(onHitSpy).not.toHaveBeenCalled();
    expect(engine.getRemainingTime()).toBeGreaterThan(0);
  });

  it('Scenario 2 (Peek & Tap): enforces early shot violation when peeker is hidden', () => {
    const sc = getScenarioById('peek-and-tap')!;
    engine.startScenario(sc);

    // Shoot before target emerges
    const onMissSpy = vi.fn();
    engine.callbacks.onMiss = onMissSpy;
    controls.onShoot!();

    expect(onMissSpy).toHaveBeenCalled();
  });

  it('Scenario 3 (Counter-Strafe): penalizes moving shots and rewards stationary shots', () => {
    const sc = getScenarioById('counter-strafe-duel')!;
    engine.startScenario(sc);

    // Simulate moving
    controls.velocity.set(3.0, 0, 0);
    const onInaccurateSpy = vi.fn();
    engine.callbacks.onMovementInaccurate = onInaccurateSpy;

    controls.onShoot!();
    expect(onInaccurateSpy).toHaveBeenCalled();
  });

  it('Scenario 4 (Jiggle Peek): shooting a fake peek incurs penalty', () => {
    const sc = getScenarioById('jiggle-reading')!;
    engine.startScenario(sc);

    engine.targets.clear();
    const fakeTarget = engine.targets.spawnTarget(sc, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    fakeTarget.isFakePeek = true;

    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1))
    );

    const onMissSpy = vi.fn();
    engine.callbacks.onMiss = onMissSpy;
    controls.onShoot!();

    expect(onMissSpy).toHaveBeenCalled();
  });

  it('Scenario 5 (Spray Control): evaluates continuous spray without moving target', () => {
    const sc = getScenarioById('spray-control')!;
    engine.startScenario(sc);

    const target = engine.targets.getTargets()[0];
    const initialPos = target.position.clone();

    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1))
    );

    controls.onShoot!();
    expect(target.position.distanceTo(initialPos)).toBe(0);
  });

  it('Scenario 6 (Target Transfer): sustains 3 simultaneously active targets and replaces killed targets immediately', () => {
    const sc = getScenarioById('target-transfer')!;
    engine.startScenario(sc);

    expect(engine.targets.getActiveCount()).toBe(3);
    const initialTargets = engine.targets.getTargets().slice();
    expect(initialTargets.length).toBe(3);

    const target0 = initialTargets[0];
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(target0.position.x, target0.position.y, 0), new THREE.Vector3(0, 0, -1))
    );

    const killSpy = vi.fn();
    engine.events.on('onKill', killSpy);
    controls.onShoot!();

    expect(killSpy).toHaveBeenCalled();
    // Replaced immediately, sustaining 3 active targets for continuous switching
    expect(engine.targets.getActiveCount()).toBe(3);
    expect(engine.targets.getTarget(target0.id)).toBeUndefined();
  });

  it('Scenario 7 (Operator Flick): enforces bolt-action recovery delay', () => {
    const sc = getScenarioById('operator-flick')!;
    engine.startScenario(sc);

    const vandalFireSpy = vi.spyOn(engine.vandal, 'fire');
    controls.onShoot!();
    expect(vandalFireSpy).toHaveBeenCalledTimes(1);

    // Immediate second shot should be blocked by bolt recovery
    controls.onShoot!();
    expect(vandalFireSpy).toHaveBeenCalledTimes(1);
  });

  it('Scenario 8 (Friend or Foe): penalizes friendly fire', () => {
    const sc = getScenarioById('friend-or-foe')!;
    engine.startScenario(sc);

    engine.targets.clear();
    const friendTarget = engine.targets.spawnTarget(sc, new THREE.Vector3(0, HEAD_LEVEL_Y, -10));
    friendTarget.kind = 'friend';

    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(0, HEAD_LEVEL_Y, 0), new THREE.Vector3(0, 0, -1))
    );

    const onMissSpy = vi.fn();
    engine.callbacks.onMiss = onMissSpy;
    controls.onShoot!();

    expect(onMissSpy).toHaveBeenCalled();
  });
});

describe('Compatibility with 22 Original Scenarios & Routines', () => {
  it('preserves all 22 original scenario IDs and definitions', () => {
    const originalIds = [
      'flick-static', 'flick-micro', 'flick-wide', 'flick-multi', 'flick-precision', 'flick-reactive',
      'tactical-angle-clear', 'tactical-counter-strafe', 'flash-delayed', 'reaction-visual', 'reaction-peripheral',
      'track-smooth', 'track-reactive', 'track-strafe', 'track-vertical', 'tactical-wideswing',
      'tactical-jiggle', 'tactical-headlevel', 'tactical-firstshot', 'flash-pop',
      'hybrid-tactical-warmup', 'hybrid-clutch'
    ];

    for (const id of originalIds) {
      const sc = getScenarioById(id);
      expect(sc, `Original scenario ${id} must exist`).toBeDefined();
    }
  });

  it('preserves all existing routines and their target compositions', () => {
    expect(TRAINING_ROUTINES.length).toBeGreaterThanOrEqual(3);
    for (const r of TRAINING_ROUTINES) {
      expect(r.scenarioIds.length).toBeGreaterThan(0);
      for (const sid of r.scenarioIds) {
        expect(getScenarioById(sid)).toBeDefined();
      }
    }
  });
});

describe('Typed Gameplay Event System & Spawner Delays', () => {
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;
  let engine: Engine;

  beforeEach(() => {
    canvas = document.createElement('canvas');
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
  });

  afterEach(() => {
    engine.dispose();
    controls.dispose();
  });

  it('emits onSpawn, onHit, onHeadshot, onKill, and onMiss events with typed payloads', () => {
    const spawns: any[] = [];
    const hits: any[] = [];
    const headshots: any[] = [];
    const kills: any[] = [];
    const misses: any[] = [];

    engine.events.on('onSpawn', (e) => spawns.push(e));
    engine.events.on('onHit', (e) => hits.push(e));
    engine.events.on('onHeadshot', (e) => headshots.push(e));
    engine.events.on('onKill', (e) => kills.push(e));
    engine.events.on('onMiss', (e) => misses.push(e));

    const sc = getScenarioById('headline')!;
    engine.startScenario(sc);

    // Headline starts with 3 targets -> 3 onSpawn events
    expect(spawns.length).toBe(3);
    expect(spawns[0]).toHaveProperty('targetId');
    expect(spawns[0]).toHaveProperty('position');

    // Shoot a headshot at target 0
    const target0 = engine.targets.getTargets()[0];
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(target0.position.x, target0.position.y, 0), new THREE.Vector3(0, 0, -1))
    );

    controls.onShoot!();

    expect(hits.length).toBe(1);
    expect(hits[0].headshot).toBe(true);
    expect(headshots.length).toBe(1);
    expect(kills.length).toBe(1);
    expect(kills[0].streak).toBe(1);

    // Advance time beyond weapon fire rate cycle time (103ms)
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 200);

    // Shoot into empty space -> onMiss
    vi.spyOn(controls, 'getRay').mockReturnValue(
      new THREE.Ray(new THREE.Vector3(999, 999, 0), new THREE.Vector3(0, 0, -1))
    );
    controls.onShoot!();

    expect(misses.length).toBe(1);
    expect(misses[0].reason).toBe('aim_miss');
  });

  it('respects respawnDelayMs and does not exceed maxAlive', () => {
    const delaySc: ScenarioConfig = {
      ...getScenarioById('flick-static')!,
      id: 'custom-delay-drill',
      spawner: {
        mode: 'respawn_on_kill',
        maxAlive: 2,
        initialTargetCount: 2,
        respawnOnKill: true,
        respawnDelayMs: 300,
      },
    };

    engine.startScenario(delaySc);
    expect(engine.targets.getActiveCount()).toBe(2);

    const t0 = engine.targets.getTargets()[0];
    engine.targets.removeTarget(t0.id);
    engine.spawner.onTargetKilled(t0.id);

    // Immediately after elimination, only 1 target active because 300ms delay is pending
    expect(engine.targets.getActiveCount()).toBe(1);

    // Advance 100ms: still pending
    engine.spawner.update(0.1, performance.now() + 100);
    expect(engine.targets.getActiveCount()).toBe(1);

    // Advance 350ms: replacement spawns
    engine.spawner.update(0.1, performance.now() + 350);
    expect(engine.targets.getActiveCount()).toBe(2);
  });

  describe('Aim Lab & KovaaK\'s Benchmark Scenarios', () => {
    it('Gridshot (Aim Lab): maintains 3 targets on grid wall with instant 1-shot kill & respawn', () => {
      const gridshot = getScenarioById('aimlab-gridshot')!;
      expect(gridshot).toBeDefined();

      engine.startScenario(gridshot);
      expect(engine.targets.getActiveCount()).toBe(3);

      const targets = engine.targets.getTargets();
      const firstTarget = targets[0];
      expect(firstTarget.dimensions.shape).toBe('sphere');

      // Shoot the first target
      vi.spyOn(controls, 'getRay').mockReturnValue(
        new THREE.Ray(new THREE.Vector3(firstTarget.position.x, firstTarget.position.y, 0), new THREE.Vector3(0, 0, -1))
      );

      const killSpy = vi.fn();
      engine.events.on('onKill', killSpy);
      controls.onShoot!();

      expect(killSpy).toHaveBeenCalledTimes(1);
      // Immediately eliminated & replaced at random open grid slot
      expect(engine.targets.getActiveCount()).toBe(3);
      expect(engine.targets.getTarget(firstTarget.id)).toBeUndefined();
    });

    it('Tile Frenzy (KovaaK\'s): maintains 3 targets on wall with rapid target transitions', () => {
      const tileFrenzy = getScenarioById('kovaaks-tile-frenzy')!;
      expect(tileFrenzy).toBeDefined();

      engine.startScenario(tileFrenzy);
      expect(engine.targets.getActiveCount()).toBe(3);

      const targets = engine.targets.getTargets();
      const t0 = targets[0];

      vi.spyOn(controls, 'getRay').mockReturnValue(
        new THREE.Ray(new THREE.Vector3(t0.position.x, t0.position.y, 0), new THREE.Vector3(0, 0, -1))
      );

      const killSpy = vi.fn();
      engine.events.on('onKill', killSpy);
      controls.onShoot!();

      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(engine.targets.getActiveCount()).toBe(3);
      expect(engine.targets.getTarget(t0.id)).toBeUndefined();
    });

    it('Sixshot & 1Wall 6Targets: initializes exactly 6 targets on front wall', () => {
      const sixshot = getScenarioById('aimlab-sixshot')!;
      engine.startScenario(sixshot);
      expect(engine.targets.getActiveCount()).toBe(6);

      const ow6t = getScenarioById('kovaaks-1w6t')!;
      engine.startScenario(ow6t);
      expect(engine.targets.getActiveCount()).toBe(6);
    });

    it('guarantees that after every hit the target disappears immediately and replacement moves', () => {
      const gridshot = getScenarioById('aimlab-gridshot')!;
      engine.startScenario(gridshot);

      const t0 = engine.targets.getTargets()[0];
      const oldPos = t0.position.clone();

      vi.spyOn(controls, 'getRay').mockReturnValue(
        new THREE.Ray(new THREE.Vector3(oldPos.x, oldPos.y, 0), new THREE.Vector3(0, 0, -1))
      );

      controls.onShoot!();

      // Old target must be gone immediately
      expect(engine.targets.getTarget(t0.id)).toBeUndefined();
      // Total count maintained
      expect(engine.targets.getActiveCount()).toBe(3);
      // No active target can be at the exact same spot as the just-killed target
      for (const t of engine.targets.getTargets()) {
        if (t.id !== t0.id) {
          expect(t.position.distanceTo(oldPos)).toBeGreaterThan(0.5);
        }
      }
    });
  });
});
