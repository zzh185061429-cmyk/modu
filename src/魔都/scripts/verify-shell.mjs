// 魔都 · 外壳验收（无头 Chrome + CDP）
//
// 验收四块：
//   1. 顶栏 —— 常驻极简（徽标 / 地点 / 楼层 / 菜单），无横向溢出
//   2. 指挥终端 —— 右侧滑出，入口齐全（系统 4 + 辅助 3 + 本楼 2 + 返回），Esc 只收边栏
//   3. 文本框 —— 上下分层（名牌骑压 / 正文 / 控制条），上句 · 语速 · 折叠可用；
//      控制条在桌面才有「发送」，窄屏的发送入口只在底部输入栏（任一时刻只有一个）
//   4. 输入按端分工 —— 桌面：文本框原地变输入框；窄屏：底部输入栏常驻
// 落盘截图：outputs/shell-<视口>-<状态>.png
//
// 用法: node src/魔都/scripts/verify-shell.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
const PORT = 9353;
const USER_DIR = path.join(ROOT, '.probe-tmp', 'chrome-shell');
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
const click = selector => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
const exists = selector => js(`!!document.querySelector(${JSON.stringify(selector)})`);
async function waitFor(fn, time = 12000) {
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
  writeFileSync(path.join(OUT, `shell-${name}.png`), Buffer.from(data, 'base64'));
};
const pressEscape = async () => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await pause(320);
};
const setDraft = (selector, value) =>
  js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
async function openSidebar() {
  await click('#btn-hud-menu');
  return waitFor(() => exists('[data-mato-sidebar]'), 4000);
}

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
  // 本地全屏替身，便于无酒馆宿主时进入游戏；这不是真机验收。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(document,'fullscreenElement',{configurable:true,get(){return document.documentElement;}});HTMLElement.prototype.requestFullscreen=()=>Promise.resolve();document.exitFullscreen=()=>Promise.resolve();`,
  });
  const url = pathToFileURL(path.resolve(ROOT, '../../dist/魔都/index.html')).href;

  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['mobile', 390, 844],
    ['landscape', 844, 390],
    ['narrow', 320, 640],
  ]) {
    // 与 index.css 的 700px 断点、App 的 useIsMobile(700) 三方对齐
    const isNarrow = width <= 700;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await waitFor(() => js('!!document.querySelector(".mato-entry__enter")'));
    await js(`(() => { const el = document.querySelector('#mato-player-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '元初'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await pause(120);
    await click('.mato-entry__enter');
    await waitFor(() => js('!!document.querySelector("[data-mato-game]") && !document.querySelector(".mato-boot")'), 20000);
    await pause(400);
    await click('#vn-textbox');
    await pause(300);

    // ── 1. 常驻顶栏 ──
    check(`${name} 顶栏常驻`, await exists('.mato-hud'));
    check(`${name} 菜单按钮可达`, await exists('#btn-hud-menu'));
    check(`${name} 常驻区不再堆功能按钮`, await js('!document.querySelector(".mato-hud__nav") && !document.querySelector(".mato-hud__toggle")'));
    check(`${name} 无横向溢出`, !(await js('document.documentElement.scrollWidth > innerWidth')));

    // ── 2. 文本框上下分层 ──
    check(`${name} 文本框存在`, await exists('#vn-textbox'));
    check(`${name} 名牌骑压上缘`, await js(`(() => {
      const plate = document.querySelector('.mato-dialogue__plate');
      const body = document.querySelector('#vn-textbox');
      if (!plate || !body) return false;
      const p = plate.getBoundingClientRect(), b = body.getBoundingClientRect();
      return p.top < b.top + 2 && p.bottom > b.top;
    })()`));
    check(`${name} 旁白/对话标识存在`, await js('!!document.querySelector(".nameplate, .mato-dialogue__seal")'));
    check(`${name} 控制条在框内底部`, await js(`(() => {
      const bar = document.querySelector('.mato-dialogue__bar');
      const body = document.querySelector('#vn-textbox');
      if (!bar || !body) return false;
      return bar.getBoundingClientRect().top >= body.getBoundingClientRect().bottom - 2;
    })()`));
    check(`${name} 控制条含记录/上句/自动/语速`, await js(`(() => {
      const text = document.querySelector('.mato-dialogue__controls')?.textContent || '';
      return ['记录','上句','自动'].every(k => text.includes(k)) && /瞬发|舒缓|适中|迅疾/.test(text);
    })()`));
    check(`${name} 楼层翻卷在框内`, await js('!!document.querySelector("#btn-floor-prev") && !!document.querySelector("#btn-floor-next")'));

    // ── 3. 上句 / 语速 ──
    await click('#vn-textbox');
    await pause(250);
    await click('#vn-textbox');
    await pause(250);
    const beforePrev = await js(`document.querySelector('#vn-textbox p')?.textContent || ''`);
    await js(`[...document.querySelectorAll('.mato-dialogue__controls button')].find(b => b.textContent.includes('上句'))?.click()`);
    await pause(250);
    check(`${name} 上句可回退`, beforePrev !== (await js(`document.querySelector('#vn-textbox p')?.textContent || ''`)));
    const speedBefore = await js(`document.querySelector('.mato-dialogue__controls')?.textContent || ''`);
    await js(`[...document.querySelectorAll('.mato-dialogue__controls button')].find(b => /瞬发|舒缓|适中|迅疾/.test(b.textContent))?.click()`);
    await pause(200);
    const speedAfter = await js(`document.querySelector('.mato-dialogue__controls')?.textContent || ''`);
    check(`${name} 语速可就地切换`, speedBefore !== speedAfter, `${speedBefore.match(/瞬发|舒缓|适中|迅疾/)} → ${speedAfter.match(/瞬发|舒缓|适中|迅疾/)}`);
    await shot(`${name}-read`);

    // ── 4. 输入按端分工 ──
    if (isNarrow) {
      check(`${name} 窄屏用底部输入栏`, (await exists('#mato-input')) && (await exists('#mato-send')));
      check(`${name} 窄屏控制条不重复发送入口`, await js(`![...document.querySelectorAll('.mato-dialogue__controls button')].some(b => b.textContent.includes('发送'))`));
      check(`${name} 文本框不压输入栏`, await js(`(() => {
        const a = document.querySelector('.mato-dialogue')?.getBoundingClientRect();
        const b = document.querySelector('.mato-composer')?.getBoundingClientRect();
        return !!a && !!b && a.bottom <= b.top + 0.5;
      })()`));
      await setDraft('#mato-input', '测试草稿');
      await pause(200);
      check(`${name} 有字才出现清空键`, await exists('.mato-composer__clear'));
      await shot(`${name}-input`);
      await click('.mato-composer__collapse');
      await pause(250);
      check(`${name} 输入栏可收起`, (await exists('#mato-input')) === false && (await exists('.mato-composer__draft')));
      await click('.mato-composer__draft');
      await pause(250);
      check(`${name} 草稿未被收起清掉`, (await js(`document.querySelector('#mato-input')?.value`)) === '测试草稿');
    } else {
      check(`${name} 桌面不渲染底部输入栏`, (await exists('#mato-input')) === false && (await exists('.mato-composer')) === false);
      check(`${name} 桌面控制条有发送入口`, await js(`[...document.querySelectorAll('.mato-dialogue__controls button')].some(b => b.textContent.includes('发送'))`));
      await js(`[...document.querySelectorAll('.mato-dialogue__controls button')].find(b => b.textContent.includes('发送'))?.click()`);
      await pause(300);
      check(`${name} 文本框原地变输入框`, await exists('#mato-draft'));
      check(`${name} 输入时正文让位`, (await exists('#vn-textbox p')) === false);
      await shot(`${name}-draft`);
      await setDraft('#mato-draft', '测试草稿');
      await pause(200);
      await pressEscape();
      check(`${name} Esc 收合输入模式`, (await exists('#mato-draft')) === false && (await exists('#vn-textbox p')));
    }

    // ── 5. 文本框折叠 ──
    await click('.mato-dialogue__collapse');
    await pause(250);
    check(`${name} 文本框可折叠`, await exists('.mato-dialogue__expand'));
    await shot(`${name}-collapsed`);
    await click('.mato-dialogue__expand');
    await pause(250);
    check(`${name} 文本框可展开`, await exists('#vn-textbox p'));

    // ── 6. 指挥终端 ──
    check(`${name} 菜单拉出侧边栏`, await openSidebar());
    check(`${name} 侧边栏自右侧滑出`, await js(`(() => {
      const panel = document.querySelector('.mato-sidebar__panel');
      if (!panel) return false;
      const r = panel.getBoundingClientRect();
      return r.right >= innerWidth - 1 && r.left > 0;
    })()`));
    check(`${name} 侧边栏宽度按设计展开`, await js(`(() => {
      const panel = document.querySelector('.mato-sidebar__panel');
      if (!panel) return false;
      const wanted = innerWidth > 700 ? Math.min(370, innerWidth * 0.88) : Math.min(340, innerWidth * 0.92);
      return Math.abs(panel.getBoundingClientRect().width - wanted) < 2;
    })()`));
    check(`${name} 侧边栏入口齐全（系统 4 + 辅助 3 + 本楼 2 + 返回）`, await js(`(() => {
      const text = document.querySelector('.mato-sidebar__panel')?.textContent || '';
      return ['人物档案','魔都领域','战斗演习','系统设置','记录','推演','手册','重新生成','删除楼层','返回标题'].every(k => text.includes(k));
    })()`));
    check(`${name} 侧边栏四宫格两列都在框内`, await js(`(() => {
      const grid = document.querySelector('.mato-sidebar__grid');
      if (!grid) return false;
      const cards = [...grid.querySelectorAll('button')];
      const right = grid.getBoundingClientRect().right;
      return cards.length % 2 === 0 && cards.every(c => c.getBoundingClientRect().right <= right + 1);
    })()`));
    await shot(`${name}-sidebar`);

    // 弹窗抽查：手册（各视口）+ 记录 / 推演 / 删除（桌面全量）
    await click('#btn-nav-manual');
    await waitFor(() => exists('#modal-manual [role="dialog"]'), 4000);
    check(`${name} 手册弹窗可开`, await exists('#modal-manual [role="dialog"]'));
    await pressEscape();
    check(`${name} Esc 只关弹窗不退出游戏`, (await exists('#modal-manual')) === false && (await exists('[data-mato-game]')));

    if (!isNarrow) {
      for (const [button, modal, label] of [
        ['#btn-nav-history', '#modal-history', '记录'],
        ['#btn-nav-thinking', '#modal-thinking', '推演'],
      ]) {
        await openSidebar();
        await click(button);
        await waitFor(() => exists(`${modal} [role="dialog"]`), 4000);
        check(`${name} ${label}弹窗可开`, await exists(`${modal} [role="dialog"]`));
        await pressEscape();
      }
      // 删除楼层：从抽屉开，验范围表单
      await openSidebar();
      await click('#btn-floor-delete');
      await waitFor(() => exists('#modal-delete [role="dialog"]'), 4000);
      check(`${name} 删除楼层弹窗可开`, await exists('#modal-delete [role="dialog"]'));
      check(`${name} 删除按范围而不是一键删本楼`, await js(`(() => {
        const modal = document.querySelector('#modal-delete');
        if (!modal) return false;
        const inputs = modal.querySelectorAll('input[type="number"]');
        return inputs.length === 2 && (modal.textContent || '').includes('不可恢复');
      })()`));
      await shot(`${name}-delete`);
      await pressEscape();
    }

    check(`${name} Esc 收合侧边栏且不退出游戏`, await js(`!document.querySelector('[data-mato-sidebar]') && !!document.querySelector('[data-mato-game]')`));
  }

  const failed = results.filter(r => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  writeFileSync(path.join(OUT, 'shell-verification.json'), JSON.stringify({ url, results }, null, 2));
  await send('Target.closeTarget', { targetId }, null);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error('外壳验收失败:', e.message);
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
