// 战斗构图探针 —— 只截图不断言（改完布局先自己看一眼，别拿错的图交人）
//
// 用法: node src/魔都/scripts/shot-battle.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
const PORT = 9355;
const USER_DIR = path.join(ROOT, '.probe-tmp', 'chrome-battle');
mkdirSync(OUT, { recursive: true });
mkdirSync(USER_DIR, { recursive: true });

const chrome = spawn(
  'C:/Users/Lenovo/AppData/Local/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--disable-background-timer-throttling',
    '--window-size=1440,900',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws = null,
  seq = 0,
  sid;
const pending = new Map();
function send(method, params = {}, sessionId = sid) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const js = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
async function waitFor(fn, time = 15000) {
  const begin = Date.now();
  while (Date.now() - begin < time) {
    if (await fn()) return true;
    await pause(100);
  }
  return false;
}
const shot = async name => {
  await js('document.fonts.ready');
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, `battle-${name}.png`), Buffer.from(data, 'base64'));
  console.log('  saved', `battle-${name}.png`);
};
const click = selector => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);

try {
  let info;
  await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      info = await r.json();
      return !!info.webSocketDebuggerUrl;
    } catch {
      return false;
    }
  });
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const r = pending.get(m.id);
      pending.delete(m.id);
      m.error ? r.reject(new Error(JSON.stringify(m.error))) : r.resolve(m.result);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  sid = (await send('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(document,'fullscreenElement',{configurable:true,get(){return document.documentElement;}});HTMLElement.prototype.requestFullscreen=()=>Promise.resolve();document.exitFullscreen=()=>Promise.resolve();`,
  });
  const url = pathToFileURL(path.resolve(ROOT, '../../dist/魔都/index.html')).href;

  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
    ['landscape', 844, 390],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor(() => js('!!document.querySelector(".mato-entry__enter")'));
    await js(`(() => { const el = document.querySelector('#mato-player-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '元初'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause(120);
    await click('.mato-entry__enter');
    await waitFor(() => js('!!document.querySelector("[data-mato-game]") && !document.querySelector(".mato-boot")'), 20000);
    await pause(400);
    // 演习入口直接进战斗
    await click('#btn-hud-menu');
    await waitFor(() => js('!!document.querySelector("[data-mato-sidebar]")'), 4000);
    await click('#btn-nav-combat');
    await waitFor(() => js('!!document.querySelector(".mato-battle")'), 5000);
    await pause(1500);
    await shot(name);
    // 换手到第 3 人（Baton Pass）
    await click('.mato-battle__mate:nth-child(3)');
    await pause(500);
    await shot(`${name}-baton`);
    // 出手：抓斩击最饱满的那一帧。
    // 接触在 100ms（DASH_MS），序列帧总长 429ms，前 3 帧几乎是空的，
    // 所以抓拍点定在 100 + 280 ≈ 380ms，正好落在扫击中段。
    await click('.mato-battle__cmd[data-command="attack"]');
    await pause(380);
    await shot(`${name}-hit`);
  }

  await send('Target.closeTarget', { targetId }, null);
} catch (e) {
  console.error('探针失败:', e.message);
  process.exitCode = 3;
} finally {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  try {
    chrome.kill();
  } catch {
    /* ignore */
  }
}
