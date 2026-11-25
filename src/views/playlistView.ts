// =====================================================================
// views/playlistView.ts — Playlist Sequencer & Custom Routine Editor
// =====================================================================

import type { Engine } from '../engine';
import type { Playlist, PlaylistEntry, DifficultyId, TrainingRoutine } from '../types';
import { getScenarioById, TRAINING_ROUTINES, getRoutineDuration } from '../scenarios';
import { calculatePlaylistDurations, validatePlaylist, createDefaultPlaylist } from '../playlist';
import { escapeHtml } from '../utils';

export interface PlaylistViewState {
  playlistTab: 'all' | 'custom' | 'presets';
  editingPlaylist: Playlist | null;
  editorErrors: string[];
  editorSearchQuery: string;
  editorCategoryFilter: string;
  playlistToDelete: string | null;
}

export interface PlaylistViewCallbacks {
  onStartPlaylist: (playlist: Playlist, difficulty: DifficultyId) => void;
  onStartRoutine: (routine: TrainingRoutine, difficulty: DifficultyId) => void;
  onRenderPage: () => void;
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  escapeHtmlFn?: (t: string) => string;
}

export function renderPlaylistEditorHTML(
  engine: Engine,
  state: PlaylistViewState,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  if (!state.editingPlaylist) return '';

  const esc = escapeHtmlFn;
  const p = state.editingPlaylist;
  const durations = calculatePlaylistDurations(p);
  const activeMin = Math.floor(durations.activeSec / 60);
  const activeSecRem = durations.activeSec % 60;
  const totalMin = Math.floor(durations.totalElapsedSec / 60);
  const totalSecRem = durations.totalElapsedSec % 60;

  const categories: Array<{ id: string; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
    { id: 'flick', label: 'Flick' },
    { id: 'tracking', label: 'Tracking' },
    { id: 'tactical', label: 'Tactical' },
    { id: 'reaction', label: 'Reaction' },
    { id: 'flash', label: 'Flash' },
    { id: 'hybrid', label: 'Hybrid' },
    { id: 'aimlab', label: 'Aimlab' },
    { id: 'kovaaks', label: 'Kovaaks' },
  ];

  const q = state.editorSearchQuery.trim().toLowerCase();
  const allScenarios = engine.store.getAllScenarios();
  const availableScenarios = allScenarios.filter(sc => {
    const matchCat =
      state.editorCategoryFilter === 'all'
        ? true
        : state.editorCategoryFilter === 'custom'
        ? sc.id.startsWith('custom_')
        : state.editorCategoryFilter === 'aimlab'
        ? sc.id.startsWith('aimlab-')
        : state.editorCategoryFilter === 'kovaaks'
        ? sc.id.startsWith('kovaaks-')
        : sc.category === state.editorCategoryFilter;

    if (!matchCat) return false;
    if (!q) return true;
    return (
      sc.name.toLowerCase().includes(q) ||
      sc.description.toLowerCase().includes(q) ||
      sc.skill.toLowerCase().includes(q) ||
      sc.category.toLowerCase().includes(q)
    );
  });

  return `
    <div class="page-inner">
      <!-- Editor Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px; border-bottom:1px solid var(--border-2); padding-bottom:16px;">
        <div>
          <div class="badge badge-teal font-game mb-4">PLAYLIST EDITOR</div>
          <h2 style="margin:0; font-size:1.8rem;">${p.name ? esc(p.name) : 'Untitled Playlist'}</h2>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-secondary btn-md" id="btn-editor-cancel">Cancel</button>
          <button class="btn btn-primary btn-md" id="btn-editor-save">SAVE PLAYLIST</button>
        </div>
      </div>

      ${state.editorErrors.length > 0 ? `
        <div style="background:rgba(255,70,85,0.15); border:1px solid var(--red); border-radius:var(--r-md); padding:12px 16px; margin-bottom:20px; color:var(--red);">
          <strong style="display:block; margin-bottom:4px;">Cannot save playlist:</strong>
          ${state.editorErrors.map(err => `<div style="font-size:0.88rem;">&bull; ${esc(err)}</div>`).join('')}
        </div>
      ` : ''}

      <!-- Top Configuration & Live Summary -->
      <div class="card mb-20" style="padding:16px;">
        <div class="grid-3" style="align-items:flex-start; margin-bottom:16px;">
          <div>
            <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
              Playlist Name <span style="color:var(--red);">*</span>
            </label>
            <input type="text" id="editor-name-input" class="form-input" value="${esc(p.name)}" placeholder="e.g. Daily Warm-Up" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;" />
          </div>
          <div>
            <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
              Description (optional)
            </label>
            <input type="text" id="editor-desc-input" class="form-input" value="${esc(p.description || '')}" placeholder="Routine purpose or focus..." style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;" />
          </div>
          <div>
            <label class="form-label" style="font-size:0.8rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
              Default Rest Interval
            </label>
            <select id="editor-rest-select" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; font-size:0.95rem;">
              <option value="0" ${p.defaultRestIntervalSec === 0 ? 'selected' : ''}>0s (No Rest / Instant)</option>
              <option value="3" ${p.defaultRestIntervalSec === 3 ? 'selected' : ''}>3s Rest</option>
              <option value="4" ${p.defaultRestIntervalSec === 4 ? 'selected' : ''}>4s Rest (Standard)</option>
              <option value="5" ${p.defaultRestIntervalSec === 5 ? 'selected' : ''}>5s Rest</option>
              <option value="10" ${p.defaultRestIntervalSec === 10 ? 'selected' : ''}>10s Rest</option>
              <option value="15" ${p.defaultRestIntervalSec === 15 ? 'selected' : ''}>15s Rest</option>
              <option value="30" ${p.defaultRestIntervalSec === 30 ? 'selected' : ''}>30s Rest</option>
            </select>
          </div>
        </div>

        <!-- Duration KPI Badges -->
        <div style="display:flex; gap:12px; align-items:center; background:var(--panel-2); padding:10px 14px; border-radius:var(--r-sm); border:1px solid var(--border); flex-wrap:wrap;">
          <div><span class="text-dim text-xs">DRILLS:</span> <strong class="text-lime font-game" style="font-size:1.1rem;">${p.entries.length}</strong></div>
          <div style="color:var(--border-2);">&bull;</div>
          <div><span class="text-dim text-xs">ACTIVE AIM TIME:</span> <strong class="text-gold font-game" style="font-size:1.1rem;">${activeMin}m ${activeSecRem.toString().padStart(2, '0')}s</strong></div>
          <div style="color:var(--border-2);">&bull;</div>
          <div><span class="text-dim text-xs">REST INTERVALS:</span> <strong class="text-dim font-game" style="font-size:1.1rem;">${durations.restSec}s</strong></div>
          <div style="color:var(--border-2);">&bull;</div>
          <div><span class="text-dim text-xs">ESTIMATED TOTAL:</span> <strong class="text-lime font-game" style="font-size:1.1rem;">${totalMin}m ${totalSecRem.toString().padStart(2, '0')}s</strong></div>
        </div>
      </div>

      <!-- 2-Column Split: Timeline (Left) & Scenario Browser (Right) -->
      <div class="grid-2" style="align-items:start; gap:24px;">
        <!-- Left Column: Ordered Drill Timeline -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 style="font-size:1.15rem; margin:0;">DRILL TIMELINE (${p.entries.length})</h3>
            <span class="text-dim text-xs">Drag or use ▲/▼ to reorder</span>
          </div>

          <div id="playlist-timeline-container" style="display:flex; flex-direction:column; gap:10px;">
            ${p.entries.length === 0 ? `
              <div class="card" style="padding:32px 16px; text-align:center; border:1px dashed var(--border-2);">
                <div class="text-dim text-sm mb-8">No drills in this playlist yet.</div>
                <div style="font-size:0.85rem; color:var(--text-dim);">Select drills from the Available Scenarios browser on the right.</div>
              </div>
            ` : p.entries.map((entry, idx) => {
              const sc = getScenarioById(entry.scenarioId);
              const isFirst = idx === 0;
              const isLast = idx === p.entries.length - 1;

              return `
                <div class="card drill-entry-card" style="padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; border-left:3px solid var(--lime-primary);">
                  <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:180px;">
                    <div class="badge badge-gold font-game" style="font-size:0.85rem; padding:4px 8px;">#${idx + 1}</div>
                    <div>
                      <div style="font-weight:600; font-size:0.95rem;">${esc(sc?.name ?? entry.scenarioId)}</div>
                      <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
                        <span class="badge badge-lime" style="font-size:0.7rem; padding:1px 6px;">${sc?.category ?? 'drill'}</span>
                        ${!sc ? '<span class="badge badge-red" style="font-size:0.7rem; padding:1px 6px;">Missing ID</span>' : ''}
                      </div>
                    </div>
                  </div>

                  <!-- Controls for this drill -->
                  <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                    <!-- Duration selector -->
                    <div style="display:flex; align-items:center; gap:4px;">
                      <span class="text-dim text-xs">Duration:</span>
                      <select class="form-select select-entry-duration" data-entry-idx="${idx}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 6px; font-size:0.8rem;">
                        <option value="15" ${entry.durationSec === 15 ? 'selected' : ''}>15s</option>
                        <option value="30" ${entry.durationSec === 30 ? 'selected' : ''}>30s</option>
                        <option value="45" ${entry.durationSec === 45 ? 'selected' : ''}>45s</option>
                        <option value="60" ${entry.durationSec === 60 ? 'selected' : ''}>60s</option>
                        <option value="90" ${entry.durationSec === 90 ? 'selected' : ''}>90s</option>
                        <option value="120" ${entry.durationSec === 120 ? 'selected' : ''}>120s</option>
                        <option value="180" ${entry.durationSec === 180 ? 'selected' : ''}>180s</option>
                      </select>
                    </div>

                    <!-- Rest interval selector -->
                    <div style="display:flex; align-items:center; gap:4px;">
                      <span class="text-dim text-xs">Rest:</span>
                      <select class="form-select select-entry-rest" data-entry-idx="${idx}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 6px; font-size:0.8rem;">
                        <option value="default" ${entry.restIntervalSec === undefined ? 'selected' : ''}>Def (${p.defaultRestIntervalSec}s)</option>
                        <option value="0" ${entry.restIntervalSec === 0 ? 'selected' : ''}>0s</option>
                        <option value="3" ${entry.restIntervalSec === 3 ? 'selected' : ''}>3s</option>
                        <option value="5" ${entry.restIntervalSec === 5 ? 'selected' : ''}>5s</option>
                        <option value="10" ${entry.restIntervalSec === 10 ? 'selected' : ''}>10s</option>
                        <option value="15" ${entry.restIntervalSec === 15 ? 'selected' : ''}>15s</option>
                      </select>
                    </div>

                    <!-- Reorder Buttons -->
                    <div style="display:flex; gap:2px;">
                      <button class="btn btn-secondary btn-sm" data-move-up="${idx}" ${isFirst ? 'disabled style="opacity:0.3;"' : ''} title="Move Up" style="padding:4px 8px; font-size:0.75rem;">▲</button>
                      <button class="btn btn-secondary btn-sm" data-move-down="${idx}" ${isLast ? 'disabled style="opacity:0.3;"' : ''} title="Move Down" style="padding:4px 8px; font-size:0.75rem;">▼</button>
                    </div>

                    <!-- Delete Drill -->
                    <button class="btn btn-secondary btn-sm btn-remove-drill" data-remove-idx="${idx}" title="Remove Drill" style="padding:4px 8px; color:var(--red); font-weight:700;">&times;</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Right Column: Available Scenarios Browser -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
            <h3 style="font-size:1.15rem; margin:0;">AVAILABLE SCENARIOS</h3>
            <input type="text" id="editor-scen-search" class="form-input" value="${esc(state.editorSearchQuery)}" placeholder="Search scenarios..." style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:4px 10px; font-size:0.85rem; width:180px;" />
          </div>

          <!-- Category Filter Pills -->
          <div style="display:flex; gap:6px; margin-bottom:12px; overflow-x:auto; padding-bottom:4px; flex-wrap:wrap;">
            ${categories.map(cat => `
              <button type="button" class="btn btn-sm ${state.editorCategoryFilter === cat.id ? 'btn-primary' : 'btn-secondary'}" data-editor-cat="${cat.id}" style="padding:3px 8px; font-size:0.75rem;">
                ${cat.label}
              </button>
            `).join('')}
          </div>

          <!-- Scenarios List -->
          <div style="display:flex; flex-direction:column; gap:8px; max-height:560px; overflow-y:auto; padding-right:4px;">
            ${availableScenarios.length === 0 ? `
              <div class="card" style="padding:24px; text-align:center; color:var(--text-dim); font-size:0.88rem;">
                No scenarios match "${esc(state.editorSearchQuery)}".
              </div>
            ` : availableScenarios.map(sc => `
              <div class="card" style="padding:10px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="flex:1; min-width:180px;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <strong style="font-size:0.95rem;">${esc(sc.name)}</strong>
                    <span class="badge badge-teal" style="font-size:0.68rem; padding:1px 5px;">${esc(sc.category)}</span>
                  </div>
                  <div class="text-dim text-xs" style="margin-top:2px; line-height:1.3;">${esc(sc.skill)} &bull; ${sc.durationSec}s</div>
                </div>
                <button class="btn btn-primary btn-sm" data-add-scenario-id="${esc(sc.id)}" style="padding:4px 10px; font-size:0.8rem; font-family:var(--font-game); letter-spacing:0.04em;">
                  + ADD
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderPlansHTML(
  engine: Engine,
  state: PlaylistViewState,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
  if (state.editingPlaylist !== null) {
    return renderPlaylistEditorHTML(engine, state, escapeHtmlFn);
  }

  const esc = escapeHtmlFn;
  const customPlaylists = engine.store.getPlaylists();
  const showCustom = state.playlistTab === 'all' || state.playlistTab === 'custom';
  const showPresets = state.playlistTab === 'all' || state.playlistTab === 'presets';

  return `
    <div class="page-inner">
      <div class="section-header" style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
        <div>
          <h2>TRAINING PLAYLISTS & ROUTINES</h2>
          <span class="section-sub">Create, customize, and play multi-drill training sequences with automatic transitions</span>
        </div>
        <div>
          <button class="btn btn-primary btn-md" id="btn-create-playlist" style="font-family:var(--font-game); letter-spacing:0.04em;">
            + CREATE NEW PLAYLIST
          </button>
        </div>
      </div>

      <!-- Filter Tabs -->
      <div style="display:flex; gap:10px; margin-bottom:24px; border-bottom:1px solid var(--border-2); padding-bottom:12px; flex-wrap:wrap;">
        <button class="btn btn-sm ${state.playlistTab === 'all' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="all">
          ALL PLAYLISTS (${customPlaylists.length + TRAINING_ROUTINES.length})
        </button>
        <button class="btn btn-sm ${state.playlistTab === 'custom' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="custom">
          CUSTOM PLAYLISTS (${customPlaylists.length})
        </button>
        <button class="btn btn-sm ${state.playlistTab === 'presets' ? 'btn-primary' : 'btn-secondary'}" data-playlist-tab="presets">
          PRESET ROUTINES (${TRAINING_ROUTINES.length})
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:20px;" id="playlists-list-container">
        ${showCustom && customPlaylists.length > 0 ? `
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${customPlaylists.map(p => {
              const durations = calculatePlaylistDurations(p);
              const activeMin = Math.floor(durations.activeSec / 60);
              const activeSecRem = durations.activeSec % 60;
              const totalMin = Math.floor(durations.totalElapsedSec / 60);
              const totalSecRem = durations.totalElapsedSec % 60;
              const badgeLabel = `${p.entries.length} Drills &bull; ${activeMin}m ${activeSecRem.toString().padStart(2, '0')}s Active (${totalMin}m ${totalSecRem.toString().padStart(2, '0')}s Total)`;

              return `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap; border-left:3px solid var(--lime-primary);">
                  <div style="flex:1; min-width:280px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                      <span class="badge badge-lime font-game">CUSTOM PLAYLIST</span>
                      <span class="badge badge-gold font-game">${badgeLabel}</span>
                    </div>
                    <h3>${esc(p.name)}</h3>
                    ${p.description ? `<p class="text-dim text-sm mt-8">${esc(p.description)}</p>` : ''}
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
                      ${p.entries.map((entry) => {
                        const sc = getScenarioById(entry.scenarioId);
                        return `<span class="badge badge-lime">${esc(sc?.name ?? entry.scenarioId)} <span style="opacity:0.75;">(${entry.durationSec}s)</span></span>`;
                      }).join('')}
                    </div>
                  </div>
                  <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span class="text-dim text-sm">Difficulty:</span>
                      <select class="form-select select-routine-diff" data-playlist-diff="${esc(p.id)}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                        <option value="beginner">Beginner</option>
                        <option value="intermediate" selected>Intermediate</option>
                        <option value="advanced">Advanced</option>
                        <option value="pro">Pro</option>
                      </select>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                      <button class="btn btn-primary btn-md" data-start-playlist="${esc(p.id)}">START PLAYLIST</button>
                      <button class="btn btn-secondary btn-sm" data-edit-playlist="${esc(p.id)}">Edit</button>
                      <button class="btn btn-secondary btn-sm" data-dup-playlist="${esc(p.id)}">Duplicate</button>
                      ${state.playlistToDelete === p.id
                        ? `<button class="btn btn-sm" data-confirm-delete-playlist="${esc(p.id)}" style="background:var(--status-danger); color:#fff;">Confirm Delete?</button>`
                        : `<button class="btn btn-secondary btn-sm" data-del-playlist="${esc(p.id)}">Delete</button>`
                      }
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}

        ${showCustom && customPlaylists.length === 0 && state.playlistTab === 'custom' ? `
          <div class="card" style="padding:40px 20px; text-align:center;">
            <h3 style="margin-bottom:8px;">No custom playlists yet</h3>
            <p class="text-dim text-sm" style="margin-bottom:16px;">Create a personalized training sequence or duplicate one of the standard warm-up presets.</p>
            <button class="btn btn-primary btn-md" id="btn-empty-create-playlist">+ CREATE YOUR FIRST PLAYLIST</button>
          </div>
        ` : ''}

        ${showPresets ? `
          <div style="display:flex; flex-direction:column; gap:16px;">
            ${TRAINING_ROUTINES.map(r => {
              const activeMin = Math.round((r.activeDurationSec ?? (r.totalDurationSec ?? getRoutineDuration(r))) / 60);
              const totalMin = Math.floor((r.totalElapsedSec ?? r.totalDurationSec) / 60);
              const totalSec = (r.totalElapsedSec ?? r.totalDurationSec) % 60;
              const badgeLabel = `${activeMin} Min Active (${totalMin}m ${totalSec.toString().padStart(2, '0')}s Total)`;

              return `
                <div class="card" style="display:flex; justify-content:space-between; align-items:center; gap:24px; flex-wrap:wrap;">
                  <div style="flex:1; min-width:280px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                      <span class="badge badge-gold font-game">PRESET ROUTINE</span>
                      <span class="badge badge-lime font-game">${badgeLabel}</span>
                    </div>
                    <h3>${esc(r.name)}</h3>
                    <p class="text-dim text-sm mt-8">${esc(r.description)}</p>
                    <div class="text-dim text-sm mt-8" style="font-size:0.85rem;">
                      <em>Drill 1 opener: <strong>Static Flicks</strong> (stationary target calibration)</em>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:12px;">
                      ${r.scenarioIds.map((sid, idx) => {
                        const sc = getScenarioById(sid);
                        const isOpener = idx === 0 && sid === 'flick-static';
                        return `<span class="badge ${isOpener ? 'badge-lime' : 'badge-gold'}">${esc(sc?.name ?? sid)}${isOpener ? ' (Stationary)' : ''}</span>`;
                      }).join('')}
                    </div>
                  </div>
                  <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span class="text-dim text-sm">Difficulty:</span>
                      <select class="form-select select-routine-diff" data-routine-select="${r.id}" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                        <option value="beginner">Beginner</option>
                        <option value="intermediate" selected>Intermediate</option>
                        <option value="advanced">Advanced</option>
                        <option value="pro">Pro</option>
                      </select>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                      <button class="btn btn-primary btn-lg" data-plan-id="${r.id}">START ROUTINE</button>
                      <button class="btn btn-secondary btn-sm" data-dup-routine="${r.id}">Customize / Clone</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

export function attachPlansListeners(
  container: HTMLElement,
  engine: Engine,
  state: PlaylistViewState,
  callbacks: PlaylistViewCallbacks
): void {
  if (state.editingPlaylist !== null) {
    // ── Editor Listeners ──────────────────────────────────────────
    const nameInput = container.querySelector('#editor-name-input') as HTMLInputElement | null;
    const descInput = container.querySelector('#editor-desc-input') as HTMLInputElement | null;
    const restSelect = container.querySelector('#editor-rest-select') as HTMLSelectElement | null;
    const searchInput = container.querySelector('#editor-scen-search') as HTMLInputElement | null;

    nameInput?.addEventListener('input', () => {
      if (state.editingPlaylist) {
        state.editingPlaylist.name = nameInput.value;
      }
    });

    descInput?.addEventListener('input', () => {
      if (state.editingPlaylist) {
        state.editingPlaylist.description = descInput.value;
      }
    });

    restSelect?.addEventListener('change', () => {
      if (state.editingPlaylist) {
        state.editingPlaylist.defaultRestIntervalSec = parseInt(restSelect.value, 10);
        callbacks.onRenderPage();
      }
    });

    searchInput?.addEventListener('input', () => {
      state.editorSearchQuery = searchInput.value;
      callbacks.onRenderPage();
      const updatedSearch = document.getElementById('editor-scen-search') as HTMLInputElement | null;
      if (updatedSearch) {
        updatedSearch.focus();
        updatedSearch.setSelectionRange(updatedSearch.value.length, updatedSearch.value.length);
      }
    });

    // Category filter pills
    container.querySelectorAll('[data-editor-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.editorCategoryFilter = (btn as HTMLElement).dataset.editorCat || 'all';
        callbacks.onRenderPage();
      });
    });

    // Add scenario to playlist
    container.querySelectorAll('[data-add-scenario-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sid = (btn as HTMLElement).dataset.addScenarioId;
        if (!sid || !state.editingPlaylist) return;
        const sc = getScenarioById(sid);
        const newEntry: PlaylistEntry = {
          id: `entry_${Date.now()}_${state.editingPlaylist.entries.length}`,
          scenarioId: sid,
          durationSec: sc?.durationSec ?? 60,
        };
        state.editingPlaylist.entries.push(newEntry);
        state.editorErrors = [];
        callbacks.onRenderPage();
      });
    });

    // Entry duration change
    container.querySelectorAll('.select-entry-duration').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt((sel as HTMLElement).dataset.entryIdx || '-1', 10);
        if (idx >= 0 && state.editingPlaylist && state.editingPlaylist.entries[idx]) {
          state.editingPlaylist.entries[idx].durationSec = parseInt((sel as HTMLSelectElement).value, 10);
          callbacks.onRenderPage();
        }
      });
    });

    // Entry rest interval change
    container.querySelectorAll('.select-entry-rest').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt((sel as HTMLElement).dataset.entryIdx || '-1', 10);
        if (idx >= 0 && state.editingPlaylist && state.editingPlaylist.entries[idx]) {
          const val = (sel as HTMLSelectElement).value;
          state.editingPlaylist.entries[idx].restIntervalSec = val === 'default' ? undefined : parseInt(val, 10);
          callbacks.onRenderPage();
        }
      });
    });

    // Reorder ▲ Move Up
    container.querySelectorAll('[data-move-up]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.moveUp || '-1', 10);
        if (idx > 0 && state.editingPlaylist && state.editingPlaylist.entries[idx]) {
          const temp = state.editingPlaylist.entries[idx];
          state.editingPlaylist.entries[idx] = state.editingPlaylist.entries[idx - 1];
          state.editingPlaylist.entries[idx - 1] = temp;
          callbacks.onRenderPage();
        }
      });
    });

    // Reorder ▼ Move Down
    container.querySelectorAll('[data-move-down]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.moveDown || '-1', 10);
        if (
          idx >= 0 &&
          state.editingPlaylist &&
          idx < state.editingPlaylist.entries.length - 1
        ) {
          const temp = state.editingPlaylist.entries[idx];
          state.editingPlaylist.entries[idx] = state.editingPlaylist.entries[idx + 1];
          state.editingPlaylist.entries[idx + 1] = temp;
          callbacks.onRenderPage();
        }
      });
    });

    // Remove Drill
    container.querySelectorAll('[data-remove-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.removeIdx || '-1', 10);
        if (idx >= 0 && state.editingPlaylist && state.editingPlaylist.entries[idx]) {
          state.editingPlaylist.entries.splice(idx, 1);
          callbacks.onRenderPage();
        }
      });
    });

    // Cancel editor
    container.querySelector('#btn-editor-cancel')?.addEventListener('click', () => {
      state.editingPlaylist = null;
      state.editorErrors = [];
      callbacks.onRenderPage();
    });

    // Save playlist
    container.querySelector('#btn-editor-save')?.addEventListener('click', () => {
      if (!state.editingPlaylist) return;
      if (nameInput) state.editingPlaylist.name = nameInput.value.trim();
      if (descInput) state.editingPlaylist.description = descInput.value.trim();
      if (restSelect) state.editingPlaylist.defaultRestIntervalSec = parseInt(restSelect.value, 10);

      const val = validatePlaylist(state.editingPlaylist);
      if (!val.valid) {
        state.editorErrors = val.errors;
        callbacks.onRenderPage();
        return;
      }

      const res = engine.store.savePlaylist(state.editingPlaylist);
      if (!res.success) {
        state.editorErrors = res.errors || ['Failed to save playlist.'];
        callbacks.onRenderPage();
        return;
      }

      state.editingPlaylist = null;
      state.editorErrors = [];
      callbacks.onRenderPage();
      callbacks.showToast('Playlist saved successfully!', 'success');
    });

    return;
  }

  // ── Normal Plans Mode Listeners ──────────────────────────────────
  container.querySelector('#btn-create-playlist')?.addEventListener('click', () => {
    state.editingPlaylist = createDefaultPlaylist('My Warm-Up Playlist');
    state.editorErrors = [];
    callbacks.onRenderPage();
  });

  container.querySelector('#btn-empty-create-playlist')?.addEventListener('click', () => {
    state.editingPlaylist = createDefaultPlaylist('My Warm-Up Playlist');
    state.editorErrors = [];
    callbacks.onRenderPage();
  });

  container.querySelectorAll('[data-playlist-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.playlistTab = ((btn as HTMLElement).dataset.playlistTab as any) || 'all';
      callbacks.onRenderPage();
    });
  });

  // Start Custom Playlist
  container.querySelectorAll('[data-start-playlist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.startPlaylist;
      if (!id) return;
      const playlist = engine.store.getPlaylistById(id);
      const diffSelect = container.querySelector(`[data-playlist-diff="${id}"]`) as HTMLSelectElement | null;
      const difficulty = (diffSelect?.value as DifficultyId) || 'intermediate';
      if (playlist) callbacks.onStartPlaylist(playlist, difficulty);
    });
  });

  // Edit Custom Playlist
  container.querySelectorAll('[data-edit-playlist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.editPlaylist;
      if (!id) return;
      const p = engine.store.getPlaylistById(id);
      if (p) {
        state.editingPlaylist = JSON.parse(JSON.stringify(p));
        state.editorErrors = [];
        callbacks.onRenderPage();
      }
    });
  });

  // Duplicate Custom Playlist
  container.querySelectorAll('[data-dup-playlist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.dupPlaylist;
      if (!id) return;
      const cloned = engine.store.duplicatePlaylist(id);
      if (cloned) {
        callbacks.showToast(`Playlist duplicated as "${cloned.name}"`, 'success');
        callbacks.onRenderPage();
      }
    });
  });

  // Request Delete Custom Playlist
  container.querySelectorAll('[data-del-playlist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.delPlaylist;
      if (!id) return;
      state.playlistToDelete = id;
      callbacks.onRenderPage();
    });
  });

  // Confirm Delete Custom Playlist
  container.querySelectorAll('[data-confirm-delete-playlist]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.confirmDeletePlaylist;
      if (!id) return;
      engine.store.deletePlaylist(id);
      state.playlistToDelete = null;
      callbacks.showToast('Playlist deleted.', 'info');
      callbacks.onRenderPage();
    });
  });

  // Start Preset Routine
  container.querySelectorAll('[data-plan-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.planId;
      const routine = TRAINING_ROUTINES.find(r => r.id === id);
      const selectEl = container.querySelector(`[data-routine-select="${id}"]`) as HTMLSelectElement | null;
      const difficulty = (selectEl?.value as DifficultyId) || 'intermediate';
      if (routine) callbacks.onStartRoutine(routine, difficulty);
    });
  });

  // Customize / Clone Preset Routine
  container.querySelectorAll('[data-dup-routine]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.dupRoutine;
      if (!id) return;
      const cloned = engine.store.duplicatePlaylist(id);
      if (cloned) {
        state.editingPlaylist = cloned;
        state.editorErrors = [];
        callbacks.onRenderPage();
      }
    });
  });
}
