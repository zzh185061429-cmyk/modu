// 诊断：直接把页面加载起来，看控制台报了什么、DOM 起没起来。
// 用法: node 魔都/scripts/diag-boot.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9366;
const USER_DIR = path.join(ROOT, '.probe-tmp', 'chrome-diag');
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

try {
  let info;
  const begun = Date.now();
  while (Date.now() - begun < 15000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      info = await r.json();
      if (info.webSocketDebuggerUrl) break;
    } catch {
      /* retry */
    }
    await pause(150);
  }
  if (!info?.webSocketDebuggerUrl) throw new Error('拿不到 CDP 端点');

  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const logs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(`[console.${m.params.type}] ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    } else if (m.method === 'Log.entryAdded') {
      logs.push(`[log.${m.params.entry.level}] ${m.params.entry.text}`);
    } else if (m.id && pending.has(m.id)) {
      const r = pending.get(m.id);
      pending.delete(m.id);
      m.error ? r.reject(new Error(JSON.stringify(m.error))) : r.resolve(m.result);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  sid = (await send('Target.attachToTarget', { targetId, flatten: true }, null)).sessionId;
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.navigate', { url });
  await pause(9000);

  const probe = await js(`JSON.stringify({
    ready: document.readyState,
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    hasEntry: !!document.querySelector('.mato-entry__enter'),
    hasName: !!document.querySelector('#mato-player-name'),
    hasGame: !!document.querySelector('[data-mato-game]'),
    scripts: document.querySelectorAll('script').length,
    firstText: (document.body.innerText || '').slice(0, 160),
  })`);
  console.log('DOM 探针:', probe);
  console.log('控制台/异常:');
  for (const line of logs.slice(0, 40)) console.log('  ' + line);
  if (logs.length === 0) console.log('  （无输出）');

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
