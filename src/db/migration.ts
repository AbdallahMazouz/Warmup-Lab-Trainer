// =====================================================================
// migration.ts — Safe, Non-Destructive LocalStorage to Dexie Migrator
// =====================================================================

import {
  LS_SESSIONS,
  LS_PERSONAL_BESTS,
  LS_ROUTINES,
  LS_PLAYLISTS,
  LS_SETTINGS,
  LS_MIGRATION_V3_STATUS,
  LS_MIGRATION_V3_ARCHIVED,
} from '../constants';
import type { WarmupLabDatabase, PersonalBestEntity, RoutineSummaryEntity, SettingsEntity } from './database';
import type { SessionResult, Playlist } from '../types';
import { validatePlaylist } from '../playlist';

export interface MigrationResult {
  migrated: boolean;
  sessionsCount: number;
  pbsCount: number;
  routinesCount: number;
  playlistsCount: number;
  settingsMigrated: boolean;
  errors: string[];
}

/**
 * Sanitizes a raw session item from legacy localStorage.
 */
export function sanitizeSession(item: any): SessionResult | null {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.scenarioId !== 'string' || item.scenarioId.trim() === '') return null;

  const hits = Math.max(0, Math.floor(Number.isFinite(item.hits) ? item.hits : 0));
  const misses = Math.max(0, Math.floor(Number.isFinite(item.misses) ? item.misses : 0));
  const headshots = Math.min(hits, Math.max(0, Math.floor(Number.isFinite(item.headshots) ? item.headshots : 0)));
  const bodyHits = typeof item.bodyHits === 'number' && Number.isFinite(item.bodyHits)
    ? item.bodyHits
    : Math.max(0, hits - headshots);
  const shotsFired = typeof item.shotsFired === 'number' && Number.isFinite(item.shotsFired)
    ? item.shotsFired
    : hits + misses;

  const score = Math.max(0, Math.floor(Number.isFinite(item.score) ? item.score : 0));
  const durationSec = Math.max(0, Number.isFinite(item.durationSec) ? item.durationSec : 0);
  const accuracy = typeof item.accuracy === 'number' && Number.isFinite(item.accuracy)
    ? Number(item.accuracy.toFixed(1))
    : (shotsFired > 0 ? Number(((hits / shotsFired) * 100).toFixed(1)) : 0);
  const headshotPct = typeof item.headshotPct === 'number' && Number.isFinite(item.headshotPct)
    ? Number(item.headshotPct.toFixed(1))
    : (hits > 0 ? Number(((headshots / hits) * 100).toFixed(1)) : 0);

  const targetsPerSecond = typeof item.targetsPerSecond === 'number' && Number.isFinite(item.targetsPerSecond)
    ? item.targetsPerSecond
    : (durationSec > 0 ? Number((hits / durationSec).toFixed(2)) : 0);
  const targetsPerMinute = typeof item.targetsPerMinute === 'number' && Number.isFinite(item.targetsPerMinute)
    ? item.targetsPerMinute
    : (durationSec > 0 ? Number(((hits / durationSec) * 60).toFixed(1)) : 0);

  const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
    ? item.timestamp
    : (typeof item.completedAt === 'string' && !isNaN(Date.parse(item.completedAt))
        ? Date.parse(item.completedAt)
        : Date.now());

  const id = typeof item.id === 'string' && item.id.trim()
    ? item.id.trim()
    : `session_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    scenarioId: item.scenarioId,
    scenarioName: typeof item.scenarioName === 'string' && item.scenarioName ? item.scenarioName : item.scenarioId,
    category: typeof item.category === 'string' ? item.category : 'flick',
    difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'intermediate',
    timestamp,
    durationSec,
    score,
    hits,
    misses,
    headshots,
    bodyHits,
    shotsFired,
    accuracy,
    headshotPct,
    avgReactionMs: typeof item.avgReactionMs === 'number' && Number.isFinite(item.avgReactionMs) ? Math.round(item.avgReactionMs) : 0,
    medianReactionMs: typeof item.medianReactionMs === 'number' && Number.isFinite(item.medianReactionMs) ? Math.round(item.medianReactionMs) : 0,
    bestReactionMs: typeof item.bestReactionMs === 'number' && Number.isFinite(item.bestReactionMs) ? Math.round(item.bestReactionMs) : 0,
    targetsPerSecond,
    targetsPerMinute,
    shotsMoving: typeof item.shotsMoving === 'number' && Number.isFinite(item.shotsMoving) ? item.shotsMoving : 0,
    shotsStationary: typeof item.shotsStationary === 'number' && Number.isFinite(item.shotsStationary) ? item.shotsStationary : 0,
    timeOnTarget: typeof item.timeOnTarget === 'number' && Number.isFinite(item.timeOnTarget) ? item.timeOnTarget : undefined,
    flashAvoidRate: typeof item.flashAvoidRate === 'number' && Number.isFinite(item.flashAvoidRate) ? item.flashAvoidRate : undefined,
    damageDealt: typeof item.damageDealt === 'number' && Number.isFinite(item.damageDealt) ? item.damageDealt : undefined,
    damageTaken: typeof item.damageTaken === 'number' && Number.isFinite(item.damageTaken) ? item.damageTaken : undefined,
    accuracyVsRetaliationPct: typeof item.accuracyVsRetaliationPct === 'number' && Number.isFinite(item.accuracyVsRetaliationPct) ? item.accuracyVsRetaliationPct : undefined,
    counterStrafeEfficiencyPct: typeof item.counterStrafeEfficiencyPct === 'number' && Number.isFinite(item.counterStrafeEfficiencyPct) ? item.counterStrafeEfficiencyPct : undefined,
    eliminations: typeof item.eliminations === 'number' && Number.isFinite(item.eliminations) ? item.eliminations : undefined,
    timesShotByBot: typeof item.timesShotByBot === 'number' && Number.isFinite(item.timesShotByBot) ? item.timesShotByBot : undefined,
    friendlyFireCount: typeof item.friendlyFireCount === 'number' && Number.isFinite(item.friendlyFireCount) ? item.friendlyFireCount : undefined,
    missedEnemiesCount: typeof item.missedEnemiesCount === 'number' && Number.isFinite(item.missedEnemiesCount) ? item.missedEnemiesCount : undefined,
    earlyShotsCount: typeof item.earlyShotsCount === 'number' && Number.isFinite(item.earlyShotsCount) ? item.earlyShotsCount : undefined,
    fakePeekShotsCount: typeof item.fakePeekShotsCount === 'number' && Number.isFinite(item.fakePeekShotsCount) ? item.fakePeekShotsCount : undefined,
    sprayAccuracy: typeof item.sprayAccuracy === 'number' && Number.isFinite(item.sprayAccuracy) ? item.sprayAccuracy : undefined,
    first10Accuracy: typeof item.first10Accuracy === 'number' && Number.isFinite(item.first10Accuracy) ? item.first10Accuracy : undefined,
    decisionAccuracy: typeof item.decisionAccuracy === 'number' && Number.isFinite(item.decisionAccuracy) ? item.decisionAccuracy : undefined,
    overkillShots: typeof item.overkillShots === 'number' && Number.isFinite(item.overkillShots) ? item.overkillShots : undefined,
    counterStrafeAccuracy: typeof item.counterStrafeAccuracy === 'number' && Number.isFinite(item.counterStrafeAccuracy) ? item.counterStrafeAccuracy : undefined,
    configVersion: typeof item.configVersion === 'number' && Number.isFinite(item.configVersion) && item.configVersion > 0 ? item.configVersion : undefined,
  };
}

/**
 * Sanitizes a raw routine summary item from legacy localStorage.
 */
export function sanitizeRoutineSummary(item: any): RoutineSummaryEntity | null {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.routineId !== 'string' || item.routineId.trim() === '') return null;

  const totalDurationSec = Math.max(0, Number.isFinite(item.totalDurationSec) ? item.totalDurationSec : 0);
  const activeDurationSec = typeof item.activeDurationSec === 'number' && Number.isFinite(item.activeDurationSec)
    ? Math.max(0, item.activeDurationSec)
    : totalDurationSec;
  const totalElapsedSec = typeof item.totalElapsedSec === 'number' && Number.isFinite(item.totalElapsedSec)
    ? Math.max(0, item.totalElapsedSec)
    : totalDurationSec;
  const transitionSec = typeof item.transitionSec === 'number' && Number.isFinite(item.transitionSec)
    ? Math.max(0, item.transitionSec)
    : 0;
  const pausedSec = typeof item.pausedSec === 'number' && Number.isFinite(item.pausedSec)
    ? Math.max(0, item.pausedSec)
    : 0;
  const retriesCount = typeof item.retriesCount === 'number' && Number.isFinite(item.retriesCount)
    ? Math.max(0, item.retriesCount)
    : 0;

  const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
    ? item.timestamp
    : (typeof item.completedAt === 'string' && !isNaN(Date.parse(item.completedAt))
        ? Date.parse(item.completedAt)
        : Date.now());

  const id = typeof item.id === 'string' && item.id.trim()
    ? item.id.trim()
    : `routine_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id,
    routineId: item.routineId,
    routineName: typeof item.routineName === 'string' ? item.routineName : item.routineId,
    difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'intermediate',
    timestamp,
    totalDurationSec,
    activeDurationSec,
    totalElapsedSec,
    transitionSec,
    pausedSec,
    retriesCount,
    drillsCompleted: Math.max(0, Number.isFinite(item.drillsCompleted) ? item.drillsCompleted : 0),
    totalDrills: Math.max(0, Number.isFinite(item.totalDrills) ? item.totalDrills : 0),
    totalScore: Math.max(0, Number.isFinite(item.totalScore) ? item.totalScore : 0),
    overallAccuracy: typeof item.overallAccuracy === 'number' && Number.isFinite(item.overallAccuracy)
      ? Number(item.overallAccuracy.toFixed(1))
      : 0,
    totalHits: Math.max(0, Number.isFinite(item.totalHits) ? item.totalHits : 0),
    totalHeadshots: Math.max(0, Number.isFinite(item.totalHeadshots) ? item.totalHeadshots : 0),
    totalShotsFired: Math.max(0, Number.isFinite(item.totalShotsFired) ? item.totalShotsFired : 0),
    avgReactionMs: typeof item.avgReactionMs === 'number' && Number.isFinite(item.avgReactionMs)
      ? Math.round(item.avgReactionMs)
      : undefined,
    isPlaylist: typeof item.isPlaylist === 'boolean' ? item.isPlaylist : undefined,
    completionRate: typeof item.completionRate === 'number' && Number.isFinite(item.completionRate)
      ? Math.round(item.completionRate)
      : undefined,
    skippedDrills: typeof item.skippedDrills === 'number' && Number.isFinite(item.skippedDrills)
      ? Math.max(0, item.skippedDrills)
      : undefined,
    drillResults: Array.isArray(item.drillResults) ? item.drillResults : undefined,
  };
}

/**
 * Checks if migration has already been executed.
 */
export function isMigrationCompleted(): boolean {
  try {
    return localStorage.getItem(LS_MIGRATION_V3_STATUS) === 'completed';
  } catch {
    return false;
  }
}

/**
 * Migrates localStorage data to Dexie IndexedDB.
 * Safe, idempotent, and non-destructive (localStorage keys are kept as archive).
 */
export async function migrateFromLocalStorage(db: WarmupLabDatabase): Promise<MigrationResult> {
  const errors: string[] = [];

  // 1. Check if already migrated
  if (isMigrationCompleted()) {
    return {
      migrated: false,
      sessionsCount: 0,
      pbsCount: 0,
      routinesCount: 0,
      playlistsCount: 0,
      settingsMigrated: false,
      errors: [],
    };
  }

  // 2. Read legacy records from localStorage
  let rawSessions: string | null = null;
  let rawPBs: string | null = null;
  let rawRoutines: string | null = null;
  let rawPlaylists: string | null = null;
  let rawSettings: string | null = null;

  try {
    rawSessions = localStorage.getItem(LS_SESSIONS);
    rawPBs = localStorage.getItem(LS_PERSONAL_BESTS);
    rawRoutines = localStorage.getItem(LS_ROUTINES);
    rawPlaylists = localStorage.getItem(LS_PLAYLISTS);
    rawSettings = localStorage.getItem(LS_SETTINGS);
  } catch (err: any) {
    errors.push(`Failed to read localStorage: ${err?.message || 'Access denied'}`);
    return {
      migrated: false,
      sessionsCount: 0,
      pbsCount: 0,
      routinesCount: 0,
      playlistsCount: 0,
      settingsMigrated: false,
      errors,
    };
  }

  // If no legacy data exists, mark migration completed and exit
  if (!rawSessions && !rawPBs && !rawRoutines && !rawPlaylists && !rawSettings) {
    try {
      localStorage.setItem(LS_MIGRATION_V3_STATUS, 'completed');
    } catch {}
    return {
      migrated: false,
      sessionsCount: 0,
      pbsCount: 0,
      routinesCount: 0,
      playlistsCount: 0,
      settingsMigrated: false,
      errors: [],
    };
  }

  // 3. Parse and sanitize sessions
  const sessionsToMigrate: SessionResult[] = [];
  if (rawSessions) {
    try {
      const parsed = JSON.parse(rawSessions);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const clean = sanitizeSession(item);
          if (clean) {
            sessionsToMigrate.push(clean);
          } else {
            errors.push('Skipped 1 malformed session entry');
          }
        }
      }
    } catch (e: any) {
      errors.push(`Error parsing sessions: ${e?.message}`);
    }
  }

  // 4. Parse and sanitize personal bests
  const pbsToMigrate: PersonalBestEntity[] = [];
  if (rawPBs) {
    try {
      const parsed = JSON.parse(rawPBs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, pb] of Object.entries(parsed)) {
          if (pb && typeof pb === 'object' && typeof (pb as any).scenarioId === 'string') {
            const p = pb as any;
            pbsToMigrate.push({
              id: key,
              scenarioId: p.scenarioId,
              difficulty: typeof p.difficulty === 'string' ? p.difficulty : undefined,
              score: typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : 0,
              accuracy: typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) ? p.accuracy : 0,
              avgReactionMs: typeof p.avgReactionMs === 'number' && Number.isFinite(p.avgReactionMs) ? p.avgReactionMs : 0,
              timestamp: typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) ? p.timestamp : Date.now(),
              configVersion: typeof p.configVersion === 'number' && Number.isFinite(p.configVersion) ? p.configVersion : undefined,
            });
          }
        }
      }
    } catch (e: any) {
      errors.push(`Error parsing personal bests: ${e?.message}`);
    }
  }

  // 5. Parse and sanitize routines
  const routinesToMigrate: RoutineSummaryEntity[] = [];
  if (rawRoutines) {
    try {
      const parsed = JSON.parse(rawRoutines);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const clean = sanitizeRoutineSummary(item);
          if (clean) {
            routinesToMigrate.push(clean);
          } else {
            errors.push('Skipped 1 malformed routine summary');
          }
        }
      }
    } catch (e: any) {
      errors.push(`Error parsing routines: ${e?.message}`);
    }
  }

  // 6. Parse and sanitize playlists
  const playlistsToMigrate: Playlist[] = [];
  if (rawPlaylists) {
    try {
      const parsed = JSON.parse(rawPlaylists);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const val = validatePlaylist(item);
          if (val.valid) {
            playlistsToMigrate.push(item as Playlist);
          } else {
            errors.push(`Skipped invalid playlist (${item?.name || 'unknown'}): ${val.errors.join(', ')}`);
          }
        }
      }
    } catch (e: any) {
      errors.push(`Error parsing playlists: ${e?.message}`);
    }
  }

  // 7. Parse settings
  let settingsEntity: SettingsEntity | null = null;
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings);
      if (parsed && typeof parsed === 'object') {
        settingsEntity = {
          key: 'general',
          value: parsed,
          updatedAt: Date.now(),
        };
      }
    } catch (e: any) {
      errors.push(`Error parsing settings: ${e?.message}`);
    }
  }

  // 8. Atomic transactional bulk write to Dexie
  try {
    await db.transaction('rw', [db.sessions, db.personalBests, db.routineCompletions, db.playlists, db.settings], async () => {
      if (sessionsToMigrate.length > 0) {
        await db.sessions.bulkPut(sessionsToMigrate);
      }
      if (pbsToMigrate.length > 0) {
        await db.personalBests.bulkPut(pbsToMigrate);
      }
      if (routinesToMigrate.length > 0) {
        await db.routineCompletions.bulkPut(routinesToMigrate);
      }
      if (playlistsToMigrate.length > 0) {
        await db.playlists.bulkPut(playlistsToMigrate);
      }
      if (settingsEntity) {
        await db.settings.put(settingsEntity);
      }
    });

    // 9. Mark migration completed (non-destructive: keep original localStorage keys intact)
    try {
      localStorage.setItem(LS_MIGRATION_V3_STATUS, 'completed');
      localStorage.setItem(LS_MIGRATION_V3_ARCHIVED, new Date().toISOString());
    } catch {}

    return {
      migrated: true,
      sessionsCount: sessionsToMigrate.length,
      pbsCount: pbsToMigrate.length,
      routinesCount: routinesToMigrate.length,
      playlistsCount: playlistsToMigrate.length,
      settingsMigrated: settingsEntity !== null,
      errors,
    };
  } catch (err: any) {
    errors.push(`Migration transaction failed: ${err?.message || 'Unknown database error'}`);
    return {
      migrated: false,
      sessionsCount: 0,
      pbsCount: 0,
      routinesCount: 0,
      playlistsCount: 0,
      settingsMigrated: false,
      errors,
    };
  }
}
