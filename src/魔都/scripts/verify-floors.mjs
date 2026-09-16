// 魔都 · S4 事件层与楼层导航验收（无头 Chrome + CDP，无酒馆宿主 → 走本地降级路径）
//
// 验收六件事：
//   1. 楼层导航初始态（#1/1 + 本地演示标记）
//   2. 选项是「起草」不是「直发」——点选项只回填输入框，楼层数不变
//   3. 发送链路：点 SEND → 生成锁 → 落新楼，生成期间画面锁在旧楼
//   4. 跳楼：翻上一层 → 出现「跟随」；点跟随 → 回最新
//   5. 阅读进度：跨楼层来回切，已读进度保持（防抖②）
//   6. 删楼：两步确认 → 楼层数 -1
//
// ⚠️ 真值边界：本地验的是**降级路径 + 状态机**。事件真的从酒馆宿主来、
//    iframe 提升、界面正则、MVU 落盘、CDN 分发只有真酒馆能验——
//    本地通过不许冒充真机通过。
//
// 用法: node src/魔都/scripts/verify-floors.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Users\\Lenovo\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9347;
const OUT = 'D:\\BaiduNetdiskDownload\\tavern_helper_template-main\\src\\魔都\\outputs';
const TARGET = 'file:///D:/BaiduNetdiskDownload/tavern_helper_template-main/dist/魔都/index.html';
const USER_DIR = 'D:\\BaiduNetdiskDownload\\tavern_helper_template-main\\.probe-tmp\\chrome-floors';

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
    writeFileSync(`${OUT}\\floors-${name}.png`, Buffer.from(data, 'base64'));
    console.log(`  shot  floors-${name}.png`);
  };
  const click = sel => evalJs(`document.querySelector(${JSON.stringify(sel)})?.click()`);

  await on('Page.enable');
  await on('Runtime.enable');
  await on('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await on('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const errors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text);
    }
  });

  await on('Page.navigate', { url: TARGET });
  await sleep(3000);
  await evalJs('document.fonts.ready');

  // ── 进入游戏 ──
  await evalJs(`(() => {
    const el = document.getElementById('mato-player-name');
    if (!el) return;
    const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    s.call(el, '测试员'); el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(200);
  await click('.mato-entry__enter');

  let booted = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    if (await evalJs(`!!document.querySelector('[data-mato-game]') && !document.querySelector('.mato-boot') && !document.querySelector('.mato-entry')`)) {
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
  if (!booted) throw new Error('未进入游戏，停止后续行为验收');
  await sleep(900);

  // ── 工具 ──
  // 楼层特征词：断言「正文属于哪一楼」，不断言具体是第几行 ——
  // 回看旧楼会恢复上次的阅读进度（防抖②），落点未必是第一行。
  const FLOOR1_MARKS = ['雨点', '战术链接', '听得很清楚', '他昨晚', '要我往站台', '别急', '金属摩擦', '那不是风', '丑鬼', '准备接战'];
  const FLOOR2_MARKS = ['铁轨的震动', '浓度在往上走', '锁链只能锁住', '替我看', '那是什么', '闭眼'];
  const belongsTo = (text, marks) => marks.some(m => (text || '').includes(m));

  const readState = () =>
    evalJs(`JSON.stringify({
      nav: document.querySelector('.mato-hud__floor')?.textContent?.trim() ?? null,
      following: !!document.getElementById('btn-floor-latest'),
      text: document.querySelector('#vn-textbox p')?.textContent ?? null,
      speaker: document.querySelector('.nameplate')?.textContent ?? null,
      input: (document.getElementById('mato-draft') ?? document.getElementById('mato-input'))?.value ?? null,
      opts: document.querySelectorAll('.surface-slip').length,
      localBadge: (document.querySelector('[data-mato-game]')?.textContent || '').includes('本地演示'),
    })`);
  const isTyping = () => evalJs(`!!document.querySelector('#vn-textbox .animate-pulse')`);
  async function waitIdle() {
    for (let i = 0; i < 40 && (await isTyping()); i++) await sleep(160);
    await sleep(300);
  }
  async function advance() {
    await waitIdle();
    await click('#vn-textbox');
    await sleep(220);
    await waitIdle();
  }
  /** 危险操作（删楼/重写）收在右侧指挥终端里，点之前先把它拉出来 */
  async function openSidebar() {
    await click('#btn-hud-menu');
    for (let i = 0; i < 30; i++) {
      if (await evalJs(`!!document.querySelector('[data-mato-sidebar]')`)) return;
      await sleep(100);
    }
    throw new Error('指挥终端未打开');
  }

  console.log('\n[1] 初始楼层状态');
  await waitIdle();
  const s0 = JSON.parse(await readState());
  check('楼层导航显示 #1/1', s0.nav === '#1/1', `nav=${s0.nav}`);
  check('无宿主时打上「本地演示」标记', s0.localBadge === true);
  check('初始不在回看历史（无「跟随」钮）', s0.following === false);
  await shot('01-initial');

  console.log('\n[2] 选项是「起草」不是「直发」');
  let sawOptions = false;
  for (let i = 0; i < 24; i++) {
    if ((await evalJs(`document.querySelectorAll('.surface-slip').length`)) > 0) {
      sawOptions = true;
      break;
    }
    await advance();
  }
  check('播到末尾弹出选项面板', sawOptions);
  const sBefore = JSON.parse(await readState());
  await click('.surface-slip');
  await sleep(400);
  const sAfterPick = JSON.parse(await readState());
  check('点选项后面板关闭', sAfterPick.opts === 0);
  check('选项文本回填到输入框（起草）', (sAfterPick.input || '').includes('原地待命'), `input=${sAfterPick.input}`);
  check('点选项不改变楼层数（未直发）', sAfterPick.nav === sBefore.nav, `before=${sBefore.nav} after=${sAfterPick.nav}`);
  await shot('02-drafted');

  console.log('\n[3] 发送链路与生成锁');
  // 桌面端：选项回填已把文本框切进输入模式，直接点输入模式里的发送
  await click('#btn-draft-send');
  // 生成中：画面锁在旧楼
  let sawGenerating = false;
  let lockedNav = null;
  for (let i = 0; i < 24; i++) {
    const st = JSON.parse(await readState());
    if ((await evalJs(`!!document.querySelector('.mato-hud__generating') && (document.getElementById('mato-draft') ?? document.getElementById('mato-input'))?.disabled === true`))) {
      sawGenerating = true;
      lockedNav = st.nav;
      break;
    }
    await sleep(60);
  }
  check('点发送后出现生成中提示', sawGenerating);
  // nav 文本在生成期间会带一个状态圆点（#1/1●），用 includes 而不是全等
  check('生成期间画面锁在旧楼（楼层号不变）', (lockedNav || '').includes('#1/1'), `lockedNav=${lockedNav}`);

  // 等生成结束
  let landed = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    const st = JSON.parse(await readState());
    if ((st.nav || '').includes('#2/2')) {
      landed = st;
      break;
    }
  }
  check('生成结束自动落到新楼（#2/2）', landed != null, `nav=${(JSON.parse(await readState())).nav}`);
  await waitIdle();
  const sNew = JSON.parse(await readState());
  check('新楼正文来自新楼层', belongsTo(sNew.text, FLOOR2_MARKS), `text=${sNew.text}`);
  check('生成结束回到跟随模式', sNew.following === false);
  await shot('03-new-floor');

  console.log('\n[4] 跳楼与回跟随');
  await advance();
  await advance();
  const sRead2 = JSON.parse(await readState());
  await click('#btn-floor-prev');
  await sleep(700);
  await waitIdle();
  const sHist = JSON.parse(await readState());
  check('翻上一层后进入回看历史', sHist.following === true, `following=${sHist.following}`);
  check('回看的是第 1 楼正文', belongsTo(sHist.text, FLOOR1_MARKS), `text=${sHist.text}`);
  await shot('04-history');

  await click('#btn-floor-latest');
  await sleep(700);
  await waitIdle();
  const sBack = JSON.parse(await readState());
  check('点跟随回到最新楼', sBack.following === false);
  check('回到最新后正文是第 2 楼', belongsTo(sBack.text, FLOOR2_MARKS), `text=${sBack.text}`);

  console.log('\n[5] 阅读进度保持（防抖②）');
  // 第 2 楼已翻到第 3 行（sRead2）；跳到第 1 楼再跳回来，应仍在第 3 行
  await click('#btn-floor-prev');
  await sleep(700);
  await waitIdle();
  await click('#btn-floor-latest');
  await sleep(700);
  await waitIdle();
  const sRestored = JSON.parse(await readState());
  check(
    '跨楼层来回切换后阅读进度保持',
    sRestored.text === sRead2.text,
    `expected=${sRead2.text} got=${sRestored.text}`,
  );

  console.log('\n[6] 删除楼层（范围弹窗）');
  const beforeDelete = JSON.parse(await readState());
  await openSidebar();
  await click('#btn-floor-delete');
  for (let i = 0; i < 30; i++) {
    if (await evalJs(`!!document.querySelector('#modal-delete')`)) break;
    await sleep(120);
  }
  const rangeForm = await evalJs(`(() => {
    const m = document.querySelector('#modal-delete');
    if (!m) return false;
    return m.querySelectorAll('input[type="number"]').length === 2 && (m.textContent || '').includes('不可恢复');
  })()`);
  check('删除弹窗按范围输入并给出不可恢复警示', rangeForm);
  check('删除需要确认按钮而不是一键删本楼', await evalJs(`!!document.querySelector('.mato-purge__submit')`));
  const stillThere = JSON.parse(await readState());
  check('未点确认前楼层尚未删除', stillThere.nav === beforeDelete.nav, `nav=${stillThere.nav}`);
  await shot('05-delete-confirm');

  await click('.mato-purge__submit');
  let afterDelete = null;
  for (let i = 0; i < 24; i++) {
    await sleep(250);
    const st = JSON.parse(await readState());
    if ((st.nav || '').includes('#1/1')) {
      afterDelete = st;
      break;
    }
  }
  check('确认后楼层被删除（回到 #1/1）', afterDelete != null, `nav=${(JSON.parse(await readState())).nav}`);

  console.log('\n[7] MVU 降级链（MVU 尚未接入，架构已留）');
  const noMvu = await evalJs(`typeof window.Mvu === 'undefined' && typeof globalThis.Mvu === 'undefined'`);
  check('本地环境确实没有 Mvu 全局', noMvu === true);
  const gameVisible = await evalJs(`(() => { const el = document.querySelector('[data-mato-game]'); const rect = el?.getBoundingClientRect(); return Boolean(rect && rect.width > 0 && rect.height > 0 && document.querySelector('#vn-textbox p') && document.querySelector('.mato-dialogue__bar')); })()`);
  check('MVU 缺席时游戏界面正常渲染（降级不崩）', gameVisible === true, `核心视图可见=${gameVisible}`);
  const stillPlayable = JSON.parse(await readState());
  check('MVU 缺席时仍可翻页/导航', stillPlayable.nav != null, `nav=${stillPlayable.nav}`);

  console.log('\n[8] 运行时错误');
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
