// 诊断：命中特效的 mask 到底有没有生效。
// 症状判据：mask 生效 → 弧光只能看到一道弧；mask 失效 → 整块方形渐变。
// 用法: node 魔都/scripts/diag-fx.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9377;
const USER_DIR = path.join(ROOT, '.probe-tmp', 'chrome-fx');
const url = pathToFileURL(path.resolve(ROOT, '../../dist/魔都/index.html')).href;

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

let ws = null;
let seq = 0;
let sid;
const pending = new Map();
const send = (method, params = {}, sessionId = sid) => {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
};
const js = async expression => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const waitFor = async (fn, time = 20000) => {
  const begun = Date.now();
  while (Date.now() - begun < time) {
    if (await fn()) return true;
    await pause(100);
  }
  return false;
};

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
  await send('Page.navigate', { url });

  await waitFor(() => js('!!document.querySelector(".mato-entry__enter")'));
  await js(`(() => { const el = document.querySelector('#mato-player-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'元初'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await pause(150);
  await js(`document.querySelector('.mato-entry__enter').click()`);
  await waitFor(() => js('!!document.querySelector("[data-mato-game]") && !document.querySelector(".mato-boot")'), 25000);
  await pause(400);
  await js(`document.querySelector('#btn-hud-menu').click()`);
  await waitFor(() => js('!!document.querySelector("[data-mato-sidebar]")'), 5000);
  await js(`document.querySelector('#btn-nav-combat').click()`);
  await waitFor(() => js('!!document.querySelector(".mato-battle")'), 6000);
  await pause(1500);

  // 出手，然后在特效存活期内轮询抓计算样式
  await js(`document.querySelector('.mato-battle__cmd[data-command="attack"]').click()`);
  let probe = null;
  for (let i = 0; i < 26 && !probe; i++) {
    await pause(50);
    probe = await js(`(() => {
      const el = document.querySelector('.mato-fx__damage');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return JSON.stringify({
        opacity: cs.opacity, fontSize: cs.fontSize, left: cs.left, top: cs.top, text: el.textContent,
        maskSize: cs.maskSize || cs.webkitMaskSize,
        maskRepeat: cs.maskRepeat || cs.webkitMaskRepeat,
        background: cs.backgroundImage.slice(0, 70),
        box: [Math.round(box.width), Math.round(box.height)],
        varSlash: (cs.getPropertyValue('--fx-slash') || 'none').slice(0, 60),
        layers: [...document.querySelectorAll('.mato-fx > *')].map(n => n.className),
      });
    })()`);
  }
  console.log('特效探针:', probe ?? '（没抓到 .mato-fx__slash —— 特效可能根本没渲染）');

  await send('Target.closeTarget', { targetId }, null);
} catch (e) {
  console.error('诊断失败:', e.message);
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
