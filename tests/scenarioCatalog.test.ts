import { describe, it, expect } from 'vitest';
import { getScenariosByCategory, SCENARIOS } from '../src/scenarios';
import { createDefaultCustomScenario, convertCustomScenarioToConfig } from '../src/scenarioConfig';

describe('Phase 7 — Scenario Catalog Querying', () => {
  it('returns built-in scenarios matching category when no custom list is passed', () => {
    const flick = getScenariosByCategory('flick');
    expect(flick.length).toBeGreaterThan(0);
    expect(flick.every(s => s.category === 'flick')).toBe(true);
  });

  it('includes custom scenarios matching category when custom list is provided', () => {
    const custom = createDefaultCustomScenario('retaliatory_duel');
    custom.id = 'custom_tactical_duel';
    custom.category = 'tactical';
    const customConfig = convertCustomScenarioToConfig(custom);

    const tacticalWithout = getScenariosByCategory('tactical');
    const tacticalWith = getScenariosByCategory('tactical', [customConfig]);

    expect(tacticalWith.length).toBe(tacticalWithout.length + 1);
    expect(tacticalWith.some(s => s.id === 'custom_tactical_duel')).toBe(true);
  });

  it('supports category "all" returning combined pool', () => {
    const custom = createDefaultCustomScenario('retaliatory_duel');
    custom.id = 'custom_drill_all';
    const customConfig = convertCustomScenarioToConfig(custom);

    const all = getScenariosByCategory('all', [customConfig]);
    expect(all.length).toBe(SCENARIOS.length + 1);
  });

  it('preserves all 39 built-in scenarios with unique IDs and required metadata', () => {
    expect(SCENARIOS.length).toBe(39);
    const ids = SCENARIOS.map(s => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(39);
    for (const s of SCENARIOS) {
      expect(s.id).toBeDefined();
      expect(typeof s.id).toBe('string');
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.name).toBeDefined();
      expect(s.category).toBeDefined();
    }
  });
});
