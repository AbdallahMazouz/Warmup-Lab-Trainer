// =====================================================================
// verifyPhase3Browser.mjs — Real Headless Chrome CDP Verification for Phase 3
// =====================================================================

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4173;
const CDP_PORT = 9222;
const USER_DATA_DIR = path.join(process.cwd(), '.chrome-phase3-test-profile');

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

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval exception: ${res.exceptionDetails.text} - ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('[Phase 3 Verification] Starting Vite preview server...');
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    shell: true,
    stdio: 'pipe',
  });

  await sleep(1500);

  console.log('[Phase 3 Verification] Launching Chrome in headless mode with CDP...');
  if (fs.existsSync(USER_DATA_DIR)) {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  }

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-sync',
    `http://localhost:${PORT}`,
  ]);

  try {
    let targets = null;
    for (let i = 0; i < 20; i++) {
      try {
        targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
        if (targets && targets.length > 0) break;
      } catch {}
      await sleep(300);
    }

    if (!targets || targets.length === 0) {
      throw new Error('Could not connect to Chrome debugging target');
    }

    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    console.log(`[Phase 3 Verification] Connected to CDP: ${pageTarget.webSocketDebuggerUrl}`);

    const cdp = new SimpleCDP(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');

    await sleep(1000);

    // 1. Verify basic boot
    let bootMessage = false;
    for (let i = 0; i < 20; i++) {
      try {
        bootMessage = await cdp.eval('window.engine !== undefined && window.ui !== undefined && window.store !== undefined');
        if (bootMessage) break;
      } catch {}
      await sleep(300);
    }
    console.log(`[1] Core modules mounted on window: ${bootMessage}`);
    if (!bootMessage) throw new Error('Core modules failed to mount on window');

    // 2. Test Migration from legacy localStorage
    console.log('[2] Seeding mock legacy localStorage data...');
    await cdp.eval(`
      localStorage.setItem('vwt_sessions_v2', JSON.stringify([
        {
          id: 'sess_legacy_cdp_1',
          scenarioId: 'micro-adjust',
          scenarioName: 'Micro Adjust',
          category: 'flick',
          difficulty: 'standard',
          timestamp: 1690000000,
          durationSec: 60,
          score: 1150,
          hits: 23,
          misses: 2,
          headshots: 19,
          accuracy: 92.0,
          avgReactionMs: 220,
          medianReactionMs: 215,
          bestReactionMs: 180,
          targetsPerSecond: 0.38
        }
      ]));
      localStorage.setItem('vwt_pbs_v2', JSON.stringify({
        'micro-adjust:standard': {
          scenarioId: 'micro-adjust',
          difficulty: 'standard',
          score: 1150,
          accuracy: 92.0,
          avgReactionMs: 220,
          timestamp: 1690000000
        }
      }));
      localStorage.setItem('vwt_playlists_v1', JSON.stringify([
        {
          id: 'pl_legacy_cdp',
          name: 'Legacy CDP Routine',
          defaultRestIntervalSec: 5,
          entries: [{ id: 'e1', scenarioId: 'micro-adjust', durationSec: 60 }],
          createdAt: 1690000000,
          updatedAt: 1690000000
        }
      ]));
      // Remove migration flag to force migration run
      localStorage.removeItem('vwt_migration_v3_status');
    `);

    console.log('[2] Reloading page to trigger automatic migration engine...');
    await cdp.send('Page.reload');
    await sleep(1500);

    const migrationStatus = await cdp.eval(`localStorage.getItem('vwt_migration_v3_status')`);
    console.log(`[2] Migration flag set in localStorage: ${migrationStatus}`);
    if (migrationStatus !== 'completed') throw new Error('Migration status was not set to completed');

    const migratedSessionCount = await cdp.eval(`window.store.totalSessions()`);
    console.log(`[2] Migrated sessions hydrated in Store: ${migratedSessionCount}`);
    if (migratedSessionCount < 1) throw new Error('Store failed to hydrate migrated sessions');

    const migratedPB = await cdp.eval(`window.store.getPB('micro-adjust:standard')?.score`);
    console.log(`[2] Migrated PB hydrated in Store: ${migratedPB}`);
    if (migratedPB !== 1150) throw new Error('Store failed to hydrate migrated PB');

    // 3. Verify Dexie database contents directly in browser
    console.log('[3] Inspecting Dexie database WarmupLabDB directly...');
    const dexieVerification = await cdp.eval(`
      (async () => {
        const db = window.store.getDatabase();
        const session = await db.sessions.get('sess_legacy_cdp_1');
        const playlist = await db.playlists.get('pl_legacy_cdp');
        return {
          hasSession: session !== undefined && session.score === 1150,
          hasPlaylist: playlist !== undefined && playlist.name === 'Legacy CDP Routine'
        };
      })()
    `);
    console.log(`[3] Dexie verification:`, JSON.stringify(dexieVerification));
    if (!dexieVerification.hasSession || !dexieVerification.hasPlaylist) {
      throw new Error('Dexie database verification failed');
    }

    // 4. Verify UI Settings page & Dexie status badge
    console.log('[4] Navigating to Settings page in UI...');
    await cdp.eval(`window.ui.renderPage('settings')`);
    await sleep(500);

    const badgeText = await cdp.eval(`document.querySelector('#db-status-badge')?.textContent?.trim()`);
    console.log(`[4] Database status badge text: "${badgeText}"`);
    if (badgeText !== 'INDEXEDDB (ACTIVE)') {
      throw new Error(`Expected INDEXEDDB (ACTIVE) badge, got: ${badgeText}`);
    }

    const hasBackupButtons = await cdp.eval(`
      document.querySelector('#btn-export-backup') !== null &&
      document.querySelector('#btn-import-backup') !== null
    `);
    console.log(`[4] Full backup & restore buttons present: ${hasBackupButtons}`);
    if (!hasBackupButtons) throw new Error('Backup buttons not found in settings UI');

    // 5. Test Live Drill Completion & Background Write-Through
    console.log('[5] Simulating live drill completion with PB...');
    const completeDrillResult = await cdp.eval(`
      (() => {
        const newSession = {
          id: 'sess_live_cdp_99',
          scenarioId: 'micro-adjust',
          scenarioName: 'Micro Adjust',
          category: 'flick',
          difficulty: 'standard',
          timestamp: Date.now(),
          durationSec: 60,
          score: 1550, // Beats 1150 PB!
          hits: 31,
          misses: 1,
          headshots: 28,
          accuracy: 96.8,
          avgReactionMs: 195,
          medianReactionMs: 190,
          bestReactionMs: 160,
          targetsPerSecond: 0.51
        };
        const { isPB } = window.store.addSession(newSession);
        return { isPB, total: window.store.totalSessions() };
      })()
    `);
    console.log(`[5] Drill completed result:`, JSON.stringify(completeDrillResult));
    if (!completeDrillResult.isPB || completeDrillResult.total < 2) {
      throw new Error('Live drill completion did not trigger PB or increment session count');
    }

    // Wait a moment for background write to commit to Dexie
    await sleep(500);

    const liveDexieRecord = await cdp.eval(`
      (async () => {
        const db = window.store.getDatabase();
        const record = await db.sessions.get('sess_live_cdp_99');
        const pb = await db.personalBests.get('micro-adjust:standard');
        return {
          hasRecord: record !== undefined,
          score: record?.score,
          pbScore: pb?.score
        };
      })()
    `);
    console.log(`[5] Verified background write to Dexie:`, JSON.stringify(liveDexieRecord));
    if (!liveDexieRecord.hasRecord || liveDexieRecord.score !== 1550 || liveDexieRecord.pbScore !== 1550) {
      throw new Error('Background Dexie write-through failed to persist live session or PB');
    }

    // 6. Test Universal Backup Export Envelope
    console.log('[6] Verifying universal backup export JSON...');
    const backupJson = await cdp.eval(`window.store.exportBackupJSON()`);
    const parsed = JSON.parse(backupJson);
    console.log(`[6] Backup envelope: format=${parsed.format}, version=${parsed.version}, sessions=${parsed.data.sessions.length}`);
    if (parsed.format !== 'warmuplab-backup' || parsed.version !== 3 || parsed.data.sessions.length < 2) {
      throw new Error('Universal backup envelope verification failed');
    }

    // 7. Verify Persistence Across Tab Reload
    console.log('[7] Testing full persistence across page reload...');
    await cdp.send('Page.reload');
    await sleep(1500);

    const reloadedSessionsCount = await cdp.eval(`window.store.totalSessions()`);
    const reloadedPB = await cdp.eval(`window.store.getPB('micro-adjust:standard')?.score`);
    console.log(`[7] Reloaded sessions: ${reloadedSessionsCount}, PB score: ${reloadedPB}`);
    if (reloadedSessionsCount < 2 || reloadedPB !== 1550) {
      throw new Error('Reload persistence verification failed');
    }

    console.log('\n======================================================');
    console.log('✅ ALL PHASE 3 REAL BROWSER (CDP) VERIFICATIONS PASSED!');
    console.log('======================================================\n');
    cdp.close();
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
