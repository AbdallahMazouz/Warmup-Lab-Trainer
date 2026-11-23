import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WarmupLabDatabase } from '../src/db/database';
import type { SessionResult, Playlist } from '../src/types';

describe('WarmupLabDatabase (Dexie IndexedDB)', () => {
  let db: WarmupLabDatabase;

  beforeEach(() => {
    // Unique DB name per test to avoid cross-test pollution in fake-indexeddb
    db = new WarmupLabDatabase(`TestWarmupLabDB_${Date.now()}_${Math.random()}`);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('initializes all 6 tables with valid schema', () => {
    expect(db.sessions).toBeDefined();
    expect(db.personalBests).toBeDefined();
    expect(db.routineCompletions).toBeDefined();
    expect(db.playlists).toBeDefined();
    expect(db.settings).toBeDefined();
    expect(db.telemetry).toBeDefined();
  });

  it('can insert, query, and delete sessions with compound indexes', async () => {
    const session: SessionResult = {
      id: 'sess_1',
      scenarioId: 'micro-adjust',
      scenarioName: 'Micro Adjust',
      category: 'flick',
      difficulty: 'standard',
      timestamp: 1700000000,
      durationSec: 60,
      score: 1250,
      hits: 25,
      misses: 2,
      headshots: 18,
      accuracy: 92.5,
      avgReactionMs: 220,
      medianReactionMs: 215,
      bestReactionMs: 180,
      targetsPerSecond: 0.45,
    };

    await db.sessions.put(session);

    const fetched = await db.sessions.get('sess_1');
    expect(fetched).toBeDefined();
    expect(fetched?.score).toBe(1250);

    // Query by compound index [scenarioId+difficulty]
    const matched = await db.sessions
      .where(['scenarioId', 'difficulty'])
      .equals(['micro-adjust', 'standard'])
      .toArray();
    expect(matched.length).toBe(1);
    expect(matched[0].id).toBe('sess_1');

    await db.sessions.delete('sess_1');
    const afterDelete = await db.sessions.get('sess_1');
    expect(afterDelete).toBeUndefined();
  });

  it('supports personal best upserts and lookups', async () => {
    await db.personalBests.put({
      id: 'micro-adjust:standard',
      scenarioId: 'micro-adjust',
      difficulty: 'standard',
      score: 1500,
      accuracy: 94.0,
      avgReactionMs: 210,
      timestamp: 1700001000,
    });

    const pb = await db.personalBests.get('micro-adjust:standard');
    expect(pb).toBeDefined();
    expect(pb?.score).toBe(1500);

    // Update with higher score
    await db.personalBests.put({
      id: 'micro-adjust:standard',
      scenarioId: 'micro-adjust',
      difficulty: 'standard',
      score: 1800,
      accuracy: 96.0,
      avgReactionMs: 195,
      timestamp: 1700002000,
    });

    const updatedPb = await db.personalBests.get('micro-adjust:standard');
    expect(updatedPb?.score).toBe(1800);
  });

  it('stores and retrieves custom playlists', async () => {
    const playlist: Playlist = {
      id: 'pl_test_1',
      name: 'Speed Warmup',
      description: 'Quick warmup routine',
      defaultRestIntervalSec: 5,
      entries: [
        { id: 'e1', scenarioId: 'micro-adjust', durationSec: 45 },
        { id: 'e2', scenarioId: 'gridshot', durationSec: 60, restIntervalSec: 10 },
      ],
      createdAt: 1700000000,
      updatedAt: 1700000000,
      isBuiltin: false,
    };

    await db.playlists.put(playlist);
    const retrieved = await db.playlists.get('pl_test_1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Speed Warmup');
    expect(retrieved?.entries.length).toBe(2);
  });

  it('supports telemetry frames batch insertion and querying by sessionId', async () => {
    await db.telemetry.bulkAdd([
      { id: 't1', sessionId: 'sess_1', scenarioId: 'micro-adjust', timestamp: 100, crosshairX: 10, crosshairY: 20, action: 'spawn' },
      { id: 't2', sessionId: 'sess_1', scenarioId: 'micro-adjust', timestamp: 250, crosshairX: 15, crosshairY: 22, action: 'shot' },
      { id: 't3', sessionId: 'sess_1', scenarioId: 'micro-adjust', timestamp: 250, crosshairX: 15, crosshairY: 22, action: 'hit', targetId: 'tar_1' },
      { id: 't4', sessionId: 'sess_2', scenarioId: 'gridshot', timestamp: 300, crosshairX: 0, crosshairY: 0, action: 'miss' },
    ]);

    const sess1Frames = await db.telemetry.where('sessionId').equals('sess_1').toArray();
    expect(sess1Frames.length).toBe(3);
  });
});
