import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine';
import { Renderer } from '../src/renderer';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { SCENARIOS } from '../src/scenarios';

describe('Phase 9 — Hot Loop Optimization & Elimination Path', () => {
  let engine: Engine;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    const mockWebGLRenderer = {
      domElement: canvas,
      setSize: () => {},
      setPixelRatio: () => {},
      render: () => {},
      clear: () => {},
      dispose: () => {},
    } as unknown as THREE.WebGLRenderer;

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
  });

  afterEach(() => {
    engine.dispose();
  });

  it('caches activeMovementEnabled and activeHasCover upon starting scenario', () => {
    const tacticalStrafe = SCENARIOS.find(s => s.id === 'tactical-counter-strafe')!;
    engine.startScenario(tacticalStrafe);

    expect((engine as unknown as { activeMovementEnabled: boolean }).activeMovementEnabled).toBe(true);
    expect((engine as unknown as { activeHasCover: boolean }).activeHasCover).toBe(false);

    engine.stopScenario();
    expect((engine as unknown as { activeMovementEnabled: boolean }).activeMovementEnabled).toBe(false);
    expect((engine as unknown as { activeHasCover: boolean }).activeHasCover).toBe(false);

    const peekDrill = SCENARIOS.find(s => s.id === 'tactical-jiggle')!;
    engine.startScenario(peekDrill);
    expect((engine as unknown as { activeHasCover: boolean }).activeHasCover).toBe(true);

    engine.stopScenario();
  });

  it('eliminates targets cleanly on hit and increments killstreak without taking dead paths', () => {
    const config = SCENARIOS.find(s => s.id === 'flick-static')!;
    engine.startScenario(config);

    const initialStreak = engine.getKillStreak();
    expect(initialStreak).toBe(0);

    // Spawn a target directly
    const target = engine.targets.spawnTarget(config);
    expect(target).toBeDefined();
    expect(engine.targets.getActiveCount()).toBeGreaterThan(0);

    // Simulate ray hitting the target
    const hitRay = new THREE.Ray(
      new THREE.Vector3(target.position.x, target.position.y, target.position.z + 10),
      new THREE.Vector3(0, 0, -1)
    );

    // Call private handleShoot or trigger controls onShoot
    (engine as unknown as { controls: { getRay: () => THREE.Ray; onShoot?: () => void } }).controls.getRay = () => hitRay;
    (engine as unknown as { handleShoot: () => void }).handleShoot();

    expect(engine.getKillStreak()).toBe(1);
    expect(engine.targets.getTarget(target.id)?.alive ?? false).toBe(false);

    engine.stopScenario();
  });
});
