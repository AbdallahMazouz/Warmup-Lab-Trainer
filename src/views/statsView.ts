// =====================================================================
// views/statsView.ts — Statistics Dashboard, Analytics & Session History
// =====================================================================

import type { Engine } from '../engine';
import type { DifficultyId, SkillDimensionEvaluation, RecommendationResult, PageId } from '../types';
import { SCENARIOS, getScenarioById } from '../scenarios';
import { generateRecommendation } from '../recommendations';
import { escapeHtml } from '../utils';

export function generateSparklineSVG(scores: number[], width = 180, height = 40): string {
  if (!scores || scores.length === 0) return '';
  if (scores.length === 1) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;" aria-label="Score progression">
      <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--teal)" stroke-dasharray="3 3" stroke-width="1.5" />
      <circle cx="${width / 2}" cy="${height / 2}" r="4" fill="var(--teal)" />
    </svg>`;
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min === 0 ? 1 : max - min;
  const paddingY = 6;
  const usableHeight = height - paddingY * 2;
  const stepX = width / (scores.length - 1);

  const points = scores.map((val, idx) => {
    const x = idx * stepX;
    const y = height - paddingY - ((val - min) / range) * usableHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');
  const lastPoint = points[points.length - 1].split(',');
  const isUp = scores[scores.length - 1] >= scores[0];
  const strokeColor = isUp ? 'var(--teal)' : 'var(--red)';

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible;" aria-label="Score progression">
    <polyline fill="none" stroke="${strokeColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polylineStr}" />
    <circle cx="${lastPoint[0]}" cy="${lastPoint[1]}" r="4" fill="${strokeColor}" />
  </svg>`;
}

export interface StatsViewState {
  historyFeedbackMessage: { type: 'success' | 'error'; text: string } | null;
  selectedTrendScenario: string;
  selectedTrendDifficulty: DifficultyId | 'all';
  historyPage: number;
  historyPageSize: number;
  historyCategoryFilter: string;
  historyDifficultyFilter: DifficultyId | 'all';
  historySortBy: 'date_desc' | 'date_asc' | 'score_desc' | 'score_asc' | 'accuracy_desc';
  isClearModalOpen: boolean;
}

export interface StatsViewCallbacks {
  onLaunchRecommendation: (rec: RecommendationResult) => void;
  onLaunchScenario: (scenId: string) => void;
  onNavigate: (page: PageId) => void;
  onRenderPage: () => void;
  escapeHtmlFn?: (t: string) => string;
}

export function renderSkillBarHTML(dim: SkillDimensionEvaluation, escapeHtmlFn: (t: string) => string = escapeHtml): string {
  const esc = escapeHtmlFn;
  const hasData = dim.sampleCount > 0;
  const scoreColor = dim.isDeficit
    ? 'var(--status-danger)'
    : (dim.score < dim.benchmark ? 'var(--gold)' : 'var(--lime-primary)');
  const barClass = dim.isDeficit
    ? 'red'
    : (dim.score < dim.benchmark ? 'gold' : 'lime');

  const badgeHTML = !hasData
    ? `<span class="badge badge-dim font-game">UNTESTED</span>`
    : (dim.isDeficit
      ? `<span class="badge badge-red font-game">DEFICIT</span>`
      : (dim.sampleCount < 2
        ? `<span class="badge badge-gold font-game">PRELIMINARY</span>`
        : `<span class="badge badge-lime font-game">ON TARGET</span>`));

  const scoreDisplay = hasData
    ? `<span class="font-game" style="font-weight:700; font-size:1.15rem; color:${scoreColor};">${dim.score}<span style="font-size:0.85rem; color:var(--text-dim);">/100</span></span>`
    : `<span class="font-game text-dim" style="font-weight:700; font-size:0.95rem;">NO DATA</span>`;

  const coveragePct = Math.round(dim.confidence * 100);

  return `
    <div style="background:var(--panel-2); border:1px solid var(--border); border-radius:var(--r-md); padding:14px 16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
        <div>
          <span style="font-weight:700; color:var(--text); font-size:0.95rem;">${esc(dim.name)}</span>
          <span style="font-size:0.8rem; color:var(--text-dim); margin-left:8px;">${esc(dim.description)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:0.82rem; color:var(--text-dim);">Benchmark: <strong>${dim.benchmark}</strong></span>
          ${badgeHTML}
          ${scoreDisplay}
        </div>
      </div>

      <div class="progress-bar" style="height:7px; background:var(--bg-2); margin-bottom:8px;">
        <div class="progress-fill ${barClass}" style="width:${hasData ? dim.score : 0}%;"></div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.8rem; color:var(--text-dim); flex-wrap:wrap; gap:6px;">
        <span>${esc(dim.evidenceSummary)}</span>
        <span>${hasData ? `${dim.sampleCount} session(s) (${coveragePct}% evidence coverage)` : '0 sessions'}</span>
      </div>
    </div>
  `;
}

export function renderTrainingIntelligenceSectionHTML(
  rec: RecommendationResult,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  const esc = escapeHtmlFn;
  const badgeType = rec.isColdStart
    ? `<span class="badge badge-gold font-game">DIAGNOSTIC BASELINE</span>`
    : (rec.primaryDimension
      ? `<span class="badge badge-red font-game">DEFICIT FOCUS: ${rec.dimensionName ? esc(rec.dimensionName.toUpperCase()) : 'TARGETED'}</span>`
      : `<span class="badge badge-lime font-game">MAINTENANCE & PROGRESSION</span>`);

  const actionBtnText = rec.recommendationType === 'routine'
    ? `⚡ LAUNCH 5-MIN DIAGNOSTIC ROUTINE`
    : `⚡ LAUNCH ${rec.recommendedScenarioName ? esc(rec.recommendedScenarioName.toUpperCase()) : 'RECOMMENDED DRILL'}`;

  const targetLabel = rec.recommendationType === 'routine'
    ? `Routine: <strong>${esc(rec.recommendedRoutineName || 'Diagnostic Routine')}</strong>`
    : `Scenario: <strong>${esc(rec.recommendedScenarioName || 'Target Drill')}</strong>`;

  const coveragePct = Math.round(rec.confidence * 100);

  return `
    <div class="card mb-32" style="border:1px solid var(--border-2); background:linear-gradient(180deg, var(--panel) 0%, var(--panel-2) 100%);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--border); padding-bottom:12px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.3rem;">🧠</span>
            <h3 style="font-size:1.3rem; margin:0; letter-spacing:0.04em;">TRAINING INTELLIGENCE & RECOMMENDATIONS</h3>
          </div>
          <span class="section-sub" style="font-size:0.85rem;">Deterministic skill gap analysis and target drill selection</span>
        </div>
        <div>
          ${badgeType}
        </div>
      </div>

      <!-- Highlight Recommendation Box -->
      <div style="background:var(--bg-2); border-left:4px solid ${rec.isColdStart ? 'var(--gold)' : (rec.primaryDimension ? 'var(--status-danger)' : 'var(--lime-primary)')}; border-radius:0 var(--r-md) var(--r-md) 0; padding:16px 20px; margin-bottom:24px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; flex-wrap:wrap; gap:10px;">
          <div>
            <h4 style="font-size:1.25rem; color:var(--text); margin-bottom:4px; font-family:var(--font-game);">${esc(rec.title)}</h4>
            <div style="font-size:0.88rem; color:var(--text-dim);">
              ${targetLabel}
              <span style="margin:0 8px; color:var(--border-2);">|</span>
              <span>Preset: <strong style="color:var(--text);">${rec.targetDifficulty.toUpperCase()}</strong> <span style="font-size:0.75rem; color:var(--text-dim);">(default baseline)</span></span>
            </div>
          </div>
          <div style="text-align:right;">
            <span class="badge ${rec.confidence >= 0.5 ? 'badge-lime' : 'badge-gold'}" style="font-size:0.75rem;">
              ${coveragePct}% EVIDENCE COVERAGE
            </span>
          </div>
        </div>

        <div style="margin:12px 0; font-size:0.9rem; line-height:1.5;">
          <p style="color:var(--text); margin-bottom:6px;"><strong>Evidence:</strong> ${esc(rec.evidence)}</p>
          <p style="color:var(--text-dim); margin-bottom:6px;">${esc(rec.rationale)}</p>
          <p style="font-size:0.82rem; color:var(--text-dim);"><strong>Benchmark Target:</strong> <span style="color:var(--text);">${rec.benchmarkTarget}</span></p>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; flex-wrap:wrap; gap:12px;">
          <span style="font-size:0.78rem; color:var(--text-dim);">Confidence reflects historical sample coverage, not win probability.</span>
          <button class="btn btn-primary btn-lg" id="btn-rec-launch" style="font-weight:700;">
            ${actionBtnText}
          </button>
        </div>
      </div>

      <!-- 5 Skill Dimensions Breakdown -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h4 style="font-size:0.95rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim);">SKILL DIMENSION EVALUATIONS</h4>
          <span style="font-size:0.78rem; color:var(--text-dim);">Minimum 2 samples required per dimension to establish a deficit</span>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          ${rec.dimensionEvaluations.map((dim) => renderSkillBarHTML(dim, esc)).join('')}
        </div>
      </div>
    </div>
  `;
}

export function renderTrendDetailsHTML(
  engine: Engine,
  scenarioId: string,
  diff: DifficultyId | 'all',
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  const esc = escapeHtmlFn;
  const trend = engine.store.getScenarioTrend(
    scenarioId,
    diff === 'all' ? undefined : diff
  );
  const sc = getScenarioById(scenarioId);

  if (!trend.hasEnoughData) {
    return `
      <div style="background:var(--panel-2); border:1px dashed var(--border-2); border-radius:var(--r-md); padding:20px; text-align:center;">
        <div class="text-dim text-sm" style="margin-bottom:6px;">
          ⚠️ Insufficient history for <strong>${esc(sc?.name ?? scenarioId)}</strong> ${diff !== 'all' ? `(${diff.toUpperCase()})` : '(All Difficulties)'}
        </div>
        <p style="font-size:0.9rem; margin:0; color:var(--text-dim);">
          At least 2 sessions with this scenario and difficulty scope are required to calculate performance trends. (Current recorded: <strong>${trend.sampleCount}</strong>)
        </p>
      </div>
    `;
  }

  const sDelta = trend.scoreDelta ?? 0;
  const aDelta = trend.accuracyDelta;
  const hsDelta = trend.headshotDelta;

  const sClass = sDelta > 0 ? 'trend-up' : (sDelta < 0 ? 'trend-down' : 'trend-neutral');
  const aClass = typeof aDelta === 'number' ? (aDelta > 0 ? 'trend-up' : (aDelta < 0 ? 'trend-down' : 'trend-neutral')) : 'trend-neutral';
  const hsClass = typeof hsDelta === 'number' ? (hsDelta > 0 ? 'trend-up' : (hsDelta < 0 ? 'trend-down' : 'trend-neutral')) : 'trend-neutral';

  const sSign = sDelta > 0 ? '+' : '';
  const aSign = typeof aDelta === 'number' && aDelta > 0 ? '+' : '';
  const hsSign = typeof hsDelta === 'number' && hsDelta > 0 ? '+' : '';

  let reactionDisplay = '<span class="text-dim">N/A (Tracking Drill)</span>';
  if (trend.meaningfulReactionTime) {
    if (trend.reactionDelta === null || trend.reactionDelta === undefined) {
      reactionDisplay = '<span class="text-dim">N/A</span>';
    } else {
      const rDelta = trend.reactionDelta;
      // Faster reaction is a negative delta (fewer ms), which is better!
      const rClass = rDelta < 0 ? 'trend-up' : (rDelta > 0 ? 'trend-down' : 'trend-neutral');
      const rText = rDelta < 0
        ? `${Math.abs(rDelta)} ms faster ⚡`
        : (rDelta > 0 ? `+${rDelta} ms slower` : '0 ms change');
      reactionDisplay = `<span class="${rClass}" style="font-weight:700;">${rText}</span>`;
    }
  }

  const sparklineSvg = generateSparklineSVG(trend.recentScores, 200, 44);
  const scopeBadge = diff === 'all'
    ? '<span class="badge badge-teal" style="font-size:0.75rem;">Aggregate Scope: All Difficulties</span>'
    : `<span class="badge badge-red" style="font-size:0.75rem;">Strict Scope: ${diff.toUpperCase()} Only</span>`;

  return `
    <div style="background:var(--panel-2); border:1px solid var(--border-2); border-radius:var(--r-md); padding:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px;">
            <h4 style="margin:0; font-size:1.15rem; color:var(--text);">${esc(sc?.name ?? scenarioId)}</h4>
            ${scopeBadge}
          </div>
          <span class="text-dim text-sm">Latest Attempt vs. Previous Attempt &bull; ${trend.sampleCount} total records</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <div style="text-align:right;">
            <span class="text-dim text-xs" style="display:block; text-transform:uppercase; letter-spacing:0.06em;">Score Trend</span>
            <span class="text-dim text-xs">Last ${trend.recentScores.length} attempts</span>
          </div>
          ${sparklineSvg}
        </div>
      </div>

      <div class="grid-4" style="gap:12px;">
        <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
          <span class="text-dim text-xs uppercase" style="display:block;">Score Delta</span>
          <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${sClass}">
            ${sSign}${sDelta.toLocaleString()} pts
          </div>
          <span class="text-dim text-xs">${trend.latest?.score.toLocaleString()} vs ${trend.previous?.score.toLocaleString()}</span>
        </div>

        <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
          <span class="text-dim text-xs uppercase" style="display:block;">Accuracy Delta</span>
          <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${aClass}">
            ${typeof aDelta === 'number' ? `${aSign}${aDelta.toFixed(1)}%` : '<span class="text-dim font-game" style="font-size:1.15rem;">Untested</span>'}
          </div>
          <span class="text-dim text-xs">${typeof aDelta === 'number' ? `${trend.latest?.accuracy.toFixed(1)}% vs ${trend.previous?.accuracy.toFixed(1)}%` : 'Insufficient shots (&lt; 5)'}</span>
        </div>

        <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
          <span class="text-dim text-xs uppercase" style="display:block;">Headshot Rate Delta</span>
          <div style="font-family:var(--font-game); font-size:1.4rem; font-weight:700;" class="${hsClass}">
            ${typeof hsDelta === 'number' ? `${hsSign}${hsDelta.toFixed(1)}%` : '<span class="text-dim font-game" style="font-size:1.15rem;">Untested</span>'}
          </div>
          <span class="text-dim text-xs">${typeof hsDelta === 'number' ? 'Latest vs previous' : 'Insufficient shots (&lt; 5)'}</span>
        </div>

        <div style="background:var(--panel); padding:12px; border-radius:var(--r-sm); border:1px solid var(--border);">
          <span class="text-dim text-xs uppercase" style="display:block;">Reaction Time Delta</span>
          <div style="font-size:1.15rem; margin-top:4px;">
            ${reactionDisplay}
          </div>
          <span class="text-dim text-xs">${trend.meaningfulReactionTime ? `${trend.latest?.avgReactionMs ?? 0}ms vs ${trend.previous?.avgReactionMs ?? 0}ms` : 'Not applicable'}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderStatsHTML(
  engine: Engine,
  state: StatsViewState,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  const esc = escapeHtmlFn;
  const agg = engine.store.getAggregateStats();
  const recentStats = engine.store.getRecentStats(10);
  const pbs = engine.store.getAllPBs();
  const pbList = Object.values(pbs);
  const routineSummaries = engine.store.getRoutineSummaries(10);
  const bestScenarios = engine.store.getBestPerformingScenarios(5);
  const allSessions = engine.store.getSessions(undefined, 100);
  const preferredDifficulty = allSessions[0]?.difficulty || 'intermediate';
  const rec = generateRecommendation(allSessions, preferredDifficulty);

  if (agg.totalDrills === 0 && agg.totalRoutines === 0) {
    return `
      <div class="page-inner">
        <div class="section-header">
          <h2>TRAINING PROGRESS DASHBOARD</h2>
          <span class="section-sub">Comprehensive aim analytics, consistency metrics, and personal records</span>
        </div>

        ${state.historyFeedbackMessage ? `
          <div role="status" aria-live="polite" style="padding:10px 14px; border-radius:var(--r-sm); margin-bottom:16px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; background:${state.historyFeedbackMessage.type === 'success' ? 'rgba(0,255,136,0.15)' : 'rgba(255,70,85,0.15)'}; border:1px solid ${state.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'}; color:${state.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'};">
            <span>${state.historyFeedbackMessage.text}</span>
            <button id="btn-dismiss-feedback" aria-label="Dismiss notification" style="background:none; border:none; color:inherit; font-weight:700; cursor:pointer;">&times;</button>
          </div>
        ` : ''}

        <div class="card" style="text-align:center; padding:48px 24px;">
          <div style="font-size:3rem; margin-bottom:12px;">🧠</div>
          <span class="badge badge-gold font-game" style="margin-bottom:12px;">DIAGNOSTIC BASELINE RECOMMENDED</span>
          <h3 style="font-size:1.6rem; margin-bottom:10px;">NO TRAINING SESSIONS RECORDED YET</h3>
          <p class="text-dim" style="max-width:560px; margin:0 auto 20px; font-size:0.95rem; line-height:1.6;">
            ${esc(rec.evidence)} Complete the Quick 5-Minute Warm-Up Routine to establish your initial baseline across flicks, tracking, and reaction speed.
          </p>
          <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
            <button class="btn btn-primary btn-lg" id="btn-empty-diagnostic">⚡ START 5-MIN DIAGNOSTIC ROUTINE</button>
            <button class="btn btn-secondary btn-lg" id="btn-empty-play">START QUICK DRILL</button>
            <button class="btn btn-secondary btn-lg" id="btn-empty-plans">BROWSE WARM-UP PLANS</button>
          </div>
        </div>
      </div>
    `;
  }

  const totalTimeMin = Math.round(agg.totalTimePlayedSec / 60);

  return `
    <div class="page-inner">
      <div class="section-header">
        <h2>TRAINING PROGRESS DASHBOARD</h2>
        <span class="section-sub">Real-time lifetime analytics, recent form trends, and routine performance</span>
      </div>

      <!-- Training Intelligence & Recommendations -->
      ${renderTrainingIntelligenceSectionHTML(rec, esc)}

      <!-- Metric Overview Cards: Lifetime Totals -->
      <div class="grid-4 mb-24">
        <div class="card stats-summary-card">
          <div class="stat-value text-lime">${agg.totalDrills}</div>
          <div class="stat-label">Total Drills Completed</div>
        </div>
        <div class="card stats-summary-card">
          <div class="stat-value text-teal">${agg.totalRoutines}</div>
          <div class="stat-label">Warm-Up Routines Completed</div>
        </div>
        <div class="card stats-summary-card">
          <div class="stat-value text-gold">${agg.overallAccuracy.toFixed(1)}%</div>
          <div class="stat-label">Lifetime Accuracy (${agg.totalHits}/${agg.totalShots} shots)</div>
        </div>
        <div class="card stats-summary-card">
          <div class="stat-value text-green">${agg.overallHeadshotPct.toFixed(1)}%</div>
          <div class="stat-label">Lifetime Headshot Rate (${agg.totalHeadshots}/${agg.totalHits} hits)</div>
        </div>
      </div>

      <!-- Lifetime vs Recent Form Comparison -->
      <div class="grid-2 mb-32">
        <div class="card">
          <div class="section-header" style="margin-bottom:14px;">
            <h3>LIFETIME BENCHMARKS</h3>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Total Arena Time</span>
              <span style="font-weight:700; color:var(--text); font-family:var(--font-game);">${totalTimeMin} min (${agg.totalTimePlayedSec}s)</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Total Targets Hit</span>
              <span style="font-weight:700; color:var(--green); font-family:var(--font-game);">${agg.totalHits.toLocaleString()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Total Headshots</span>
              <span style="font-weight:700; color:var(--gold); font-family:var(--font-game);">${agg.totalHeadshots.toLocaleString()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="text-dim text-sm">Personal Bests Established</span>
              <span style="font-weight:700; color:var(--lime-primary); font-family:var(--font-game);">${pbList.length}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="section-header" style="margin-bottom:14px;">
            <h3>RECENT FORM (LAST ${recentStats.count} SESSIONS)</h3>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Recent Accuracy</span>
              <span style="font-weight:700; color:var(--gold); font-family:var(--font-game);">${recentStats.accuracy.toFixed(1)}%</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Recent Headshot Rate</span>
              <span style="font-weight:700; color:var(--green); font-family:var(--font-game);">${recentStats.headshotPct.toFixed(1)}%</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border); padding-bottom:8px;">
              <span class="text-dim text-sm">Recent Average Score</span>
              <span style="font-weight:700; color:var(--lime-primary); font-family:var(--font-game);">${recentStats.avgScore.toLocaleString()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span class="text-dim text-sm">Recent Shots Fired</span>
              <span style="font-weight:700; color:var(--text); font-family:var(--font-game);">${recentStats.totalHits} / ${recentStats.totalShots}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Like-for-Like Trend Comparison & Sparkline -->
      <div class="card mb-32">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:16px;">
          <div>
            <h3 style="margin:0 0 4px;">LIKE-FOR-LIKE PERFORMANCE TRENDS</h3>
            <span class="text-dim text-sm">Compare consecutive attempts under identical scenario and difficulty conditions</span>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <select id="trend-scenario-select" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 12px; font-size:0.85rem;">
              ${SCENARIOS.map(s => `<option value="${s.id}" ${state.selectedTrendScenario === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
            <select id="trend-diff-select" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 12px; font-size:0.85rem;">
              <option value="all" ${state.selectedTrendDifficulty === 'all' ? 'selected' : ''}>All Difficulties</option>
              <option value="beginner" ${state.selectedTrendDifficulty === 'beginner' ? 'selected' : ''}>Beginner</option>
              <option value="intermediate" ${state.selectedTrendDifficulty === 'intermediate' ? 'selected' : ''}>Intermediate</option>
              <option value="advanced" ${state.selectedTrendDifficulty === 'advanced' ? 'selected' : ''}>Advanced</option>
              <option value="pro" ${state.selectedTrendDifficulty === 'pro' ? 'selected' : ''}>Pro</option>
            </select>
          </div>
        </div>

        <div id="trend-details-container">
          ${renderTrendDetailsHTML(engine, state.selectedTrendScenario, state.selectedTrendDifficulty, esc)}
        </div>
      </div>

      <!-- Top Performing Scenarios -->
      ${bestScenarios.length > 0 ? `
        <div class="card mb-32">
          <div class="section-header" style="margin-bottom:14px;">
            <h3>HIGHEST SINGLE-SESSION SCORES (BY SCENARIO)</h3>
            <span class="section-sub">Single-session personal bests across scenarios. Sample size and average score reflect consistency.</span>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                  <th style="padding:10px;">Scenario</th>
                  <th style="padding:10px;">Category</th>
                  <th style="padding:10px;">Single-Session Best</th>
                  <th style="padding:10px;">Average Score</th>
                  <th style="padding:10px;">Best Accuracy</th>
                  <th style="padding:10px;">Attempts (Sample Size)</th>
                </tr>
              </thead>
              <tbody>
                ${bestScenarios.map(b => {
                  const avg = b.avgScore ?? b.bestScore;
                  const isReliable = b.playCount >= 2;
                  return `
                    <tr style="border-bottom:1px solid var(--border);">
                      <td style="padding:12px 10px; font-weight:600;">${esc(b.scenarioName)}</td>
                      <td style="padding:12px 10px;"><span class="badge badge-teal">${b.category.toUpperCase()}</span></td>
                      <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.15rem;">${b.bestScore.toLocaleString()}</td>
                      <td style="padding:12px 10px; font-weight:600; color:var(--text); font-family:var(--font-game);">${avg.toLocaleString()}</td>
                      <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${b.bestAccuracy.toFixed(1)}%</td>
                      <td style="padding:12px 10px;">
                        <span class="badge ${isReliable ? 'badge-green' : 'badge-gold'}">${b.playCount} ${b.playCount === 1 ? 'drill (single run)' : 'drills'}</span>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- All Personal Bests Table -->
      <div class="card mb-32">
        <h3 class="mb-16">ALL PERSONAL BESTS</h3>
        ${pbList.length === 0 ? `
          <p class="text-dim text-sm">No personal bests recorded yet.</p>
        ` : `
          <div class="table-scroll-wrapper" style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                  <th style="padding:10px;">Scenario</th>
                  <th style="padding:10px;">Score</th>
                  <th style="padding:10px;">Accuracy</th>
                  <th style="padding:10px;">Avg Reaction</th>
                  <th style="padding:10px;">Date</th>
                </tr>
              </thead>
              <tbody>
                ${pbList.map(pb => {
                  const sc = getScenarioById(pb.scenarioId);
                  const isReactionMeaningful = sc ? sc.meaningfulReactionTime : true;
                  return `
                    <tr style="border-bottom:1px solid var(--border);">
                      <td style="padding:12px 10px; font-weight:600;">${esc(sc?.name ?? pb.scenarioId)}</td>
                      <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.15rem;">${pb.score.toLocaleString()}</td>
                      <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${pb.accuracy.toFixed(1)}%</td>
                      <td style="padding:12px 10px;">${isReactionMeaningful && pb.avgReactionMs > 0 ? `${pb.avgReactionMs} ms` : 'N/A'}</td>
                      <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(pb.timestamp).toLocaleDateString()}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Completed Warm-Up Routines Section (Dedicated & Isolated) -->
      <div class="card mb-32">
        <div class="section-header" style="margin-bottom:14px;">
          <h3>COMPLETED WARM-UP ROUTINES</h3>
          <span class="section-sub">Summaries of structured multi-drill warmup sessions</span>
        </div>
        ${routineSummaries.length === 0 ? `
          <p class="text-dim text-sm">No warm-up routines completed yet. Head to Warm-Up Plans to complete a 5, 10, or 20-minute structured routine!</p>
        ` : `
          <div class="table-scroll-wrapper" style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
              <thead>
                <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                  <th style="padding:10px;">Routine</th>
                  <th style="padding:10px;">Difficulty</th>
                  <th style="padding:10px;">Drills</th>
                  <th style="padding:10px;">Active Aim Time</th>
                  <th style="padding:10px;">Total Elapsed Time</th>
                  <th style="padding:10px;">Retries</th>
                  <th style="padding:10px;">Score</th>
                  <th style="padding:10px;">Accuracy</th>
                  <th style="padding:10px;">Headshot %</th>
                  <th style="padding:10px;">Date</th>
                </tr>
              </thead>
              <tbody>
                ${routineSummaries.map(r => {
                  const activeSec = r.activeDurationSec ?? r.totalDurationSec;
                  const elapsedSec = r.totalElapsedSec ?? r.totalDurationSec;
                  const activeMin = Math.floor(activeSec / 60);
                  const activeRemSec = activeSec % 60;
                  const elapsedMin = Math.floor(elapsedSec / 60);
                  const elapsedRemSec = elapsedSec % 60;
                  const hsRate = r.totalHits > 0 ? ((r.totalHeadshots / r.totalHits) * 100).toFixed(1) : '0.0';

                  return `
                    <tr style="border-bottom:1px solid var(--border);">
                      <td style="padding:12px 10px; font-weight:600;">${esc(r.routineName)}</td>
                      <td style="padding:12px 10px;"><span class="badge badge-red">${r.difficulty.toUpperCase()}</span></td>
                      <td style="padding:12px 10px;"><span class="badge badge-teal">${r.drillsCompleted}/${r.totalDrills}</span></td>
                      <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${activeMin}m ${activeRemSec.toString().padStart(2, '0')}s</td>
                      <td style="padding:12px 10px; color:var(--text-dim);">${elapsedMin}m ${elapsedRemSec.toString().padStart(2, '0')}s</td>
                      <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${r.retriesCount ?? 0}</td>
                      <td style="padding:12px 10px; font-weight:700; color:var(--gold); font-family:var(--font-game); font-size:1.1rem;">${r.totalScore.toLocaleString()}</td>
                      <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${r.overallAccuracy.toFixed(1)}%</td>
                      <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${hsRate}%</td>
                      <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(r.timestamp).toLocaleDateString()}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Session History Management (Paginated & Filterable) -->
      <div class="card" id="session-history-container">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
          <div>
            <h3 style="margin:0 0 4px;">SESSION HISTORY & DIAGNOSTICS</h3>
            <span class="section-sub">Detailed records of individual drill attempts with client-side export and import</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-sm btn-secondary" id="btn-export-history" title="Export all stored sessions as JSON">
              📥 EXPORT JSON
            </button>
            <button class="btn btn-sm btn-secondary" id="btn-import-history" title="Import sessions from JSON file">
              📤 IMPORT JSON
            </button>
            <input type="file" id="input-import-history" accept=".json,application/json" style="display:none;" />
            <button class="btn btn-sm btn-secondary text-red" id="btn-clear-history" title="Clear drill session records" style="border-color:rgba(255,70,85,0.4);">
              🗑️ CLEAR HISTORY
            </button>
          </div>
        </div>

        <!-- Notification Toast (if any) -->
        ${state.historyFeedbackMessage ? `
          <div role="status" aria-live="polite" style="padding:10px 14px; border-radius:var(--r-sm); margin-bottom:16px; font-size:0.85rem; display:flex; justify-content:space-between; align-items:center; background:${state.historyFeedbackMessage.type === 'success' ? 'rgba(0,255,136,0.15)' : 'rgba(255,70,85,0.15)'}; border:1px solid ${state.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'}; color:${state.historyFeedbackMessage.type === 'success' ? 'var(--green)' : 'var(--red)'};">
            <span>${state.historyFeedbackMessage.text}</span>
            <button id="btn-dismiss-feedback" aria-label="Dismiss notification" style="background:none; border:none; color:inherit; font-weight:700; cursor:pointer;">&times;</button>
          </div>
        ` : ''}

        <!-- Filter and Sort Bar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:16px; padding:10px 12px; background:var(--panel-2); border-radius:var(--r-sm); border:1px solid var(--border);">
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <label class="text-dim text-xs uppercase" style="letter-spacing:0.06em;">Filter:</label>
            <select id="history-filter-cat" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
              <option value="all" ${state.historyCategoryFilter === 'all' ? 'selected' : ''}>All Categories</option>
              <option value="flick" ${state.historyCategoryFilter === 'flick' ? 'selected' : ''}>Flicks</option>
              <option value="tracking" ${state.historyCategoryFilter === 'tracking' ? 'selected' : ''}>Tracking</option>
              <option value="tactical" ${state.historyCategoryFilter === 'tactical' ? 'selected' : ''}>Tactical</option>
              <option value="flash" ${state.historyCategoryFilter === 'flash' ? 'selected' : ''}>Flash Recovery</option>
              <option value="reaction" ${state.historyCategoryFilter === 'reaction' ? 'selected' : ''}>Reaction Time</option>
              <option value="hybrid" ${state.historyCategoryFilter === 'hybrid' ? 'selected' : ''}>Hybrid</option>
            </select>

            <select id="history-filter-diff" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
              <option value="all" ${state.historyDifficultyFilter === 'all' ? 'selected' : ''}>All Difficulties</option>
              <option value="beginner" ${state.historyDifficultyFilter === 'beginner' ? 'selected' : ''}>Beginner</option>
              <option value="intermediate" ${state.historyDifficultyFilter === 'intermediate' ? 'selected' : ''}>Intermediate</option>
              <option value="advanced" ${state.historyDifficultyFilter === 'advanced' ? 'selected' : ''}>Advanced</option>
              <option value="pro" ${state.historyDifficultyFilter === 'pro' ? 'selected' : ''}>Pro</option>
            </select>
          </div>

          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <label class="text-dim text-xs uppercase" style="letter-spacing:0.06em;">Sort:</label>
            <select id="history-sort-by" class="form-select" style="background:var(--panel); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 8px; font-size:0.82rem;">
              <option value="date_desc" ${state.historySortBy === 'date_desc' ? 'selected' : ''}>Date (Newest First)</option>
              <option value="date_asc" ${state.historySortBy === 'date_asc' ? 'selected' : ''}>Date (Oldest First)</option>
              <option value="score_desc" ${state.historySortBy === 'score_desc' ? 'selected' : ''}>Score (High to Low)</option>
              <option value="accuracy_desc" ${state.historySortBy === 'accuracy_desc' ? 'selected' : ''}>Accuracy (High to Low)</option>
            </select>
          </div>
        </div>

        <!-- Table -->
        ${(() => {
          const filteredResult = engine.store.getFilteredSessions({
            category: state.historyCategoryFilter,
            difficulty: state.historyDifficultyFilter,
            sortBy: state.historySortBy,
            page: state.historyPage,
            pageSize: state.historyPageSize,
          });
          state.historyPage = filteredResult.currentPage;

          if (filteredResult.sessions.length === 0) {
            return `<p class="text-dim text-sm" style="padding:20px; text-align:center;">No matching session records found.</p>`;
          }

          return `
            <div class="table-scroll-wrapper" style="overflow-x:auto;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem; letter-spacing:0.08em;">
                    <th style="padding:10px;">Scenario</th>
                    <th style="padding:10px;">Difficulty</th>
                    <th style="padding:10px;">Score</th>
                    <th style="padding:10px;">Accuracy</th>
                    <th style="padding:10px;">Headshot %</th>
                    <th style="padding:10px;">Hits / Misses</th>
                    <th style="padding:10px;">Targets / Min</th>
                    <th style="padding:10px;">Avg Reaction</th>
                    <th style="padding:10px;">Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredResult.sessions.map(s => {
                    const sc = getScenarioById(s.scenarioId);
                    const isReactionMeaningful = sc ? sc.meaningfulReactionTime : true;
                    const hsPct = typeof s.headshotPct === 'number' && Number.isFinite(s.headshotPct)
                      ? `${s.headshotPct.toFixed(1)}%`
                      : (s.hits > 0 ? `${((s.headshots / s.hits) * 100).toFixed(1)}%` : '0.0%');
                    const tpm = typeof s.targetsPerMinute === 'number' && Number.isFinite(s.targetsPerMinute)
                      ? s.targetsPerMinute.toFixed(1)
                      : (s.durationSec > 0 ? ((s.hits / s.durationSec) * 60).toFixed(1) : '0.0');

                    return `
                      <tr style="border-bottom:1px solid var(--border);">
                        <td style="padding:12px 10px; font-weight:600;">${esc(s.scenarioName)}</td>
                        <td style="padding:12px 10px;"><span class="badge badge-red">${s.difficulty ? s.difficulty.toUpperCase() : 'INTERMEDIATE'}</span></td>
                        <td style="padding:12px 10px; font-weight:700; color:var(--text); font-family:var(--font-game); font-size:1.1rem;">${s.score.toLocaleString()}</td>
                        <td style="padding:12px 10px; color:var(--teal); font-weight:600;">${s.accuracy.toFixed(1)}%</td>
                        <td style="padding:12px 10px; color:var(--gold); font-weight:600;">${hsPct}</td>
                        <td style="padding:12px 10px;"><span class="text-green">${s.hits}</span> / <span class="text-red">${s.misses}</span></td>
                        <td style="padding:12px 10px;">${tpm}</td>
                        <td style="padding:12px 10px;">${isReactionMeaningful && s.avgReactionMs > 0 ? `${s.avgReactionMs} ms` : 'N/A'}</td>
                        <td style="padding:12px 10px; color:var(--text-dim); font-size:0.8rem;">${new Date(s.timestamp).toLocaleDateString()}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- Pagination Controls -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:16px; padding-top:12px; border-top:1px solid var(--border); flex-wrap:wrap; gap:10px;">
              <span class="text-dim text-xs">
                Showing page <strong>${filteredResult.currentPage}</strong> of <strong>${filteredResult.totalPages}</strong> &bull; Total records: <strong>${filteredResult.totalRecords}</strong>
              </span>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-sm btn-secondary" id="btn-history-prev" ${filteredResult.currentPage <= 1 ? 'disabled' : ''}>
                  &laquo; PREV
                </button>
                <button class="btn btn-sm btn-secondary" id="btn-history-next" ${filteredResult.currentPage >= filteredResult.totalPages ? 'disabled' : ''}>
                  NEXT &raquo;
                </button>
              </div>
            </div>
          `;
        })()}
      </div>

      <!-- Clear Confirmation Modal -->
      <div id="modal-clear-history" role="dialog" aria-modal="true" aria-labelledby="clear-modal-title" style="display:${state.isClearModalOpen ? 'flex' : 'none'}; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:1000; align-items:center; justify-content:center;">
        <div class="card" style="max-width:480px; width:90%; border:1px solid var(--red); background:var(--panel-2); padding:24px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
            <span style="font-size:1.6rem;" aria-hidden="true">⚠️</span>
            <h3 id="clear-modal-title" style="margin:0; color:var(--red);">CLEAR DRILL SESSION HISTORY?</h3>
          </div>
          <p style="font-size:0.9rem; line-height:1.5; color:var(--text); margin-bottom:16px;">
            This will permanently delete all individual drill session records (<strong>${engine.store.totalSessions()}</strong> stored).
          </p>
          <p style="font-size:0.85rem; line-height:1.5; color:var(--text-dim); margin-bottom:24px; background:var(--panel); padding:10px; border-radius:var(--r-sm); border-left:3px solid var(--teal);">
            🛡️ <strong>Safety Guarantee:</strong> Your <strong>Personal Bests (PBs)</strong> and <strong>Completed Warm-Up Routine history</strong> will NOT be deleted.
          </p>
          <div style="display:flex; justify-content:flex-end; gap:12px;">
            <button class="btn btn-secondary btn-sm" id="btn-cancel-clear">CANCEL</button>
            <button class="btn btn-primary btn-sm" id="btn-confirm-clear" style="background:var(--red); border-color:var(--red);">CONFIRM CLEAR</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function attachStatsListeners(
  container: HTMLElement,
  engine: Engine,
  state: StatsViewState,
  callbacks: StatsViewCallbacks
): void {
  const allSessions = engine.store.getSessions(undefined, 100);
  const preferredDifficulty = allSessions[0]?.difficulty || 'intermediate';
  const rec = generateRecommendation(allSessions, preferredDifficulty);

  container.querySelector('#btn-rec-launch')?.addEventListener('click', () => {
    callbacks.onLaunchRecommendation(rec);
  });

  container.querySelector('#btn-empty-diagnostic')?.addEventListener('click', () => {
    callbacks.onLaunchRecommendation(rec);
  });

  container.querySelector('#btn-empty-play')?.addEventListener('click', () => {
    callbacks.onLaunchScenario('flick-static');
  });

  container.querySelector('#btn-empty-plans')?.addEventListener('click', () => {
    callbacks.onNavigate('plans');
  });

  const scenSelect = container.querySelector('#trend-scenario-select') as HTMLSelectElement | null;
  const diffSelect = container.querySelector('#trend-diff-select') as HTMLSelectElement | null;
  const detailsContainer = container.querySelector('#trend-details-container');

  const updateTrend = () => {
    if (scenSelect && detailsContainer) {
      state.selectedTrendScenario = scenSelect.value;
      state.selectedTrendDifficulty = (diffSelect?.value as DifficultyId | 'all') ?? 'all';
      detailsContainer.innerHTML = renderTrendDetailsHTML(
        engine,
        state.selectedTrendScenario,
        state.selectedTrendDifficulty,
        callbacks.escapeHtmlFn
      );
    }
  };

  scenSelect?.addEventListener('change', updateTrend);
  diffSelect?.addEventListener('change', updateTrend);

  // ── Session History Management Listeners ─────────────────────────────
  container.querySelector('#btn-export-history')?.addEventListener('click', () => {
    const jsonStr = engine.store.exportSessionsJSON();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `warmup-lab-session-history-${dateStr}.json`;
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonStr);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (typeof url === 'string' && url.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
      state.historyFeedbackMessage = {
        type: 'success',
        text: `Exported ${engine.store.totalSessions()} session(s) to ${filename}.`,
      };
    } catch (err: any) {
      state.historyFeedbackMessage = {
        type: 'error',
        text: `Export failed: ${err?.message || 'Unknown error'}`,
      };
    }
    callbacks.onRenderPage();
  });

  const fileInput = container.querySelector('#input-import-history') as HTMLInputElement | null;
  container.querySelector('#btn-import-history')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = typeof e.target?.result === 'string' ? e.target.result : '';
      const res = engine.store.importSessionsJSON(content);
      if (res.success) {
        state.historyPage = 1;
        const capNotice = typeof res.excludedByCapCount === 'number' && res.excludedByCapCount > 0
          ? ` (${res.retainedCount ?? res.importedCount} retained, ${res.excludedByCapCount} excluded by 100-session limit)`
          : '';
        state.historyFeedbackMessage = {
          type: 'success',
          text: `Import completed: ${res.importedCount} imported${capNotice}, ${res.duplicateCount} duplicate(s) skipped${res.invalidCount > 0 ? `, ${res.invalidCount} invalid record(s) discarded` : ''}.`,
        };
      } else {
        state.historyFeedbackMessage = {
          type: 'error',
          text: res.error || 'Import failed: Invalid file format.',
        };
      }
      fileInput.value = '';
      callbacks.onRenderPage();
    };

    reader.onerror = () => {
      state.historyFeedbackMessage = {
        type: 'error',
        text: 'File read error: Failed to read selected file.',
      };
      fileInput.value = '';
      callbacks.onRenderPage();
    };

    reader.readAsText(file);
  });

  const modalEl = container.querySelector('#modal-clear-history') as HTMLElement | null;
  const cancelClearBtn = container.querySelector('#btn-cancel-clear') as HTMLButtonElement | null;
  const confirmClearBtn = container.querySelector('#btn-confirm-clear') as HTMLButtonElement | null;

  if (state.isClearModalOpen && modalEl) {
    cancelClearBtn?.focus();

    modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!state.isClearModalOpen) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        state.isClearModalOpen = false;
        callbacks.onRenderPage();
        (document.getElementById('btn-clear-history') as HTMLElement | null)?.focus();
      } else if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === cancelClearBtn) {
            e.preventDefault();
            confirmClearBtn?.focus();
          }
        } else {
          if (document.activeElement === confirmClearBtn) {
            e.preventDefault();
            cancelClearBtn?.focus();
          }
        }
      }
    });
  }

  container.querySelector('#btn-clear-history')?.addEventListener('click', () => {
    state.isClearModalOpen = true;
    callbacks.onRenderPage();
  });

  cancelClearBtn?.addEventListener('click', () => {
    state.isClearModalOpen = false;
    callbacks.onRenderPage();
    (document.getElementById('btn-clear-history') as HTMLElement | null)?.focus();
  });

  confirmClearBtn?.addEventListener('click', () => {
    engine.store.clearSessions();
    state.isClearModalOpen = false;
    state.historyPage = 1;
    state.historyFeedbackMessage = {
      type: 'success',
      text: 'All drill session history cleared. Personal bests and routine records preserved.',
    };
    callbacks.onRenderPage();
  });

  const catSelect = container.querySelector('#history-filter-cat') as HTMLSelectElement | null;
  catSelect?.addEventListener('change', () => {
    state.historyCategoryFilter = catSelect.value;
    state.historyPage = 1;
    callbacks.onRenderPage();
  });

  const histDiffSelect = container.querySelector('#history-filter-diff') as HTMLSelectElement | null;
  histDiffSelect?.addEventListener('change', () => {
    state.historyDifficultyFilter = (histDiffSelect.value as DifficultyId | 'all') ?? 'all';
    state.historyPage = 1;
    callbacks.onRenderPage();
  });

  const sortSelect = container.querySelector('#history-sort-by') as HTMLSelectElement | null;
  sortSelect?.addEventListener('change', () => {
    state.historySortBy = sortSelect.value as any;
    state.historyPage = 1;
    callbacks.onRenderPage();
  });

  container.querySelector('#btn-history-prev')?.addEventListener('click', () => {
    if (state.historyPage > 1) {
      state.historyPage--;
      callbacks.onRenderPage();
    }
  });

  container.querySelector('#btn-history-next')?.addEventListener('click', () => {
    state.historyPage++;
    callbacks.onRenderPage();
  });

  container.querySelector('#btn-dismiss-feedback')?.addEventListener('click', () => {
    state.historyFeedbackMessage = null;
    callbacks.onRenderPage();
  });
}
