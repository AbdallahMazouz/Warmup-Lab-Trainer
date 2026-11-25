// =====================================================================
// store.ts — Session history, personal bests & Dexie write-through cache
// =====================================================================

import {
  LS_SESSIONS,
  LS_PERSONAL_BESTS,
  LS_ROUTINES,
  LS_PLAYLISTS,
  LS_CUSTOM_SCENARIOS,
} from './constants';
import type {
  SessionResult,
  PersonalBest,
  RoutineSummary,
  DifficultyId,
  ScenarioTrendResult,
  BestScenarioMetric,
  AggregateStats,
  HistoryExportEnvelope,
  ImportHistoryResult,
  FilterSessionsOptions,
  FilteredSessionsResult,
  Playlist,
  ScenarioConfig,
  WarmupLabScenarioV1,
  WarmupLabBackupV4,
  BackupImportResult,
} from './types';
import { getScenarioById, SCENARIOS, TRAINING_ROUTINES, registerCustomScenarioResolver } from './scenarios';
import { validatePlaylist, duplicatePlaylist as clonePlaylist, convertRoutineToPlaylist } from './playlist';
import { validateCustomScenarioJSON, convertCustomScenarioToConfig } from './scenarioConfig';
import { WarmupLabDatabase } from './db/database';
import {
  migrateFromLocalStorage,
  sanitizeSession,
  sanitizeRoutineSummary,
} from './db/migration';

const MAX_SESSIONS = 100;
const MAX_ROUTINES = 20;

export class Store {
  private db: WarmupLabDatabase;
  private sessions: SessionResult[] = [];
  private pbs: Record<string, PersonalBest> = {};
  private routineSummaries: RoutineSummary[] = [];
  private playlists: Playlist[] = [];
  private customScenarios: WarmupLabScenarioV1[] = [];
  private isInitialized = false;
  private isFallbackMode = false;

  constructor(dbInstance?: WarmupLabDatabase) {
    this.db = dbInstance || new WarmupLabDatabase();
    // Register custom scenario resolver with global scenario lookup
    registerCustomScenarioResolver((id: string) => this.getCustomScenarioConfig(id));
    // Synchronously seed in-memory cache from localStorage so immediate calls before async init() work
    this.sessions = this.loadSessions();
    this.pbs = this.loadPBs();
    this.routineSummaries = this.loadRoutineSummaries();
    this.playlists = this.loadPlaylists();
    this.customScenarios = this.loadCustomScenarios();
  }

  /**
   * Asynchronously hydrates the in-memory cache from Dexie IndexedDB
   * and runs safe migration if legacy localStorage records exist.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.db.open();
      // Run safe, non-destructive migration if needed
      await migrateFromLocalStorage(this.db);

      // Hydrate in-memory cache from Dexie
      const dbSessions = await this.db.sessions.orderBy('timestamp').reverse().toArray();
      if (dbSessions.length > 0) {
        this.sessions = dbSessions;
      }

      const dbPBs = await this.db.personalBests.toArray();
      if (dbPBs.length > 0) {
        for (const pb of dbPBs) {
          this.pbs[pb.id] = {
            scenarioId: pb.scenarioId,
            difficulty: pb.difficulty,
            score: pb.score,
            accuracy: pb.accuracy,
            avgReactionMs: pb.avgReactionMs,
            timestamp: pb.timestamp,
            configVersion: pb.configVersion,
          };
        }
      }

      const dbRoutines = await this.db.routineCompletions.orderBy('timestamp').reverse().toArray();
      if (dbRoutines.length > 0) {
        this.routineSummaries = dbRoutines;
      }

      const dbPlaylists = await this.db.playlists.toArray();
      if (dbPlaylists.length > 0) {
        this.playlists = dbPlaylists;
      }

      const dbCustom = await this.db.customScenarios.toArray();
      if (dbCustom.length > 0) {
        this.customScenarios = dbCustom;
        this.saveCustomScenarios();
      } else if (this.customScenarios.length > 0) {
        await this.db.customScenarios.bulkPut(this.customScenarios).catch(() => {});
      }

      this.isInitialized = true;
    } catch (err) {
      console.warn('[Store] Dexie initialization failed, falling back to localStorage cache:', err);
      this.isFallbackMode = true;
      this.isInitialized = true;
    }
  }

  isReady(): boolean {
    return this.isInitialized;
  }

  isFallback(): boolean {
    return this.isFallbackMode;
  }

  getDatabase(): WarmupLabDatabase {
    return this.db;
  }

  // ── Sessions ──────────────────────────────────────────────────────
  addSession(result: SessionResult): { isPB: boolean } {
    if (!result || !result.scenarioId) {
      return { isPB: false };
    }

    // Prevent duplicate saves of the same session ID
    if (this.sessions.some(s => s.id === result.id)) {
      return { isPB: false };
    }

    const sanitized = sanitizeSession(result);
    if (!sanitized) {
      return { isPB: false };
    }

    this.sessions.unshift(sanitized);
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    }

    // Save localStorage mirror (capped to prevent quota errors)
    this.saveSessions();

    const isPB = this.updatePB(sanitized);

    // Background write-through to Dexie
    if (!this.isFallbackMode) {
      this.db.sessions.put(sanitized).catch(err => {
        console.error('[Store] Failed to write session to Dexie:', err);
      });

      if (isPB) {
        const overallPB = this.pbs[sanitized.scenarioId];
        if (overallPB) {
          this.db.personalBests.put({
            id: sanitized.scenarioId,
            ...overallPB,
          }).catch(err => console.error('[Store] Failed to write overall PB to Dexie:', err));
        }

        if (sanitized.difficulty) {
          const diffKey = `${sanitized.scenarioId}:${sanitized.difficulty}`;
          const diffPB = this.pbs[diffKey];
          if (diffPB) {
            this.db.personalBests.put({
              id: diffKey,
              ...diffPB,
            }).catch(err => console.error('[Store] Failed to write diff PB to Dexie:', err));
          }
        }
      }
    }

    return { isPB };
  }

  getSessions(scenarioId?: string, limit = 20): SessionResult[] {
    let s = this.sessions;
    if (scenarioId) s = s.filter(x => x.scenarioId === scenarioId);
    return s.slice(0, limit);
  }

  getRecentSessions(limit = 10): SessionResult[] {
    return this.sessions.slice(0, limit);
  }

  // ── Universal Backup & Restore (Phase 3 & Phase 4) ────────────────
  exportBackupJSON(): string {
    const backup: WarmupLabBackupV4 = {
      format: 'warmuplab-backup',
      version: 4,
      exportedAt: new Date().toISOString(),
      clientVersion: '1.2.0',
      data: {
        sessions: [...this.sessions],
        personalBests: Object.values(this.pbs),
        routineSummaries: [...this.routineSummaries],
        playlists: [...this.playlists],
        customScenarios: [...this.customScenarios],
      },
    };
    return JSON.stringify(backup, null, 2);
  }

  async importBackupJSON(jsonStr: string): Promise<BackupImportResult> {
    const errors: string[] = [];

    if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
      return {
        success: false,
        sessionsImported: 0,
        pbsImported: 0,
        routinesImported: 0,
        playlistsImported: 0,
        customScenariosImported: 0,
        settingsImported: false,
        errors: ['Empty or invalid JSON string provided.'],
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err: any) {
      return {
        success: false,
        sessionsImported: 0,
        pbsImported: 0,
        routinesImported: 0,
        playlistsImported: 0,
        customScenariosImported: 0,
        settingsImported: false,
        errors: [`JSON parse error: ${err?.message}`],
      };
    }

    let rawSessions: any[] = [];
    let rawRoutines: any[] = [];
    let rawPlaylists: any[] = [];
    let rawCustomScenarios: any[] = [];

    if (parsed && typeof parsed === 'object') {
      if (parsed.format === 'warmuplab-backup' && parsed.data) {
        rawSessions = Array.isArray(parsed.data.sessions) ? parsed.data.sessions : [];
        rawRoutines = Array.isArray(parsed.data.routineSummaries) ? parsed.data.routineSummaries : [];
        rawPlaylists = Array.isArray(parsed.data.playlists) ? parsed.data.playlists : [];
        rawCustomScenarios = Array.isArray(parsed.data.customScenarios) ? parsed.data.customScenarios : [];
      } else if (Array.isArray(parsed.sessions)) {
        rawSessions = parsed.sessions;
      } else if (Array.isArray(parsed)) {
        rawSessions = parsed;
      }
    }

    const validSessions: SessionResult[] = [];
    for (const s of rawSessions) {
      const clean = sanitizeSession(s);
      if (clean && !this.sessions.some(existing => existing.id === clean.id)) {
        validSessions.push(clean);
        this.sessions.unshift(clean);
        this.updatePB(clean);
      }
    }

    const validPlaylists: Playlist[] = [];
    for (const p of rawPlaylists) {
      const val = validatePlaylist(p);
      if (val.valid) {
        const cleanP = p as Playlist;
        validPlaylists.push(cleanP);
        const idx = this.playlists.findIndex(existing => existing.id === cleanP.id);
        if (idx !== -1) {
          this.playlists[idx] = cleanP;
        } else {
          this.playlists.push(cleanP);
        }
      }
    }

    const validRoutines: RoutineSummary[] = [];
    for (const r of rawRoutines) {
      const cleanR = sanitizeRoutineSummary(r);
      if (cleanR && !this.routineSummaries.some(existing => existing.id === cleanR.id)) {
        validRoutines.push(cleanR);
        this.routineSummaries.unshift(cleanR);
      }
    }

    const validCustomScenarios: WarmupLabScenarioV1[] = [];
    for (const sc of rawCustomScenarios) {
      const val = validateCustomScenarioJSON(sc);
      if (val.valid) {
        const cleanSc = sc as WarmupLabScenarioV1;
        validCustomScenarios.push(cleanSc);
        const idx = this.customScenarios.findIndex(existing => existing.id === cleanSc.id);
        if (idx !== -1) {
          this.customScenarios[idx] = cleanSc;
        } else {
          this.customScenarios.push(cleanSc);
        }
      }
    }

    // Persist to Dexie
    if (!this.isFallbackMode) {
      try {
        await this.db.transaction('rw', [
          this.db.sessions,
          this.db.personalBests,
          this.db.routineCompletions,
          this.db.playlists,
          this.db.customScenarios,
        ], async () => {
          if (validSessions.length > 0) await this.db.sessions.bulkPut(validSessions);
          if (validRoutines.length > 0) await this.db.routineCompletions.bulkPut(validRoutines);
          if (validPlaylists.length > 0) await this.db.playlists.bulkPut(validPlaylists);
          if (validCustomScenarios.length > 0) await this.db.customScenarios.bulkPut(validCustomScenarios);
          const pbEntities = Object.entries(this.pbs).map(([id, pb]) => ({ id, ...pb }));
          if (pbEntities.length > 0) await this.db.personalBests.bulkPut(pbEntities);
        });
      } catch (e: any) {
        errors.push(`Database transaction warning: ${e?.message}`);
      }
    }

    this.saveSessions();
    this.savePBs();
    this.saveRoutineSummaries();
    this.savePlaylists();
    this.saveCustomScenarios();

    return {
      success: true,
      sessionsImported: validSessions.length,
      pbsImported: Object.keys(this.pbs).length,
      routinesImported: validRoutines.length,
      playlistsImported: validPlaylists.length,
      customScenariosImported: validCustomScenarios.length,
      settingsImported: false,
      errors,
    };
  }

  // ── History Management & Legacy Diagnostics ────────────────────────
  exportSessionsJSON(): string {
    const envelope: HistoryExportEnvelope = {
      version: 'vwt-history-v1',
      exportedAt: Date.now(),
      totalSessions: this.sessions.length,
      sessions: [...this.sessions],
    };
    return JSON.stringify(envelope, null, 2);
  }

  importSessionsJSON(jsonStr: string): ImportHistoryResult {
    const totalBefore = this.sessions.length;

    if (typeof jsonStr !== 'string' || !jsonStr.trim()) {
      return {
        success: false,
        importedCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        totalBefore,
        totalAfter: totalBefore,
        error: 'Empty or invalid JSON string provided.',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err: any) {
      return {
        success: false,
        importedCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        totalBefore,
        totalAfter: totalBefore,
        error: `JSON parse error: ${err?.message || 'Invalid syntax'}`,
      };
    }

    let rawRecords: any[] = [];
    if (Array.isArray(parsed)) {
      rawRecords = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const envelope = parsed as Record<string, any>;
      if (Array.isArray(envelope.sessions)) {
        rawRecords = envelope.sessions;
      } else {
        return {
          success: false,
          importedCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
          totalBefore,
          totalAfter: totalBefore,
          error: 'Unsupported JSON structure: object missing "sessions" array.',
        };
      }
    } else {
      return {
        success: false,
        importedCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        totalBefore,
        totalAfter: totalBefore,
        error: 'Invalid JSON payload type. Expected an array or export envelope object.',
      };
    }

    let importedCount = 0;
    let duplicateCount = 0;
    let invalidCount = 0;

    const workingSessions = [...this.sessions];
    const newlyAddedSessions: SessionResult[] = [];

    for (const item of rawRecords) {
      const sanitized = sanitizeSession(item);
      if (!sanitized) {
        invalidCount++;
        continue;
      }

      const rawId = item && typeof (item as any).id === 'string' && (item as any).id.trim()
        ? (item as any).id.trim()
        : null;

      const isDuplicate = workingSessions.some((existing) => {
        if (rawId) {
          return existing.id === rawId;
        }
        return existing.timestamp === sanitized.timestamp && existing.scenarioId === sanitized.scenarioId;
      });

      if (isDuplicate) {
        duplicateCount++;
        continue;
      }

      workingSessions.push(sanitized);
      newlyAddedSessions.push(sanitized);
      importedCount++;
    }

    if (importedCount === 0 && duplicateCount === 0) {
      return {
        success: false,
        importedCount: 0,
        duplicateCount,
        invalidCount,
        totalBefore,
        totalAfter: totalBefore,
        error: 'No valid session records found in import payload.',
      };
    }

    if (importedCount === 0) {
      return {
        success: true,
        importedCount: 0,
        retainedCount: 0,
        excludedByCapCount: 0,
        duplicateCount,
        invalidCount,
        totalBefore,
        totalAfter: totalBefore,
      };
    }

    // Sort newest first
    workingSessions.sort((a, b) => b.timestamp - a.timestamp);
    const clampedSessions = workingSessions.slice(0, MAX_SESSIONS);

    // Differentiate newly added records that fit within MAX_SESSIONS from those excluded by cap
    const clampedSet = new Set(clampedSessions.map(s => s.id));
    const retainedCount = newlyAddedSessions.filter(s => clampedSet.has(s.id)).length;
    const excludedByCapCount = newlyAddedSessions.length - retainedCount;

    try {
      localStorage.setItem(LS_SESSIONS, JSON.stringify(clampedSessions));
    } catch (err: any) {
      return {
        success: false,
        importedCount: 0,
        retainedCount: 0,
        excludedByCapCount: 0,
        duplicateCount,
        invalidCount,
        totalBefore,
        totalAfter: totalBefore,
        error: `Storage failure: ${err?.message || 'Could not write to localStorage'}`,
      };
    }

    this.sessions = clampedSessions;

    for (const s of newlyAddedSessions) {
      this.updatePB(s);
    }

    // Write-through to Dexie
    if (!this.isFallbackMode && newlyAddedSessions.length > 0) {
      this.db.sessions.bulkPut(newlyAddedSessions).catch(err => {
        console.error('[Store] Failed to write imported sessions to Dexie:', err);
      });
    }

    return {
      success: true,
      importedCount,
      retainedCount,
      excludedByCapCount,
      duplicateCount,
      invalidCount,
      totalBefore,
      totalAfter: this.sessions.length,
    };
  }

  clearSessions(): void {
    this.sessions = [];
    try {
      localStorage.removeItem(LS_SESSIONS);
    } catch {}
    if (!this.isFallbackMode) {
      this.db.sessions.clear().catch(err => {
        console.error('[Store] Failed to clear sessions in Dexie:', err);
      });
    }
  }

  getFilteredSessions(options: FilterSessionsOptions = {}): FilteredSessionsResult {
    const {
      category = 'all',
      difficulty = 'all',
      scenarioId = 'all',
      sortBy = 'date_desc',
      page = 1,
      pageSize = 10,
    } = options;

    let filtered = [...this.sessions];

    if (category && category !== 'all') {
      filtered = filtered.filter((s) => s.category === category);
    }

    if (difficulty && difficulty !== 'all') {
      filtered = filtered.filter((s) => s.difficulty === difficulty);
    }

    if (scenarioId && scenarioId !== 'all') {
      filtered = filtered.filter((s) => s.scenarioId === scenarioId);
    }

    switch (sortBy) {
      case 'date_asc':
        filtered.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'score_desc':
        filtered.sort((a, b) => b.score - a.score);
        break;
      case 'score_asc':
        filtered.sort((a, b) => a.score - b.score);
        break;
      case 'accuracy_desc':
        filtered.sort((a, b) => b.accuracy - a.accuracy);
        break;
      case 'date_desc':
      default:
        filtered.sort((a, b) => b.timestamp - a.timestamp);
        break;
    }

    const totalRecords = filtered.length;
    const safePageSize = Math.max(1, pageSize);
    const totalPages = Math.max(1, Math.ceil(totalRecords / safePageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (safePage - 1) * safePageSize;
    const paginatedSessions = filtered.slice(startIndex, startIndex + safePageSize);

    return {
      sessions: paginatedSessions,
      totalRecords,
      totalPages,
      currentPage: safePage,
      pageSize: safePageSize,
    };
  }

  // ── Routines ──────────────────────────────────────────────────────
  addRoutineSummary(summary: RoutineSummary): void {
    if (!summary || !summary.routineId) return;

    const sanitized = sanitizeRoutineSummary(summary);
    if (!sanitized) return;

    this.routineSummaries.unshift(sanitized);
    if (this.routineSummaries.length > MAX_ROUTINES) {
      this.routineSummaries = this.routineSummaries.slice(0, MAX_ROUTINES);
    }
    this.saveRoutineSummaries();

    if (!this.isFallbackMode) {
      this.db.routineCompletions.put(sanitized).catch(err => {
        console.error('[Store] Failed to write routine summary to Dexie:', err);
      });
    }
  }

  getRoutineSummaries(limit = 20): RoutineSummary[] {
    return this.routineSummaries.slice(0, limit);
  }

  // ── Custom Playlists ──────────────────────────────────────────────
  getPlaylists(): Playlist[] {
    return [...this.playlists];
  }

  getPlaylistById(id: string): Playlist | undefined {
    if (!id) return undefined;
    const found = this.playlists.find(p => p.id === id);
    if (found) return found;

    // Check if it's a built-in routine ID
    const preset = TRAINING_ROUTINES.find(r => r.id === id);
    if (preset) {
      return convertRoutineToPlaylist(preset);
    }
    return undefined;
  }

  savePlaylist(playlist: Playlist): { success: boolean; errors?: string[] } {
    const val = validatePlaylist(playlist);
    if (!val.valid) {
      return { success: false, errors: val.errors };
    }

    const clean: Playlist = {
      ...playlist,
      name: playlist.name.trim(),
      description: playlist.description?.trim() ?? '',
      defaultRestIntervalSec: typeof playlist.defaultRestIntervalSec === 'number' && Number.isFinite(playlist.defaultRestIntervalSec)
        ? Math.max(0, Math.min(120, playlist.defaultRestIntervalSec))
        : 4,
      entries: playlist.entries.map((e, idx) => ({
        id: e.id || `entry_${Date.now()}_${idx}`,
        scenarioId: e.scenarioId,
        durationSec: Number.isFinite(e.durationSec) ? Math.max(5, Math.min(600, e.durationSec)) : 60,
        restIntervalSec: typeof e.restIntervalSec === 'number' && Number.isFinite(e.restIntervalSec)
          ? Math.max(0, Math.min(120, e.restIntervalSec))
          : undefined,
        configOverrides: e.configOverrides ? { ...e.configOverrides } : undefined,
      })),
      isBuiltin: false,
      updatedAt: Date.now(),
      createdAt: playlist.createdAt || Date.now(),
    };

    const existingIdx = this.playlists.findIndex(p => p.id === clean.id);
    if (existingIdx !== -1) {
      this.playlists[existingIdx] = clean;
    } else {
      this.playlists.unshift(clean);
    }

    this.savePlaylists();

    if (!this.isFallbackMode) {
      this.db.playlists.put(clean).catch(err => {
        console.error('[Store] Failed to write playlist to Dexie:', err);
      });
    }

    return { success: true };
  }

  createPlaylist(name: string, description = '', entries: any[] = []): { success: boolean; playlist?: Playlist; errors?: string[] } {
    const newPlaylist: Playlist = {
      id: `pl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: (name || 'New Custom Playlist').trim(),
      description: description.trim(),
      defaultRestIntervalSec: 4,
      entries: entries.map((e, idx) => ({
        id: e.id || `entry_${Date.now()}_${idx}`,
        scenarioId: e.scenarioId,
        durationSec: Number.isFinite(e.durationSec) ? e.durationSec : 60,
        restIntervalSec: e.restIntervalSec,
        configOverrides: e.configOverrides,
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isBuiltin: false,
    };

    const result = this.savePlaylist(newPlaylist);
    if (!result.success) {
      return { success: false, errors: result.errors };
    }
    return { success: true, playlist: newPlaylist };
  }

  deletePlaylist(id: string): boolean {
    if (!id) return false;

    const idx = this.playlists.findIndex(p => p.id === id);
    if (idx === -1) return false;

    const target = this.playlists[idx];
    if (target.isBuiltin) return false;

    this.playlists.splice(idx, 1);
    this.savePlaylists();

    if (!this.isFallbackMode) {
      this.db.playlists.delete(id).catch(err => {
        console.error('[Store] Failed to delete playlist in Dexie:', err);
      });
    }

    return true;
  }

  duplicatePlaylist(id: string, newName?: string): Playlist | null {
    const original = this.getPlaylistById(id);
    if (!original) return null;

    const cloned = clonePlaylist(original);
    if (newName) {
      cloned.name = newName;
    }
    const saveRes = this.savePlaylist(cloned);
    if (!saveRes.success) return null;

    return cloned;
  }

  // ── Custom Scenarios (Phase 4) ────────────────────────────────────
  getCustomScenarios(): WarmupLabScenarioV1[] {
    return [...this.customScenarios];
  }

  getCustomScenario(id: string): WarmupLabScenarioV1 | undefined {
    if (!id) return undefined;
    return this.customScenarios.find(s => s.id === id);
  }

  getCustomScenarioConfig(id: string): ScenarioConfig | undefined {
    const custom = this.getCustomScenario(id);
    if (!custom) return undefined;
    return convertCustomScenarioToConfig(custom);
  }

  saveCustomScenario(
    scenario: WarmupLabScenarioV1,
    options: { resetPB?: boolean; incrementVersion?: boolean } = {}
  ): { success: boolean; errors?: string[] } {
    const val = validateCustomScenarioJSON(scenario);
    if (!val.valid) {
      return { success: false, errors: val.errors };
    }

    const currentVersion = scenario.metadata?.configVersion || 1;
    const finalVersion = options.incrementVersion ? currentVersion + 1 : currentVersion;

    const clean: WarmupLabScenarioV1 = {
      ...scenario,
      id: scenario.id.trim(),
      name: scenario.name.trim(),
      description: scenario.description ? scenario.description.trim() : '',
      tags: scenario.tags ? scenario.tags.map(t => t.trim()).filter(Boolean) : [],
      metadata: {
        ...scenario.metadata,
        updatedAt: Date.now(),
        configVersion: finalVersion,
        isCustom: true,
      },
    };

    const idx = this.customScenarios.findIndex(s => s.id === clean.id);
    if (idx !== -1) {
      this.customScenarios[idx] = clean;
    } else {
      this.customScenarios.unshift(clean);
    }

    if (!this.isFallbackMode) {
      this.db.customScenarios.put(clean).catch(err => {
        console.error('[Store] Failed to write custom scenario to Dexie:', err);
      });
    }

    this.saveCustomScenarios();

    if (options.resetPB) {
      this.resetPB(clean.id);
    }

    return { success: true };
  }

  saveAsNewCustomScenario(
    scenario: WarmupLabScenarioV1,
    newName?: string
  ): { success: boolean; scenario?: WarmupLabScenarioV1; errors?: string[] } {
    const timestamp = Date.now();
    const newId = `custom_${timestamp}_${Math.random().toString(36).substring(2, 7)}`;
    const cloned: WarmupLabScenarioV1 = {
      ...JSON.parse(JSON.stringify(scenario)),
      id: newId,
      name: newName ? newName.trim() : (scenario.name ? (scenario.name.includes('(Copy)') ? scenario.name : `${scenario.name} (Copy)`) : 'New Custom Drill'),
      metadata: {
        createdAt: timestamp,
        updatedAt: timestamp,
        configVersion: 1,
        isCustom: true,
      },
    };

    const res = this.saveCustomScenario(cloned);
    if (!res.success) {
      return { success: false, errors: res.errors };
    }
    return { success: true, scenario: cloned };
  }

  resetPB(scenarioId: string): void {
    if (!scenarioId) return;

    delete this.pbs[scenarioId];
    for (const key of Object.keys(this.pbs)) {
      if (key.startsWith(`${scenarioId}:`)) {
        delete this.pbs[key];
      }
    }

    this.savePBs();

    if (!this.isFallbackMode) {
      this.db.personalBests.where('scenarioId').equals(scenarioId).delete().catch(() => {
        this.db.personalBests.delete(scenarioId).catch(() => {});
      });
    }
  }

  deleteCustomScenario(id: string): boolean {
    if (!id) return false;
    const idx = this.customScenarios.findIndex(s => s.id === id);
    if (idx === -1) return false;

    this.customScenarios.splice(idx, 1);

    if (!this.isFallbackMode) {
      this.db.customScenarios.delete(id).catch(err => {
        console.error('[Store] Failed to delete custom scenario in Dexie:', err);
      });
    }

    this.saveCustomScenarios();

    return true;
  }

  duplicateCustomScenario(id: string, newName?: string): WarmupLabScenarioV1 | null {
    const original = this.getCustomScenario(id);
    if (!original) return null;

    const timestamp = Date.now();
    const cloned: WarmupLabScenarioV1 = {
      ...JSON.parse(JSON.stringify(original)),
      id: `custom_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
      name: newName ? newName.trim() : `${original.name} (Copy)`,
      metadata: {
        createdAt: timestamp,
        updatedAt: timestamp,
        configVersion: 1,
        isCustom: true,
      },
    };

    const res = this.saveCustomScenario(cloned);
    if (!res.success) return null;
    return cloned;
  }

  getScenario(id: string): ScenarioConfig | undefined {
    return getScenarioById(id);
  }

  getAllScenarios(): ScenarioConfig[] {
    const customConfigs = this.customScenarios.map(convertCustomScenarioToConfig);
    return [...customConfigs, ...SCENARIOS];
  }

  // ── Personal bests ─────────────────────────────────────────────────
  getPB(scenarioId: string, difficulty?: DifficultyId): PersonalBest | null {
    if (!scenarioId) return null;
    if (difficulty) {
      const diffKey = `${scenarioId}:${difficulty}`;
      return this.pbs[diffKey] ?? null;
    }
    return this.pbs[scenarioId] ?? null;
  }

  getAllPBs(): Record<string, PersonalBest> {
    return { ...this.pbs };
  }

  // ── Aggregate stats ─────────────────────────────────────────────────
  totalTimePlayed(): number {
    return this.sessions.reduce((s, r) => s + (Number.isFinite(r.durationSec) ? r.durationSec : 0), 0);
  }

  overallAccuracy(): number {
    const shootingSessions = this.sessions.filter(s => s.category !== 'tracking');
    const total = shootingSessions.reduce((s, r) => s + (r.shotsFired ?? ((r.hits || 0) + (r.misses || 0))), 0);
    const hits  = shootingSessions.reduce((s, r) => s + (r.hits || 0), 0);
    return total > 0 ? Number(((hits / total) * 100).toFixed(1)) : 0;
  }

  overallHeadshotPercentage(): number {
    const shootingSessions = this.sessions.filter(s => s.category !== 'tracking');
    const totalHits = shootingSessions.reduce((s, r) => s + (r.hits || 0), 0);
    const totalHeadshots = shootingSessions.reduce((s, r) => s + (r.headshots || 0), 0);
    return totalHits > 0 ? Number(((totalHeadshots / totalHits) * 100).toFixed(1)) : 0;
  }

  totalSessions(): number { return this.sessions.length; }
  totalRoutines(): number { return this.routineSummaries.length; }

  getAggregateStats(): AggregateStats {
    const shootingSessions = this.sessions.filter(s => s.category !== 'tracking');
    const trackingSessions = this.sessions.filter(s => s.category === 'tracking');

    const totalHits = this.sessions.reduce((s, r) => s + (r.hits || 0), 0);
    const totalShots = this.sessions.reduce((s, r) => s + (r.shotsFired ?? ((r.hits || 0) + (r.misses || 0))), 0);
    const totalHeadshots = this.sessions.reduce((s, r) => s + (r.headshots || 0), 0);

    const shootingHits = shootingSessions.reduce((s, r) => s + (r.hits || 0), 0);
    const shootingShots = shootingSessions.reduce((s, r) => s + (r.shotsFired ?? ((r.hits || 0) + (r.misses || 0))), 0);
    const shootingHeadshots = shootingSessions.reduce((s, r) => s + (r.headshots || 0), 0);

    const overallAccuracy = shootingShots > 0
      ? Number(((shootingHits / shootingShots) * 100).toFixed(1))
      : 0;

    const overallHeadshotPct = shootingHits > 0
      ? Number(((shootingHeadshots / shootingHits) * 100).toFixed(1))
      : 0;

    return {
      totalDrills: this.sessions.length,
      totalRoutines: this.routineSummaries.length,
      totalTimePlayedSec: this.totalTimePlayed(),
      overallAccuracy,
      overallHeadshotPct,
      totalHits,
      totalShots,
      totalHeadshots,
      shootingDrillsCount: shootingSessions.length,
      trackingDrillsCount: trackingSessions.length,
    };
  }

  getRecentStats(count = 10): {
    count: number;
    accuracy: number;
    headshotPct: number;
    avgScore: number;
    totalHits: number;
    totalShots: number;
  } {
    const recent = this.sessions.slice(0, count);
    if (recent.length === 0) {
      return { count: 0, accuracy: 0, headshotPct: 0, avgScore: 0, totalHits: 0, totalShots: 0 };
    }
    const shootingRecent = recent.filter(r => r.category !== 'tracking');
    const totalShots = shootingRecent.reduce((acc, r) => acc + (r.shotsFired ?? ((r.hits || 0) + (r.misses || 0))), 0);
    const totalHits = shootingRecent.reduce((acc, r) => acc + (r.hits || 0), 0);
    const totalHeadshots = shootingRecent.reduce((acc, r) => acc + (r.headshots || 0), 0);
    const totalScore = recent.reduce((acc, r) => acc + (r.score || 0), 0);

    return {
      count: recent.length,
      accuracy: totalShots > 0 ? Number(((totalHits / totalShots) * 100).toFixed(1)) : 0,
      headshotPct: totalHits > 0 ? Number(((totalHeadshots / totalHits) * 100).toFixed(1)) : 0,
      avgScore: Math.round(totalScore / recent.length),
      totalHits,
      totalShots,
    };
  }

  getBestPerformingScenarios(limit = 5): BestScenarioMetric[] {
    const grouped = new Map<string, {
      scenarioName: string;
      category: any;
      bestScore: number;
      bestAccuracy: number;
      totalScore: number;
      playCount: number;
    }>();

    for (const s of this.sessions) {
      const groupKey = s.configVersion ? `${s.scenarioId}#v${s.configVersion}` : s.scenarioId;
      const displayName = s.configVersion ? `${s.scenarioName} (v${s.configVersion})` : s.scenarioName;
      const existing = grouped.get(groupKey);
      if (!existing) {
        grouped.set(groupKey, {
          scenarioName: displayName,
          category: s.category,
          bestScore: s.score,
          bestAccuracy: s.accuracy,
          totalScore: s.score,
          playCount: 1,
        });
      } else {
        existing.playCount++;
        existing.totalScore += s.score;
        if (s.score > existing.bestScore) existing.bestScore = s.score;
        if (s.accuracy > existing.bestAccuracy) existing.bestAccuracy = s.accuracy;
      }
    }

    const list: BestScenarioMetric[] = Array.from(grouped.entries()).map(([scenarioId, data]) => ({
      scenarioId,
      scenarioName: data.scenarioName,
      category: data.category,
      bestScore: data.bestScore,
      bestAccuracy: data.bestAccuracy,
      playCount: data.playCount,
      avgScore: Math.round(data.totalScore / data.playCount),
    }));

    return list.sort((a, b) => b.bestScore - a.bestScore).slice(0, limit);
  }

  getConsistentPerformingScenarios(minSamples = 2, limit = 5): BestScenarioMetric[] {
    const all = this.getBestPerformingScenarios(100);
    return all
      .filter(s => s.playCount >= minSamples)
      .sort((a, b) => (b.avgScore ?? b.bestScore) - (a.avgScore ?? a.bestScore))
      .slice(0, limit);
  }

  getScenarioTrend(scenarioId: string, difficulty?: DifficultyId, configVersion?: number): ScenarioTrendResult {
    const sc = getScenarioById(scenarioId);
    const meaningfulReactionTime = sc ? sc.meaningfulReactionTime : true;

    let matches = this.sessions.filter(s => s.scenarioId === scenarioId);
    if (difficulty) {
      matches = matches.filter(s => s.difficulty === difficulty);
    }

    // Separate configuration versions strictly:
    // If target configVersion is explicitly passed, filter strictly to that version.
    // If omitted, take the latest session's version (or undefined for legacy) so different versions are never mixed!
    const targetVersion = configVersion !== undefined
      ? configVersion
      : (matches.length > 0 ? matches[0].configVersion : undefined);

    if (targetVersion !== undefined) {
      matches = matches.filter(s => s.configVersion === targetVersion);
    } else {
      matches = matches.filter(s => s.configVersion === undefined);
    }

    if (matches.length < 2) {
      return {
        hasEnoughData: false,
        scenarioId,
        difficulty,
        configVersion: targetVersion,
        sampleCount: matches.length,
        meaningfulReactionTime,
        recentScores: matches.map(s => s.score).reverse(),
      };
    }

    // matches is ordered newest first:
    const latest = matches[0];
    const previous = matches[1];

    const scoreDelta = latest.score - previous.score;

    const latestShots = typeof latest.shotsFired === 'number' && Number.isFinite(latest.shotsFired)
      ? latest.shotsFired
      : (latest.hits + latest.misses);
    const prevShots = typeof previous.shotsFired === 'number' && Number.isFinite(previous.shotsFired)
      ? previous.shotsFired
      : (previous.hits + previous.misses);
    const hasSufficientShooting = latestShots >= 5 && prevShots >= 5;

    const accuracyDelta = hasSufficientShooting
      ? Number((latest.accuracy - previous.accuracy).toFixed(1))
      : null;

    const latestHs = typeof latest.headshotPct === 'number' ? latest.headshotPct : (latest.hits > 0 ? (latest.headshots / latest.hits) * 100 : 0);
    const prevHs = typeof previous.headshotPct === 'number' ? previous.headshotPct : (previous.hits > 0 ? (previous.headshots / previous.hits) * 100 : 0);
    const headshotDelta = hasSufficientShooting
      ? Number((latestHs - prevHs).toFixed(1))
      : null;

    let reactionDelta: number | null = null;
    if (meaningfulReactionTime && latest.avgReactionMs > 0 && previous.avgReactionMs > 0) {
      reactionDelta = latest.avgReactionMs - previous.avgReactionMs;
    }

    const recentScores = matches.slice(0, 8).map(s => s.score).reverse();

    return {
      hasEnoughData: true,
      scenarioId,
      difficulty,
      configVersion: targetVersion,
      sampleCount: matches.length,
      latest,
      previous,
      scoreDelta,
      accuracyDelta,
      headshotDelta,
      reactionDelta,
      meaningfulReactionTime,
      recentScores,
    };
  }

  categoryBreakdown(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const s of this.sessions) {
      if (s.category) {
        map[s.category] = (map[s.category] ?? 0) + 1;
      }
    }
    return map;
  }

  // ── Private helpers ─────────────────────────────────────────────────
  private updatePB(result: SessionResult): boolean {
    if (!result.scenarioId) return false;

    // Do not distort standard PBs if drill was run with a non-standard custom duration
    const sc = getScenarioById(result.scenarioId);
    if (sc && Number.isFinite(result.durationSec) && result.durationSec !== sc.durationSec) {
      return false;
    }

    let isPB = false;

    // Like-for-like scenario comparison
    const prev = this.pbs[result.scenarioId];
    const isNewVersion = prev && prev.configVersion !== undefined && result.configVersion !== undefined && prev.configVersion !== result.configVersion;

    if (!prev || isNewVersion || result.score > prev.score) {
      this.pbs[result.scenarioId] = {
        scenarioId:   result.scenarioId,
        difficulty:   result.difficulty,
        score:        result.score,
        accuracy:     result.accuracy,
        avgReactionMs:result.avgReactionMs,
        timestamp:    result.timestamp,
        configVersion:result.configVersion,
      };
      isPB = true;
    }

    // Per-difficulty comparison
    if (result.difficulty) {
      const diffKey = `${result.scenarioId}:${result.difficulty}`;
      const prevDiff = this.pbs[diffKey];
      const isDiffNewVersion = prevDiff && prevDiff.configVersion !== undefined && result.configVersion !== undefined && prevDiff.configVersion !== result.configVersion;
      if (!prevDiff || isDiffNewVersion || result.score > prevDiff.score) {
        this.pbs[diffKey] = {
          scenarioId:   result.scenarioId,
          difficulty:   result.difficulty,
          score:        result.score,
          accuracy:     result.accuracy,
          avgReactionMs:result.avgReactionMs,
          timestamp:    result.timestamp,
          configVersion:result.configVersion,
        };
        isPB = true;
      }
    }

    if (isPB) {
      this.savePBs();
    }
    return isPB;
  }

  private loadSessions(): SessionResult[] {
    try {
      const raw = localStorage.getItem(LS_SESSIONS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const sanitizedList: SessionResult[] = [];
      for (const item of parsed) {
        const clean = sanitizeSession(item);
        if (clean) sanitizedList.push(clean);
      }
      return sanitizedList.slice(0, MAX_SESSIONS);
    } catch {
      return [];
    }
  }

  private saveSessions(): void {
    try {
      // Keep mirror in localStorage capped to avoid quota exceeded errors
      localStorage.setItem(LS_SESSIONS, JSON.stringify(this.sessions.slice(0, MAX_SESSIONS)));
    } catch {}
  }

  private loadPBs(): Record<string, PersonalBest> {
    try {
      const raw = localStorage.getItem(LS_PERSONAL_BESTS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const result: Record<string, PersonalBest> = {};
      for (const [key, pb] of Object.entries(parsed)) {
        if (pb && typeof pb === 'object' && typeof (pb as any).scenarioId === 'string') {
          const p = pb as any;
          result[key] = {
            scenarioId: p.scenarioId,
            difficulty: typeof p.difficulty === 'string' ? p.difficulty : undefined,
            score: typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : 0,
            accuracy: typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) ? p.accuracy : 0,
            avgReactionMs: typeof p.avgReactionMs === 'number' && Number.isFinite(p.avgReactionMs) ? p.avgReactionMs : 0,
            timestamp: typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) ? p.timestamp : Date.now(),
            configVersion: typeof p.configVersion === 'number' && Number.isFinite(p.configVersion) ? p.configVersion : undefined,
          };
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private savePBs(): void {
    try { localStorage.setItem(LS_PERSONAL_BESTS, JSON.stringify(this.pbs)); } catch {}
  }

  private loadRoutineSummaries(): RoutineSummary[] {
    try {
      const raw = localStorage.getItem(LS_ROUTINES);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const sanitizedList: RoutineSummary[] = [];
      for (const item of parsed) {
        const clean = sanitizeRoutineSummary(item);
        if (clean) sanitizedList.push(clean);
      }
      return sanitizedList.slice(0, MAX_ROUTINES);
    } catch {
      return [];
    }
  }

  private saveRoutineSummaries(): void {
    try { localStorage.setItem(LS_ROUTINES, JSON.stringify(this.routineSummaries.slice(0, MAX_ROUTINES))); } catch {}
  }

  private loadPlaylists(): Playlist[] {
    try {
      const raw = localStorage.getItem(LS_PLAYLISTS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const validPlaylists: Playlist[] = [];
      for (const item of parsed) {
        const val = validatePlaylist(item);
        if (val.valid) {
          validPlaylists.push(item as Playlist);
        }
      }
      return validPlaylists;
    } catch {
      return [];
    }
  }

  private savePlaylists(): void {
    try { localStorage.setItem(LS_PLAYLISTS, JSON.stringify(this.playlists)); } catch {}
  }

  private loadCustomScenarios(): WarmupLabScenarioV1[] {
    try {
      const raw = localStorage.getItem(LS_CUSTOM_SCENARIOS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const valid: WarmupLabScenarioV1[] = [];
      for (const item of parsed) {
        const val = validateCustomScenarioJSON(item);
        if (val.valid) {
          valid.push(item as WarmupLabScenarioV1);
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  private saveCustomScenarios(): void {
    try { localStorage.setItem(LS_CUSTOM_SCENARIOS, JSON.stringify(this.customScenarios)); } catch {}
  }
}
