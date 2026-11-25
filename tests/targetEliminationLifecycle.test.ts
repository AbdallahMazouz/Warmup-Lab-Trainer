// =====================================================================
// tests/targetEliminationLifecycle.test.ts — Bot / Target Elimination Lifecycle
// =====================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { TargetManager, type TargetRenderer } from '../src/targetManager';
import { Renderer } from '../src/renderer';
import { Spawner } from '../src/spawner';
import { Engine } from '../src/engine';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { getScenarioById } from '../src/scenarios';
import { resolveScenarioConfig, createDefaultCustomScenario, convertCustomScenarioToConfig, validateCustomScenarioJSON } from '../src/scenarioConfig';
import { HEAD_LEVEL_Y, TARGET_TORSO_RADIUS, TARGET_TORSO_HEIGHT, TARGET_TORSO_OFFSET_Y } from '../src/constants';
import { UIManager } from '../src/ui';
import type { ScenarioConfig, HitEventPayload, KillEventPayload, WarmupLabScenarioV1 } from '../src/types';

describe('Stage B — Aim Lab / KovaaK\'s-Style Target Elimination Lifecycle', () => {
  let engine: Engine;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;
  let controls: Controls;
  let audio: AudioManager;
  let settings: SettingsManager;
  let store: Store;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    Object.defineProperty(canvas, 'clientWidth', { value: 1920 });
    Object.defineProperty(canvas, 'clientHeight', { value: 1080 });
    document.body.appendChild(canvas);

    const mockWebGLRenderer = {
      domElement: canvas,
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
    renderer.dispose();
    controls.dispose();
    audio.dispose();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  // ── 1. Immediate Visual Disappearance ─────────────────────────────────
  it('instantly removes target mesh and visual object from scene upon lethal hit', () => {
    const config = getScenarioById('flick-static')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const initialTargets = tm.getTargets();
    expect(initialTargets.length).toBe(1);

    const targetId = initialTargets[0].id;
    const targetPos = initialTargets[0].position.clone();

    // Verify visual object exists in scene
    expect(renderer.getTargetVisual(targetId)).toBeDefined();
    const visualGroup = renderer.getTargetVisual(targetId)!.group;
    expect(renderer.scene.children.includes(visualGroup)).toBe(true);

    // Aim directly at target head
    controls.camera.position.set(0, 1.7, 0);
    controls.yawObject.position.set(0, 1.7, 0);
    const dir = new THREE.Vector3().subVectors(targetPos, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    // Shoot target
    (engine as any).handleShoot();

    // The target must be immediately removed from TargetManager
    expect(tm.getTarget(targetId)).toBeUndefined();

    // The visual mesh must be immediately removed from Renderer and Three.js scene
    expect(renderer.getTargetVisual(targetId)).toBeUndefined();
    expect(renderer.scene.children.includes(visualGroup)).toBe(false);
  });

  // ── 2. 50 Consecutive Eliminations Without Mesh Accumulation ─────────
  it('does not accumulate dead meshes or scene children over 50 consecutive eliminations', () => {
    const config = getScenarioById('aimlab-gridshot')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const maxAlive = 3;
    expect(tm.getActiveCount()).toBe(maxAlive);

    // Baseline count of non-target arena objects (floor, ceiling, walls, lights)
    const baseSceneChildrenCount = renderer.scene.children.length - maxAlive;

    // Perform 50 consecutive shots eliminating targets
    for (let i = 0; i < 50; i++) {
      const active = tm.getTargets().filter(t => t.alive);
      expect(active.length).toBeGreaterThan(0);
      const targetToShoot = active[0];

      // Aim at target
      const dir = new THREE.Vector3().subVectors(targetToShoot.position, controls.yawObject.position).normalize();
      vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

      // Advance lastShotTime to bypass fire rate limit
      (engine as any).lastShotTime = -Infinity;

      (engine as any).handleShoot();

      // Ensure active targets never exceed maxAlive
      expect(tm.getActiveCount()).toBeLessThanOrEqual(maxAlive);

      // Verify that total scene children never accumulates dead bodies
      const currentTargetVisualsCount = (renderer as any).targetVisuals.size;
      expect(currentTargetVisualsCount).toBeLessThanOrEqual(maxAlive);
      expect(renderer.scene.children.length).toBeLessThanOrEqual(baseSceneChildrenCount + maxAlive);
    }

    expect((engine as any).hits).toBe(50);
  });

  // ── 3. Multi-Shot HP Behavior (Spray Control Dummy) ───────────────────
  it('preserves multi-shot dummy HP, flashes on non-lethal hits, and eliminates only when HP drops to zero', () => {
    const config = getScenarioById('spray-control')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const dummy = tm.getTargets()[0];
    expect(dummy).toBeDefined();
    expect(dummy.hp).toBe(400);

    const dummyId = dummy.id;
    const dummyPos = dummy.position.clone();

    // Aim at dummy torso (torso center: y + torsoOffsetY)
    const torsoY = dummyPos.y + dummy.dimensions.torsoOffsetY;
    const aimPoint = new THREE.Vector3(dummyPos.x, torsoY, dummyPos.z);
    const dir = new THREE.Vector3().subVectors(aimPoint, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    const hitEvents: HitEventPayload[] = [];
    const killEvents: KillEventPayload[] = [];
    engine.events.on('onHit', (e) => hitEvents.push(e));
    engine.events.on('onKill', (e) => killEvents.push(e));

    const flashSpy = vi.spyOn(renderer, 'flashTarget');
    const playHitSpy = vi.spyOn(audio, 'playHit');

    // Vandal torso damage = 40 HP per shot. Dummy has 400 HP.
    // Shots 1 to 9 must be non-lethal (reducing HP by 40 each, 400 -> 360 -> ... -> 40)
    for (let shot = 1; shot <= 9; shot++) {
      (engine as any).lastShotTime = -Infinity;
      (engine as any).handleShoot();

      expect(dummy.alive).toBe(true);
      expect(dummy.hp).toBe(400 - shot * 40);
      expect(hitEvents.length).toBe(shot);
      expect(hitEvents[hitEvents.length - 1].remainingHp).toBe(400 - shot * 40);
      expect(killEvents.length).toBe(0);

      // Flash and sound must trigger for visual feedback
      expect(flashSpy).toHaveBeenCalledTimes(shot);
      expect(playHitSpy).toHaveBeenCalledTimes(shot);

      // Dummy must remain active in scene
      expect(tm.getTarget(dummyId)).toBeDefined();
      expect(renderer.getTargetVisual(dummyId)).toBeDefined();
    }

    // Shot 10: Final lethal shot (40 HP remaining -> 0 HP)
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();

    expect(hitEvents.length).toBe(10);
    expect(hitEvents[hitEvents.length - 1].remainingHp).toBe(0);
    expect(killEvents.length).toBe(1);
    expect(killEvents[0].targetId).toBe(dummyId);

    // Dummy must be eliminated immediately
    expect(tm.getTarget(dummyId)).toBeUndefined();
    expect(renderer.getTargetVisual(dummyId)).toBeUndefined();
  });

  // ── 4. Respawn Timing and Position ────────────────────────────────────
  it('spawns grid replacements at distinct slots avoiding lastKilledPos', () => {
    const config = getScenarioById('aimlab-gridshot')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;

    const initialTarget = tm.getTargets()[0];
    const killedPos = initialTarget.position.clone();

    // Aim and kill initial target
    const dir = new THREE.Vector3().subVectors(killedPos, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).handleShoot();

    // In gridshot (3 targets active on 4x3 grid), replacement spawns immediately at an open slot
    expect(tm.getActiveCount()).toBe(3);

    // Confirm that none of the active targets occupy the exact position of the killed target
    for (const t of tm.getTargets()) {
      expect(t.position.distanceTo(killedPos)).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('enforces perceptual respawn delay on single-slot fixed dummy drills so elimination is visible', () => {
    const config = getScenarioById('spray-control')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;

    // Eliminate dummy with 10 shots
    for (let shot = 0; shot < 10; shot++) {
      const dummy = tm.getTargets()[0];
      if (!dummy) break;
      const dir = new THREE.Vector3().subVectors(dummy.position, controls.yawObject.position).normalize();
      vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));
      (engine as any).lastShotTime = -Infinity;
      (engine as any).handleShoot();
    }

    // Immediately after lethal shot, dummy is eliminated and target count is 0
    expect(tm.getActiveCount()).toBe(0);
    expect((spawner as any).pendingRespawns.length).toBe(1);

    // Advance spawner by 40ms -> still in delay window, dummy is absent
    const now = performance.now();
    spawner.update(0.04, now + 40);
    expect(tm.getActiveCount()).toBe(0);

    // Advance spawner past 80ms delay -> replacement spawns
    spawner.update(0.05, now + 100);
    expect(tm.getActiveCount()).toBe(1);
    expect(tm.getTargets()[0].hp).toBe(400);
  });

  // ── 5. Target Transfer Preservation ───────────────────────────────────
  it('preserves surviving targets while eliminating only the hit target in Target Transfer', () => {
    const config = getScenarioById('target-transfer')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    expect(tm.getActiveCount()).toBe(3);

    const initialTargets = tm.getTargets();
    const targetToKill = initialTargets[0];
    const survivor1 = initialTargets[1];
    const survivor2 = initialTargets[2];

    const dir = new THREE.Vector3().subVectors(targetToKill.position, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).handleShoot();

    // TargetToKill must be removed
    expect(tm.getTarget(targetToKill.id)).toBeUndefined();
    expect(renderer.getTargetVisual(targetToKill.id)).toBeUndefined();

    // Survivors must remain untouched
    expect(tm.getTarget(survivor1.id)).toBeDefined();
    expect(tm.getTarget(survivor2.id)).toBeDefined();
    expect(renderer.getTargetVisual(survivor1.id)).toBeDefined();
    expect(renderer.getTargetVisual(survivor2.id)).toBeDefined();

    // Total target count remains at 3
    expect(tm.getActiveCount()).toBe(3);
  });

  // ── 6. Tracking Target Persistence ────────────────────────────────────
  it('keeps tracking targets alive and persistent when player clicks or fires', () => {
    const config = getScenarioById('track-smooth')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    expect(tm.getActiveCount()).toBe(1);
    const trackingTarget = tm.getTargets()[0];
    const targetId = trackingTarget.id;

    // Aim directly at target and click 5 times
    const dir = new THREE.Vector3().subVectors(trackingTarget.position, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    for (let i = 0; i < 5; i++) {
      (engine as any).lastShotTime = -Infinity;
      (engine as any).handleShoot();
    }

    // Target must NOT be eliminated by clicks in tracking mode
    expect(trackingTarget.alive).toBe(true);
    expect(tm.getTarget(targetId)).toBeDefined();
    expect(renderer.getTargetVisual(targetId)).toBeDefined();
    expect((engine as any).hits).toBe(0);
  });

  // ── 7. Tactical Peeker Cleanup ────────────────────────────────────────
  it('cleans up tactical peeker immediately on hit, resets peeker state, and schedules next peek', () => {
    const config = getScenarioById('tactical-jiggle')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;

    // Advance spawner past initial 500ms peek delay to spawn peeker
    spawner.update(0.016, performance.now() + 1000);

    // Advance target manager so peeker emerges from behind cover into exposed duel state
    tm.update(0.25, performance.now() + 1250, controls.yawObject.position);

    const peeker = tm.getTargets()[0];
    expect(peeker).toBeDefined();
    expect(spawner.isPeekerActive).toBe(true);
    expect(peeker.isCovered).toBe(false);

    const peekerId = peeker.id;
    const peekerPos = peeker.position.clone();

    // Aim and kill peeker
    const dir = new THREE.Vector3().subVectors(peekerPos, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();

    // Peeker must be removed immediately from TM and scene
    expect(tm.getTarget(peekerId)).toBeUndefined();
    expect(renderer.getTargetVisual(peekerId)).toBeUndefined();
    expect(spawner.isPeekerActive).toBe(false);

    // Threat progress must be 0
    expect(tm.getHighestThreatProgress(controls.yawObject.position)).toBe(0);
  });

  it('allows unshot tactical peeker to retreat into cover without accumulating dead objects', () => {
    const config = getScenarioById('tactical-jiggle')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;

    // Advance spawner past initial 500ms peek delay
    spawner.update(0.016, performance.now() + 1000);

    const peeker = tm.getTargets()[0];
    expect(peeker).toBeDefined();

    // Advance controller state through full peek-and-retreat cycle
    // emerging -> exposed_duel -> retreating -> hidden
    for (let step = 0; step < 20; step++) {
      tm.update(0.1, performance.now() + step * 100, controls.yawObject.position);
    }

    // Peeker is now hidden behind cover; active count remains 1 and alive
    expect(peeker.alive).toBe(true);
    expect(tm.getActiveCount()).toBe(1);
    expect(renderer.getTargetVisual(peeker.id)).toBeDefined();
  });

  // ── 8. Overkill Accounting ────────────────────────────────────────────
  it('accurately accounts for overkill shots when shooting at recently eliminated target position without lingering meshes', () => {
    const config = getScenarioById('target-transfer')!;
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const targetToKill = tm.getTargets()[0];
    const killPos = targetToKill.position.clone();

    const dir = new THREE.Vector3().subVectors(killPos, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    // Shot 1: Lethal elimination
    (engine as any).handleShoot();
    expect((engine as any).hits).toBe(1);
    expect((engine as any).overkillShots).toBe(0);

    // Target is gone from visual scene
    expect(renderer.getTargetVisual(targetToKill.id)).toBeUndefined();

    // Shot 2: Follow-up shot into the exact same location 100ms later (overkill shot)
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();

    expect((engine as any).overkillShots).toBe(1);
    expect((engine as any).misses).toBe(1);

    // Shot 3: Shot into empty unrelated air far away
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 1, 0)));
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();

    expect((engine as any).overkillShots).toBe(1);
    expect((engine as any).misses).toBe(2);
  });

  // ── Stage C Priority 1: Spawner Respawn Delay Preservations ───────────
  it('preserves explicitly configured respawnDelayMs: 0 on single-slot fixed dummy drills without 80ms override', () => {
    const customDrill: WarmupLabScenarioV1 = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'custom_zero_delay_dummy',
      name: 'Zero Delay Dummy',
      description: 'Single-slot fixed dummy with explicit zero respawn delay',
      category: 'precision',
      difficulty: 'intermediate',
      durationSec: 60,
      spawner: {
        mode: 'fixed_points',
        maxAlive: 1,
        fixedPoints: [{ x: 0, y: 1.58, z: -12 }],
        respawnDelayMs: 0,
      },
      target: {
        shape: 'humanoid',
        hp: 100,
        multiShot: false,
        movementPattern: 'static',
      },
    };

    const config = convertCustomScenarioToConfig(customDrill);
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;
    expect(tm.getActiveCount()).toBe(1);

    const dummy = tm.getTargets()[0];
    const dir = new THREE.Vector3().subVectors(dummy.position, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).handleShoot();

    // With explicit respawnDelayMs: 0, the replacement dummy must spawn immediately without pending delays
    expect((spawner as any).pendingRespawns.length).toBe(0);
    expect(tm.getActiveCount()).toBe(1);
  });

  it('schedules positive respawn delay when configured on single-slot fixed points', () => {
    const customDrill: WarmupLabScenarioV1 = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'custom_delayed_dummy',
      name: 'Delayed Dummy',
      description: 'Single-slot fixed dummy with explicit 250ms respawn delay',
      category: 'precision',
      difficulty: 'intermediate',
      durationSec: 60,
      spawner: {
        mode: 'fixed_points',
        maxAlive: 1,
        fixedPoints: [{ x: 0, y: 1.58, z: -12 }],
        respawnDelayMs: 250,
      },
      target: {
        shape: 'humanoid',
        hp: 100,
        multiShot: false,
        movementPattern: 'static',
      },
    };

    const config = convertCustomScenarioToConfig(customDrill);
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;
    const dummy = tm.getTargets()[0];

    const dir = new THREE.Vector3().subVectors(dummy.position, controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).handleShoot();

    expect(tm.getActiveCount()).toBe(0);
    expect((spawner as any).pendingRespawns.length).toBe(1);
    expect((spawner as any).pendingRespawns[0].spawnAt).toBeGreaterThanOrEqual(performance.now() + 200);
  });

  // ── Stage C Priority 2: Creator Studio Multi-Shot Target Support ───────
  it('renders multi-shot checkbox in Creator Studio DOM, reads and saves multiShot correctly', async () => {
    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);

    const ui = new UIManager(engine, appContainer);
    ui.navigateTo('creator');

    // Verify multi-shot checkbox is rendered in DOM
    const multiShotCheckbox = appContainer.querySelector('#studio-multi-shot') as HTMLInputElement;
    expect(multiShotCheckbox).not.toBeNull();
    expect(multiShotCheckbox.type).toBe('checkbox');

    // Check multi-shot toggle
    multiShotCheckbox.checked = true;

    // Set scenario name
    const nameInput = appContainer.querySelector('#studio-name') as HTMLInputElement;
    nameInput.value = 'Custom Spray Test Drill';

    // Set HP to 300
    const hpInput = appContainer.querySelector('#studio-target-hp') as HTMLInputElement;
    hpInput.value = '300';

    // Save as new drill
    const saveBtn = appContainer.querySelector('#btn-studio-save') as HTMLButtonElement;
    await saveBtn.click();

    const customScenarios = store.getCustomScenarios();
    const saved = customScenarios.find(s => s.name === 'Custom Spray Test Drill');
    expect(saved).toBeDefined();
    expect(saved?.target.multiShot).toBe(true);
    expect(saved?.target.hp).toBe(300);

    // Verify validation preserves boolean multiShot
    const val = validateCustomScenarioJSON(saved);
    expect(val.valid).toBe(true);
  });

  it('ensures HP alone does not trigger multi-shot behavior when multiShot is false or omitted', () => {
    const singleShotHighHp: WarmupLabScenarioV1 = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'custom_high_hp_one_shot',
      name: 'High HP One Shot Drill',
      description: 'Scenario with 500 HP but multiShot omitted',
      category: 'flick',
      difficulty: 'hard',
      durationSec: 60,
      spawner: {
        mode: 'respawn_on_kill',
        maxAlive: 1,
        respawnDelayMs: 0,
      },
      target: {
        shape: 'humanoid',
        hp: 500,
        multiShot: false,
        movementPattern: 'static',
      },
    };

    const config = convertCustomScenarioToConfig(singleShotHighHp);
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const target = tm.getTargets()[0];
    const initialId = target.id;

    // Aim at torso (40 damage from Vandal, well below 500 HP)
    const torsoY = target.position.y + target.dimensions.torsoOffsetY;
    const dir = new THREE.Vector3().subVectors(new THREE.Vector3(target.position.x, torsoY, target.position.z), controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    (engine as any).handleShoot();

    // Since multiShot is false, the target must be eliminated on the first hit despite having 500 HP
    expect(tm.getTarget(initialId)).toBeUndefined();
    expect((engine as any).hits).toBe(1);
  });

  it('absorbs multiple shots on custom multiShot drill until HP reaches zero', () => {
    const multiShotDrill: WarmupLabScenarioV1 = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'custom_multi_shot_dummy',
      name: 'Custom Multi Shot Dummy',
      description: 'Scenario with 120 HP and multiShot: true',
      category: 'precision',
      difficulty: 'intermediate',
      durationSec: 60,
      spawner: {
        mode: 'fixed_points',
        maxAlive: 1,
        fixedPoints: [{ x: 0, y: 1.58, z: -12 }],
        respawnDelayMs: 0,
      },
      target: {
        shape: 'humanoid',
        hp: 120,
        multiShot: true,
        movementPattern: 'static',
      },
    };

    const config = convertCustomScenarioToConfig(multiShotDrill);
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const dummy = tm.getTargets()[0];
    const dummyId = dummy.id;

    // Aim at torso (Vandal damage = 40 HP per shot. 120 HP -> 3 shots to kill)
    const torsoY = dummy.position.y + dummy.dimensions.torsoOffsetY;
    const dir = new THREE.Vector3().subVectors(new THREE.Vector3(dummy.position.x, torsoY, dummy.position.z), controls.yawObject.position).normalize();
    vi.spyOn(controls, 'getRay').mockReturnValue(new THREE.Ray(controls.yawObject.position.clone(), dir));

    // Shot 1: 120 -> 80 HP (non-lethal)
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();
    expect(dummy.alive).toBe(true);
    expect(dummy.hp).toBe(80);
    expect(tm.getTarget(dummyId)).toBeDefined();

    // Shot 2: 80 -> 40 HP (non-lethal)
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();
    expect(dummy.alive).toBe(true);
    expect(dummy.hp).toBe(40);

    // Shot 3: 40 -> 0 HP (lethal elimination)
    (engine as any).lastShotTime = -Infinity;
    (engine as any).handleShoot();
    expect(tm.getTarget(dummyId)).toBeUndefined();
    expect((engine as any).hits).toBe(3);
  });

  // ── Stage C Priority 3: Corridor Anti-Same-Position Spawning ──────────
  it('avoids spawning replacements within 1.5m of lastKilledPos in corridor mode when valid alternatives exist', () => {
    const config = getScenarioById('headline')!; // Corridor head-level drill
    engine.startScenario(config);

    const tm = (engine as any).targets as TargetManager;
    const spawner = (engine as any).spawner as Spawner;

    const initial = tm.getTargets()[0];
    const killedPos = initial.position.clone();

    // Simulate killing target at killedPos
    spawner.onTargetKilled(initial.id, { x: killedPos.x, y: killedPos.y, z: killedPos.z });
    tm.removeTarget(initial.id);

    // Spawn 10 replacements and confirm all maintain >= 1.5m distance from killedPos
    for (let i = 0; i < 10; i++) {
      tm.clear();
      (spawner as any).spawnOneTarget();
      const spawned = tm.getTargets()[0];
      expect(spawned).toBeDefined();
      expect(spawned.position.distanceTo(killedPos)).toBeGreaterThanOrEqual(1.5);
    }
  });

  // ── Stage C Priority 4: Accurate Torso Cylinder Overkill Intersection ─
  it('accurately detects overkill on torso cylinder and rejects horizontal near-misses outside torso radius', () => {
    const tm = new TargetManager(renderer);
    const config = getScenarioById('target-transfer')!;

    // Spawn a target at (0, 1.7, -10)
    const target = tm.spawnTarget(config, new THREE.Vector3(0, 1.7, -10));
    expect(target.dimensions.shape).toBe('humanoid');
    const torsoY = target.position.y + target.dimensions.torsoOffsetY;
    const torsoRadius = target.dimensions.torsoRadius; // 0.18m
    const now = performance.now();

    // Eliminate target so it is recorded in recentlyKilled
    tm.removeTarget(target.id);

    // 1. Ray aiming directly at torso center: must be detected as overkill
    const directRay = new THREE.Ray(
      new THREE.Vector3(0, torsoY, 0),
      new THREE.Vector3(0, 0, -1) // passes through (0, torsoY, -10)
    );
    expect(tm.checkOverkill(directRay, now)).toBe(true);

    // 2. Ray aiming horizontally at x = torsoRadius * 0.5 (inside cylinder): must be overkill
    const innerRay = new THREE.Ray(
      new THREE.Vector3(torsoRadius * 0.5, torsoY, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(tm.checkOverkill(innerRay, now)).toBe(true);

    // 3. Ray aiming horizontally at x = torsoRadius + 0.05 (outside cylinder, but within old sphere bound ~0.25m):
    // MUST NOT be detected as overkill under cylinder hit-testing
    const nearMissRay = new THREE.Ray(
      new THREE.Vector3(torsoRadius + 0.05, torsoY, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(tm.checkOverkill(nearMissRay, now)).toBe(false);

    // 4. Ray aiming at head: must still be detected as overkill
    const headY = target.position.y + target.dimensions.headOffsetY;
    const headRay = new THREE.Ray(
      new THREE.Vector3(0, headY, 0),
      new THREE.Vector3(0, 0, -1)
    );
    expect(tm.checkOverkill(headRay, now)).toBe(true);
  });
});
