// =====================================================================
// views/resultsView.ts — Drill & Routine Results Overlay View
// =====================================================================

import type { SessionResult, ScenarioConfig, RecommendationResult } from '../types';
import { escapeHtml } from '../utils';

export interface ResultModalRenderParams {
  result: SessionResult;
  isPB: boolean;
  config: ScenarioConfig | null | undefined;
  meaningfulReaction: boolean;
  meaningfulTracking: boolean;
  scoreVal: string;
  accVal: string;
  hsPctVal: string;
  avgReactVal: string;
  medReactVal: string;
  tpmVal: string;
  tpsVal: string;
  bodyHits: number;
  shotsFired: number;
  isInRoutine: boolean;
  routineName?: string;
  routineCurrentDrill?: number;
  routineTotalDrills?: number;
  nextDrillConfig?: ScenarioConfig | null;
  rec: RecommendationResult;
  escapeHtmlFn?: (t: string) => string;
}

export interface RoutineCompletionRenderParams {
  routineName: string;
  difficulty: string;
  isPlaylist: boolean;
  completedDrillsCount: number;
  totalPlannedDrills: number;
  skippedDrillsCount: number;
  completionRate: number;
  activeTrainingSec: number;
  totalElapsedSec: number;
  transitionSec: number;
  retriesCount: number;
  totalScore: number;
  overallAcc: number;
  hsPct: number;
  totalHits: number;
  completedResults: SessionResult[];
  escapeHtmlFn?: (t: string) => string;
}

export interface ResultModalCallbacks {
  onRetry: () => void;
  onNext?: () => void;
  onMenu: () => void;
  onLaunchRecommendation?: (rec: RecommendationResult) => void;
}

export function renderResultModalHTML(p: ResultModalRenderParams): string {
  const esc = p.escapeHtmlFn || escapeHtml;
  const { result, isPB, isInRoutine, nextDrillConfig, rec } = p;

  return `
    ${isPB ? `
      <div style="background:rgba(204,255,0,0.12); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:12px 24px; color:var(--lime-primary); font-family:var(--font-game); font-weight:700; font-size:1.4rem; letter-spacing:0.06em; margin-bottom:20px; box-shadow:0 0 20px rgba(204,255,0,0.2);">
        🏆 NEW PERSONAL BEST!
      </div>
    ` : ''}

    ${isInRoutine ? `
      <div style="background:rgba(204,255,0,0.08); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:8px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-family:var(--font-game); font-weight:700; color:var(--lime-primary);">ROUTINE: ${esc((p.routineName || '').toUpperCase())}</span>
        <span class="badge badge-lime font-game">DRILL ${p.routineCurrentDrill} OF ${p.routineTotalDrills}</span>
      </div>
    ` : ''}

    <div style="display:flex; justify-content:center; gap:8px; margin-bottom:8px;">
      <span class="badge badge-lime font-game">${result.category.toUpperCase()}</span>
      <span class="badge badge-red font-game">${result.difficulty.toUpperCase()}</span>
      <span class="badge badge-gold font-game">${result.durationSec}s</span>
    </div>
    <h2 style="font-size:2.2rem; margin:6px 0 20px;">${esc(result.scenarioName)}</h2>

    <!-- Primary Metrics Cards -->
    <div class="grid-4 mb-24">
      <div class="card" style="padding:14px;">
        <div class="stat-value text-gold" style="font-size:2.0rem;">${p.scoreVal}</div>
        <div class="stat-label">Final Score</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-lime" style="font-size:2.0rem;">${p.accVal}</div>
        <div class="stat-label">Accuracy</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-gold" style="font-size:2.0rem;">${p.hsPctVal}</div>
        <div class="stat-label">Headshot Rate</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-green" style="font-size:2.0rem;">${p.avgReactVal}</div>
        <div class="stat-label">Avg Reaction</div>
      </div>
    </div>

    <!-- Detailed Metrics Grid -->
    <div class="grid-4 mb-20" style="font-size:0.92rem; text-align:left; background:var(--panel-2); padding:16px; border-radius:var(--r-md); border:1px solid var(--border);">
      <div><span class="text-dim">Shots Fired:</span> <strong>${p.shotsFired}</strong></div>
      <div><span class="text-dim">Hits:</span> <strong class="text-green">${result.hits}</strong></div>
      <div><span class="text-dim">Headshots:</span> <strong class="text-gold">${result.headshots}</strong></div>
      <div><span class="text-dim">Body Hits:</span> <strong>${p.bodyHits}</strong></div>
      <div><span class="text-dim">Misses:</span> <strong class="text-red">${result.misses}</strong></div>
      <div><span class="text-dim">Median Reaction:</span> <strong>${p.medReactVal}</strong></div>
      <div><span class="text-dim">Targets / Min:</span> <strong>${p.tpmVal}</strong></div>
      <div><span class="text-dim">Kills / Sec:</span> <strong>${p.tpsVal}</strong></div>
      ${result.legHits !== undefined ? `<div><span class="text-dim">Leg Hits:</span> <strong class="text-red">${result.legHits}</strong></div>` : ''}
      ${result.friendlyFireCount !== undefined ? `<div><span class="text-dim">Friendly Fire:</span> <strong class="text-red">${result.friendlyFireCount}</strong></div>` : ''}
      ${result.earlyShotsCount !== undefined ? `<div><span class="text-dim">Early Shots:</span> <strong class="text-red">${result.earlyShotsCount}</strong></div>` : ''}
      ${result.sprayAccuracy !== undefined ? `<div><span class="text-dim">Spray Acc:</span> <strong class="text-teal">${result.sprayAccuracy.toFixed(1)}%</strong></div>` : ''}
      ${result.first10Accuracy !== undefined ? `<div><span class="text-dim">First 10 Bullets:</span> <strong class="text-gold">${result.first10Accuracy.toFixed(1)}%</strong></div>` : ''}
      ${result.decisionAccuracy !== undefined ? `<div><span class="text-dim">Decision Acc:</span> <strong class="text-green">${result.decisionAccuracy.toFixed(1)}%</strong></div>` : ''}
      ${result.counterStrafeAccuracy !== undefined ? `<div><span class="text-dim">Counter-Strafe Acc:</span> <strong class="text-lime">${result.counterStrafeAccuracy.toFixed(1)}%</strong></div>` : ''}
      ${result.overkillShots !== undefined ? `<div><span class="text-dim">Overkill Shots:</span> <strong class="text-red">${result.overkillShots}</strong></div>` : ''}
      ${result.timesShotByBot !== undefined ? `<div><span class="text-dim">Times Shot by Bot:</span> <strong class="text-red">${result.timesShotByBot}</strong></div>` : ''}
    </div>

    ${(result.shotsMoving !== undefined || result.shotsStationary !== undefined) ? `
      <div style="display:flex; justify-content:center; gap:20px; font-size:0.85rem; color:var(--text-dim); margin-bottom:20px;">
        <span>Stationary Shots: <strong style="color:var(--text);">${result.shotsStationary ?? 0}</strong></span>
        <span>Moving Shots: <strong style="color:var(--text);">${result.shotsMoving ?? 0}</strong></span>
      </div>
    ` : ''}

    ${(p.meaningfulTracking && result.timeOnTarget !== undefined) ? `
      <div style="font-size:0.9rem; color:var(--lime-primary); margin-bottom:20px;">
        Time on Target: <strong>${result.timeOnTarget.toFixed(1)}%</strong>
      </div>
    ` : ''}

    ${isInRoutine && nextDrillConfig ? `
      <div style="background:var(--panel-2); border-left:3px solid var(--lime-primary); padding:10px 16px; margin-bottom:20px; text-align:left; border-radius:0 var(--r-sm) var(--r-sm) 0;">
        <div class="text-dim text-sm" style="margin-bottom:2px;">NEXT DRILL:</div>
        <div style="font-weight:700; color:var(--text);">${esc(nextDrillConfig.name)} <span class="badge badge-gold" style="margin-left:6px;">${esc(nextDrillConfig.skill)}</span></div>
        <div id="routine-countdown-text" style="font-size:0.85rem; color:var(--lime-primary); margin-top:4px;">Starting next drill in 4s...</div>
      </div>
    ` : ''}

    ${!isInRoutine ? `
      <div class="card mb-20" style="background:var(--panel-2); border:1px solid var(--border-2); padding:16px; text-align:left; border-radius:var(--r-md);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
          <div style="font-family:var(--font-game); font-weight:700; color:var(--lime-primary); font-size:1.1rem;">
            🧠 NEXT TRAINING STEP: ${esc(rec.recommendedScenarioName ? rec.recommendedScenarioName.toUpperCase() : (rec.recommendedRoutineName ? rec.recommendedRoutineName.toUpperCase() : rec.title.toUpperCase()))}
          </div>
          <span class="badge ${rec.isColdStart ? 'badge-gold' : (rec.primaryDimension ? 'badge-red' : 'badge-lime')} font-game">
            ${rec.isColdStart ? 'DIAGNOSTIC BASELINE' : (rec.primaryDimension ? 'TARGETED FOCUS' : 'RECOMMENDED')}
          </span>
        </div>
        <div style="font-size:0.88rem; color:var(--text); margin-bottom:4px;">
          <strong>Evidence:</strong> ${esc(rec.evidence)}
        </div>
        <div style="font-size:0.84rem; color:var(--text-dim); margin-bottom:12px;">
          ${esc(rec.rationale)}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="font-size:0.8rem; color:var(--text-dim);">
            <span>Difficulty: <strong style="color:var(--text);">${rec.targetDifficulty.toUpperCase()}</strong> <span style="font-size:0.75rem; color:var(--text-dim);">(default baseline)</span></span>
            ${rec.confidence > 0 ? `<span style="margin-left:10px;">Evidence coverage: <strong>${Math.round(rec.confidence * 100)}%</strong></span>` : ''}
          </div>
          <button class="btn btn-primary btn-sm" id="btn-res-rec-launch">
            ⚡ LAUNCH ${rec.recommendationType === 'routine' ? 'ROUTINE' : 'DRILL'} &rarr;
          </button>
        </div>
      </div>
    ` : ''}

    <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
      <button class="btn btn-primary btn-lg" id="btn-res-retry">${isInRoutine ? 'RETRY DRILL' : 'PLAY AGAIN'}</button>
      ${isInRoutine ? `
        <button class="btn btn-primary btn-lg" id="btn-res-next">NEXT DRILL &rarr;</button>
        <button class="btn btn-secondary btn-lg" id="btn-res-menu">EXIT ROUTINE</button>
      ` : `
        <button class="btn btn-secondary btn-lg" id="btn-res-menu">RETURN TO MENU</button>
      `}
    </div>
  `;
}

export function renderRoutineCompletionHTML(p: RoutineCompletionRenderParams): string {
  const esc = p.escapeHtmlFn || escapeHtml;

  return `
    <div style="background:rgba(204,255,0,0.12); border:1px solid var(--lime-primary); border-radius:var(--r-md); padding:14px 24px; color:var(--lime-primary); font-family:var(--font-game); font-weight:700; font-size:1.6rem; letter-spacing:0.06em; margin-bottom:16px; box-shadow:0 0 24px rgba(204,255,0,0.25);">
      🏆 ${p.isPlaylist ? 'TRAINING PLAYLIST COMPLETE!' : 'WARM-UP ROUTINE COMPLETE!'}
    </div>

    <div style="display:flex; justify-content:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
      <span class="badge badge-lime font-game">${esc(p.routineName.toUpperCase())}</span>
      <span class="badge badge-red font-game">${p.difficulty.toUpperCase()}</span>
      <span class="badge badge-gold font-game">${p.completedDrillsCount}/${p.totalPlannedDrills} DRILLS FINISHED</span>
      ${p.skippedDrillsCount > 0 ? `<span class="badge badge-red font-game">${p.skippedDrillsCount} SKIPPED</span>` : ''}
      <span class="badge badge-green font-game">${Math.round(p.completionRate)}% COMPLETE</span>
      <span class="badge badge-lime font-game">${Math.floor(p.activeTrainingSec / 60)}m ${p.activeTrainingSec % 60}s ACTIVE</span>
      <span class="badge badge-gold font-game">${Math.floor(p.totalElapsedSec / 60)}m ${p.totalElapsedSec % 60}s TOTAL ELAPSED</span>
    </div>

    <h2 style="font-size:2.2rem; margin:6px 0 20px;">${p.isPlaylist ? 'Playlist' : 'Routine'} Summary</h2>

    <!-- Primary Aggregates -->
    <div class="grid-4 mb-24">
      <div class="card" style="padding:14px;">
        <div class="stat-value text-gold" style="font-size:2.0rem;">${p.totalScore.toLocaleString()}</div>
        <div class="stat-label">Total Score</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-lime" style="font-size:2.0rem;">${p.overallAcc.toFixed(1)}%</div>
        <div class="stat-label">Overall Accuracy</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-gold" style="font-size:2.0rem;">${p.hsPct.toFixed(1)}%</div>
        <div class="stat-label">Headshot Rate</div>
      </div>
      <div class="card" style="padding:14px;">
        <div class="stat-value text-green" style="font-size:2.0rem;">${p.totalHits}</div>
        <div class="stat-label">Total Targets Hit</div>
      </div>
    </div>

    <!-- Timing Transparency Breakdown -->
    <div class="grid-4 mb-20" style="font-size:0.92rem; text-align:left; background:var(--panel-2); padding:16px; border-radius:var(--r-md); border:1px solid var(--border);">
      <div><span class="text-dim">Active Aim Time:</span> <strong>${Math.floor(p.activeTrainingSec / 60)}m ${(p.activeTrainingSec % 60).toString().padStart(2, '0')}s</strong></div>
      <div><span class="text-dim">Total Elapsed Time:</span> <strong>${Math.floor(p.totalElapsedSec / 60)}m ${(p.totalElapsedSec % 60).toString().padStart(2, '0')}s</strong></div>
      <div><span class="text-dim">Transition Time:</span> <strong>${p.transitionSec}s</strong></div>
      <div><span class="text-dim">Retries:</span> <strong class="text-gold">${p.retriesCount}</strong></div>
    </div>

    <!-- Breakdown Table -->
    <div class="card mb-24" style="max-height:220px; overflow-y:auto; text-align:left; padding:12px;">
      <table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--border-2); color:var(--text-dim); text-transform:uppercase; font-size:0.75rem;">
            <th style="padding:6px;">#</th>
            <th style="padding:6px;">Drill</th>
            <th style="padding:6px;">Duration</th>
            <th style="padding:6px;">Score</th>
            <th style="padding:6px;">Accuracy</th>
            <th style="padding:6px;">Headshots</th>
          </tr>
        </thead>
        <tbody>
          ${p.completedResults.map((res, idx) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px; color:var(--text-dim);">${idx + 1}</td>
              <td style="padding:6px; font-weight:600;">${esc(res.scenarioName)}</td>
              <td style="padding:6px; color:var(--text-dim);">${res.durationSec}s</td>
              <td style="padding:6px; color:var(--gold); font-family:var(--font-game); font-weight:700;">${res.score.toLocaleString()}</td>
              <td style="padding:6px; color:var(--teal);">${res.accuracy.toFixed(1)}%</td>
              <td style="padding:6px; color:var(--gold);">${res.headshots}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap;">
      <button class="btn btn-primary btn-lg" id="btn-routine-menu">RETURN TO MENU</button>
    </div>
  `;
}

export function attachResultModalListeners(
  container: HTMLElement,
  callbacks: ResultModalCallbacks,
  rec?: RecommendationResult
): void {
  if (rec && callbacks.onLaunchRecommendation) {
    container.querySelector('#btn-res-rec-launch')?.addEventListener('click', () => {
      callbacks.onLaunchRecommendation!(rec);
    });
  }

  container.querySelector('#btn-res-retry')?.addEventListener('click', () => {
    callbacks.onRetry();
  });

  if (callbacks.onNext) {
    container.querySelector('#btn-res-next')?.addEventListener('click', () => {
      callbacks.onNext!();
    });
  }

  container.querySelector('#btn-res-menu')?.addEventListener('click', () => {
    callbacks.onMenu();
  });
}

export function attachRoutineCompletionListeners(
  container: HTMLElement,
  onMenu: () => void
): void {
  container.querySelector('#btn-routine-menu')?.addEventListener('click', () => {
    onMenu();
  });
}
