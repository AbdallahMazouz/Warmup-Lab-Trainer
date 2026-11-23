// =====================================================================
// verifyPhase4Browser.mjs — Real Headless Chrome CDP Verification for Phase 4
// =====================================================================

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4173;
const CDP_PORT = 9222;
const USER_DATA_DIR = path.join(process.cwd(), '.chrome-phase4-test-profile');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class SimpleCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = event => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { res, rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(msg.error);
          else res(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('--- STARTING PHASE 4 REAL HEADLESS CHROME CDP VERIFICATION ---');

  if (fs.existsSync(USER_DATA_DIR)) {
    try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log('[Setup] Launching Vite preview server on port 4173...');
  const preview = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'pipe',
    shell: true,
  });

  let serverReady = false;
  preview.stdout.on('data', d => {
    const s = d.toString();
    if (s.includes('http://localhost:4173') || s.includes('Local:')) serverReady = true;
  });

  for (let i = 0; i < 30; i++) {
    if (serverReady) break;
    await sleep(200);
  }
  console.log('[Setup] Vite preview server is ready.');

  console.log('[Setup] Launching Headless Chrome with remote debugging on port 9222...');
  const chrome = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--mute-audio',
    `http://localhost:${PORT}/`,
  ]);

  let versionInfo = null;
  for (let i = 0; i < 30; i++) {
    try {
      versionInfo = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (versionInfo) break;
    } catch {
      await sleep(250);
    }
  }

  if (!versionInfo) throw new Error('Failed to connect to Chrome debugging endpoint');
  console.log('[Setup] Chrome CDP ready:', versionInfo['Browser']);

  const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) throw new Error('No page target found in Chrome');

  const cdp = new SimpleCDP(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  console.log('[Setup] Connected to page via CDP WebSocket.');

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(1500);

  try {
    // 1. Verify Application and Store Initialization
    console.log('[1] Verifying Store, Engine, and UI on window...');
    const hasGlobals = await cdp.eval(`
      typeof window.store !== 'undefined' &&
      typeof window.engine !== 'undefined' &&
      typeof window.ui !== 'undefined'
    `);
    console.log(`[1] Globals ready: ${hasGlobals}`);
    if (!hasGlobals) throw new Error('WarmupLab globals not available on window');

    // 2. Verify Dexie Schema Version 2 and customScenarios table
    console.log('[2] Verifying Dexie DB schema version 2 and customScenarios table...');
    const dbInfo = await cdp.eval(`
      (async () => {
        const db = window.store.getDatabase();
        const tables = db.tables.map(t => t.name);
        return {
          version: db.verno,
          tables,
          hasCustomScenarios: tables.includes('customScenarios')
        };
      })()
    `);
    console.log(`[2] Dexie DB Info: version=${dbInfo.version}, tables=[${dbInfo.tables.join(', ')}]`);
    if (dbInfo.version !== 2 || !dbInfo.hasCustomScenarios) {
      throw new Error(`Expected Dexie version 2 with customScenarios table, got: ${JSON.stringify(dbInfo)}`);
    }

    // 3. Navigate to Creator Studio in UI
    console.log('[3] Navigating to Creator Studio...');
    await cdp.eval(`window.ui.navigateTo('creator')`);
    await sleep(400);

    const studioMounted = await cdp.eval(`
      document.querySelector('#studio-name') !== null &&
      document.querySelector('#studio-template-select') !== null &&
      document.querySelector('#studio-json-preview') !== null &&
      document.querySelector('#btn-studio-save') !== null &&
      document.querySelector('#btn-studio-preview') !== null
    `);
    console.log(`[3] Creator Studio DOM elements mounted: ${studioMounted}`);
    if (!studioMounted) throw new Error('Creator Studio DOM elements failed to mount');

    // 4. Test Template Switching
    console.log('[4] Loading Retaliatory Bot template...');
    await cdp.eval(`
      (() => {
        const sel = document.querySelector('#studio-template-select');
        sel.value = 'retaliatory_duel';
        document.querySelector('#btn-studio-template-new').click();
      })()
    `);
    await sleep(300);

    const templateState = await cdp.eval(`
      ({
        name: window.ui.editingScenario?.name,
        retaliatory: window.ui.editingScenario?.target?.retaliatory,
        movementPattern: window.ui.editingScenario?.target?.movementPattern
      })
    `);
    console.log(`[4] Template state:`, JSON.stringify(templateState));
    if (!templateState.retaliatory || templateState.movementPattern !== 'jiggle') {
      throw new Error(`Template loading failed: ${JSON.stringify(templateState)}`);
    }

    // 5. Test Real-time Form Inputs & Live JSON Inspector
    console.log('[5] Modifying scenario parameters and verifying live JSON inspector...');
    await cdp.eval(`
      (() => {
        const nameInput = document.querySelector('#studio-name');
        nameInput.value = 'CDP Tactical Apex Bot';
        nameInput.dispatchEvent(new Event('input'));

        const maxAliveInput = document.querySelector('#studio-max-alive');
        maxAliveInput.value = '3';
        maxAliveInput.dispatchEvent(new Event('input'));
      })()
    `);

    const inspectorJson = await cdp.eval(`document.querySelector('#studio-json-preview')?.textContent`);
    const inspectorContainsName = inspectorJson.includes('CDP Tactical Apex Bot');
    const inspectorContainsMaxAlive = inspectorJson.includes('"maxAlive": 3');
    console.log(`[5] Live JSON inspector updated: name=${inspectorContainsName}, maxAlive=${inspectorContainsMaxAlive}`);
    if (!inspectorContainsName || !inspectorContainsMaxAlive) {
      throw new Error('Live JSON inspector did not update from form inputs');
    }

    // 6. Test In-Studio Scenario Preview Launcher
    console.log('[6] Testing In-Studio live preview without saving...');
    await cdp.eval(`document.querySelector('#btn-studio-preview').click()`);
    await sleep(300);

    const isEngineRunning = await cdp.eval(`window.engine.isRunning`);
    const isCanvasVisible = await cdp.eval(`document.querySelector('#game-canvas').classList.contains('visible')`);
    console.log(`[6] Live preview running: isRunning=${isEngineRunning}, canvasVisible=${isCanvasVisible}`);
    if (!isEngineRunning || !isCanvasVisible) {
      throw new Error('In-Studio live preview failed to launch in engine');
    }

    // Return to menu / creator studio
    await cdp.eval(`window.ui.exitToMenu()`);
    await sleep(300);

    // 7. Save Custom Drill to Dexie & Store
    console.log('[7] Saving custom drill to Dexie and cache...');
    await cdp.eval(`
      (async () => {
        await document.querySelector('#btn-studio-save').click();
      })()
    `);
    await sleep(600);

    const customScenarios = await cdp.eval(`window.store.getCustomScenarios()`);
    console.log(`[7] Custom scenarios stored: count=${customScenarios.length}, id=${customScenarios[0]?.id}, name="${customScenarios[0]?.name}"`);
    if (customScenarios.length !== 1 || customScenarios[0].name !== 'CDP Tactical Apex Bot') {
      throw new Error('Custom drill failed to save to Store cache');
    }
    const customId = customScenarios[0].id;

    // Direct Dexie verification
    const dexieRecord = await cdp.eval(`
      (async () => {
        const db = window.store.getDatabase();
        return await db.customScenarios.get('${customId}');
      })()
    `);
    console.log(`[7] Dexie table customScenarios record: id=${dexieRecord?.id}, name="${dexieRecord?.name}"`);
    if (!dexieRecord || dexieRecord.name !== 'CDP Tactical Apex Bot') {
      throw new Error('Custom drill failed to persist directly to Dexie database');
    }

    // 8. Verify Custom Scenario Card and Category Filter in UI
    console.log('[8] Verifying Scenarios page rendering and Custom Category filter...');
    await cdp.eval(`window.ui.navigateTo('scenarios')`);
    await sleep(300);

    const hasCustomCard = await cdp.eval(`
      document.querySelector('[data-scen="${customId}"]') !== null &&
      document.querySelector('[data-scen="${customId}"]').textContent.includes('CUSTOM DRILL')
    `);
    console.log(`[8] Custom drill card in Scenarios grid: ${hasCustomCard}`);
    if (!hasCustomCard) throw new Error('Custom drill card missing from Scenarios page');

    // Click Custom category pill
    await cdp.eval(`document.querySelector('[data-cat="custom"]').click()`);
    await sleep(300);
    const customFilteredCount = await cdp.eval(`document.querySelectorAll('.scenario-card').length`);
    console.log(`[8] Custom category filtered cards count: ${customFilteredCount}`);
    if (customFilteredCount !== 1) throw new Error('Custom category filter failed');

    // 9. Verify Custom Scenario in Playlist Editor
    console.log('[9] Verifying custom drill in Playlist Editor Available Scenarios list...');
    await cdp.eval(`
      (() => {
        window.ui.navigateTo('plans');
        document.querySelector('#btn-create-playlist').click();
      })()
    `);
    await sleep(400);

    // Switch to Custom category in playlist editor
    await cdp.eval(`document.querySelector('[data-editor-cat="custom"]').click()`);
    await sleep(300);

    const customDrillInEditor = await cdp.eval(`
      document.querySelector('[data-add-scenario-id="${customId}"]') !== null
    `);
    console.log(`[9] Custom drill available in playlist editor: ${customDrillInEditor}`);
    if (!customDrillInEditor) throw new Error('Custom drill missing from playlist editor available list');

    // Add drill to playlist and save
    console.log('[9] Adding custom drill to playlist and saving...');
    await cdp.eval(`
      (async () => {
        document.querySelector('[data-add-scenario-id="${customId}"]').click();
        const nameInput = document.querySelector('#editor-name-input');
        nameInput.value = 'Custom Hybrid Apex Playlist';
        nameInput.dispatchEvent(new Event('input'));
        document.querySelector('#btn-editor-save').click();
      })()
    `);
    await sleep(500);

    const savedPlaylists = await cdp.eval(`window.store.getPlaylists()`);
    const apexPlaylist = savedPlaylists.find(p => p.name === 'Custom Hybrid Apex Playlist');
    console.log(`[9] Saved playlist containing custom drill:`, JSON.stringify(apexPlaylist?.entries));
    if (!apexPlaylist || !apexPlaylist.entries.some(e => e.scenarioId === customId)) {
      throw new Error('Playlist failed to persist with custom drill entry');
    }

    // 10. Test Standalone JSON Export and V4 Backup Envelope
    console.log('[10] Testing universal backup export V4 envelope...');
    const backupJson = await cdp.eval(`window.store.exportBackupJSON()`);
    const backup = JSON.parse(backupJson);
    console.log(`[10] Backup envelope: format=${backup.format}, version=${backup.version}, customScenarios=${backup.data.customScenarios?.length}`);
    if (backup.format !== 'warmuplab-backup' || backup.version !== 4 || !backup.data.customScenarios || backup.data.customScenarios.length !== 1) {
      throw new Error('Universal backup V4 envelope verification failed');
    }

    // 11. Test Full Persistence Across Page Reload
    console.log('[11] Testing full persistence across page reload (CDP reload)...');
    await cdp.send('Page.reload');
    await sleep(1500);

    const reloadedCustomScenarios = await cdp.eval(`window.store.getCustomScenarios()`);
    const reloadedPlaylists = await cdp.eval(`window.store.getPlaylists()`);
    console.log(`[11] Reloaded state: customScenarios=${reloadedCustomScenarios.length}, playlists=${reloadedPlaylists.length}`);
    if (reloadedCustomScenarios.length !== 1 || reloadedCustomScenarios[0].name !== 'CDP Tactical Apex Bot') {
      throw new Error('Custom scenarios failed to hydrate from Dexie after page reload');
    }
    if (!reloadedPlaylists.some(p => p.name === 'Custom Hybrid Apex Playlist')) {
      throw new Error('Playlists failed to hydrate after page reload');
    }

    // =====================================================================
    // Targeted Remediation Verifications (Defects 1 - 4)
    // =====================================================================

    // 12. Defect 1 — Template Identifier Mismatch Verification
    console.log('[12] Defect 1: Verifying canonical template selection for tracking_smooth...');
    await cdp.eval(`window.ui.navigateTo('creator')`);
    await sleep(300);
    await cdp.eval(`
      (() => {
        const sel = document.querySelector('#studio-template-select');
        sel.value = 'tracking_smooth';
        document.querySelector('#btn-studio-template-new').click();
      })()
    `);
    await sleep(300);
    const trackingState = await cdp.eval(`
      ({
        name: window.ui.editingScenario?.name,
        targetShape: window.ui.editingScenario?.target?.shape,
        movementPattern: window.ui.editingScenario?.target?.movementPattern,
        interactionMode: window.ui.editingScenario?.interaction?.mode
      })
    `);
    console.log('[12] Smooth Tracking template loaded:', JSON.stringify(trackingState));
    if (trackingState.targetShape !== 'sphere' || trackingState.movementPattern !== 'strafe' || trackingState.interactionMode !== 'track') {
      throw new Error(`Defect 1 regression: tracking_smooth did not load smooth track config: ${JSON.stringify(trackingState)}`);
    }

    // 13. Defect 2 & 3 — Save as New Drill, Update & Reset PB, and Version Tracking
    console.log('[13] Defect 2 & 3: Verifying Save as New Drill, Update & Reset PB, and Config Versioning...');
    // Seed a PB for original custom drill via addSession
    await cdp.eval(`
      (() => {
        window.store.addSession({
          id: 'session-seed-custom-1',
          scenarioId: '${customId}',
          scenarioName: 'CDP Tactical Apex Bot',
          category: 'tactical',
          score: 85000,
          accuracy: 95,
          targetsHit: 85,
          targetsFired: 90,
          headshots: 40,
          damageDealt: 85000,
          timestamp: Date.now() - 10000,
          durationSec: 60,
          weaponUsed: 'vandal',
          configVersion: 1
        });
        window.store.addSession({
          id: 'session-seed-builtin-1',
          scenarioId: 'flick-static',
          scenarioName: 'Flick Static',
          category: 'flick',
          score: 60000,
          accuracy: 90,
          targetsHit: 60,
          targetsFired: 65,
          headshots: 30,
          damageDealt: 60000,
          timestamp: Date.now() - 10000,
          durationSec: 60,
          weaponUsed: 'vandal'
        });
      })()
    `);
    const initialPB = await cdp.eval(`window.store.getPB('${customId}')`);
    const builtinPB = await cdp.eval(`window.store.getPB('flick-static')`);
    console.log(`[13] Initial PBs: custom=${initialPB?.score}, builtin=${builtinPB?.score}`);
    if (initialPB?.score !== 85000 || builtinPB?.score !== 60000) throw new Error('Failed to seed initial PBs');

    // Load original drill into Creator Studio
    await cdp.eval(`
      (() => {
        const scenario = window.store.getCustomScenarios().find(s => s.id === '${customId}');
        window.ui.editingScenario = JSON.parse(JSON.stringify(scenario));
        window.ui.navigateTo('creator');
      })()
    `);
    await sleep(300);

    // Save as New Drill
    console.log('[13] Testing "Save as New Drill"...');
    await cdp.eval(`
      (() => {
        document.querySelector('#btn-studio-save-new').click();
      })()
    `);
    await sleep(500);

    const afterForkScenarios = await cdp.eval(`window.store.getCustomScenarios()`);
    const forkedScenario = afterForkScenarios.find(s => s.id !== '${customId}' && s.name.includes('Copy'));
    console.log(`[13] Forked scenario created: id=${forkedScenario?.id}, name="${forkedScenario?.name}", configVersion=${forkedScenario?.metadata?.configVersion}`);
    if (!forkedScenario || forkedScenario.id === customId || forkedScenario.metadata?.configVersion !== 1) {
      throw new Error('Save as New Drill failed to create independent scenario');
    }

    // Check original drill PB still intact
    const originalPBAfterFork = await cdp.eval(`window.store.getPB('${customId}')`);
    const forkedPB = await cdp.eval(`window.store.getPB('${forkedScenario.id}')`);
    console.log(`[13] PBs after fork: original=${originalPBAfterFork?.score}, forked=${forkedPB}`);
    if (originalPBAfterFork?.score !== 85000 || forkedPB !== null) {
      throw new Error('Original PB was affected by fork or forked drill inherited PB incorrectly');
    }

    // Now test "Update & Reset PB" on original drill
    console.log('[13] Testing "Update & Reset PB"...');
    await cdp.eval(`
      (() => {
        const scenario = window.store.getCustomScenarios().find(s => s.id === '${customId}');
        window.ui.editingScenario = JSON.parse(JSON.stringify(scenario));
        window.ui.navigateTo('creator');
        window.confirm = () => true;
        document.querySelector('#btn-studio-update-reset-pb').click();
      })()
    `);
    await sleep(500);

    const updatedScenarios = await cdp.eval(`window.store.getCustomScenarios()`);
    const updatedOriginal = updatedScenarios.find(s => s.id === customId);
    const originalPBAfterReset = await cdp.eval(`window.store.getPB('${customId}')`);
    const builtinPBAfterReset = await cdp.eval(`window.store.getPB('flick-static')`);
    console.log(`[13] After Update & Reset PB: version=${updatedOriginal?.metadata?.configVersion}, customPB=${originalPBAfterReset?.score}, builtinPB=${builtinPBAfterReset?.score}`);
    if (updatedOriginal?.metadata?.configVersion !== 2) {
      throw new Error(`Expected configVersion 2, got ${updatedOriginal?.metadata?.configVersion}`);
    }
    if (originalPBAfterReset !== null && originalPBAfterReset !== undefined) {
      throw new Error(`Custom PB was not reset: got ${JSON.stringify(originalPBAfterReset)}`);
    }
    if (builtinPBAfterReset?.score !== 60000) {
      throw new Error('Unrelated built-in PB was altered during custom PB reset');
    }

    // Test Config Version Separation in Analytics
    console.log('[14] Defect 3: Verifying Configuration Version Isolation in Analytics...');
    await cdp.eval(`
      (() => {
        // Record v1 session
        window.store.addSession({
          id: 'session-v1-test',
          scenarioId: '${customId}',
          scenarioName: '${customId}',
          category: 'tactical',
          score: 500,
          accuracy: 80,
          targetsHit: 50,
          targetsFired: 60,
          headshots: 10,
          damageDealt: 500,
          timestamp: Date.now() - 5000,
          durationSec: 60,
          weaponUsed: 'vandal',
          configVersion: 1
        });
        // Record v2 session
        window.store.addSession({
          id: 'session-v2-test',
          scenarioId: '${customId}',
          scenarioName: '${customId}',
          category: 'tactical',
          score: 900,
          accuracy: 90,
          targetsHit: 90,
          targetsFired: 100,
          headshots: 20,
          damageDealt: 900,
          timestamp: Date.now(),
          durationSec: 60,
          weaponUsed: 'vandal',
          configVersion: 2
        });
      })()
    `);
    const trendV1 = await cdp.eval(`window.store.getScenarioTrend('${customId}', undefined, 1)`);
    const trendV2 = await cdp.eval(`window.store.getScenarioTrend('${customId}', undefined, 2)`);
    console.log(`[14] Analytics trend separation: v1 count=${trendV1.sampleCount}, v2 count=${trendV2.sampleCount}`);
    if (trendV1.sampleCount !== 2 || trendV1.recentScores[1] !== 500) { // seeded + new v1
      throw new Error(`Trend for v1 did not isolate v1 sessions: ${JSON.stringify(trendV1)}`);
    }
    if (trendV2.sampleCount !== 1 || trendV2.recentScores[0] !== 900) {
      throw new Error(`Trend for v2 did not isolate v2 sessions: ${JSON.stringify(trendV2)}`);
    }

    // 15. Defect 4 — Missing Playlist Notification & Completion Accuracy
    console.log('[15] Defect 4: Verifying Missing Playlist Toast & Completion Metrics...');
    const routineSummaryResult = await cdp.eval(`
      (() => {
        // Prepare mock routine with 3 drills: [valid, missing, valid]
        const testPlaylist = {
          id: 'test-defect4-playlist',
          name: 'Missing Drill Recovery Test',
          description: 'Testing skip behavior',
          category: 'custom',
          isBuiltIn: false,
          defaultRestIntervalSec: 0,
          entries: [
            { scenarioId: 'flick-static', durationSec: 30 },
            { scenarioId: 'non-existent-custom-drill-xyz', durationSec: 30 },
            { scenarioId: 'track-smooth', durationSec: 30 }
          ],
          tags: ['test'],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        let toastReceived = null;
        const origShowToast = window.ui.showToast.bind(window.ui);
        window.ui.showToast = (msg, type) => {
          if (msg.includes('Skipping missing scenario')) {
            toastReceived = msg;
          }
          origShowToast(msg, type);
        };

        // Start routine
        window.ui.startPlaylist(testPlaylist);

        // Complete first drill (triggers auto-advance, skips drill 2, lands on drill 3)
        window.ui.showResultsScreen({
          id: 'drill-1-res',
          scenarioId: 'flick-static',
          scenarioName: 'Flick Static',
          category: 'flick',
          difficulty: 'intermediate',
          score: 100,
          accuracy: 90,
          hits: 10,
          misses: 1,
          headshots: 5,
          shotsFired: 11,
          targetsHit: 10,
          targetsFired: 11,
          damageDealt: 100,
          timestamp: Date.now(),
          durationSec: 30,
          weaponUsed: 'vandal'
        }, false);

        // Complete 3rd drill (concludes routine and shows completion screen)
        window.ui.showResultsScreen({
          id: 'drill-3-res',
          scenarioId: 'track-smooth',
          scenarioName: 'Track Smooth',
          category: 'tracking',
          difficulty: 'intermediate',
          score: 150,
          accuracy: 85,
          hits: 15,
          misses: 3,
          headshots: 8,
          shotsFired: 18,
          targetsHit: 15,
          targetsFired: 18,
          damageDealt: 150,
          timestamp: Date.now(),
          durationSec: 30,
          weaponUsed: 'vandal'
        }, false);

        // Check completion screen DOM
        const completedBadge = document.querySelector('.routine-completion-stats')?.textContent || document.body.textContent;

        return {
          toastReceived,
          html: completedBadge
        };
      })()
    `);
    console.log('[15] Missing drill playlist run result:', JSON.stringify({
      toastReceived: routineSummaryResult.toastReceived,
      has2Finished: routineSummaryResult.html.includes('2/3 DRILLS FINISHED'),
      has1Skipped: routineSummaryResult.html.includes('1 SKIPPED'),
      has67Percent: routineSummaryResult.html.includes('67% COMPLETE')
    }));

    if (!routineSummaryResult.toastReceived || !routineSummaryResult.toastReceived.includes('non-existent-custom-drill-xyz')) {
      throw new Error(`Missing drill toast was not triggered: ${routineSummaryResult.toastReceived}`);
    }
    if (!routineSummaryResult.html.includes('2/3 DRILLS FINISHED') || !routineSummaryResult.html.includes('1 SKIPPED') || !routineSummaryResult.html.includes('67% COMPLETE')) {
      throw new Error(`Routine completion screen statistics incorrect: ${routineSummaryResult.html}`);
    }

    console.log('\n======================================================');
    console.log('✅ ALL PHASE 4 & REMEDIATION REAL BROWSER (CDP) VERIFICATIONS PASSED!');
    console.log('======================================================\n');
    cdp.close();
    process.exit(0);
  } finally {
    chrome.kill();
    preview.kill();
    if (fs.existsSync(USER_DATA_DIR)) {
      try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}
    }
  }
}

run().catch(err => {
  console.error('❌ CDP Verification failed:', err);
  process.exit(1);
});
