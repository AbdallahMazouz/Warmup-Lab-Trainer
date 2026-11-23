import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../src/store';
import { WarmupLabDatabase } from '../src/db/database';
import type { SessionResult, Playlist } from '../src/types';

describe('Store with Dexie Write-Through Cache (Phase 3)', () => {
  let db: WarmupLabDatabase;
  let store: Store;

  beforeEach(async () => {
    localStorage.clear();
    db = new WarmupLabDatabase(`TestStoreDB_${Date.now()}_${Math.random()}`);
    store = new Store(db);
    await store.init();
  });

  afterEach(async () => {
    await db.delete();
    localStorage.clear();
  });

  it('hydrates empty store and reports ready state', () => {
    expect(store.isReady()).toBe(true);
    expect(store.isFallback()).toBe(false);
    expect(store.totalSessions()).toBe(0);
    expect(store.getPlaylists().length).toBe(0);
  });

  it('addSession updates in-memory cache synchronously and persists to Dexie', async () => {
    const session: SessionResult = {
      id: 'sess_live_1',
      scenarioId: 'micro-adjust',
      scenarioName: 'Micro Adjust',
      category: 'flick',
      difficulty: 'standard',
      timestamp: Date.now(),
      durationSec: 60,
      score: 1300,
      hits: 26,
      misses: 2,
      headshots: 20,
      accuracy: 92.8,
      avgReactionMs: 215,
      medianReactionMs: 210,
      bestReactionMs: 175,
      targetsPerSecond: 0.43,
    };

    // Synchronous execution
    const res = store.addSession(session);
    expect(res.isPB).toBe(true);
    expect(store.totalSessions()).toBe(1);
    expect(store.getSessions()[0].id).toBe('sess_live_1');

    // Verify PB is immediately accessible synchronously
    const pb = store.getPB('micro-adjust');
    expect(pb).not.toBeNull();
    expect(pb?.score).toBe(1300);

    // Wait a tick for async Dexie background write
    await new Promise(r => setTimeout(r, 50));

    // Verify Dexie table has the session
    const dbSession = await db.sessions.get('sess_live_1');
    expect(dbSession).toBeDefined();
    expect(dbSession?.score).toBe(1300);

    const dbPB = await db.personalBests.get('micro-adjust');
    expect(dbPB).toBeDefined();
    expect(dbPB?.score).toBe(1300);
  });

  it('survives store reload and rehydrates from Dexie', async () => {
    store.addSession({
      id: 'sess_persist_1',
      scenarioId: 'gridshot',
      scenarioName: 'Gridshot',
      category: 'flick',
      difficulty: 'standard',
      timestamp: 1700000000,
      durationSec: 60,
      score: 950,
      hits: 19,
      misses: 5,
      headshots: 12,
      accuracy: 79.2,
      avgReactionMs: 240,
      medianReactionMs: 235,
      bestReactionMs: 190,
      targetsPerSecond: 0.32,
    });

    await new Promise(r => setTimeout(r, 50));

    // Simulate page reload with a new Store instance on the same DB
    const reloadedStore = new Store(db);
    await reloadedStore.init();

    expect(reloadedStore.totalSessions()).toBe(1);
    expect(reloadedStore.getSessions()[0].scenarioId).toBe('gridshot');
    expect(reloadedStore.getPB('gridshot')?.score).toBe(950);
  });

  it('universal exportBackupJSON and importBackupJSON work seamlessly', async () => {
    store.addSession({
      id: 'sess_b1',
      scenarioId: 'micro-adjust',
      scenarioName: 'Micro Adjust',
      category: 'flick',
      difficulty: 'standard',
      timestamp: 1700001000,
      durationSec: 60,
      score: 1400,
      hits: 28,
      misses: 1,
      headshots: 24,
      accuracy: 96.5,
      avgReactionMs: 200,
      medianReactionMs: 195,
      bestReactionMs: 165,
      targetsPerSecond: 0.47,
    });

    const playlistRes = store.createPlaylist('Custom Aim Routine', 'My drill set', [
      { scenarioId: 'micro-adjust', durationSec: 45 },
    ]);
    expect(playlistRes.success).toBe(true);

    const backupJson = store.exportBackupJSON();
    expect(backupJson).toContain('warmuplab-backup');
    expect(backupJson).toContain('Custom Aim Routine');

    // Clear and restore into fresh store & db
    localStorage.clear();
    const newDb = new WarmupLabDatabase(`TestRestoreDB_${Date.now()}_${Math.random()}`);
    const freshStore = new Store(newDb);
    await freshStore.init();

    expect(freshStore.totalSessions()).toBe(0);

    const importRes = await freshStore.importBackupJSON(backupJson);
    expect(importRes.success).toBe(true);
    expect(importRes.sessionsImported).toBe(1);
    expect(importRes.playlistsImported).toBe(1);

    expect(freshStore.totalSessions()).toBe(1);
    expect(freshStore.getPlaylists()[0].name).toBe('Custom Aim Routine');

    await newDb.delete();
  });
});
