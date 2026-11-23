import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WarmupLabDatabase } from '../src/db/database';
import { migrateFromLocalStorage, isMigrationCompleted } from '../src/db/migration';
import {
  LS_SESSIONS,
  LS_PERSONAL_BESTS,
  LS_ROUTINES,
  LS_PLAYLISTS,
  LS_SETTINGS,
  LS_MIGRATION_V3_STATUS,
  LS_MIGRATION_V3_ARCHIVED,
} from '../src/constants';

describe('LocalStorage to Dexie Migration Engine', () => {
  let db: WarmupLabDatabase;

  beforeEach(() => {
    localStorage.clear();
    db = new WarmupLabDatabase(`TestMigrationDB_${Date.now()}_${Math.random()}`);
  });

  afterEach(async () => {
    await db.delete();
    localStorage.clear();
  });

  it('handles empty localStorage cleanly', async () => {
    const res = await migrateFromLocalStorage(db);
    expect(res.migrated).toBe(false);
    expect(res.sessionsCount).toBe(0);
    expect(res.errors.length).toBe(0);
    expect(isMigrationCompleted()).toBe(true);
  });

  it('migrates sessions, PBs, routines, playlists, and settings non-destructively', async () => {
    // 1. Seed mock legacy localStorage
    const mockSessions = [
      {
        id: 'sess_1',
        scenarioId: 'micro-adjust',
        score: 1100,
        hits: 20,
        misses: 2,
        durationSec: 60,
        timestamp: 1690000000,
      },
      {
        // Missing id, should be auto-assigned
        scenarioId: 'gridshot',
        score: 850,
        hits: 15,
        misses: 5,
        durationSec: 30,
        timestamp: 1690001000,
      },
    ];

    const mockPBs = {
      'micro-adjust:standard': {
        scenarioId: 'micro-adjust',
        difficulty: 'standard',
        score: 1100,
        accuracy: 90.9,
        avgReactionMs: 230,
        timestamp: 1690000000,
      },
    };

    const mockRoutines = [
      {
        id: 'rout_1',
        routineId: 'full-warmup',
        routineName: 'Full Warmup',
        totalDurationSec: 300,
        drillsCompleted: 5,
        totalDrills: 5,
        totalScore: 5000,
        timestamp: 1690002000,
      },
    ];

    const mockPlaylists = [
      {
        id: 'pl_1',
        name: 'My Playlist',
        defaultRestIntervalSec: 5,
        entries: [{ id: 'e1', scenarioId: 'micro-adjust', durationSec: 60 }],
        createdAt: 1690000000,
        updatedAt: 1690000000,
      },
    ];

    const mockSettings = {
      fov: 103,
      sensitivity: 0.15,
      crosshairColor: '#00ff78',
    };

    localStorage.setItem(LS_SESSIONS, JSON.stringify(mockSessions));
    localStorage.setItem(LS_PERSONAL_BESTS, JSON.stringify(mockPBs));
    localStorage.setItem(LS_ROUTINES, JSON.stringify(mockRoutines));
    localStorage.setItem(LS_PLAYLISTS, JSON.stringify(mockPlaylists));
    localStorage.setItem(LS_SETTINGS, JSON.stringify(mockSettings));

    // 2. Run migration
    const res = await migrateFromLocalStorage(db);

    expect(res.migrated).toBe(true);
    expect(res.sessionsCount).toBe(2);
    expect(res.pbsCount).toBe(1);
    expect(res.routinesCount).toBe(1);
    expect(res.playlistsCount).toBe(1);
    expect(res.settingsMigrated).toBe(true);
    expect(res.errors.length).toBe(0);

    // 3. Verify Dexie contents
    const dbSessions = await db.sessions.toArray();
    expect(dbSessions.length).toBe(2);
    expect(dbSessions.find(s => s.scenarioId === 'gridshot')?.id).toBeDefined();

    const dbPBs = await db.personalBests.toArray();
    expect(dbPBs.length).toBe(1);
    expect(dbPBs[0].id).toBe('micro-adjust:standard');

    const dbPlaylists = await db.playlists.toArray();
    expect(dbPlaylists.length).toBe(1);
    expect(dbPlaylists[0].name).toBe('My Playlist');

    const dbSettings = await db.settings.get('general');
    expect(dbSettings?.value.sensitivity).toBe(0.15);

    // 4. Non-destructive check: Original localStorage keys must still exist!
    expect(localStorage.getItem(LS_SESSIONS)).not.toBeNull();
    expect(localStorage.getItem(LS_PERSONAL_BESTS)).not.toBeNull();
    expect(localStorage.getItem(LS_ROUTINES)).not.toBeNull();
    expect(localStorage.getItem(LS_PLAYLISTS)).not.toBeNull();
    expect(localStorage.getItem(LS_SETTINGS)).not.toBeNull();
    expect(localStorage.getItem(LS_MIGRATION_V3_STATUS)).toBe('completed');
    expect(localStorage.getItem(LS_MIGRATION_V3_ARCHIVED)).not.toBeNull();

    // 5. Idempotency check: Re-running migration does not duplicate or re-run
    const rerun = await migrateFromLocalStorage(db);
    expect(rerun.migrated).toBe(false);
    expect(rerun.sessionsCount).toBe(0);
    const dbSessionsAfterRerun = await db.sessions.toArray();
    expect(dbSessionsAfterRerun.length).toBe(2);
  });

  it('skips corrupted records gracefully and imports valid records', async () => {
    const corruptSessions = [
      { id: 'valid_1', scenarioId: 'micro-adjust', score: 500, hits: 10, misses: 2, timestamp: 1000 },
      { id: 'invalid_no_scenario', score: 300 }, // missing scenarioId -> invalid
      'not even an object',
    ];

    localStorage.setItem(LS_SESSIONS, JSON.stringify(corruptSessions));

    const res = await migrateFromLocalStorage(db);
    expect(res.migrated).toBe(true);
    expect(res.sessionsCount).toBe(1);
    expect(res.errors.length).toBeGreaterThan(0);

    const dbSessions = await db.sessions.toArray();
    expect(dbSessions.length).toBe(1);
    expect(dbSessions[0].id).toBe('valid_1');
  });
});
