// =====================================================================
// captureRedesignScreenshots.mjs — High-Res CDP Viewport Screenshot Capture
// =====================================================================

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 4173;
const CDP_PORT = 9222;
const USER_DATA_DIR = path.join(process.cwd(), '.chrome-screenshot-profile');
const SCREENSHOT_DIR = 'C:\\Users\\abdel\\.gemini\\antigravity-cli\\brain\\549ebf22-5738-4f6c-a1ea-5cf4cfac2e93\\screenshots';

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
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 800,
    });
    await this.send('Emulation.setVisibleSize', { width, height });
  }

  async captureScreenshot(filename) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Captured] ${filename} (${buffer.length} bytes)`);
    return outPath;
  }
}

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('[1/4] Spawning Vite preview on port 4173...');
  const previewProcess = spawn('npx.cmd', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    shell: true,
  });

  let serverUp = false;
  for (let i = 0; i < 30; i++) {
    try {
      await fetchJson(`http://localhost:${PORT}`);
      serverUp = true;
      break;
    } catch {
      await sleep(200);
    }
  }

  console.log('[2/4] Spawning Headless Chrome CDP...');
  const chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `--user-data-dir=${USER_DATA_DIR}`,
    `http://localhost:${PORT}`,
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 30; i++) {
    try {
      targets = await fetchJson(`http://localhost:${CDP_PORT}/json`);
      if (targets && targets.length > 0) break;
    } catch {
      await sleep(200);
    }
  }

  const pageTarget = targets.find(t => t.type === 'page');
  const cdp = new SimpleCDP(pageTarget.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await sleep(1000);

  // Seed sample session data and a custom scenario so the UI looks active and populated
  await cdp.eval(`(async () => {
    // Seed sample sessions
    await window.store.addSession({
      scenarioId: 'flick-static',
      scenarioName: 'Static Flicks',
      category: 'flick',
      difficulty: 'intermediate',
      score: 87400,
      accuracy: 94.2,
      hits: 48,
      misses: 3,
      headshots: 42,
      headshotPct: 87.5,
      avgReactionMs: 198,
      durationSec: 60,
      timestamp: Date.now() - 3600000,
      configVersion: 1
    });

    await window.store.addSession({
      scenarioId: 'track-smooth',
      scenarioName: 'Smooth Strafe Tracking',
      category: 'tracking',
      difficulty: 'intermediate',
      score: 91200,
      accuracy: 88.6,
      hits: 120,
      misses: 15,
      headshots: 98,
      headshotPct: 81.6,
      avgReactionMs: 165,
      durationSec: 60,
      timestamp: Date.now() - 1800000,
      configVersion: 1
    });

    // Seed custom scenario
    await window.store.saveCustomScenario({
      id: 'custom_esports_apex_bot',
      name: 'Apex Arena Counter-Strafe Duel',
      category: 'tactical',
      difficulty: 'pro',
      durationSec: 60,
      description: 'High-speed AD strafing bot with return-fire threat mechanics.',
      skill: 'Micro-flick & Movement Reading',
      weapon: { preset: 'vandal', requireCounterStrafe: true },
      spawner: { mode: 'random_area', maxAlive: 3, respawnOnKill: true, respawnDelayMs: 0, spawnRadius: 12 },
      target: { shape: 'sphere', hp: 100, sizeMultiplier: 1.0, movementPattern: 'strafe', speedMultiplier: 1.2, retaliatory: true, retaliateDelayMs: 700, retaliationPenalty: 250 },
      scoring: { baseHitScore: 100, headshotBonus: 50, missPenalty: -25, speedBonusMax: 300, counterStrafeBonus: 50 },
      metadata: { createdAt: Date.now(), modifiedAt: Date.now(), configVersion: 1 }
    });
  })()`);

  console.log('[3/4] Capturing Desktop Viewport (1920x1080)...');
  await cdp.setViewport(1920, 1080);

  // 1. Home / Command Deck
  await cdp.eval(`window.ui.navigateTo('home')`);
  await sleep(600);
  await cdp.captureScreenshot('01_home_command_deck.png');

  // 2. Scenarios Browser
  await cdp.eval(`window.ui.navigateTo('scenarios')`);
  await sleep(600);
  await cdp.captureScreenshot('02_scenarios_browser.png');

  // 3. Creator Studio
  await cdp.eval(`window.ui.editingScenario = window.store.getCustomScenario('custom_esports_apex_bot'); window.ui.navigateTo('creator');`);
  await sleep(600);
  await cdp.captureScreenshot('03_creator_studio.png');

  // 4. Warm-Up Plans / Playlists
  await cdp.eval(`window.ui.navigateTo('plans')`);
  await sleep(600);
  await cdp.captureScreenshot('04_training_playlists.png');

  // 5. Statistics Dashboard
  await cdp.eval(`window.ui.navigateTo('stats')`);
  await sleep(600);
  await cdp.captureScreenshot('05_statistics_dashboard.png');

  // 6. Settings & Calibration
  await cdp.eval(`window.ui.navigateTo('settings')`);
  await sleep(600);
  await cdp.captureScreenshot('06_settings_calibration.png');

  // 7. Results Screen Overlay
  await cdp.eval(`window.ui.showResultsScreen({
    scenarioId: 'flick-static',
    scenarioName: 'Static Flicks',
    category: 'flick',
    difficulty: 'intermediate',
    score: 94850,
    accuracy: 96.8,
    hits: 52,
    misses: 2,
    headshots: 47,
    headshotPct: 90.4,
    avgReactionMs: 184,
    medianReactionMs: 179,
    targetsPerMinute: 52.0,
    targetsPerSecond: 0.87,
    durationSec: 60,
    timestamp: Date.now(),
    configVersion: 1
  }, true)`);
  await sleep(600);
  await cdp.captureScreenshot('07_results_screen.png');

  // Dismiss overlay
  await cdp.eval(`document.getElementById('result-overlay').classList.remove('visible')`);

  console.log('[4/4] Capturing Laptop & Tablet Viewports...');
  // Laptop (1366x768)
  await cdp.setViewport(1366, 768);
  await cdp.eval(`window.ui.navigateTo('home')`);
  await sleep(500);
  await cdp.captureScreenshot('08_home_1366x768.png');

  await cdp.eval(`window.ui.navigateTo('creator')`);
  await sleep(500);
  await cdp.captureScreenshot('09_creator_studio_1366x768.png');

  // Tablet (768x1024)
  await cdp.setViewport(768, 1024);
  await cdp.eval(`window.ui.navigateTo('home')`);
  await sleep(500);
  await cdp.captureScreenshot('10_home_768x1024.png');

  await cdp.eval(`window.ui.navigateTo('scenarios')`);
  await sleep(500);
  await cdp.captureScreenshot('11_scenarios_768x1024.png');

  // Cleanup
  console.log('[Cleanup] Terminating preview and chrome processes...');
  try { previewProcess.kill(); } catch {}
  try { chromeProcess.kill(); } catch {}
  try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}

  console.log('✅ ALL SCREENSHOTS CAPTURED SUCCESSFULLY!');
  process.exit(0);
}

run().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
