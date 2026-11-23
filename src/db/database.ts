// =====================================================================
// database.ts — Dexie IndexedDB Schema for WarmupLab
// =====================================================================

import Dexie, { type Table } from 'dexie';
import { DB_NAME } from '../constants';
import type { SessionResult, PersonalBest, RoutineSummary, Playlist, Settings, WarmupLabScenarioV1 } from '../types';

export interface PersonalBestEntity extends PersonalBest {
  /** Composite key: `${scenarioId}` or `${scenarioId}:${difficulty}` */
  id: string;
}

export interface RoutineSummaryEntity extends RoutineSummary {
  id: string;
}

export interface SettingsEntity {
  key: string;
  value: Settings;
  updatedAt: number;
}

export interface TelemetryFrameEntity {
  id: string;
  sessionId: string;
  scenarioId: string;
  timestamp: number;
  crosshairX: number;
  crosshairY: number;
  action: 'shot' | 'hit' | 'headshot' | 'miss' | 'spawn';
  targetId?: string;
  targetPosition?: [number, number, number];
}

export class WarmupLabDatabase extends Dexie {
  sessions!: Table<SessionResult, string>;
  personalBests!: Table<PersonalBestEntity, string>;
  routineCompletions!: Table<RoutineSummaryEntity, string>;
  playlists!: Table<Playlist, string>;
  settings!: Table<SettingsEntity, string>;
  telemetry!: Table<TelemetryFrameEntity, string>;
  customScenarios!: Table<WarmupLabScenarioV1, string>;

  constructor(dbName = DB_NAME) {
    super(dbName);
    this.version(1).stores({
      sessions: 'id, scenarioId, category, difficulty, timestamp, [scenarioId+difficulty], [scenarioId+timestamp]',
      personalBests: 'id, scenarioId, difficulty, score, timestamp',
      routineCompletions: 'id, routineId, timestamp, isPlaylist',
      playlists: 'id, name, updatedAt, isBuiltin',
      settings: 'key',
      telemetry: 'id, sessionId, scenarioId, timestamp',
    });

    this.version(2).stores({
      customScenarios: 'id, name, category, difficulty, metadata.createdAt, metadata.updatedAt',
    });
  }
}
