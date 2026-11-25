// =====================================================================
// views/creatorStudioView.ts — Custom Drill Creator Studio
// =====================================================================

import type { Engine } from '../engine';
import type { PageId, ScenarioConfig, DifficultyId, WarmupLabScenarioV1 } from '../types';
import {
  createDefaultCustomScenario,
  convertCustomScenarioToConfig,
  validateCustomScenarioJSON,
} from '../scenarioConfig';
import { escapeHtml } from '../utils';

export interface CreatorStudioViewState {
  editingScenario: WarmupLabScenarioV1 | null;
  studioActiveTemplate: string;
  studioErrors: string[];
}

export interface CreatorStudioViewCallbacks {
  onLaunchPreview: (config: ScenarioConfig) => void;
  onNavigate: (page: PageId) => void;
  onRenderPage: () => void;
  showToast: (msg: string, type?: 'success' | 'info' | 'pb' | 'error') => void;
  escapeHtmlFn?: (t: string) => string;
}

export function renderCreatorStudioHTML(
  engine: Engine,
  state: CreatorStudioViewState,
  escapeHtmlFn: (t: string) => string = escapeHtml
): string {
    if (!state.editingScenario) {
      state.editingScenario = createDefaultCustomScenario(state.studioActiveTemplate || 'static_flick');
    }
    const s = state.editingScenario;
    const esc = escapeHtmlFn;
    const isExisting = Boolean(s.id && engine.store.getCustomScenario(s.id));
    const weapon = s.weapon ?? { preset: 'vandal' as const, requireCounterStrafe: false };
    const spawner = s.spawner;
    const target = s.target;
    const scoring = s.scoring ?? { baseHitScore: 100, headshotBonus: 50, missPenalty: -25, speedBonusMax: 300, counterStrafeBonus: 0 };
    const jsonStr = JSON.stringify(s, null, 2);

    return `
      <div class="page-inner">
        <!-- Studio Header -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:16px; border-bottom:1px solid var(--border-2); padding-bottom:16px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge badge-lime font-game">CREATOR STUDIO</span>
              <span class="badge badge-gold font-game" style="font-size:0.7rem;">V1 ENGINE</span>
              ${isExisting ? `<span class="badge badge-gold font-game" style="font-size:0.7rem;">v${s.metadata?.configVersion || 1}</span>` : ''}
            </div>
            <h2 style="margin:4px 0 0 0; font-size:1.8rem;">${s.name ? esc(s.name) : 'Untitled Custom Drill'}</h2>
          </div>

          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px; background:var(--panel-2); padding:4px 8px; border-radius:var(--r-sm); border:1px solid var(--border-2);">
              <span class="text-dim text-xs">Template:</span>
              <select id="studio-template-select" class="form-select" style="background:transparent; color:var(--text); border:none; padding:2px 6px; font-size:0.85rem; font-weight:600;">
                <option value="static_flick" ${state.studioActiveTemplate === 'static_flick' ? 'selected' : ''}>Static Flick (Aim Lab/KovaaK's)</option>
                <option value="tracking_smooth" ${state.studioActiveTemplate === 'tracking_smooth' ? 'selected' : ''}>Smooth Tracking (Strafe)</option>
                <option value="tactical_peek" ${state.studioActiveTemplate === 'tactical_peek' ? 'selected' : ''}>Angle Peek Duel</option>
                <option value="retaliatory_duel" ${state.studioActiveTemplate === 'retaliatory_duel' ? 'selected' : ''}>Retaliatory Bot Skirmish</option>
              </select>
              <button class="btn btn-secondary btn-sm" id="btn-studio-template-new" style="padding:2px 8px; font-size:0.75rem;">Load</button>
            </div>

            <button class="btn btn-secondary btn-sm" id="btn-studio-import" title="Import from JSON file">📂 Import</button>
            <input type="file" id="input-studio-import" accept=".json" style="display:none;" />
            <button class="btn btn-secondary btn-sm" id="btn-studio-export" title="Export as JSON file">💾 Export</button>
            <button class="btn btn-primary btn-sm" id="btn-studio-preview">⚡ Preview</button>
            ${isExisting ? `
              <button class="btn btn-primary btn-sm" id="btn-studio-save">Update Drill</button>
              <button class="btn btn-secondary btn-sm" id="btn-studio-update-reset-pb" style="border-color:var(--gold); color:var(--gold);" title="Increment version and reset Personal Best">Update & Reset PB</button>
              <button class="btn btn-secondary btn-sm" id="btn-studio-save-new" title="Fork into a new independent drill">Save as New Drill</button>
            ` : `
              <button class="btn btn-primary btn-sm" id="btn-studio-save">SAVE DRILL</button>
            `}
            <button class="btn btn-secondary btn-sm" id="btn-studio-cancel">Cancel</button>
          </div>
        </div>

        ${state.studioErrors.length > 0 ? `
          <div style="background:rgba(255,70,85,0.15); border:1px solid var(--red); border-radius:var(--r-md); padding:12px 16px; margin-bottom:20px; color:var(--red);">
            <strong style="display:block; margin-bottom:4px;">Cannot save custom drill:</strong>
            ${state.studioErrors.map(err => `<div style="font-size:0.88rem;">&bull; ${esc(err)}</div>`).join('')}
          </div>
        ` : ''}

        <!-- 2-Column Split: Form (Left) & Live Inspector (Right) -->
        <div class="grid-2" style="align-items:start; gap:24px;">
          <!-- Left Column: Visual Editor Form -->
          <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- Card 1: Identity & General Parameters -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                1. GENERAL DRILL SPECIFICATION
              </h3>
              <div class="grid-2" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Drill Name <span style="color:var(--red);">*</span>
                  </label>
                  <input type="text" id="studio-name" class="form-input" value="${esc(s.name)}" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Category
                  </label>
                  <select id="studio-cat" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="flick" ${s.category === 'flick' ? 'selected' : ''}>Clicking / Flicking</option>
                    <option value="tracking" ${s.category === 'tracking' ? 'selected' : ''}>Tracking</option>
                    <option value="tactical" ${s.category === 'tactical' ? 'selected' : ''}>Tactical</option>
                    <option value="reaction" ${s.category === 'reaction' ? 'selected' : ''}>Reaction</option>
                    <option value="precision" ${s.category === 'precision' ? 'selected' : ''}>Precision</option>
                    <option value="switching" ${s.category === 'switching' ? 'selected' : ''}>Switching</option>
                    <option value="decision" ${s.category === 'decision' ? 'selected' : ''}>Decision Making</option>
                    <option value="movement" ${s.category === 'movement' ? 'selected' : ''}>Movement</option>
                    <option value="hybrid" ${s.category === 'hybrid' ? 'selected' : ''}>Hybrid</option>
                  </select>
                </div>
              </div>

              <div style="margin-bottom:12px;">
                <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                  Description
                </label>
                <input type="text" id="studio-desc" class="form-input" value="${esc(s.description || '')}" placeholder="What mechanics does this drill train?" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
              </div>

              <div class="grid-3" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Difficulty
                  </label>
                  <select id="studio-diff" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="beginner" ${s.difficulty === 'beginner' ? 'selected' : ''}>Beginner</option>
                    <option value="intermediate" ${s.difficulty === 'intermediate' ? 'selected' : ''}>Intermediate</option>
                    <option value="advanced" ${s.difficulty === 'advanced' ? 'selected' : ''}>Advanced</option>
                    <option value="pro" ${s.difficulty === 'pro' ? 'selected' : ''}>Pro</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Duration
                  </label>
                  <select id="studio-duration" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="15" ${s.durationSec === 15 ? 'selected' : ''}>15s (Quick Sprint)</option>
                    <option value="30" ${s.durationSec === 30 ? 'selected' : ''}>30s</option>
                    <option value="45" ${s.durationSec === 45 ? 'selected' : ''}>45s</option>
                    <option value="60" ${s.durationSec === 60 ? 'selected' : ''}>60s (Standard)</option>
                    <option value="90" ${s.durationSec === 90 ? 'selected' : ''}>90s</option>
                    <option value="120" ${s.durationSec === 120 ? 'selected' : ''}>120s (Endurance)</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Weapon
                  </label>
                  <select id="studio-weapon" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="vandal" ${weapon.preset === 'vandal' ? 'selected' : ''}>Vandal (Rifle)</option>
                    <option value="phantom" ${weapon.preset === 'phantom' ? 'selected' : ''}>Phantom (Rifle)</option>
                    <option value="sheriff" ${weapon.preset === 'sheriff' ? 'selected' : ''}>Sheriff (Pistol)</option>
                    <option value="operator" ${weapon.preset === 'operator' ? 'selected' : ''}>Operator (Sniper)</option>
                  </select>
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-require-cs" ${weapon.requireCounterStrafe ? 'checked' : ''} />
                  <span>Enforce Counter-Strafing (Penalize shooting while moving)</span>
                </label>
              </div>
            </div>

            <!-- Card 2: Spawner & Target Population -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                2. SPAWNER & TARGET POPULATION
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Spawn Mode
                  </label>
                  <select id="studio-spawn-mode" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="random_area" ${spawner.mode === 'random_area' ? 'selected' : ''}>Random Area</option>
                    <option value="grid" ${spawner.mode === 'grid' ? 'selected' : ''}>Grid</option>
                    <option value="peek" ${spawner.mode === 'peek' ? 'selected' : ''}>Cover Peek</option>
                    <option value="fixed_points" ${spawner.mode === 'fixed_points' ? 'selected' : ''}>Fixed Points</option>
                    <option value="wave" ${spawner.mode === 'wave' ? 'selected' : ''}>Wave</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Count (Max Alive)
                  </label>
                  <input type="number" id="studio-max-alive" min="1" max="10" value="${spawner.maxAlive}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Respawn Delay (ms)
                  </label>
                  <input type="number" id="studio-respawn-delay" min="0" max="2000" step="50" value="${spawner.respawnDelayMs ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Lifetime (sec, 0 = infinite)
                  </label>
                  <input type="number" id="studio-target-lifetime" min="0" max="10" step="0.1" value="${spawner.targetLifetimeSec ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Spawn Area Radius (meters)
                  </label>
                  <input type="number" id="studio-spawn-radius" min="4" max="30" step="1" value="${spawner.spawnRadius ?? 10}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-respawn-on-kill" ${spawner.respawnOnKill !== false ? 'checked' : ''} />
                  <span>Instant Respawn On Kill (Keeps continuous rhythm)</span>
                </label>
              </div>
            </div>

            <!-- Card 3: Target Model & Movement Physics -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--lime-primary); border-bottom:1px solid var(--border); padding-bottom:6px;">
                3. TARGET MODEL & MOVEMENT
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Shape
                  </label>
                  <select id="studio-target-shape" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="sphere" ${target.shape === 'sphere' ? 'selected' : ''}>Sphere (Aim Lab Standard)</option>
                    <option value="humanoid" ${target.shape === 'humanoid' ? 'selected' : ''}>Humanoid (Tactical Bot)</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Target Health (HP)
                  </label>
                  <input type="number" id="studio-target-hp" min="1" max="1000" value="${target.hp ?? 100}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Size Multiplier
                  </label>
                  <input type="number" id="studio-target-size" min="0.5" max="3.0" step="0.1" value="${target.sizeMultiplier ?? 1.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-4" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Movement Pattern
                  </label>
                  <select id="studio-movement-pattern" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="static" ${target.movementPattern === 'static' ? 'selected' : ''}>Static (Stationary)</option>
                    <option value="strafe" ${target.movementPattern === 'strafe' ? 'selected' : ''}>Tactical Strafe</option>
                    <option value="jiggle" ${target.movementPattern === 'jiggle' ? 'selected' : ''}>AD Jiggle Peek</option>
                    <option value="peek" ${target.movementPattern === 'peek' ? 'selected' : ''}>Cover Peek Out/In</option>
                    <option value="wander" ${target.movementPattern === 'wander' ? 'selected' : ''}>Wander / Dynamic</option>
                    <option value="vertical" ${target.movementPattern === 'vertical' ? 'selected' : ''}>Vertical Mobility</option>
                    <option value="variable" ${target.movementPattern === 'variable' ? 'selected' : ''}>Variable Rhythm</option>
                    <option value="wideswing" ${target.movementPattern === 'wideswing' ? 'selected' : ''}>Wide Swing</option>
                  </select>
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Speed Multiplier
                  </label>
                  <input type="number" id="studio-speed-multiplier" min="0.0" max="3.0" step="0.1" value="${target.speedMultiplier ?? 0.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Fake Peek Chance
                  </label>
                  <input type="number" id="studio-fake-peek" min="0.0" max="1.0" step="0.05" value="${target.fakePeekChance ?? 0.0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Bot Personality
                  </label>
                  <select id="studio-bot-personality" class="form-select" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;">
                    <option value="" ${!target.personality ? 'selected' : ''}>Auto / Generic</option>
                    <option value="strafe_specialist" ${target.personality === 'strafe_specialist' ? 'selected' : ''}>Strafe Specialist</option>
                    <option value="tactical_peeker" ${target.personality === 'tactical_peeker' ? 'selected' : ''}>Tactical Peeker</option>
                    <option value="evasive_bot" ${target.personality === 'evasive_bot' ? 'selected' : ''}>Evasive Bot</option>
                    <option value="duelist" ${target.personality === 'duelist' ? 'selected' : ''}>Duelist</option>
                  </select>
                </div>
              </div>

              <div style="margin-top:10px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-head-level" ${target.headLevel ? 'checked' : ''} />
                  <span>Lock Targets to Valorant Crosshair Head-Level</span>
                </label>
              </div>
              <div style="margin-top:8px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="studio-multi-shot" ${target.multiShot ? 'checked' : ''} />
                  <span>Multi-Shot Target (Absorbs damage across multiple hits until HP reaches zero)</span>
                </label>
              </div>
            </div>

            <!-- Card 4: Retaliatory Enemy Threat (Bot Defense) -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--red); border-bottom:1px solid var(--border); padding-bottom:6px;">
                4. RETALIATORY BOT & THREAT MECHANICS
              </h3>
              <div style="margin-bottom:12px;">
                <label style="display:flex; align-items:center; gap:8px; font-size:0.9rem; cursor:pointer; font-weight:600;">
                  <input type="checkbox" id="studio-retaliation" ${target.retaliatory ? 'checked' : ''} />
                  <span>Enable Retaliatory Threat (Enemy bots fire back if not eliminated quickly)</span>
                </label>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Bot Reaction Time (ms)
                  </label>
                  <input type="number" id="studio-retaliate-delay" min="300" max="3000" step="50" value="${target.retaliateDelayMs ?? 800}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Firing Penalty (points deducted)
                  </label>
                  <input type="number" id="studio-retaliate-penalty" min="0" max="500" step="25" value="${target.retaliationPenalty ?? 200}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>
            </div>

            <!-- Card 5: Scoring Calibration -->
            <div class="card" style="padding:16px;">
              <h3 style="font-size:1.05rem; margin-top:0; margin-bottom:12px; color:var(--gold); border-bottom:1px solid var(--border); padding-bottom:6px;">
                5. SCORING CALIBRATION
              </h3>
              <div class="grid-3" style="gap:12px; margin-bottom:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Base Hit Score
                  </label>
                  <input type="number" id="studio-score-hit" value="${scoring.baseHitScore ?? 100}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Headshot Bonus
                  </label>
                  <input type="number" id="studio-score-hs" value="${scoring.headshotBonus ?? 50}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Miss Penalty
                  </label>
                  <input type="number" id="studio-score-miss" value="${scoring.missPenalty ?? -25}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>

              <div class="grid-2" style="gap:12px;">
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Speed Bonus Max
                  </label>
                  <input type="number" id="studio-score-speed-max" value="${scoring.speedBonusMax ?? 300}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
                <div>
                  <label class="form-label" style="font-size:0.78rem; color:var(--text-dim); text-transform:uppercase; display:block; margin-bottom:4px;">
                    Counter-Strafe Bonus
                  </label>
                  <input type="number" id="studio-score-cs" value="${scoring.counterStrafeBonus ?? 0}" class="form-input" style="width:100%; background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.9rem;" />
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Live Inspector & Portable JSON -->
          <div style="position:sticky; top:20px; display:flex; flex-direction:column; gap:16px;">
            <div class="card" style="padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <h3 style="font-size:1.05rem; margin:0;">LIVE DRILL INSPECTOR</h3>
                <span class="badge ${state.studioErrors.length === 0 ? 'badge-lime' : 'badge-red'}" id="studio-inspector-status">
                  ${state.studioErrors.length === 0 ? '✓ VALID SPEC' : '⚠️ ISSUES DETECTED'}
                </span>
              </div>

              <!-- Quick action buttons -->
              <button class="btn btn-primary btn-md w-full mb-10" id="btn-studio-inspector-preview">
                ⚡ TEST PLAY IN ARENA
              </button>
              <button class="btn btn-primary btn-md w-full mb-10" id="btn-studio-inspector-save">
                💾 ${isExisting ? 'UPDATE DRILL' : 'SAVE TO MY DRILLS'}
              </button>
              ${isExisting ? `
                <button class="btn btn-secondary btn-md w-full mb-10" id="btn-studio-inspector-update-reset-pb" style="border-color:var(--gold); color:var(--gold); font-size:0.85rem; font-weight:600;">
                  ⚡ UPDATE & RESET PB
                </button>
                <button class="btn btn-secondary btn-md w-full mb-16" id="btn-studio-inspector-save-new" style="font-size:0.85rem; font-weight:600;">
                  📑 SAVE AS NEW DRILL
                </button>
              ` : `
                <div class="mb-16"></div>
              `}

              <!-- Live KPI Badges -->
              <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:16px; background:var(--panel-2); padding:10px; border-radius:var(--r-sm); border:1px solid var(--border-2); font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Population:</span>
                  <strong id="studio-kpi-targets">${spawner.maxAlive} targets (${target.movementPattern})</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Weapon:</span>
                  <strong id="studio-kpi-weapon">${weapon.preset.toUpperCase()} ${weapon.requireCounterStrafe ? '(CS Enforced)' : ''}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Threat:</span>
                  <strong id="studio-kpi-threat" style="${target.retaliatory ? 'color:var(--status-danger);' : ''}">${target.retaliatory ? `⚠️ Return-Fire (${target.retaliateDelayMs}ms)` : 'Passive'}</strong>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span class="text-dim">Duration:</span>
                  <strong id="studio-kpi-duration">${s.durationSec}s</strong>
                </div>
              </div>

              <!-- JSON schema viewer -->
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span class="text-dim text-xs font-game">WARMUPLAB SCENARIO V1 JSON</span>
                <button class="btn btn-secondary btn-sm" id="btn-copy-json" style="padding:2px 8px; font-size:0.75rem;">📋 Copy</button>
              </div>
              <pre id="studio-json-preview" style="background:var(--surface-base); border:1px solid var(--border-medium); padding:12px; border-radius:var(--r-sm); font-size:0.78rem; font-family:var(--font-mono); max-height:440px; overflow-y:auto; color:var(--lime-primary); white-space:pre-wrap; word-break:break-all;">${esc(jsonStr)}</pre>
            </div>
          </div>
        </div>
      </div>
    `;
  }


export function updateStudioLiveInspector(
  container: HTMLElement,
  state: CreatorStudioViewState
): void {
    if (!state.editingScenario) return;
    const s = state.editingScenario;
    const weapon = s.weapon ?? { preset: 'vandal' as const, requireCounterStrafe: false };
    const jsonStr = JSON.stringify(s, null, 2);

    const pre = container.querySelector('#studio-json-preview');
    if (pre) pre.textContent = jsonStr;

    const val = validateCustomScenarioJSON(s);
    const statusPill = container.querySelector('#studio-inspector-status');
    if (statusPill) {
      statusPill.className = `badge ${val.valid ? 'badge-teal' : 'badge-red'}`;
      statusPill.textContent = val.valid ? '✓ VALID SPEC' : '⚠️ ISSUES DETECTED';
    }

    const kpiTargets = container.querySelector('#studio-kpi-targets');
    if (kpiTargets) {
      const personalityLabel = s.target.personality ? ` · ${s.target.personality.replace('_', ' ')}` : '';
      kpiTargets.textContent = `${s.spawner.maxAlive} targets (${s.target.movementPattern}${personalityLabel})`;
    }

    const kpiWeapon = container.querySelector('#studio-kpi-weapon');
    if (kpiWeapon) kpiWeapon.textContent = `${weapon.preset.toUpperCase()} ${weapon.requireCounterStrafe ? '(CS Enforced)' : ''}`;

    const kpiThreat = container.querySelector('#studio-kpi-threat') as HTMLElement | null;
    if (kpiThreat) {
      kpiThreat.textContent = s.target.retaliatory ? `⚠️ Return-Fire (${s.target.retaliateDelayMs}ms)` : 'Passive';
      kpiThreat.style.color = s.target.retaliatory ? 'var(--red)' : '';
    }

    const kpiDuration = container.querySelector('#studio-kpi-duration');
    if (kpiDuration) kpiDuration.textContent = `${s.durationSec}s`;
  }


export function attachCreatorStudioListeners(
  container: HTMLElement,
  engine: Engine,
  state: CreatorStudioViewState,
  callbacks: CreatorStudioViewCallbacks
): void {
    const syncFromForm = (): void => {
      if (!state.editingScenario) return;

      const name = (container.querySelector('#studio-name') as HTMLInputElement)?.value.trim() ?? '';
      const desc = (container.querySelector('#studio-desc') as HTMLInputElement)?.value.trim() || '';
      const cat = (container.querySelector('#studio-cat') as HTMLSelectElement)?.value || 'flick';
      const diff = (container.querySelector('#studio-diff') as HTMLSelectElement)?.value as DifficultyId || 'intermediate';
      const dur = parseInt((container.querySelector('#studio-duration') as HTMLSelectElement)?.value || '60', 10);
      const weaponPreset = (container.querySelector('#studio-weapon') as HTMLSelectElement)?.value as any || 'vandal';
      const requireCS = (container.querySelector('#studio-require-cs') as HTMLInputElement)?.checked ?? false;

      const spawnMode = (container.querySelector('#studio-spawn-mode') as HTMLSelectElement)?.value as any || 'random_area';
      const maxAlive = parseInt((container.querySelector('#studio-max-alive') as HTMLInputElement)?.value || '1', 10);
      const respawnOnKill = (container.querySelector('#studio-respawn-on-kill') as HTMLInputElement)?.checked ?? true;
      const respawnDelay = parseInt((container.querySelector('#studio-respawn-delay') as HTMLInputElement)?.value || '0', 10);
      const targetLifetime = parseFloat((container.querySelector('#studio-target-lifetime') as HTMLInputElement)?.value || '0');
      const spawnRadius = parseFloat((container.querySelector('#studio-spawn-radius') as HTMLInputElement)?.value || '10');

      const targetShape = (container.querySelector('#studio-target-shape') as HTMLSelectElement)?.value as any || 'sphere';
      const targetHp = parseInt((container.querySelector('#studio-target-hp') as HTMLInputElement)?.value || '100', 10);
      const multiShot = (container.querySelector('#studio-multi-shot') as HTMLInputElement)?.checked ?? false;
      const targetSize = parseFloat((container.querySelector('#studio-target-size') as HTMLInputElement)?.value || '1.0');
      const movePattern = (container.querySelector('#studio-movement-pattern') as HTMLSelectElement)?.value as any || 'static';
      const speedMult = parseFloat((container.querySelector('#studio-speed-multiplier') as HTMLInputElement)?.value || '0.0');
      const headLevel = (container.querySelector('#studio-head-level') as HTMLInputElement)?.checked ?? false;
      const fakePeek = parseFloat((container.querySelector('#studio-fake-peek') as HTMLInputElement)?.value || '0.0');
      const botPersonality = ((container.querySelector('#studio-bot-personality') as HTMLSelectElement)?.value || undefined) as any;

      const retaliatory = (container.querySelector('#studio-retaliation') as HTMLInputElement)?.checked ?? false;
      const retaliateDelay = parseInt((container.querySelector('#studio-retaliate-delay') as HTMLInputElement)?.value || '800', 10);
      const retaliatePenalty = parseInt((container.querySelector('#studio-retaliate-penalty') as HTMLInputElement)?.value || '200', 10);

      const baseHit = parseInt((container.querySelector('#studio-score-hit') as HTMLInputElement)?.value || '100', 10);
      const hsBonus = parseInt((container.querySelector('#studio-score-hs') as HTMLInputElement)?.value || '50', 10);
      const missPenalty = parseInt((container.querySelector('#studio-score-miss') as HTMLInputElement)?.value || '-25', 10);
      const speedMax = parseInt((container.querySelector('#studio-score-speed-max') as HTMLInputElement)?.value || '300', 10);
      const csBonus = parseInt((container.querySelector('#studio-score-cs') as HTMLInputElement)?.value || '0', 10);

      state.editingScenario = {
        ...state.editingScenario,
        name,
        description: desc,
        category: cat as any,
        difficulty: diff,
        durationSec: dur,
        weapon: {
          ...state.editingScenario.weapon,
          preset: weaponPreset,
          requireCounterStrafe: requireCS,
        },
        spawner: {
          ...state.editingScenario.spawner,
          mode: spawnMode,
          maxAlive,
          initialTargetCount: maxAlive,
          respawnOnKill,
          respawnDelayMs: respawnDelay,
          targetLifetimeSec: targetLifetime > 0 ? targetLifetime : undefined,
          spawnRadius,
        },
        target: {
          ...state.editingScenario.target,
          shape: targetShape,
          hp: targetHp,
          multiShot,
          sizeMultiplier: targetSize,
          movementPattern: movePattern,
          speedMultiplier: speedMult,
          headLevel,
          fakePeekChance: fakePeek > 0 ? fakePeek : undefined,
          personality: botPersonality,
          retaliatory,
          retaliateDelayMs: retaliateDelay,
          retaliationPenalty: retaliatePenalty,
        },
        scoring: {
          ...state.editingScenario.scoring,
          baseHitScore: baseHit,
          headshotBonus: hsBonus,
          missPenalty,
          speedBonusMax: speedMax,
          counterStrafeBonus: csBonus,
        },
        metadata: {
          ...state.editingScenario.metadata,
          updatedAt: Date.now(),
        },
      };

      updateStudioLiveInspector(container, state);
    };

    // Attach input listeners across all controls
    container.querySelectorAll('input, select').forEach(el => {
      if (el.id === 'studio-template-select' || el.id === 'input-studio-import') return;
      el.addEventListener('input', syncFromForm);
      el.addEventListener('change', syncFromForm);
    });

    // Template Selector + Load Button
    container.querySelector('#btn-studio-template-new')?.addEventListener('click', () => {
      const select = container.querySelector('#studio-template-select') as HTMLSelectElement | null;
      const tmpl = select?.value || 'static_flick';
      state.studioActiveTemplate = tmpl;
      state.editingScenario = createDefaultCustomScenario(tmpl);
      state.studioErrors = [];
      callbacks.onRenderPage();
      callbacks.showToast(`Loaded ${tmpl.replace('_', ' ')} template`, 'info');
    });

    // Import JSON File
    const importInput = container.querySelector('#input-studio-import') as HTMLInputElement | null;
    container.querySelector('#btn-studio-import')?.addEventListener('click', () => {
      importInput?.click();
    });

    importInput?.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          const val = validateCustomScenarioJSON(parsed);
          if (!val.valid) {
            state.studioErrors = val.errors;
            callbacks.showToast('Invalid drill JSON specification', 'error');
            callbacks.onRenderPage();
            return;
          }
          state.editingScenario = parsed as WarmupLabScenarioV1;
          state.studioErrors = [];
          callbacks.showToast(`Imported "${state.editingScenario.name}" successfully!`, 'success');
          callbacks.onRenderPage();
        } catch (err: any) {
          state.studioErrors = [`Failed to parse JSON file: ${err.message}`];
          callbacks.showToast('JSON parse error', 'error');
          callbacks.onRenderPage();
        }
      };
      reader.readAsText(file);
    });

    // Export JSON File
    container.querySelector('#btn-studio-export')?.addEventListener('click', () => {
      syncFromForm();
      if (!state.editingScenario) return;
      const blob = new Blob([JSON.stringify(state.editingScenario, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.editingScenario.id}.warmuplab.json`;
      a.click();
      URL.revokeObjectURL(url);
      callbacks.showToast(`Exported "${state.editingScenario.name}"`, 'success');
    });

    // Copy JSON to clipboard
    container.querySelector('#btn-copy-json')?.addEventListener('click', () => {
      syncFromForm();
      if (!state.editingScenario) return;
      navigator.clipboard?.writeText(JSON.stringify(state.editingScenario, null, 2));
      callbacks.showToast('JSON copied to clipboard!', 'info');
    });

    // Preview in Arena (from header or inspector card)
    const handlePreview = () => {
      syncFromForm();
      if (!state.editingScenario) return;
      const val = validateCustomScenarioJSON(state.editingScenario);
      if (!val.valid) {
        state.studioErrors = val.errors;
        callbacks.onRenderPage();
        return;
      }
      const config = convertCustomScenarioToConfig(state.editingScenario);
      callbacks.onLaunchPreview(config);
    };

    container.querySelector('#btn-studio-preview')?.addEventListener('click', handlePreview);
    container.querySelector('#btn-studio-inspector-preview')?.addEventListener('click', handlePreview);

    // Save Drill (from header or inspector card)
    const handleSave = async () => {
      syncFromForm();
      if (!state.editingScenario) return;
      const val = validateCustomScenarioJSON(state.editingScenario);
      if (!val.valid) {
        state.studioErrors = val.errors;
        callbacks.onRenderPage();
        return;
      }
      await engine.store.saveCustomScenario(state.editingScenario);
      callbacks.showToast(`Custom drill "${state.editingScenario.name}" saved!`, 'success');
      state.editingScenario = null;
      callbacks.onNavigate('scenarios');
    };

    container.querySelector('#btn-studio-save')?.addEventListener('click', handleSave);
    container.querySelector('#btn-studio-inspector-save')?.addEventListener('click', handleSave);

    // Save as New Drill (Fork into independent custom drill)
    const handleSaveAsNew = async () => {
      syncFromForm();
      if (!state.editingScenario) return;
      const val = validateCustomScenarioJSON(state.editingScenario);
      if (!val.valid) {
        state.studioErrors = val.errors;
        callbacks.onRenderPage();
        return;
      }
      const res = engine.store.saveAsNewCustomScenario(state.editingScenario);
      if (!res.success) {
        state.studioErrors = res.errors || ['Failed to fork scenario'];
        callbacks.onRenderPage();
        return;
      }
      callbacks.showToast(`Saved as new drill "${res.scenario?.name}"!`, 'success');
      state.editingScenario = null;
      callbacks.onNavigate('scenarios');
    };

    container.querySelector('#btn-studio-save-new')?.addEventListener('click', handleSaveAsNew);
    container.querySelector('#btn-studio-inspector-save-new')?.addEventListener('click', handleSaveAsNew);

    // Update & Reset PB (Increment configVersion & clear PB)
    const handleUpdateResetPB = async () => {
      syncFromForm();
      if (!state.editingScenario) return;
      const val = validateCustomScenarioJSON(state.editingScenario);
      if (!val.valid) {
        state.studioErrors = val.errors;
        callbacks.onRenderPage();
        return;
      }

      const curVersion = state.editingScenario.metadata?.configVersion || 1;
      const nextVersion = curVersion + 1;
      const drillName = state.editingScenario.name || 'Custom Drill';

      const confirmed = window.confirm(
        `Update "${drillName}" and Reset Personal Best?\n\n` +
        `• Version will increment from v${curVersion} to v${nextVersion}.\n` +
        `• Current PB for this scenario will be reset.\n` +
        `• Historical sessions remain preserved in your log.\n` +
        `• Unrelated custom drills and built-in PBs are not affected.\n\n` +
        `Proceed with update and PB reset?`
      );

      if (!confirmed) return;

      await engine.store.saveCustomScenario(state.editingScenario, {
        resetPB: true,
        incrementVersion: true,
      });

      callbacks.showToast(`Updated "${drillName}" to v${nextVersion} and reset PB!`, 'pb');
      state.editingScenario = null;
      callbacks.onNavigate('scenarios');
    };

    container.querySelector('#btn-studio-update-reset-pb')?.addEventListener('click', handleUpdateResetPB);
    container.querySelector('#btn-studio-inspector-update-reset-pb')?.addEventListener('click', handleUpdateResetPB);

    // Cancel Button
    container.querySelector('#btn-studio-cancel')?.addEventListener('click', () => {
      state.editingScenario = null;
      callbacks.onNavigate('scenarios');
    });
  }

