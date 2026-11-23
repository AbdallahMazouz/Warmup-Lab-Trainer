// =====================================================================
// scripts/verify_browser_runtime.ts — Headless Chrome Runtime Verification
// =====================================================================

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 4173;
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

// 1. Static file server
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
  console.log(`Preview server listening on http://localhost:${PORT}`);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const debugPort = 9222;

  console.log('Launching headless Chrome...');
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${debugPort}`,
    '--headless=new',
    '--disable-gpu-shader-disk-cache',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `http://localhost:${PORT}`,
  ]);

  // Wait for debugger port
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

  console.log('Connected to Chrome DevTools Protocol.');

  // Find page target
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

  // Enable runtime and DOM
  await sendCommand('Runtime.enable');
  await sendCommand('Page.enable');

  // Wait 1.5s for page and Three.js initialization
  await new Promise((r) => setTimeout(r, 1500));

  async function evaluate(expression: string): Promise<any> {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value;
  }

  console.log('\n--- BROWSER RUNTIME EVALUATION ---');

  // 1. Check title and DOM
  const title = await evaluate('document.title');
  console.log('Page Title:', title);

  const canvasExists = await evaluate('!!document.querySelector("canvas")');
  console.log('Canvas element exists:', canvasExists);

  // 2. Check UI components
  const heroBtnExists = await evaluate('!!document.querySelector("#btn-hero-play")');
  console.log('Hero Play button exists:', heroBtnExists);

  const scenarioGridCards = await evaluate('document.querySelectorAll(".scenario-card").length');
  console.log('Scenario cards rendered:', scenarioGridCards);

  // 3. Launch Quick Play Flick
  console.log('\nLaunching Quick Play Flick scenario...');
  await evaluate('document.querySelector("#btn-hero-play").click()');
  await new Promise((r) => setTimeout(r, 500));

  const hudVisible = await evaluate('!document.querySelector("#hud").classList.contains("hidden")');
  const timerText = await evaluate('document.querySelector("#timer").textContent');
  console.log('HUD visible:', hudVisible, 'Timer:', timerText);

  // 4. Test Pause via ESC key simulation / engine.pause()
  console.log('\nTesting Pause state...');
  await evaluate('(window as any).engine?.pause?.() || document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }))');
  await new Promise((r) => setTimeout(r, 300));

  const pauseOverlayVisible = await evaluate('!document.querySelector("#pause-overlay")?.classList.contains("hidden")');
  console.log('Pause overlay visible:', pauseOverlayVisible);

  // 5. Test Resume
  console.log('\nTesting Resume state...');
  await evaluate('document.querySelector("#pause-overlay")?.click()');
  await new Promise((r) => setTimeout(r, 300));
  const pauseOverlayAfterResume = await evaluate('document.querySelector("#pause-overlay")?.classList.contains("hidden")');
  console.log('Pause overlay hidden after resume:', pauseOverlayAfterResume);

  // Clean exit
  ws.close();
  chromeProc.kill();
  server.close();
  console.log('\nBrowser verification finished cleanly.');
}

main().catch((err) => {
  console.error('Browser verification failed:', err);
  process.exit(1);
});
