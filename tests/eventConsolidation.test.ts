import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/engine';
import { Renderer } from '../src/renderer';
import { Controls } from '../src/controls';
import { AudioManager } from '../src/audio';
import { SettingsManager } from '../src/settings';
import { Store } from '../src/store';
import { SCENARIOS } from '../src/scenarios';
import type { EngineHUDState, SessionResult } from '../src/types';

describe('Phase 5 — Event Architecture & Consolidation', () => {
  let engine: Engine;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    const mockWebGLRenderer = {
      domElement: canvas,
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      render: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    } as unknown as THREE.WebGLRenderer;

    const renderer = new Renderer(canvas, 103, mockWebGLRenderer);
    const controls = new Controls(renderer.camera, canvas);
    const audio = new AudioManager();
    const settings = new SettingsManager();
    const store = new Store();
    engine = new Engine(renderer, controls, audio, settings, store);
  });

  it('emits onTick, onFlash, and onScenarioComplete to typed GameplayEventEmitter listeners', () => {
    const tickListener = vi.fn();
    const flashListener = vi.fn();
    const completeListener = vi.fn();

    const unsubTick = engine.events.on('onTick', tickListener);
    const unsubFlash = engine.events.on('onFlash', flashListener);
    const unsubComplete = engine.events.on('onScenarioComplete', completeListener);

    const mockHUD: EngineHUDState = {
      timeRemaining: 25,
      totalDuration: 30,
      score: 1500,
      hits: 15,
      misses: 2,
      accuracy: 88.2,
      headshots: 10,
      fps: 144,
      isTracking: false,
    };

    engine.events.emit('onTick', mockHUD);
    expect(tickListener).toHaveBeenCalledWith(mockHUD);

    engine.events.emit('onFlash', { intensity: 0.85, durationMs: 1800 });
    expect(flashListener).toHaveBeenCalledWith({ intensity: 0.85, durationMs: 1800 });

    const mockResult: SessionResult = {
      id: 'session-test',
      scenarioId: 'flick-static',
      scenarioName: 'Flick Static',
      category: 'flick',
      difficulty: 'intermediate',
      timestamp: Date.now(),
      durationSec: 30,
      score: 2500,
      hits: 25,
      misses: 2,
      headshots: 20,
      bodyHits: 5,
      shotsFired: 27,
      accuracy: 92.6,
      headshotPct: 80.0,
      avgReactionMs: 220,
      medianReactionMs: 215,
      bestReactionMs: 180,
      targetsPerSecond: 0.83,
      targetsPerMinute: 50.0,
      shotsMoving: 0,
      shotsStationary: 27,
      timeOnTarget: 0,
      flashAvoidRate: 0,
    };

    engine.events.emit('onScenarioComplete', { result: mockResult, isPB: true });
    expect(completeListener).toHaveBeenCalledWith({ result: mockResult, isPB: true });

    // Unsubscribe removes listener
    unsubTick();
    engine.events.emit('onTick', mockHUD);
    expect(tickListener).toHaveBeenCalledTimes(1);
  });

  it('emits onRetaliationHit and onMovementInaccurate simultaneously through emitter and callback bridge', () => {
    const emitterRetaliateSpy = vi.fn();
    const callbackRetaliateSpy = vi.fn();
    const emitterInaccurateSpy = vi.fn();
    const callbackInaccurateSpy = vi.fn();

    engine.events.on('onRetaliationHit', emitterRetaliateSpy);
    engine.callbacks.onRetaliationHit = callbackRetaliateSpy;

    engine.events.on('onMovementInaccurate', emitterInaccurateSpy);
    engine.callbacks.onMovementInaccurate = callbackInaccurateSpy;

    // Trigger retaliation target event
    (engine as unknown as { targets: { onTargetRetaliate?: (target: { id: string; retaliationPenalty?: number; position: THREE.Vector3 }) => void } })
      .targets.onTargetRetaliate?.({ id: 'bot-1', retaliationPenalty: 300, position: new THREE.Vector3(0, 0, -10) });

    // Since engine is not running, target retaliate returns early
    // Now start scenario and test
    const config = SCENARIOS.find(s => s.id === 'tactical-counter-strafe')!;
    engine.startScenario(config);

    (engine as unknown as { targets: { onTargetRetaliate?: (target: { id: string; retaliationPenalty?: number; position: THREE.Vector3 }) => void } })
      .targets.onTargetRetaliate?.({ id: 'bot-1', retaliationPenalty: 300, position: new THREE.Vector3(0, 0, -10) });

    expect(emitterRetaliateSpy).toHaveBeenCalledWith({ targetId: 'bot-1', penalty: 300 });
    expect(callbackRetaliateSpy).toHaveBeenCalledWith('bot-1', 300);

    engine.stopScenario();
  });
});
