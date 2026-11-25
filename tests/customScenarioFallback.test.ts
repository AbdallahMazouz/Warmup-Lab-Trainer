import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from '../src/store';
import { WarmupLabDatabase } from '../src/db/database';
import { createDefaultCustomScenario } from '../src/scenarioConfig';
import { LS_CUSTOM_SCENARIOS } from '../src/constants';

describe('Phase 3 — Custom Scenario Persistence & Storage Fallback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists custom scenarios to localStorage mirror upon save and delete', () => {
    const db = new WarmupLabDatabase(`TestCustomPersistence_${Date.now()}_${Math.random()}`);
    const store = new Store(db);

    const sc = createDefaultCustomScenario('retaliatory_duel');
    sc.name = 'Persistent Custom Drill';
    const res = store.saveCustomScenario(sc);
    expect(res.success).toBe(true);

    // Verify localStorage mirror was written
    const rawLs = localStorage.getItem(LS_CUSTOM_SCENARIOS);
    expect(rawLs).toBeTruthy();
    const parsed = JSON.parse(rawLs!);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe(sc.id);
    expect(parsed[0].name).toBe('Persistent Custom Drill');

    // Delete custom drill
    const delRes = store.deleteCustomScenario(sc.id);
    expect(delRes).toBe(true);

    const rawLsAfter = localStorage.getItem(LS_CUSTOM_SCENARIOS);
    const parsedAfter = JSON.parse(rawLsAfter!);
    expect(parsedAfter.length).toBe(0);
  });

  it('enters fallback mode when Dexie fails to open, but retains custom scenarios from localStorage', async () => {
    // Seed localStorage with a custom scenario
    const custom = createDefaultCustomScenario('tactical_peek');
    custom.name = 'Fallback Offline Drill';
    localStorage.setItem(LS_CUSTOM_SCENARIOS, JSON.stringify([custom]));

    // Create a mock DB that rejects open()
    const faultyDb = {
      open: vi.fn().mockRejectedValue(new Error('IndexedDB blocked by security policy')),
      close: vi.fn(),
    } as unknown as WarmupLabDatabase;

    const store = new Store(faultyDb);
    // Before async init, constructor synchronously loaded from localStorage
    expect(store.getCustomScenarios().length).toBe(1);
    expect(store.getCustomScenario(custom.id)?.name).toBe('Fallback Offline Drill');

    await store.init();
    expect(store.isFallback()).toBe(true);
    expect(store.isReady()).toBe(true);
    expect(store.getCustomScenarios().length).toBe(1);

    // Save another scenario in fallback mode
    const custom2 = createDefaultCustomScenario('spray_control');
    custom2.name = 'Secondary Fallback Drill';
    const saveRes = store.saveCustomScenario(custom2);
    expect(saveRes.success).toBe(true);
    expect(store.getCustomScenarios().length).toBe(2);

    // Verify localStorage mirror has both drills
    const rawLs = localStorage.getItem(LS_CUSTOM_SCENARIOS);
    const parsed = JSON.parse(rawLs!);
    expect(parsed.length).toBe(2);
  });

  it('safely handles corrupted localStorage data without throwing', () => {
    localStorage.setItem(LS_CUSTOM_SCENARIOS, 'invalid {json');
    const db = new WarmupLabDatabase(`TestCorruptLS_${Date.now()}_${Math.random()}`);
    expect(() => {
      const store = new Store(db);
      expect(store.getCustomScenarios().length).toBe(0);
    }).not.toThrow();
  });
});
