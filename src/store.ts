// =====================================================================
// store.ts — Session history and personal bests (localStorage)
// =====================================================================

import { LS_SESSIONS, LS_PERSONAL_BESTS, LS_ROUTINES } from './constants';
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
} from './types';
import { getScenarioById } from './scenarios';

const MAX_SESSIONS = 100;
const MAX_ROUTINES = 20;

export class Store {
  private sessions: SessionResult[];
  private pbs: Record<string, PersonalBest>;
  private routineSummaries: RoutineSummary[];

  constructor() {
    this.sessions = this.loadSessions();
    this.pbs = this.loadPBs();
    this.routineSummaries = this.loadRoutineSummaries();
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

    const sanitized = this.sanitizeSession(result);
    if (!sanitized) {
      return { isPB: false };
    }

    this.sessions.unshift(sanitized);
    if (this.sessions.length > MAX_SESSIONS) {
      this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    }
    this.saveSessions();
    const isPB = this.updatePB(sanitized);
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

  // ── History Management & Diagnostics ───────────────────────────────
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
        error: `JSON parse error: ${err?.message || 'Invalid JSON syntax'}`,
      };
    }

    let rawRecords: unknown[];
    if (Array.isArray(parsed)) {
      rawRecords = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const envelope = parsed as any;
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
      const sanitized = this.sanitizeSession(item);
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

    const startIdx = (safePage - 1) * safePageSize;
    const pagedSessions = filtered.slice(startIdx, startIdx + safePageSize);

    return {
      sessions: pagedSessions,
      totalRecords,
      totalPages,
      currentPage: safePage,
      pageSize: safePageSize,
    };
  }

  // ── Routine Summaries ──────────────────────────────────────────────
  addRoutineSummary(summary: RoutineSummary): void {
    if (!summary || !summary.routineId) return;
    if (this.routineSummaries.some(r => r.id === summary.id)) return;

    const sanitized = this.sanitizeRoutineSummary(summary);
    if (!sanitized) return;

    this.routineSummaries.unshift(sanitized);
    if (this.routineSummaries.length > MAX_ROUTINES) {
      this.routineSummaries = this.routineSummaries.slice(0, MAX_ROUTINES);
    }
    this.saveRoutineSummaries();
  }

  getRoutineSummaries(limit = 20): RoutineSummary[] {
    return this.routineSummaries.slice(0, limit);
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
      const existing = grouped.get(s.scenarioId);
      if (!existing) {
        grouped.set(s.scenarioId, {
          scenarioName: s.scenarioName,
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

  getScenarioTrend(scenarioId: string, difficulty?: DifficultyId): ScenarioTrendResult {
    const sc = getScenarioById(scenarioId);
    const meaningfulReactionTime = sc ? sc.meaningfulReactionTime : true;

    let matches = this.sessions.filter(s => s.scenarioId === scenarioId);
    if (difficulty) {
      matches = matches.filter(s => s.difficulty === difficulty);
    }

    if (matches.length < 2) {
      return {
        hasEnoughData: false,
        scenarioId,
        difficulty,
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
    let isPB = false;

    // Like-for-like scenario comparison
    const prev = this.pbs[result.scenarioId];
    if (!prev || result.score > prev.score) {
      this.pbs[result.scenarioId] = {
        scenarioId:   result.scenarioId,
        difficulty:   result.difficulty,
        score:        result.score,
        accuracy:     result.accuracy,
        avgReactionMs:result.avgReactionMs,
        timestamp:    result.timestamp,
      };
      isPB = true;
    }

    // Like-for-like scenario + difficulty comparison
    if (result.difficulty) {
      const diffKey = `${result.scenarioId}:${result.difficulty}`;
      const prevDiff = this.pbs[diffKey];
      if (!prevDiff || result.score > prevDiff.score) {
        this.pbs[diffKey] = {
          scenarioId:   result.scenarioId,
          difficulty:   result.difficulty,
          score:        result.score,
          accuracy:     result.accuracy,
          avgReactionMs:result.avgReactionMs,
          timestamp:    result.timestamp,
        };
        isPB = true;
      }
    }

    if (isPB) {
      this.savePBs();
    }
    return isPB;
  }

  private sanitizeSession(item: any): SessionResult | null {
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

    return {
      id: typeof item.id === 'string' && item.id ? item.id : `session_${Date.now()}_${Math.random()}`,
      scenarioId: item.scenarioId,
      scenarioName: typeof item.scenarioName === 'string' && item.scenarioName ? item.scenarioName : item.scenarioId,
      category: typeof item.category === 'string' ? item.category : 'flick',
      difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'intermediate',
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : Date.now(),
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
    };
  }

  private sanitizeRoutineSummary(item: any): RoutineSummary | null {
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

    return {
      id: typeof item.id === 'string' && item.id ? item.id : `routine_${Date.now()}_${Math.random()}`,
      routineId: item.routineId,
      routineName: typeof item.routineName === 'string' ? item.routineName : item.routineId,
      difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'intermediate',
      timestamp: typeof item.timestamp === 'number' && Number.isFinite(item.timestamp) ? item.timestamp : Date.now(),
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
    };
  }

  private loadSessions(): SessionResult[] {
    try {
      const raw = localStorage.getItem(LS_SESSIONS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const sanitizedList: SessionResult[] = [];
      for (const item of parsed) {
        const clean = this.sanitizeSession(item);
        if (clean) sanitizedList.push(clean);
      }
      return sanitizedList.slice(0, MAX_SESSIONS);
    } catch {
      return [];
    }
  }

  private saveSessions(): void {
    try { localStorage.setItem(LS_SESSIONS, JSON.stringify(this.sessions)); } catch {}
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
        const clean = this.sanitizeRoutineSummary(item);
        if (clean) sanitizedList.push(clean);
      }
      return sanitizedList.slice(0, MAX_ROUTINES);
    } catch {
      return [];
    }
  }

  private saveRoutineSummaries(): void {
    try { localStorage.setItem(LS_ROUTINES, JSON.stringify(this.routineSummaries)); } catch {}
  }
}
