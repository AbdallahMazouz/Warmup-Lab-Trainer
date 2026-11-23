import { describe, it, expect } from 'vitest';
import {
  validateCustomScenarioJSON,
  convertCustomScenarioToConfig,
  createDefaultCustomScenario,
} from '../src/scenarioConfig';
import type { WarmupLabScenarioV1 } from '../src/types';

describe('Custom Scenario Schema & Validation (Phase 4)', () => {
  it('validates a correct WarmupLabScenarioV1 template', () => {
    const scenario = createDefaultCustomScenario('static_flick');
    const res = validateCustomScenarioJSON(scenario);
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
  });

  it('generates valid presets for all archetype templates', () => {
    const templates = ['static_flick', 'smooth_track', 'tactical_peek', 'retaliatory_duel'];
    for (const t of templates) {
      const sc = createDefaultCustomScenario(t);
      const res = validateCustomScenarioJSON(sc);
      expect(res.valid, `Template "${t}" failed validation: ${res.errors.join(', ')}`).toBe(true);
      expect(sc.id.startsWith('custom_')).toBe(true);
      expect(sc.format).toBe('warmuplab-scenario');
      expect(sc.version).toBe(1);
    }
  });

  it('rejects payloads with wrong format or unsupported schema version', () => {
    const badFormat = {
      format: 'unknown-format',
      version: 1,
      id: 'custom_1',
      name: 'Test',
      durationSec: 60,
      spawner: { mode: 'random_area', maxAlive: 1 },
      target: { shape: 'sphere', movementPattern: 'static' },
    };
    const res = validateCustomScenarioJSON(badFormat);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('Invalid format identifier'))).toBe(true);

    const badVersion = {
      format: 'warmuplab-scenario',
      version: 99,
      id: 'custom_1',
      name: 'Test',
      durationSec: 60,
      spawner: { mode: 'random_area', maxAlive: 1 },
      target: { shape: 'sphere', movementPattern: 'static' },
    };
    const resVersion = validateCustomScenarioJSON(badVersion);
    expect(resVersion.valid).toBe(false);
    expect(resVersion.errors.some(e => e.includes('Unsupported schema version'))).toBe(true);
  });

  it('enforces custom_ ID prefix to prevent collision with built-in scenarios', () => {
    const collisionAttempt = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'flick-static', // Built-in collision attempt!
      name: 'Fake Flick Static',
      durationSec: 60,
      spawner: { mode: 'random_area', maxAlive: 1 },
      target: { shape: 'sphere', movementPattern: 'static' },
    };
    const res = validateCustomScenarioJSON(collisionAttempt);
    expect(res.valid).toBe(false);
    expect(res.errors.some(e => e.includes('must start with "custom_" prefix'))).toBe(true);
  });

  it('enforces strict boundary limits on duration, targets, and speed', () => {
    const outOfBounds = {
      format: 'warmuplab-scenario',
      version: 1,
      id: 'custom_out_of_bounds',
      name: 'A'.repeat(85), // Too long
      durationSec: 2, // Too short (< 5s)
      spawner: {
        mode: 'random_area',
        maxAlive: 50, // Too many (> 20)
        spawnRadius: 100, // Too far (> 40m)
      },
      target: {
        shape: 'invalid_shape',
        movementPattern: 'flying_circle', // Unsupported pattern
        sizeMultiplier: 10.0, // Too big (> 3.0)
        speedMultiplier: 9.0, // Too fast (> 4.0)
      },
    };
    const res = validateCustomScenarioJSON(outOfBounds);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('converts WarmupLabScenarioV1 to engine-compatible ScenarioConfig', () => {
    const custom = createDefaultCustomScenario('retaliatory_duel');
    const engineConfig = convertCustomScenarioToConfig(custom);

    expect(engineConfig.id).toBe(custom.id);
    expect(engineConfig.name).toBe(custom.name);
    expect(engineConfig.durationSec).toBe(custom.durationSec);
    expect(engineConfig.targetCount).toBe(custom.spawner.maxAlive);
    expect(engineConfig.movementPattern).toBe('jiggle');
    expect(engineConfig.target?.retaliatory).toBe(true);
    expect(engineConfig.target?.retaliateDelayMs).toBe(800);
    expect(engineConfig.spawner?.mode).toBe('random_area');
    expect(engineConfig.scoring?.counterStrafeBonus).toBe(150);
  });
});
