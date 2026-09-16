// 魔都 · LOGO 还原验收（无头 Chrome + CDP）
//
// 验收三件事：
//   1. 入口页 LOGO 的 computed filter 为 none —— `filter: brightness(0)`（黑剪影印花）已拆除
//   2. 开场覆盖层 LOGO 同上
//   3. 内联素材本身确实是官方彩色 LOGO —— canvas 采样证明洋红像素真实存在（不是灰度图）
// 同时落盘截图供人工核对：outputs/logo-entry.png / logo-boot-loading.png / logo-boot-ready.png
//
// 用法: node src/魔都/scripts/verify-logo.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
const PORT = 9351;
const USER_DIR = path.join(ROOT, '.probe-tmp', 'chrome-logo');
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
const results = [];
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
const check = (name, ok, detail = '') => {
  results.push({ name, passed: !!ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
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
  writeFileSync(path.join(OUT, `logo-${name}.png`), Buffer.from(data, 'base64'));
  console.log('  saved', path.join(OUT, `logo-${name}.png`));
};

/** 采样任意 <img>：读原始位图（不受 CSS filter 影响），统计彩色/灰度/透明占比 */
const sampleImage = selector => js(`(() => {
  const img = document.querySelector(${JSON.stringify(selector)});
  if (!img) return { error: 'img not found' };
  if (!img.complete || !img.naturalWidth) return { error: 'img not loaded' };
  try {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let total = 0, opaque = 0, magenta = 0, gray = 0;
    const seen = new Map();
    for (let i = 0; i < d.length; i += 4) {
      total++;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 16) continue;
      opaque++;
      if (r > 150 && g < 90 && b > 70 && b < 175) magenta++;
      if (Math.abs(r - g) < 14 && Math.abs(g - b) < 14) gray++;
      const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    let top = null;
    for (const [k, v] of seen) if (!top || v > top[1]) top = [k, v];
    return {
      width: img.naturalWidth, height: img.naturalHeight, total, opaque,
      magenta, gray,
      magentaRatio: +(magenta / opaque).toFixed(4),
      grayRatio: +(gray / opaque).toFixed(4),
      dominantBucket: top ? top[0] : null,
    };
  } catch (e) { return { error: String(e && e.message || e) }; }
})()`);

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
  // 本地全屏替身，便于在无酒馆宿主时进入开场；这不是真机验收。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(document,'fullscreenElement',{configurable:true,get(){return document.documentElement;}});HTMLElement.prototype.requestFullscreen=()=>Promise.resolve();document.exitFullscreen=()=>Promise.resolve();`,
  });
  const url = pathToFileURL(path.resolve(ROOT, '../../dist/魔都/index.html')).href;
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  // —— 1. 入口页 ——
  const entryReady = await waitFor(() => js('!!document.querySelector(".mato-entry__logo img")'));
  check('入口页 LOGO 存在', entryReady);
  const entryFilter = await js(`getComputedStyle(document.querySelector('.mato-entry__logo img')).filter`);
  check('入口页 LOGO 无 brightness(0)', entryFilter === 'none', `filter=${entryFilter}`);
  const entrySample = await sampleImage('.mato-entry__logo img');
  check(
    '入口页内联素材是官方彩色 LOGO（洋红像素存在）',
    !entrySample.error && entrySample.magentaRatio > 0.05,
    JSON.stringify(entrySample),
  );
  await shot('entry');

  // —— 2. 开场覆盖层 ——
  await js(`(() => { const el = document.querySelector('#mato-player-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '元初'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await pause(120);
  await js(`document.querySelector('.mato-entry__enter').click()`);
  const bootReady = await waitFor(() => js('!!document.querySelector(".mato-boot__logo img")'), 8000);
  check('开场覆盖层 LOGO 出现', bootReady);
  if (bootReady) {
    const bootFilter = await js(`getComputedStyle(document.querySelector('.mato-boot__logo img')).filter`);
    check('开场 LOGO 无 brightness(0)', bootFilter === 'none', `filter=${bootFilter}`);
    await shot('boot-loading');
    await pause(1300);
    await shot('boot-ready');
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  writeFileSync(
    path.join(OUT, 'logo-verification.json'),
    JSON.stringify({ url, results, entrySample }, null, 2),
  );
  await send('Target.closeTarget', { targetId }, null);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error('LOGO 验收失败:', e.message);
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
