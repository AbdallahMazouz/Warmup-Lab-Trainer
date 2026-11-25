// =====================================================================
// views/scenarioBrowserView.ts — Scenario Catalog / Browser View
// =====================================================================

import type { ScenarioConfig, PersonalBest } from '../types';
import { escapeHtml } from '../utils';

export interface ScenarioBrowserCallbacks {
  onOpenCreator: () => void;
  onSelectCategory: (cat: string) => void;
  onLaunchScenario: (scenId: string) => void;
  onEditCustom: (scenId: string) => void;
  onDuplicateCustom: (scenId: string) => void;
  onExportCustom: (scenId: string) => void;
  onDeleteCustom: (scenId: string) => void;
}

export const SCENARIO_CATEGORIES = [
  { id: 'all', label: 'All Categories' },
  { id: 'custom', label: '🛠️ Custom Drills' },
  { id: 'aimlab', label: '🎯 Aim Lab' },
  { id: 'kovaaks', label: "⚡ KovaaK's" },
  { id: 'flick', label: 'Clicking / Flicking' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'switching', label: 'Switching' },
  { id: 'tactical', label: 'Tactical' },
  { id: 'precision', label: 'Precision' },
  { id: 'decision', label: 'Decision Making' },
  { id: 'movement', label: 'Movement' },
  { id: 'flash', label: 'Flash Recovery' },
  { id: 'hybrid', label: 'Hybrid' },
];

export function renderScenariosHTML(
  allScens: ScenarioConfig[],
  selectedCategory: string,
  getPB: (id: string) => PersonalBest | null,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  const esc = escapeHtmlFn;

  const filtered = selectedCategory === 'all'
    ? allScens
    : selectedCategory === 'custom'
      ? allScens.filter(s => s.id.startsWith('custom_'))
      : selectedCategory === 'aimlab'
        ? allScens.filter(s => s.id.startsWith('aimlab-'))
        : selectedCategory === 'kovaaks'
          ? allScens.filter(s => s.id.startsWith('kovaaks-'))
          : allScens.filter(s => s.category === selectedCategory);

  return `
    <div class="page-inner">
      <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <h2>TRAINING SCENARIOS</h2>
          <span class="section-sub">Choose a specialized exercise targeting your aim weaknesses</span>
        </div>
        <div>
          <button class="btn btn-primary btn-md" id="btn-open-creator" style="font-family:var(--font-game); letter-spacing:0.04em;">
            + CREATE CUSTOM DRILL
          </button>
        </div>
      </div>

      <!-- Filter pills -->
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:24px;">
        ${SCENARIO_CATEGORIES.map(c => `
          <button class="btn btn-sm ${selectedCategory === c.id ? 'btn-primary' : 'btn-secondary'}" data-cat="${c.id}">
            ${c.label}
          </button>
        `).join('')}
      </div>

      <!-- Grid of scenarios -->
      <div class="scenario-grid">
        ${filtered.length === 0 ? `
          <div class="card" style="grid-column: 1 / -1; padding:32px; text-align:center; color:var(--text-dim);">
            No scenarios found in this category.
            ${selectedCategory === 'custom' ? '<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" id="btn-empty-creator">+ CREATE YOUR FIRST DRILL</button></div>' : ''}
          </div>
        ` : filtered.map(s => {
          const pb = getPB(s.id);
          const isCustom = s.id.startsWith('custom_');
          const behaviorBadge = isCustom
            ? `<span class="badge badge-gold">CUSTOM DRILL</span>`
            : s.id.startsWith('aimlab-')
            ? `<span class="badge" style="background:rgba(255,70,85,0.2); color:#ff4655; border:1px solid rgba(255,70,85,0.4);">🎯 AIM LAB</span>`
            : s.id.startsWith('kovaaks-')
              ? `<span class="badge" style="background:rgba(0,240,255,0.2); color:#00f0ff; border:1px solid rgba(0,240,255,0.4);">⚡ KOVAAK'S</span>`
              : s.id === 'headline'
            ? `<span class="badge" style="background:rgba(255,70,85,0.15); color:#ff4655; border:1px solid rgba(255,70,85,0.3);">HEADLINE</span>`
            : s.id === 'peek-and-tap'
              ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">ANGLE HOLD</span>`
              : s.id === 'counter-strafe-duel'
                ? `<span class="badge" style="background:rgba(0,255,200,0.15); color:#00ffc8; border:1px solid rgba(0,255,200,0.3);">COUNTER-STRAFE</span>`
                : s.id === 'jiggle-reading'
                  ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">PEEK READING</span>`
                  : s.id === 'spray-control'
                    ? `<span class="badge" style="background:rgba(255,215,0,0.15); color:#ffd700; border:1px solid rgba(255,215,0,0.3);">SPRAY CONTROL</span>`
                    : s.id === 'target-transfer'
                      ? `<span class="badge" style="background:rgba(0,200,255,0.15); color:#00c8ff; border:1px solid rgba(0,200,255,0.3);">TARGET TRANSFER</span>`
                      : s.id === 'operator-flick'
                        ? `<span class="badge" style="background:rgba(180,100,255,0.15); color:#d080ff; border:1px solid rgba(180,100,255,0.3);">OPERATOR FLICK</span>`
                        : s.id === 'friend-or-foe'
                          ? `<span class="badge" style="background:rgba(51,153,255,0.15); color:#3399ff; border:1px solid rgba(51,153,255,0.3);">FRIEND OR FOE</span>`
                          : s.movementPattern === 'static'
                            ? `<span class="badge" style="background:rgba(255,255,255,0.06); color:var(--text-dim); border:1px solid rgba(255,255,255,0.12);">STATIONARY</span>`
                            : (s.id === 'tactical-jiggle' || s.id === 'tactical-wideswing' || s.id === 'flash-pop')
                              ? `<span class="badge" style="background:rgba(255,160,32,0.15); color:#ffa020; border:1px solid rgba(255,160,32,0.3);">COVER DUEL</span>`
                              : s.id === 'track-vertical'
                                ? `<span class="badge" style="background:rgba(180,100,255,0.15); color:#d080ff; border:1px solid rgba(180,100,255,0.3);">MOBILITY</span>`
                                : s.category === 'tracking'
                                  ? `<span class="badge" style="background:rgba(0,255,136,0.12); color:#00ff88; border:1px solid rgba(0,255,136,0.25);">TRACKING</span>`
                                  : s.category === 'hybrid'
                                    ? `<span class="badge" style="background:rgba(0,200,255,0.15); color:#00c8ff; border:1px solid rgba(0,200,255,0.3);">HYBRID THREAT</span>`
                                    : `<span class="badge" style="background:rgba(255,70,85,0.15); color:#ff4655; border:1px solid rgba(255,70,85,0.3);">TACTICAL STRAFE</span>`;

          return `
            <div class="card scenario-card" data-scen="${esc(s.id)}" role="button" tabindex="0" aria-label="Play ${esc(s.name)} scenario">
              <div class="scenario-card-meta">
                <span class="badge badge-red">${esc(s.category)}</span>
                ${behaviorBadge}
                <span class="badge badge-lime">${esc(s.difficulty)}</span>
                <span class="badge badge-gold">${s.durationSec}s</span>
              </div>
              <div class="scenario-card-title">${esc(s.name)}</div>
              <p class="scenario-card-desc">${esc(s.description)}</p>
              <div class="text-dim text-sm mb-8"><strong>Skill:</strong> ${esc(s.skill)}</div>
              <div class="scenario-card-pb">
                <span class="pb-label">Personal Best</span>
                <span class="pb-value">${pb ? pb.score.toLocaleString() : '—'}</span>
              </div>
              ${isCustom ? `
                <div style="display:flex; gap:6px; margin-top:16px;">
                  <button class="btn btn-primary btn-sm" data-play-custom="${esc(s.id)}" style="flex:1;">PLAY</button>
                  <button class="btn btn-secondary btn-sm" data-edit-custom="${esc(s.id)}" title="Edit Drill">✏️</button>
                  <button class="btn btn-secondary btn-sm" data-dup-custom="${esc(s.id)}" title="Duplicate Drill">📋</button>
                  <button class="btn btn-secondary btn-sm" data-export-custom="${esc(s.id)}" title="Export JSON">💾</button>
                  <button class="btn btn-secondary btn-sm" data-del-custom="${esc(s.id)}" title="Delete Drill" style="color:var(--status-danger);">&times;</button>
                </div>
              ` : `
                <button class="btn btn-primary btn-sm w-full mt-16">PLAY SCENARIO</button>
              `}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function attachScenariosListeners(
  container: HTMLElement,
  callbacks: ScenarioBrowserCallbacks
): void {
  container.querySelector('#btn-open-creator')?.addEventListener('click', () => {
    callbacks.onOpenCreator();
  });

  container.querySelector('#btn-empty-creator')?.addEventListener('click', () => {
    callbacks.onOpenCreator();
  });

  container.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = (btn as HTMLElement).dataset.cat ?? 'all';
      callbacks.onSelectCategory(cat);
    });
  });

  container.querySelectorAll('[data-play-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenId = (btn as HTMLElement).dataset.playCustom;
      if (scenId) callbacks.onLaunchScenario(scenId);
    });
  });

  container.querySelectorAll('[data-edit-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenId = (btn as HTMLElement).dataset.editCustom;
      if (scenId) callbacks.onEditCustom(scenId);
    });
  });

  container.querySelectorAll('[data-dup-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenId = (btn as HTMLElement).dataset.dupCustom;
      if (scenId) callbacks.onDuplicateCustom(scenId);
    });
  });

  container.querySelectorAll('[data-export-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenId = (btn as HTMLElement).dataset.exportCustom;
      if (scenId) callbacks.onExportCustom(scenId);
    });
  });

  container.querySelectorAll('[data-del-custom]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const scenId = (btn as HTMLElement).dataset.delCustom;
      if (scenId) callbacks.onDeleteCustom(scenId);
    });
  });

  container.querySelectorAll('[data-scen]').forEach(card => {
    const activate = () => {
      const scenId = (card as HTMLElement).dataset.scen;
      if (scenId) callbacks.onLaunchScenario(scenId);
    };
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-edit-custom], [data-dup-custom], [data-export-custom], [data-del-custom], [data-play-custom]')) {
        return;
      }
      activate();
    });
    card.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        activate();
      }
    });
  });
}
