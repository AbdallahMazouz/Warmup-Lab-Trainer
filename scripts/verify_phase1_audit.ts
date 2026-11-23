// =====================================================================
// scripts/verify_phase1_audit.ts — Phase 1 Browser Gameplay Audit
// =====================================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 4174;
const DIST_DIR = path.resolve('dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  let reqPath = req.url?.split('?')[0] || '/';
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(DIST_DIR, reqPath);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`Phase 1 Audit Preview Server listening on http://localhost:${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const debugPort = 9223;

  console.log('Launching headless Chrome for Phase 1 Audit...');
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--disable-gpu-shader-disk-cache',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,720',
    `http://localhost:${PORT}`,
  ]);

  let webSocketDebuggerUrl = '';
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (res.ok) {
        const json = await res.json();
        webSocketDebuggerUrl = json.webSocketDebuggerUrl;
        break;
      }
    } catch {}
  }

  if (!webSocketDebuggerUrl) {
    console.error('Failed to connect to Chrome CDP');
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  console.log('Connected to Chrome CDP.');

  const targetsRes = await fetch(`http://127.0.0.1:${debugPort}/json`);
  const targets = await targetsRes.json();
  const pageTarget = targets.find((t: any) => t.type === 'page');

  if (!pageTarget) {
    console.error('No page target found');
    chromeProc.kill();
    server.close();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = reject;
  });

  let msgId = 1;
  function sendCommand(method: string, params: any = {}): Promise<any> {
    const id = msgId++;
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          ws.removeEventListener('message', handler);
          resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await sendCommand('Runtime.enable');
  await sendCommand('Page.enable');

  await new Promise((r) => setTimeout(r, 1500));

  async function evaluate(expression: string): Promise<any> {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res?.exceptionDetails) {
      console.error('Runtime.evaluate exception:', res.exceptionDetails);
    }
    return res?.result?.value;
  }

  async function captureScreenshot(filepath: string): Promise<void> {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    if (res?.data) {
      fs.writeFileSync(filepath, Buffer.from(res.data, 'base64'));
      console.log(`Saved screenshot: ${filepath}`);
    }
  }

  console.log('\n======================================================');
  console.log(' PHASE 1 IMPLEMENTATION AUDIT & BROWSER VERIFICATION ');
  console.log('======================================================\n');

  // Audit 1: Launch tactical-skirmish (Retaliatory Scenario)
  console.log('[Audit 1 & 5] Launching Tactical Skirmish (Retaliatory) scenario...');
  const launchSuccess = await evaluate(`
    (() => {
      const ui = window.ui;
      if (!ui) return false;
      ui.launchScenario('tactical-skirmish');
      // In headless browser without pointer lock gesture, ensure engine is active/resumed
      window.engine.resume();
      return true;
    })()
  `);
  console.log('Launched tactical-skirmish via UI:', launchSuccess);

  await new Promise((r) => setTimeout(r, 600));

  // Verify HUD Elements
  const hudAudit = await evaluate(`
    (() => {
      const visualizer = document.querySelector('#hud-input-visualizer');
      const threatMeter = document.querySelector('#hud-threat-meter');
      const threatFill = document.querySelector('#hud-threat-fill');
      const threatOverlay = document.querySelector('#threat-overlay');
      const speedVal = document.querySelector('#hud-speed-val');
      const speedStatus = document.querySelector('#hud-speed-status');
      const keyW = document.querySelector('#key-w');
      const keyA = document.querySelector('#key-a');
      const keyS = document.querySelector('#key-s');
      const keyD = document.querySelector('#key-d');

      return {
        hasVisualizer: !!visualizer,
        visualizerVisible: !visualizer?.classList.contains('hidden'),
        hasThreatMeter: !!threatMeter,
        hasThreatFill: !!threatFill,
        hasThreatOverlay: !!threatOverlay,
        hasSpeedVal: !!speedVal,
        hasSpeedStatus: !!speedStatus,
        speedStatusText: speedStatus?.textContent,
        keysPresent: !!(keyW && keyA && keyS && keyD)
      };
    })()
  `);
  console.log('HUD DOM Elements Audit:', JSON.stringify(hudAudit, null, 2));

  // Audit 5 & 6: Test Counter-Strafe HUD, acceleration, deceleration, status pill
  console.log('\n[Audit 5 & 6] Testing AD Counter-Strafe HUD & 0.6 m/s threshold...');
  const strafeTest = await evaluate(`
    (() => {
      const controls = window.engine?.controls;
      const engine = window.engine;
      if (!controls || !engine) return { error: 'No controls or engine' };

      const results = [];

      // State 1: Initially stopped (0.0 m/s)
      controls.velocity.set(0, 0, 0);
      controls.update(0.016, true);
      const initialSpeed = controls.getSpeed();
      const initialAccurate = controls.isCounterStrafed();
      results.push({ step: 'stopped', speed: initialSpeed, isAccurate: initialAccurate });

      // State 2: Acceleration via A key
      controls.moveLeft = true;
      controls.update(0.1, true); // accelerate
      const accelSpeed = controls.getSpeed();
      const accelAccurate = controls.isCounterStrafed();
      results.push({ step: 'accelerating', speed: accelSpeed, isAccurate: accelAccurate });

      // State 3: Dead-zone threshold test: exactly 0.58 m/s (below 0.6)
      controls.velocity.set(0.58, 0, 0);
      const subThresholdSpeed = controls.getSpeed();
      const subThresholdAccurate = controls.isCounterStrafed();
      results.push({ step: 'threshold_0.58', speed: subThresholdSpeed, isAccurate: subThresholdAccurate });

      // State 4: Above dead-zone: 0.62 m/s (above 0.6)
      controls.velocity.set(0.62, 0, 0);
      const supraThresholdSpeed = controls.getSpeed();
      const supraThresholdAccurate = controls.isCounterStrafed();
      results.push({ step: 'threshold_0.62', speed: supraThresholdSpeed, isAccurate: supraThresholdAccurate });

      // State 5: Counter-strafe direction reversal: press D, release A
      controls.moveLeft = false;
      controls.moveRight = true;
      controls.update(0.05, true); // decelerate and turn around
      const counterStrafeSpeed = controls.getSpeed();
      results.push({ step: 'counter_strafing', speed: counterStrafeSpeed, isAccurate: controls.isCounterStrafed() });

      // Set moving state for visual screenshot
      controls.moveLeft = true;
      controls.moveRight = false;
      controls.velocity.set(3.8, 0, 0);
      engine.update();

      return results;
    })()
  `);
  console.log('Movement & Threshold Test Results:', JSON.stringify(strafeTest, null, 2));

  // Capture screenshot of moving counter-strafe HUD
  const movingScreenshotPath = path.resolve('research', 'audit_counterstrafe_moving.png');
  await captureScreenshot(movingScreenshotPath);

  // Return to stopped state
  await evaluate(`
    (() => {
      const controls = window.engine.controls;
      controls.moveLeft = false;
      controls.velocity.set(0, 0, 0);
      window.engine.update();
    })()
  `);
  const stoppedScreenshotPath = path.resolve('research', 'audit_counterstrafe_stopped.png');
  await captureScreenshot(stoppedScreenshotPath);

  // Audit 2 & 4: Line of Sight, Obstacles, and Shield verification
  console.log('\n[Audit 2 & 4] Testing Line-of-Sight, Obstacles, Shielding, and Walls...');
  const losAudit = await evaluate(`
    (() => {
      const engine = window.engine;
      const tm = engine.targets;

      // 1. Occluded by cover box: (-10, 1.7, -10) behind front_left barrier (-8, 1, -8)
      const playerPos = engine.controls.yawObject.position;
      const targetCovered = {
        alive: true,
        isCovered: false,
        shielded: false,
        position: { x: -10, y: 1.7, z: -10 }
      };
      const losOccluded = tm.hasLineOfSight(targetCovered, playerPos);

      // 2. Open line of sight: (0, 1.7, -10)
      const targetOpen = {
        alive: true,
        isCovered: false,
        shielded: false,
        position: { x: 0, y: 1.7, z: -10 }
      };
      const losOpen = tm.hasLineOfSight(targetOpen, playerPos);

      // 3. Shielded target in open view
      const targetShielded = {
        alive: true,
        isCovered: false,
        shielded: true,
        position: { x: 0, y: 1.7, z: -10 }
      };
      const losShielded = tm.hasLineOfSight(targetShielded, playerPos);

      // 4. Outside arena walls: (0, 1.7, -25)
      const targetBehindWall = {
        alive: true,
        isCovered: false,
        shielded: false,
        position: { x: 0, y: 1.7, z: -25 }
      };
      const losBehindWall = tm.hasLineOfSight(targetBehindWall, playerPos);

      return {
        losOccludedByCoverBox: losOccluded,       // Expected: false
        losOpenDirectView: losOpen,               // Expected: true
        losBlockedByShield: losShielded,          // Expected: false
        losBlockedByArenaWall: losBehindWall      // Expected: false
      };
    })()
  `);
  console.log('Line-of-Sight & Cover Check Results:', JSON.stringify(losAudit, null, 2));

  // Audit 1, 3 & 7: Retaliation threat accumulation, score deduction, and timesShotByBot
  console.log('\n[Audit 1, 3 & 7] Testing Retaliation Threat, Reaction Window, Scoring & Analytics...');
  const engineState = await evaluate(`
    (() => {
      const engine = window.engine;
      const targets = Array.from(engine.targets.targets.values());
      return {
        isRunning: engine.isRunning,
        activeConfigId: engine.activeConfig?.id,
        targetCount: targets.length,
        firstTarget: targets[0] ? {
          id: targets[0].id,
          retaliatory: targets[0].retaliatory,
          retaliateDelayMs: targets[0].retaliateDelayMs,
          timeVisibleMs: targets[0].timeVisibleMs,
          hasRetaliated: targets[0].hasRetaliated,
          position: targets[0].position,
          isCovered: targets[0].isCovered,
        } : null
      };
    })()
  `);
  console.log('Engine state before wait:', JSON.stringify(engineState, null, 2));

  // Step engine simulation forward 1.2s via manual ticks or rAF to ensure exact deterministic time accumulation
  const debugRetaliate = await evaluate(`
    (() => {
      const engine = window.engine;
      // In headless browser without mouse lock, unpause engine for simulation
      engine.isPaused = false;
      const t = Array.from(engine.targets.targets.values())[0];
      const beforeTimes = engine.timesShotByBot;
      const beforeRetaliated = t ? t.hasRetaliated : null;

      // Check onTargetRetaliate callback presence
      const hasCallback = typeof engine.targets.onTargetRetaliate === 'function';

      // Execute ticks (15 x 100ms = 1.5s > 850ms retaliateDelayMs)
      for (let i = 0; i < 15; i++) {
        engine.targets.update(0.1, performance.now() + i * 100, engine.controls.yawObject.position);
      }
      engine.update();

      return {
        hasCallback,
        beforeTimes,
        beforeRetaliated,
        afterTimes: engine.timesShotByBot,
        afterRetaliated: t ? t.hasRetaliated : null,
        afterVisibleMs: t ? t.timeVisibleMs : null,
        isRunning: engine.isRunning,
        isPaused: engine.isPaused
      };
    })()
  `);
  console.log('Debug Retaliate Run:', JSON.stringify(debugRetaliate, null, 2));

  const postRetaliateAudit = await evaluate(`
    (() => {
      const engine = window.engine;
      const threatOverlay = document.querySelector('#threat-overlay');
      const targets = Array.from(engine.targets.targets.values());

      return {
        score: engine.score,
        timesShotByBot: engine.timesShotByBot,
        threatOverlayHasHit: threatOverlay?.classList.contains('hit') || false,
        firstTargetRetaliated: targets[0]?.hasRetaliated,
        firstTargetTimeVisible: targets[0]?.timeVisibleMs,
      };
    })()
  `);
  console.log('Post-Retaliation Audit:', JSON.stringify(postRetaliateAudit, null, 2));

  // Capture in-game screenshot during retaliated state
  const screenshotPath = path.resolve('research', 'audit_threat_retaliation.png');
  await captureScreenshot(screenshotPath);

  // Audit 8: Session completion & saved progress persistence
  console.log('\n[Audit 8] Completing session and verifying saved progress...');
  const completeAudit = await evaluate(`
    (() => {
      const engine = window.engine;
      const ui = window.ui;
      engine.completeScenario();

      const lastSession = engine.store.getRecentSessions(1)[0];
      const resultModal = document.querySelector('#result-modal-content');
      const resultModalHtml = resultModal?.innerHTML || '';

      return {
        sessionSaved: !!lastSession,
        lastSessionScenarioId: lastSession?.scenarioId,
        lastSessionTimesShot: lastSession?.timesShotByBot,
        modalDisplaysTimesShot: resultModalHtml.includes('Times Shot by Bot:'),
      };
    })()
  `);
  console.log('Session Save & Results Modal Audit:', JSON.stringify(completeAudit, null, 2));

  // Capture modal screenshot
  const modalScreenshotPath = path.resolve('research', 'audit_results_modal.png');
  await captureScreenshot(modalScreenshotPath);

  // Clean exit
  ws.close();
  chromeProc.kill();
  server.close();
  console.log('\nPhase 1 Browser Audit completed successfully.');
}

main().catch((err) => {
  console.error('Phase 1 Audit failed:', err);
  process.exit(1);
});
