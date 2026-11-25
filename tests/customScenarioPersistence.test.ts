import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/store';
import { WarmupLabDatabase } from '../src/db/database';
import { createDefaultCustomScenario } from '../src/scenarioConfig';
import { getScenarioById, SCENARIOS } from '../src/scenarios';

describe('Custom Scenario Persistence & Registry Integration (Phase 4)', () => {
  let db: WarmupLabDatabase;
  let store: Store;

  beforeEach(async () => {
    localStorage.clear();
    db = new WarmupLabDatabase(`TestCustomScenDB_${Date.now()}_${Math.random()}`);
    store = new Store(db);
    await store.init();
  });

  afterEach(async () => {
    await db.delete();
    localStorage.clear();
  });

  it('saves and retrieves custom scenarios via Store', () => {
    const sc = createDefaultCustomScenario('retaliatory_duel');
    sc.name = 'Ranked Bot Skirmish';

    const saveRes = store.saveCustomScenario(sc);
    expect(saveRes.success).toBe(true);

    const list = store.getCustomScenarios();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(sc.id);
    expect(list[0].name).toBe('Ranked Bot Skirmish');

    const single = store.getCustomScenario(sc.id);
    expect(single).toBeDefined();
    expect(single?.name).toBe('Ranked Bot Skirmish');
  });

  it('unified getScenarioById resolves built-in first, then custom scenarios', () => {
    // 1. Built-in scenario
    const builtin = getScenarioById('flick-static');
    expect(builtin).toBeDefined();
    expect(builtin?.name).toBe('Static Flicks');

    // 2. Custom scenario
    const custom = createDefaultCustomScenario('smooth_track');
    custom.name = 'Vertical Tracking Duel';
    store.saveCustomScenario(custom);

    const resolved = getScenarioById(custom.id);
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe(custom.id);
    expect(resolved?.name).toBe('Vertical Tracking Duel');
    expect(resolved?.movementPattern).toBe('strafe');
  });

  it('duplicates custom scenarios with unique IDs and preserves properties', () => {
    const custom = createDefaultCustomScenario('tactical_peek');
    custom.name = 'Ascent A Main Peek';
    store.saveCustomScenario(custom);

    const dup = store.duplicateCustomScenario(custom.id);
    expect(dup).not.toBeNull();
    expect(dup?.id).not.toBe(custom.id);
    expect(dup?.name).toBe('Ascent A Main Peek (Copy)');
    expect(dup?.spawner.mode).toBe('peek');

    expect(store.getCustomScenarios().length).toBe(2);
  });

  it('deletes custom scenarios cleanly from memory and Dexie', async () => {
    const custom = createDefaultCustomScenario('static_flick');
    store.saveCustomScenario(custom);
    expect(store.getCustomScenarios().length).toBe(1);

    const delRes = store.deleteCustomScenario(custom.id);
    expect(delRes).toBe(true);
    expect(store.getCustomScenarios().length).toBe(0);

    // Verify deleted in Dexie
    const fromDb = await db.customScenarios.get(custom.id);
    expect(fromDb).toBeUndefined();
  });

  it('persists custom scenarios across store reloads', async () => {
    const custom = createDefaultCustomScenario('retaliatory_duel');
    custom.name = 'Persistent Skirmish';
    store.saveCustomScenario(custom);

    // Give background Dexie write a tick
    await new Promise(r => setTimeout(r, 50));

    // Simulate page reload with a fresh store instance on same DB
    const reloadedStore = new Store(db);
    await reloadedStore.init();

    expect(reloadedStore.getCustomScenarios().length).toBe(1);
    expect(reloadedStore.getCustomScenario(custom.id)?.name).toBe('Persistent Skirmish');
  });

  it('exports and restores custom scenarios in universal backup V4', async () => {
    const custom = createDefaultCustomScenario('tactical_peek');
    custom.name = 'V4 Backup Drill';
    store.saveCustomScenario(custom);

    const backupJson = store.exportBackupJSON();
    expect(backupJson).toContain('warmuplab-backup');
    expect(backupJson).toContain('"version": 4');
    expect(backupJson).toContain('V4 Backup Drill');

    // Clear and restore into fresh store & db
    localStorage.clear();
    const restoreDb = new WarmupLabDatabase(`TestRestoreV4DB_${Date.now()}_${Math.random()}`);
    const restoreStore = new Store(restoreDb);
    await restoreStore.init();

    expect(restoreStore.getCustomScenarios().length).toBe(0);

    const importRes = await restoreStore.importBackupJSON(backupJson);
    expect(importRes.success).toBe(true);
    expect(importRes.customScenariosImported).toBe(1);
    expect(restoreStore.getCustomScenarios().length).toBe(1);
    expect(restoreStore.getCustomScenario(custom.id)?.name).toBe('V4 Backup Drill');

    await restoreDb.delete();
  });
});
