// 魔都 · S3 演出层验收（无头 Chrome + CDP）
//
// 验收四件事：
//   1. 舞台静止 —— 鼠标移动前后，场景层/立绘层的 computed transform 不变（视差已拆除）
//   2. 逐行播放 —— 解析器输出真的被播出来（旁白/对话/独白/玩家行各有其态）
//   3. 选项面板 —— 播到末尾弹出解析出的 <options>，点击后作为玩家行继续
//   4. 文本框贴文字 —— 文本框高度贴内容，不再占三分之一屏
//
// 用法: node src/魔都/scripts/shoot-stage.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Users\\Lenovo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const OUT = 'D:\\BaiduNetdiskDownload\\tavern_helper_template-main\\src\\魔都\\outputs';
const TARGET = 'file:///D:/BaiduNetdiskDownload/tavern_helper_template-main/dist/魔都/index.html';
const USER_DIR = 'D:\\BaiduNetdiskDownload\\tavern_helper_template-main\\.probe-tmp\\chrome-stage';

mkdirSync(OUT, { recursive: true });
mkdirSync(USER_DIR, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--allow-file-access-from-files',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let ws = null;
let seq = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
  });
}
async function waitForDevtools() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* wait */
    }
    await sleep(150);
  }
  throw new Error('DevTools 未就绪');
}

/** 无酒馆宿主时也要能进游戏：mock 掉全屏 */
const INJECT = `(() => {
  try {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get() { return document.documentElement; } });
    document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
    document.exitFullscreen = function () { return Promise.resolve(); };
  } catch (e) {}
})();`;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  const v = await waitForDevtools();
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const on = (m, p) => send(m, p || {}, sessionId);
  const evalJs = async expr =>
    (await on('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
  const shot = async name => {
    const { data } = await on('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${OUT}\\stage-${name}.png`, Buffer.from(data, 'base64'));
    console.log(`  shot  stage-${name}.png`);
  };

  await on('Page.enable');
  await on('Runtime.enable');
  await on('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await on('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  // 收集页面错误（白屏定位用）
  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text);
    }
  });

  await on('Page.navigate', { url: TARGET });
  await sleep(3000);

  console.log('\n[进入游戏]');
  await evalJs(`(() => {
    const el = document.getElementById('mato-player-name');
    if (!el) return 'NO_INPUT';
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, '测试员'); el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'OK';
  })()`);
  await sleep(200);
  await evalJs(`document.querySelector('.mato-entry__enter')?.click()`);

  // 等开场动画结束（最多 12s，必要时点"跳过转场"）
  let booted = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const gone = await evalJs(`!document.querySelector('.mato-boot')`);
    if (gone) {
      booted = true;
      break;
    }
    if (i === 10) {
      await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('跳过'));
        if (b) b.click();
      })()`);
    }
  }
  check('开场覆盖层已卸载', booted);
  await sleep(900);

  console.log('\n[1] 舞台静止（视差已拆除）');
  const readTransforms = () =>
    evalJs(`JSON.stringify({
      backdrop: getComputedStyle(document.querySelector('[data-mato-stage="backdrop"]')).transform,
      sprites: getComputedStyle(document.querySelector('[data-mato-stage="sprites"]')).transform,
    })`);

  await evalJs(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, clientY: 80, bubbles: true }))`);
  await sleep(500);
  const t1 = await readTransforms();
  await evalJs(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1200, clientY: 720, bubbles: true }))`);
  await sleep(700);
  const t2 = await readTransforms();
  check('鼠标移动后场景层 / 立绘层位移不变', t1 === t2, `before=${t1} after=${t2}`);

  const staged = await evalJs(`document.querySelector('[data-mato-game]')?.getAttribute('data-mato-staged')`);
  check('开场结束后降载属性已移除', staged === null, `data-mato-staged=${staged}`);

  console.log('\n[2] 逐行播放');
  const readLine = () =>
    evalJs(`JSON.stringify({
      speaker: document.querySelector('.nameplate')?.textContent ?? null,
      text: document.querySelector('#vn-textbox p')?.textContent ?? null,
      typing: !!document.querySelector('#vn-textbox .animate-pulse'),
      boxH: Math.round(document.querySelector('#vn-textbox')?.getBoundingClientRect().height ?? 0),
      boxW: Math.round(document.querySelector('#vn-textbox')?.getBoundingClientRect().width ?? 0),
    })`);

  const isTyping = () => evalJs(`!!document.querySelector('#vn-textbox .animate-pulse')`);
  /** 等本行打完字 + 名牌过渡结束（AnimatePresence mode="wait" 退出期间读到的还是旧名牌） */
  async function waitIdle() {
    for (let i = 0; i < 40 && (await isTyping()); i++) await sleep(160);
    await sleep(320);
  }
  async function advance() {
    await waitIdle();
    await evalJs(`document.querySelector('#vn-textbox')?.click()`);
    await sleep(220);
    await waitIdle();
  }

  await waitIdle();
  const l1 = JSON.parse(await readLine());
  await shot('01-line1');
  check('第 1 行为旁白（无名牌）', l1.speaker === null && (l1.text || '').includes('雨点'), JSON.stringify(l1));

  await advance();
  const l2 = JSON.parse(await readLine());
  await shot('02-line2');
  check('第 2 行为羽前京香对话（有名牌）', (l2.speaker || '').includes('羽前京香'), JSON.stringify(l2));

  await advance();
  await advance();
  const l4 = JSON.parse(await readLine());
  await shot('03-line4');
  check('第 4 行为内心独白（仍在羽前京香名下）', (l4.speaker || '').includes('羽前京香'), JSON.stringify(l4));

  console.log('\n[3] 文本框排版');
  check('文本框限宽居中（< 画面宽度）', l4.boxW > 600 && l4.boxW < 1100, `width=${l4.boxW}`);
  check('文本框高度贴内容（< 240px，非半屏面板）', l4.boxH > 80 && l4.boxH < 240, `height=${l4.boxH}`);

  console.log('\n[4] 选项面板');
  let optsSeen = 0;
  for (let i = 0; i < 24; i++) {
    const open = await evalJs(`!!document.querySelector('.surface-slip')`);
    if (open) {
      optsSeen = await evalJs(`document.querySelectorAll('.surface-slip').length`);
      break;
    }
    await advance();
  }
  await sleep(400);
  await shot('04-options');
  check('播到末尾弹出选项面板（3 项）', optsSeen === 3, `实得 ${optsSeen} 项`);

  const optTexts = await evalJs(
    `JSON.stringify([...document.querySelectorAll('.surface-slip')].map(b => b.textContent.replace(/^[甲乙丙丁戊己庚辛壬癸]/, '').trim()))`,
  );
  console.log('  选项内容:', optTexts);

  // 选第一项 → 只起草（回填输入框），不直发。
  // 「点了就发」会误触烧 token，发送链路的行为验收在 verify-floors.mjs。
  await evalJs(`document.querySelector('.surface-slip')?.click()`);
  await sleep(700);
  await shot('05-option-drafted');
  const drafted = await evalJs(`(document.getElementById('mato-draft') ?? document.getElementById('mato-input'))?.value ?? null`);
  check('选中选项后回填输入框（起草，不直发）', (drafted || '').includes('原地待命'), `input=${drafted}`);

  console.log('\n[5] 运行时错误');
  check('无未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  await send('Target.closeTarget', { targetId });
  process.exitCode = fail === 0 ? 0 : 1;
} catch (e) {
  console.error('验收失败:', e.message);
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
