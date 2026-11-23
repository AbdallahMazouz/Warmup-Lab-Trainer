import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { Spawner } from '../src/spawner';
import { TargetManager } from '../src/targetManager';
import { Renderer } from '../src/renderer';
import { validateCustomScenarioJSON, createDefaultCustomScenario, resolveScenarioConfig } from '../src/scenarioConfig';
import type { WarmupLabScenarioV1 } from '../src/types';

describe('Phase 2 — Custom Scenario Validation & Spawner Reliability', () => {
  describe('Mode-Specific Validation in validateCustomScenarioJSON', () => {
    let base: WarmupLabScenarioV1;

    beforeEach(() => {
      base = createDefaultCustomScenario('retaliatory_duel');
    });

    it('validates a correct grid mode configuration', () => {
      base.spawner.mode = 'grid';
      base.spawner.gridDimensions = { rows: 3, cols: 4, spacingX: 1.5, spacingY: 1.2 };
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(true);
    });

    it('rejects grid mode with missing or non-object gridDimensions', () => {
      base.spawner.mode = 'grid';
      delete base.spawner.gridDimensions;
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('spawner.gridDimensions is required for "grid" mode');
    });

    it('rejects grid mode with zero or negative dimensions', () => {
      base.spawner.mode = 'grid';
      base.spawner.gridDimensions = { rows: 0, cols: -2, spacingX: 1.5, spacingY: 1.2 };
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('gridDimensions.rows'))).toBe(true);
      expect(res.errors.some(e => e.includes('gridDimensions.cols'))).toBe(true);
    });

    it('rejects grid mode with non-positive spacing or NaN', () => {
      base.spawner.mode = 'grid';
      base.spawner.gridDimensions = { rows: 2, cols: 2, spacingX: 0, spacingY: NaN };
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('gridDimensions.spacingX'))).toBe(true);
      expect(res.errors.some(e => e.includes('gridDimensions.spacingY'))).toBe(true);
    });

    it('validates a correct fixed_points configuration', () => {
      base.spawner.mode = 'fixed_points';
      base.spawner.fixedPoints = [
        { x: -2, y: 1.5, z: -10 },
        { x: 2, y: 1.5, z: -10 },
      ];
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(true);
    });

    it('rejects fixed_points mode with empty or missing array', () => {
      base.spawner.mode = 'fixed_points';
      base.spawner.fixedPoints = [];
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
      expect(res.errors).toContain('spawner.fixedPoints must be a non-empty array for "fixed_points" mode');
    });

    it('rejects fixed_points mode containing malformed coordinate objects', () => {
      base.spawner.mode = 'fixed_points';
      base.spawner.fixedPoints = [
        { x: 0, y: 1.5, z: -10 },
        { x: NaN, y: 1.5, z: -10 },
      ];
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('spawner.fixedPoints[1]'))).toBe(true);
    });

    it('validates a correct random_arc configuration', () => {
      base.spawner.mode = 'random_arc';
      base.spawner.arcDegrees = 120;
      const res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(true);
    });

    it('rejects random_arc mode with out-of-range or NaN degrees', () => {
      base.spawner.mode = 'random_arc';
      base.spawner.arcDegrees = 0;
      let res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);

      base.spawner.arcDegrees = 400;
      res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);

      base.spawner.arcDegrees = NaN;
      res = validateCustomScenarioJSON(base);
      expect(res.valid).toBe(false);
    });
  });

  describe('Spawner Runtime Defensive Execution', () => {
    let spawner: Spawner;
    let targetManager: TargetManager;
    let renderer: Renderer;

    beforeEach(() => {
      const mockCanvas = document.createElement('canvas');
      const mockWebGLRenderer = {
        domElement: mockCanvas,
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        clear: () => {},
        dispose: () => {},
      } as unknown as THREE.WebGLRenderer;

      renderer = new Renderer(mockCanvas, 103, mockWebGLRenderer);
      targetManager = new TargetManager(renderer);
      spawner = new Spawner();
    });

    it('handles malformed fixed_points without crashing and generates finite coordinates', () => {
      const custom = createDefaultCustomScenario('retaliatory_duel');
      custom.spawner.mode = 'fixed_points';
      // Forcefully assign malformed points at runtime
      (custom.spawner as unknown as { fixedPoints: unknown[] }).fixedPoints = [];
      const resolved = resolveScenarioConfig(custom);

      expect(() => {
        spawner.init(resolved, targetManager);
      }).not.toThrow();

      const targets = targetManager.getTargets();
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(Number.isFinite(t.position.x)).toBe(true);
        expect(Number.isFinite(t.position.y)).toBe(true);
        expect(Number.isFinite(t.position.z)).toBe(true);
      }
    });

    it('handles malformed gridDimensions without crashing and generates finite coordinates', () => {
      const custom = createDefaultCustomScenario('retaliatory_duel');
      custom.spawner.mode = 'grid';
      // Forcefully assign malformed grid dimensions
      (custom.spawner as unknown as { gridDimensions: unknown }).gridDimensions = null;
      const resolved = resolveScenarioConfig(custom);

      expect(() => {
        spawner.init(resolved, targetManager);
      }).not.toThrow();

      const targets = targetManager.getTargets();
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(Number.isFinite(t.position.x)).toBe(true);
        expect(Number.isFinite(t.position.y)).toBe(true);
        expect(Number.isFinite(t.position.z)).toBe(true);
      }
    });

    it('handles malformed random_arc degrees without producing NaN positions', () => {
      const custom = createDefaultCustomScenario('retaliatory_duel');
      custom.spawner.mode = 'random_arc';
      (custom.spawner as unknown as { arcDegrees: unknown }).arcDegrees = NaN;
      const resolved = resolveScenarioConfig(custom);

      expect(() => {
        spawner.init(resolved, targetManager);
      }).not.toThrow();

      const targets = targetManager.getTargets();
      expect(targets.length).toBeGreaterThan(0);
      for (const t of targets) {
        expect(Number.isFinite(t.position.x)).toBe(true);
        expect(Number.isFinite(t.position.y)).toBe(true);
        expect(Number.isFinite(t.position.z)).toBe(true);
      }
    });
  });
});
