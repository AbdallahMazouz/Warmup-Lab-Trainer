// =====================================================================
// views/settingsView.ts — Settings page HTML template and event wiring
// =====================================================================

import type { Engine } from '../engine';
import type { PageId, Settings, SoundProfileId } from '../types';
import { getAllSoundProfiles, getSoundProfile } from '../soundProfiles';
import { escapeHtml } from '../utils';

export interface SettingsViewCallbacks {
  showToast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  renderPage: (page: PageId) => void;
  applyCrosshairStyles: (s: Settings) => void;
  fpsEl: HTMLElement;
}

export function renderSettingsHTML(engine: Engine, escapeHtmlFn: (t: string) => string = escapeHtml): string {
  const s = engine.settings.getAll();
  const profiles = getAllSoundProfiles();
  const activeProfile = getSoundProfile(s.soundProfile);
  const isAudioReady = engine.audio.isReady();

  return `
    <div class="page-inner" style="max-width:960px;">
      <div class="section-header">
        <h2>SETTINGS & CALIBRATION</h2>
        <span class="section-sub">Configure mouse look, field of view, audio profiles, and visual ergonomics</span>
      </div>

      <!-- Mouse Settings -->
      <div class="card settings-section">
        <div class="settings-section-title">MOUSE & SENSITIVITY</div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Sensitivity</div>
            <div class="settings-row-desc">Calibrated for Valorant (e.g. 0.35 at 800 DPI &approx; 0.12 scale)</div>
          </div>
          <div class="settings-row-control">
            <div class="range-row">
              <input type="range" id="set-sens" min="0.01" max="1.0" step="0.01" value="${s.sensitivity}">
              <span class="range-value" id="val-sens">${s.sensitivity.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Invert Y Axis</div>
            <div class="settings-row-desc">Reverse vertical pitch aiming direction</div>
          </div>
          <div class="settings-row-control">
            <label class="toggle">
              <input type="checkbox" id="set-invert-y" ${s.invertY ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Visuals & FOV -->
      <div class="card settings-section">
        <div class="settings-section-title">FIELD OF VIEW & VISUALS</div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Field of View (Horizontal)</div>
            <div class="settings-row-desc">Valorant standard is 103&deg; horizontal FOV</div>
          </div>
          <div class="settings-row-control">
            <div class="range-row">
              <input type="range" id="set-fov" min="70" max="120" step="1" value="${s.fov}">
              <span class="range-value" id="val-fov">${s.fov}&deg;</span>
            </div>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Flash Intensity</div>
            <div class="settings-row-desc">Controls max brightness and whiteout during flash training</div>
          </div>
          <div class="settings-row-control">
            <div class="range-row">
              <input type="range" id="set-flash" min="0.1" max="1.0" step="0.05" value="${s.flashIntensity}">
              <span class="range-value" id="val-flash">${Math.round(s.flashIntensity * 100)}%</span>
            </div>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Show Real-Time FPS</div>
            <div class="settings-row-desc">Display frame rate counter on HUD</div>
          </div>
          <div class="settings-row-control">
            <label class="toggle">
              <input type="checkbox" id="set-show-fps" ${s.showFps ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Crosshair Settings with Live Preview -->
      <div class="card settings-section">
        <div class="settings-section-title">CROSSHAIR ERGONOMICS</div>

        <div style="display:flex; gap:32px; align-items:flex-start; flex-wrap:wrap;">
          <div style="flex:1; min-width:280px;">
            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Color Preset</div>
              </div>
              <div class="settings-row-control" style="display:flex; gap:6px;">
                <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#00ff78" style="color:#00ff78;">Green</button>
                <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#00ffff" style="color:#00ffff;">Cyan</button>
                <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ffff00" style="color:#ffff00;">Yellow</button>
                <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ffffff" style="color:#ffffff;">White</button>
                <button class="btn btn-sm btn-secondary ch-color-btn" data-color="#ff4655" style="color:#ff4655;">Red</button>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Crosshair Size (Length)</div>
              </div>
              <div class="settings-row-control">
                <div class="range-row">
                  <input type="range" id="set-ch-size" min="3" max="24" step="1" value="${s.crosshairSize}">
                  <span class="range-value" id="val-ch-size">${s.crosshairSize}px</span>
                </div>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Inner Offset / Gap</div>
              </div>
              <div class="settings-row-control">
                <div class="range-row">
                  <input type="range" id="set-ch-gap" min="1" max="16" step="1" value="${s.crosshairGap}">
                  <span class="range-value" id="val-ch-gap">${s.crosshairGap}px</span>
                </div>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Line Thickness</div>
              </div>
              <div class="settings-row-control">
                <div class="range-row">
                  <input type="range" id="set-ch-thick" min="1" max="6" step="1" value="${s.crosshairThickness}">
                  <span class="range-value" id="val-ch-thick">${s.crosshairThickness}px</span>
                </div>
              </div>
            </div>

            <div class="settings-row">
              <div class="settings-row-info">
                <div class="settings-row-label">Center Dot</div>
              </div>
              <div class="settings-row-control">
                <label class="toggle">
                  <input type="checkbox" id="set-ch-dot" ${s.crosshairDot ? 'checked' : ''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- Interactive Preview Box -->
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
            <div class="ch-preview-box" id="ch-preview">
              <div class="crosshair" id="ch-preview-inner">
                <div class="crosshair-line ch-h ch-left"></div>
                <div class="crosshair-line ch-h ch-right"></div>
                <div class="crosshair-line ch-v ch-top"></div>
                <div class="crosshair-line ch-v ch-bottom"></div>
                <div class="ch-dot" id="ch-preview-dot" style="display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); border-radius:50%;"></div>
              </div>
            </div>
            <span class="text-dim text-sm">Live Preview</span>
          </div>
        </div>
      </div>

      <!-- Audio & Vandal Sound Profiles -->
      <div class="card settings-section">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
          <div>
            <div class="settings-section-title" style="margin-bottom:4px;">VANDAL SOUND PROFILES & KILL-STREAK AUDIO</div>
            <span class="text-dim text-sm">Original procedural acoustic synthesis, custom weapon sound profiles, and kill-streak progression</span>
          </div>
          <div id="audio-status-badge">
            ${isAudioReady
              ? '<span class="badge badge-green">Web Audio: Active / Ready</span>'
              : '<span class="badge badge-gold">Web Audio: Click Preview or Unmute to Activate</span>'}
          </div>
        </div>

        <!-- Sound Profile Selection -->
        <div class="settings-row" style="align-items:flex-start;">
          <div class="settings-row-info">
            <div class="settings-row-label">Vandal Sound Profile</div>
            <div class="settings-row-desc">Select an original procedural acoustic profile for firing, hits, and eliminations</div>
          </div>
          <div class="settings-row-control" style="max-width:320px; width:100%;">
            <select id="set-sound-profile" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:8px 12px; width:100%; font-size:0.9rem;">
              ${profiles.map(p => `
                <option value="${p.id}" ${s.soundProfile === p.id ? 'selected' : ''}>${escapeHtmlFn(p.name)}</option>
              `).join('')}
            </select>
          </div>
        </div>

        <!-- Profile Details Card -->
        <div id="audio-profile-card" style="background:var(--panel-2); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:16px; margin:16px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
            <span class="badge badge-lime font-game" id="profile-badge">${activeProfile.badgeLabel}</span>
            <span class="text-dim text-xs font-mono" id="profile-id-tag">ID: ${activeProfile.id}</span>
          </div>
          <div style="font-weight:700; font-size:1.05rem; color:var(--text); margin-bottom:4px;" id="profile-title">${escapeHtmlFn(activeProfile.name)}</div>
          <p style="margin:0 0 8px; font-size:0.88rem; color:var(--text-dim); line-height:1.5;" id="profile-desc">${escapeHtmlFn(activeProfile.shortDescription)}</p>
          <div style="font-size:0.78rem; color:var(--text-dim); border-top:1px dashed var(--border); padding-top:8px; font-style:italic;" id="profile-disclaimer">
            ${escapeHtmlFn(activeProfile.designNotes)}
          </div>
        </div>

        <!-- Sound Previews (Non-mutating) -->
        <div class="settings-row" style="align-items:flex-start;">
          <div class="settings-row-info">
            <div class="settings-row-label">Acoustic Previews</div>
            <div class="settings-row-desc">Test weapon audio without starting a drill or modifying live kill streaks</div>
          </div>
          <div class="settings-row-control" style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-fire">🔊 PREVIEW FIRING</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-hit">🎯 PREVIEW BODY HIT</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-prev-head">💥 PREVIEW HEADSHOT</button>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              <select id="select-prev-stage" class="form-select" style="background:var(--panel-2); color:var(--text); border:1px solid var(--border-2); border-radius:var(--r-sm); padding:6px 10px; font-size:0.85rem;">
                <option value="1">Stage 1 (1 Kill)</option>
                <option value="2">Stage 2 (2 Kills)</option>
                <option value="3">Stage 3 (3 Kills)</option>
                <option value="4">Stage 4 (4 Kills)</option>
                <option value="5" selected>Stage 5+ (Ace / 5+ Kills)</option>
              </select>
              <button type="button" class="btn btn-primary btn-sm" id="btn-prev-kill">⭐ PREVIEW KILL STREAK</button>
            </div>
          </div>
        </div>

        <!-- Master Volume Slider -->
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Master Volume</div>
            <div class="settings-row-desc">Master output gain across all audio channels</div>
          </div>
          <div class="settings-row-control">
            <div class="range-row">
              <input type="range" id="set-vol" min="0" max="1.0" step="0.05" value="${s.volume}">
              <span class="range-value" id="val-vol">${Math.round(s.volume * 100)}%</span>
            </div>
          </div>
        </div>

        <!-- SFX Volume Slider -->
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Sound Effects (SFX) Volume</div>
            <div class="settings-row-desc">Volume of gunshots, hit indicators, and kill-streak cues</div>
          </div>
          <div class="settings-row-control">
            <div class="range-row">
              <input type="range" id="set-sfx-vol" min="0" max="1.0" step="0.05" value="${s.sfxVolume ?? 0.8}">
              <span class="range-value" id="val-sfx-vol">${Math.round((s.sfxVolume ?? 0.8) * 100)}%</span>
            </div>
          </div>
        </div>

        <!-- Mute Toggle -->
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Mute All Audio</div>
            <div class="settings-row-desc">Instantly silence all weapon firing, hit sounds, and cues</div>
          </div>
          <div class="settings-row-control">
            <label class="toggle">
              <input type="checkbox" id="set-audio-mute" ${s.audioMuted ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Kill-Streak Progression Audio Toggle -->
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Kill-Streak Audio Progression</div>
            <div class="settings-row-desc">Play escalating harmonic chords as consecutive kills climb from Stage 1 to 5+</div>
          </div>
          <div class="settings-row-control">
            <label class="toggle">
              <input type="checkbox" id="set-streak-audio" ${s.killStreakAudioEnabled !== false ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Restore Audio Defaults Action -->
        <div style="display:flex; justify-content:flex-end; margin-top:16px;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-reset-audio">RESTORE AUDIO DEFAULTS</button>
        </div>
      </div>

      <!-- Storage & Local-First Database (Phase 3) -->
      <div class="card settings-section">
        <div class="settings-section-title">STORAGE & BACKUP (LOCAL-FIRST)</div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Database Engine</div>
            <div class="settings-row-desc">WarmupLab uses local IndexedDB (Dexie.js) with zero cloud dependencies</div>
          </div>
          <div class="settings-row-control">
            <span class="badge ${engine.store.isFallback() ? 'badge-yellow' : 'badge-lime'} font-game" id="db-status-badge">
              ${engine.store.isFallback() ? 'LOCALSTORAGE FALLBACK' : 'INDEXEDDB (ACTIVE)'}
            </span>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-label">Full Workspace Backup</div>
            <div class="settings-row-desc">Export or restore all sessions, personal bests, routine stats, and custom playlists</div>
          </div>
          <div class="settings-row-control" style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-export-backup">💾 EXPORT FULL BACKUP (.JSON)</button>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-import-backup">📂 RESTORE BACKUP</button>
            <input type="file" id="input-import-backup" accept=".json" style="display:none;">
          </div>
        </div>
      </div>

      <!-- Reset Button -->
      <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:24px;">
        <button class="btn btn-secondary" id="btn-reset-settings">RESET ALL SETTINGS TO DEFAULTS</button>
      </div>
    </div>
  `;
}

export function attachSettingsListeners(
  container: HTMLElement,
  engine: Engine,
  callbacks: SettingsViewCallbacks
): void {
  const bindRange = (
    sliderId: string,
    labelId: string,
    suffix: string,
    setter: (v: number) => void
  ) => {
    const slider = container.querySelector(`#${sliderId}`) as HTMLInputElement;
    const label = container.querySelector(`#${labelId}`);
    slider?.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      if (label) label.textContent = `${val}${suffix}`;
      setter(val);
      engine.applySettings();
    });
  };

  bindRange('set-sens', 'val-sens', '', v => engine.settings.set('sensitivity', v));
  bindRange('set-fov', 'val-fov', '°', v => engine.settings.set('fov', v));
  bindRange('set-flash', 'val-flash', '%', v => engine.settings.set('flashIntensity', v));
  bindRange('set-vol', 'val-vol', '%', v => engine.settings.set('volume', v));
  bindRange('set-sfx-vol', 'val-sfx-vol', '%', v => engine.settings.set('sfxVolume', v));

  // Sound Profile Selector
  const profileSelect = container.querySelector('#set-sound-profile') as HTMLSelectElement | null;
  profileSelect?.addEventListener('change', () => {
    const pid = profileSelect.value as SoundProfileId;
    engine.settings.set('soundProfile', pid);
    engine.applySettings();

    const p = getSoundProfile(pid);
    const badge = container.querySelector('#profile-badge');
    const idTag = container.querySelector('#profile-id-tag');
    const title = container.querySelector('#profile-title');
    const desc = container.querySelector('#profile-desc');
    const disc = container.querySelector('#profile-disclaimer');

    if (badge) badge.textContent = p.badgeLabel;
    if (idTag) idTag.textContent = `ID: ${p.id}`;
    if (title) title.textContent = p.name;
    if (desc) desc.textContent = p.shortDescription;
    if (disc) disc.textContent = p.designNotes;
  });

  // Sound Previews (safe, non-mutating)
  const updateAudioStatusBadge = () => {
    const badgeContainer = container.querySelector('#audio-status-badge');
    if (badgeContainer) {
      badgeContainer.innerHTML = '<span class="badge badge-green">Web Audio: Active / Ready</span>';
    }
  };

  container.querySelector('#btn-prev-fire')?.addEventListener('click', () => {
    const pid = (profileSelect?.value as SoundProfileId) || engine.settings.get('soundProfile');
    engine.audio.previewGunshot(pid);
    updateAudioStatusBadge();
  });

  container.querySelector('#btn-prev-hit')?.addEventListener('click', () => {
    const pid = (profileSelect?.value as SoundProfileId) || engine.settings.get('soundProfile');
    engine.audio.previewHit(pid, false);
    updateAudioStatusBadge();
  });

  container.querySelector('#btn-prev-head')?.addEventListener('click', () => {
    const pid = (profileSelect?.value as SoundProfileId) || engine.settings.get('soundProfile');
    engine.audio.previewHit(pid, true);
    updateAudioStatusBadge();
  });

  container.querySelector('#btn-prev-kill')?.addEventListener('click', () => {
    const pid = (profileSelect?.value as SoundProfileId) || engine.settings.get('soundProfile');
    const stageSelect = container.querySelector('#select-prev-stage') as HTMLSelectElement | null;
    const stage = stageSelect ? parseInt(stageSelect.value, 10) : 1;
    engine.audio.previewKill(pid, stage);
    updateAudioStatusBadge();
  });

  // Audio checkboxes
  container.querySelector('#set-audio-mute')?.addEventListener('change', e => {
    const checked = (e.target as HTMLInputElement).checked;
    engine.settings.set('audioMuted', checked);
    engine.applySettings();
  });

  container.querySelector('#set-streak-audio')?.addEventListener('change', e => {
    const checked = (e.target as HTMLInputElement).checked;
    engine.settings.set('killStreakAudioEnabled', checked);
    engine.applySettings();
  });

  // Audio reset defaults button
  container.querySelector('#btn-reset-audio')?.addEventListener('click', () => {
    engine.settings.resetAudio();
    engine.applySettings();
    callbacks.renderPage('settings');
    callbacks.showToast('Vandal audio settings restored to default presets.', 'info');
  });

  // Crosshair sliders
  bindRange('set-ch-size', 'val-ch-size', 'px', v => {
    engine.settings.set('crosshairSize', v);
    callbacks.applyCrosshairStyles(engine.settings.getAll());
  });
  bindRange('set-ch-gap', 'val-ch-gap', 'px', v => {
    engine.settings.set('crosshairGap', v);
    callbacks.applyCrosshairStyles(engine.settings.getAll());
  });
  bindRange('set-ch-thick', 'val-ch-thick', 'px', v => {
    engine.settings.set('crosshairThickness', v);
    callbacks.applyCrosshairStyles(engine.settings.getAll());
  });

  // Checkboxes
  container.querySelector('#set-invert-y')?.addEventListener('change', e => {
    engine.settings.set('invertY', (e.target as HTMLInputElement).checked);
    engine.applySettings();
  });

  container.querySelector('#set-show-fps')?.addEventListener('change', e => {
    const checked = (e.target as HTMLInputElement).checked;
    engine.settings.set('showFps', checked);
    callbacks.fpsEl.style.display = checked ? 'block' : 'none';
  });

  container.querySelector('#set-ch-dot')?.addEventListener('change', e => {
    const checked = (e.target as HTMLInputElement).checked;
    engine.settings.set('crosshairDot', checked);
    callbacks.applyCrosshairStyles(engine.settings.getAll());
  });

  // Color buttons
  container.querySelectorAll('.ch-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = (btn as HTMLElement).dataset.color;
      if (color) {
        engine.settings.set('crosshairColor', color);
        callbacks.applyCrosshairStyles(engine.settings.getAll());
      }
    });
  });

  // Full Backup Export
  container.querySelector('#btn-export-backup')?.addEventListener('click', () => {
    const jsonStr = engine.store.exportBackupJSON();
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `warmuplab-full-backup-${dateStr}.json`;
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
      callbacks.showToast('Full workspace backup exported successfully!');
    } catch (err: any) {
      callbacks.showToast(`Export failed: ${err?.message || 'Error'}`, 'error');
    }
  });

  // Full Backup Import
  const backupFileInput = container.querySelector('#input-import-backup') as HTMLInputElement | null;
  container.querySelector('#btn-import-backup')?.addEventListener('click', () => {
    backupFileInput?.click();
  });

  backupFileInput?.addEventListener('change', () => {
    const file = backupFileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = typeof e.target?.result === 'string' ? e.target.result : '';
      const res = await engine.store.importBackupJSON(content);
      if (res.success) {
        callbacks.showToast(`Restored: ${res.sessionsImported} sessions, ${res.playlistsImported} playlists, ${res.routinesImported} routines!`);
        callbacks.renderPage('settings');
      } else {
        callbacks.showToast(`Restore failed: ${res.errors.join(', ')}`, 'error');
      }
      backupFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // Reset settings
  container.querySelector('#btn-reset-settings')?.addEventListener('click', () => {
    engine.settings.reset();
    engine.applySettings();
    callbacks.applyCrosshairStyles(engine.settings.getAll());
    callbacks.renderPage('settings');
    callbacks.showToast('Settings restored to default presets.', 'info');
  });

  callbacks.applyCrosshairStyles(engine.settings.getAll());
}
