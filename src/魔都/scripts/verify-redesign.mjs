import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'outputs');
const PORT = 9347;
const chrome = spawn('C:/Users/Lenovo/AppData/Local/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(ROOT, '_probe', 'redesign-browser')}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--allow-file-access-from-files', '--disable-background-timer-throttling', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0, sid;
const pending = new Map();
const results = [];
const errors = [];
const requests = [];
function send(method, params = {}, sessionId = sid) { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
const js = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const check = (name, ok, detail = '') => { results.push({ name, passed: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
async function waitFor(fn, time = 10000) { const begin = Date.now(); while (Date.now() - begin < time) { if(await fn()) return; await pause(100); } throw new Error('Condition timed out'); }
const shot = async name => { await js('document.fonts.ready'); const { data } = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, `redesign-${name}.png`), Buffer.from(data, 'base64')); };
const click = selector => js(`document.querySelector(${JSON.stringify(selector)})?.click()`);
/** 功能入口收在右侧指挥终端里，点之前先拉出来（弹窗打开时终端会自动收起） */
async function openSidebar() { await click('#btn-hud-menu'); await waitFor(()=>js(`!!document.querySelector('[data-mato-sidebar]')`)); }
async function enter() {
  await js(`(() => { const el = document.querySelector('#mato-player-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '元初'); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await pause(100); await click('.mato-entry__enter');
  await waitFor(() => js('!!document.querySelector("[data-mato-game]") && !document.querySelector(".mato-boot")'));
  await pause(100); await click('#vn-textbox'); await pause(100);
}
async function advance() { await click('#vn-textbox'); await pause(120); await click('#vn-textbox'); await pause(160); }
async function rects(selectors) { return js(`(${JSON.stringify(selectors)}).map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return {selector:s,rect:r?{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}:null};})`); }
try {
  let info;
  await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); info = await r.json(); return !!info.webSocketDebuggerUrl; } catch { return false; } });
  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if(m.id && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); m.error ? r.reject(new Error(JSON.stringify(m.error))) : r.resolve(m.result); } if(m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if(m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url); };
  const {targetId} = await send('Target.createTarget', {url:'about:blank'}, null);
  sid = (await send('Target.attachToTarget', {targetId, flatten:true}, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // Local full-screen harness; this is not host-runtime acceptance.
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(document,'fullscreenElement',{configurable:true,get(){return document.documentElement;}});HTMLElement.prototype.requestFullscreen=()=>Promise.resolve();document.exitFullscreen=()=>Promise.resolve();`});
  const url = pathToFileURL(path.resolve(ROOT, '../../dist/魔都/index.html')).href;
  for (const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['landscape',844,390],['narrow',320,640]]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    await waitFor(()=>js('!!document.querySelector(".mato-entry__hero")'));
    await js('document.fonts.ready');
    await shot(`${name}-entry`);
    const overflow = await js('document.documentElement.scrollWidth > innerWidth');
    check(`${name} 入口无横向溢出`,!overflow);
    const entry = await js(`(()=>{const root=document.querySelector('.mato-entry'),b=document.querySelector('.mato-entry__enter');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {reachable:r.y>=0&&r.bottom<=innerHeight+1,scroll:root.scrollHeight,client:root.clientHeight};})()`);
    check(`${name} 开始按钮可到达`,entry.reachable,JSON.stringify(entry));
    await enter(); await click('#vn-textbox'); await pause(160); await click('#vn-textbox'); await pause(160);
    // 输入按端分工：窄屏才有底部输入栏，展开它再验布局
    const isNarrow = width <= 700;
    if (isNarrow) { await click('.mato-composer__draft'); await pause(280); }
    await shot(`${name}-stage`);
    const boxes = await rects(isNarrow ? ['.mato-hud','.mato-dialogue','#mato-input','#mato-send'] : ['.mato-hud','.mato-dialogue','#vn-textbox']);
    check(`${name} HUD / 对话 / 输入均在视口`,boxes.every(b=>b.rect&&b.rect.x>=-1&&b.rect.right<=width+1&&b.rect.y>=-1&&b.rect.bottom<=height+1),JSON.stringify(boxes));
    const overlap = await js(`(()=>{const a=document.querySelector('.mato-dialogue')?.getBoundingClientRect(),b=document.querySelector('.mato-composer')?.getBoundingClientRect();if(!a)return false;if(!b)return true;return a.bottom<=b.top+0.5;})()`);
    check(`${name} 对话框不遮输入`,overlap);
    for (const [panel,selector,modal] of [['archive','#btn-nav-database','#modal-database'],['territory','#btn-nav-map','#modal-map'],['settings','#btn-nav-settings','#modal-settings']]) {
      await openSidebar(); await click(selector); await waitFor(()=>js(`!!document.querySelector('${modal} [role="dialog"]')`));
      await pause(140); await shot(`${name}-${panel}`);
      const fit = await js(`(()=>{const el=document.querySelector('${modal} .mato-modal__panel'),r=el.getBoundingClientRect(),body=el.querySelector('.mato-modal__content');return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1&&body.scrollWidth<=body.clientWidth+1;})()`);
      check(`${name} ${panel} 布局无溢出`,fit);
      if(panel==='archive') { await click('.mato-archive > nav button:last-child'); check(`${name} 人物档案可切换`,await js(`document.querySelector('.mato-archive__identity h3')?.textContent==='出云天花'`)); }
      if(panel==='settings') { await click('.mato-segment button:first-child'); check(`${name} 文字速度可调整`,await js(`document.querySelector('.mato-segment button:first-child')?.getAttribute('aria-pressed')==='true'`)); }
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'}); await pause(500);
      check(`${name} Escape只关闭弹窗`,await js(`!document.querySelector('${modal}')&&!!document.querySelector('[data-mato-game]')`));
    }
    await click('.mato-dialogue__controls button:first-child'); await pause(160); await shot(`${name}-history`); await click('#modal-history-close-btn'); await pause(200);
    await openSidebar(); await click('#btn-nav-combat'); await waitFor(()=>js('!!document.querySelector(".mato-battle")')); await pause(1200); await shot(`${name}-combat`);
    check(`${name} 战斗界面无横向溢出`,await js(`(()=>{const e=document.querySelector('.mato-battle');return e.scrollWidth<=e.clientWidth+1;})()`));
    check(`${name} 每回合 5 个行动点`,await js(`document.querySelectorAll('.mato-battle__pips i').length===5`));
    if(name==='desktop') {
      const hp = await js(`Number(document.querySelector('.mato-battle__enemy-hp').getAttribute('aria-valuenow'))`);
      // 连点两下：busyRef 应挡住第二次，只结算一次
      await js(`document.querySelector('.mato-battle__cmd[data-command="attack"]').click();document.querySelector('.mato-battle__cmd[data-command="attack"]').click();`);
      await pause(900);
      const after = await js(`Number(document.querySelector('.mato-battle__enemy-hp').getAttribute('aria-valuenow'))`);
      check('战斗连点只结算一次',hp-after>0&&hp-after<25,`${hp} -> ${after}`);
      await click('.mato-battle__unit:nth-child(2)');
      check('可点选队友出战',await js(`document.querySelector('.mato-battle__unit:nth-child(2)').getAttribute('aria-pressed')==='true'`));
      check('敌方有远景立绘位',await js(`!!document.querySelector('.mato-battle__enemy')`));
    }
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'}); await pause(180);
    check(`${name} Escape退出战斗保留游戏`,await js(`!document.querySelector('.mato-battle')&&!!document.querySelector('[data-mato-game]')`));
    if(name==='desktop') {
      for(let i=0;i<30&&!await js('!!document.querySelector(".mato-choices")');i++) { await click('#vn-textbox'); await pause(100); }
      await shot('desktop-choices');
      check('选项可见',await js('document.querySelectorAll(".surface-slip").length===3'));
      await click('.surface-slip');
      // 桌面端回填进文本框内的输入位（窄屏才是底部输入栏）
      check('选择仅起草',await js('!!(document.querySelector("#mato-draft") ?? document.querySelector("#mato-input"))?.value'));
    }
    check(`${name} 无解释性占位文案`,await js(`!/(立绘待定|此面板为占位|尚未接入|COM_LINK_ACTIVE|LINK STATUS|入口 v0)/.test(document.body.innerText)`));
    if(name==='desktop') {
      const fonts = await js(`({serif:document.fonts.check('600 21px "Mato Mincho"','魔都羽前京香'),sans:document.fonts.check('400 14px "Mato Sans"','设置'),latin:document.fonts.check('400 24px "Mato Latin"','07')})`);
      check('中西文字体实际加载',fonts.serif&&fonts.sans&&fonts.latin,JSON.stringify(fonts));
      check('角色原图成功加载',await js(`Array.from(document.querySelectorAll('.mato-sprites img')).every(i=>i.complete&&i.naturalWidth>0)`));
    }
  }
  check('页面无未捕获异常',errors.length===0,JSON.stringify(errors));
  check('不依赖在线字体与图像请求',!requests.some(u=>/^https?:/.test(u)&&!/127.0.0.1/.test(u)),requests.filter(u=>/^https?:/.test(u)).join(','));
  writeFileSync(path.join(OUT,'redesign-verification.json'),JSON.stringify({results,errors,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length},null,2));
  process.exitCode=results.every(r=>r.passed)?0:1;
} catch(e) { console.error(e);process.exitCode=2; }
finally { ws?.close();chrome.kill(); }
