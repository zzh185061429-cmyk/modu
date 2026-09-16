/**
 * TauriTavern 宿主全屏兼容层
 *
 * 背景：TauriTavern（TT）宿主修改过 .mes 结构（宿主保留区），并对第三方
 * position:fixed 浮层做几何管理。本卡的伪全屏直接在父页面把楼层元素/iframe
 * 改成 position:fixed，在 TT 上有两类已知症状：
 *   1) 「不能全屏」——伪全屏元素被祖先链上 transform/contain/filter 等属性
 *      困住（containing block 变成祖先盒子而非视口），fixed 只覆盖祖先盒子；
 *   2) 「发送消息后全屏弹出」——楼层重渲染/虚拟化投影协调会重置接管元素
 *      的内联样式，伪全屏态丢失。
 *
 * 本文件提供三个能力（全部仅在检测到 TT 宿主时生效；上游 SillyTavern 上
 * 每个入口都是 no-op，现有行为零改动）：
 *   - enterTTFullscreenCompat / exitTTFullscreenCompat：
 *       进入伪全屏时中和祖先链上的 containing-block 陷阱（先存原值，退出时
 *       按原样恢复），并给接管元素打 data-tt-mobile-surface="fullscreen-window"
 *       opt-in 标记——TT 几何防火墙尊重该标记，不再把它当异常浮层修正。
 *   - installTTFullscreenReassert：
 *       全屏期间订阅楼层重渲染事件，防抖后重新应用接管样式（再断言守卫）。
 *
 * 参考：TauriTavern FrontendHostContract（平台 ABI window.__TAURITAVERN__、
 * data-tt-mobile-surface 分类契约）；TavernHelper C1（eventOn 返回值兼容、
 * CHAT_CHANGED 类事件 250ms 防抖惯例）。
 */

/** 单条祖先链中和记录：退出全屏时按原样恢复 */
type TrapRestore = {
  el: HTMLElement;
  prop: string;
  hadInline: boolean;
  inlineValue: string;
  inlinePriority: string;
};

/**
 * containing-block 陷阱属性 → 恒等值。
 * 这些属性非恒等值时，会让后代的 position:fixed 以该祖先为包含块而非视口。
 */
const TRAP_PROPS: ReadonlyArray<readonly [string, string]> = [
  ['transform', 'none'],
  ['contain', 'none'],
  ['filter', 'none'],
  ['backdrop-filter', 'none'],
  ['perspective', 'none'],
  ['will-change', 'auto'],
  ['content-visibility', 'visible'],
  ['container-type', 'normal'],
];

/** TT 第三方浮层分类契约的 opt-in 标记（宿主尊重已显式标记的节点） */
const SURFACE_ATTR = 'data-tt-mobile-surface';
const SURFACE_VALUE = 'fullscreen-window';
const LOG = '[魔都·TT全屏兼容]';

let trapRestoreList: TrapRestore[] = [];
let taggedEls: HTMLElement[] = [];
let ttHostCache: boolean | null = null;

/** TT 宿主检测：平台 ABI / 运行标记；本 iframe 与父窗口各查一轮（同源可读） */
export function isTauriTavern(): boolean {
  if (ttHostCache !== null) return ttHostCache;
  let detected = false;
  try {
    const w = window as any;
    if (w.__TAURITAVERN__?.abiVersion) detected = true;
    else if (w.__TAURI_RUNNING__ === true) detected = true;
  } catch { /* ignore */ }
  if (!detected) {
    try {
      const p = window.parent as any;
      if (p && p !== window) {
        if (p.__TAURITAVERN__?.abiVersion) detected = true;
        else if (p.__TAURI_RUNNING__ === true) detected = true;
      }
    } catch { /* 跨域安全异常，按非 TT 处理 */ }
  }
  ttHostCache = detected;
  return detected;
}

/** 读取 TT 设置镜像（诊断用，尽力而为） */
function readTTDiagnostics(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const p = (window.parent && window.parent !== window ? window.parent : window) as any;
    out.abiVersion = p.__TAURITAVERN__?.abiVersion ?? null;
    out.erProfile = p.localStorage?.getItem('tt:embeddedRuntimeProfile') ?? null;
  } catch {
    out.erProfile = 'unreadable';
  }
  return out;
}

/**
 * 进入伪全屏时的 TT 兼容处理（幂等：先恢复上一轮，再重新捕获）。
 *
 * @param takeoverEl 伪全屏接管元素（魔都为楼层 .mes）
 */
export function enterTTFullscreenCompat(takeoverEl: HTMLElement | null): void {
  if (!isTauriTavern()) return;
  exitTTFullscreenCompat();
  if (!takeoverEl) return;

  // 1) 中和祖先链上的 containing-block 陷阱（含 html/body）
  let neutralized = 0;
  try {
    const doc = takeoverEl.ownerDocument;
    const root = doc?.documentElement ?? null;
    let node: HTMLElement | null = takeoverEl.parentElement;
    while (node) {
      const view = node.ownerDocument?.defaultView;
      if (view) {
        const cs = view.getComputedStyle(node);
        for (const [prop, identity] of TRAP_PROPS) {
          const value = cs.getPropertyValue(prop);
          if (value && value !== identity) {
            trapRestoreList.push({
              el: node,
              prop,
              hadInline: node.style.getPropertyValue(prop) !== '',
              inlineValue: node.style.getPropertyValue(prop),
              inlinePriority: node.style.getPropertyPriority(prop),
            });
            // inline important：压过宿主样式表，退出时按原样恢复
            node.style.setProperty(prop, identity, 'important');
            neutralized++;
          }
        }
      }
      if (node === root) break;
      node = node.parentElement;
    }
  } catch (e) {
    console.warn(`${LOG} 祖先链中和失败`, e);
  }

  // 2) opt-in 标记：让 TT 几何防火墙把接管元素当全屏窗口对待，不再改写
  try {
    if (!takeoverEl.hasAttribute(SURFACE_ATTR)) {
      takeoverEl.setAttribute(SURFACE_ATTR, SURFACE_VALUE);
      taggedEls.push(takeoverEl);
    }
  } catch { /* ignore */ }

  console.info(`${LOG} 已接管：`, { neutralized, ...readTTDiagnostics() });
}

/** 退出伪全屏时恢复祖先链与标记（必须与 enter 成对调用，或卸载时兜底调用） */
export function exitTTFullscreenCompat(): void {
  while (trapRestoreList.length) {
    const rec = trapRestoreList.pop()!;
    try {
      if (rec.hadInline) rec.el.style.setProperty(rec.prop, rec.inlineValue, rec.inlinePriority);
      else rec.el.style.removeProperty(rec.prop);
    } catch { /* ignore */ }
  }
  while (taggedEls.length) {
    const el = taggedEls.pop()!;
    try { el.removeAttribute(SURFACE_ATTR); } catch { /* ignore */ }
  }
}

/**
 * 全屏状态再断言守卫（TT 专属）。
 *
 * 楼层重渲染/虚拟化投影协调会重置接管元素的内联样式；订阅相关事件，
 * 防抖 250ms 后重新应用（C1 惯例：UI 重建类事件需防抖等待），并在其后
 * 350ms 做一次结算补挂，覆盖虚拟化的有界 settle window。
 *
 * @param applyFn  重新应用接管样式的函数（须幂等、自行重查元素）
 * @param isActive 当前是否处于全屏（false 时不做任何事）
 * @returns disposer（非 TT 宿主返回空函数）
 */
export function installTTFullscreenReassert(
  applyFn: () => void,
  isActive: () => boolean,
): () => void {
  if (!isTauriTavern()) return () => {};
  const host = window as any;
  const events = host.tavern_events || {};
  const onFn = typeof host.eventOn === 'function' ? host.eventOn : undefined;
  if (!onFn) return () => {};

  const EVENT_KEYS = [
    'MESSAGE_RECEIVED',
    'MESSAGE_SENT',
    'MESSAGE_UPDATED',
    'MESSAGE_SWIPED',
    'USER_MESSAGE_RENDERED',
    'CHARACTER_MESSAGE_RENDERED',
    'CHAT_CHANGED',
    'MORE_MESSAGES_LOADED',
  ];

  let timer: number | undefined;
  let settleTimer: number | undefined;

  const schedule = () => {
    if (!isActive()) return;
    window.clearTimeout(timer);
    window.clearTimeout(settleTimer);
    timer = window.setTimeout(() => {
      if (!isActive()) return;
      try {
        applyFn();
      } catch (e) {
        console.warn(`${LOG} 再断言失败`, e);
      }
      // 结算补挂：覆盖虚拟化投影的迟到 settle
      settleTimer = window.setTimeout(() => {
        if (!isActive()) return;
        try {
          applyFn();
        } catch { /* ignore */ }
      }, 350);
    }, 250);
  };

  const disposers: Array<() => void> = [];
  for (const key of EVENT_KEYS) {
    const name = events[key];
    if (typeof name !== 'string') continue;
    try {
      const d = onFn(name, schedule);
      // eventOn 新版返回 { stop() }；旧版返回 void，靠 iframe 关闭自动卸载
      if (d && typeof d.stop === 'function') disposers.push(() => d.stop());
    } catch { /* 单事件订阅失败不阻塞其余 */ }
  }

  return () => {
    window.clearTimeout(timer);
    window.clearTimeout(settleTimer);
    while (disposers.length) {
      try {
        disposers.pop()?.();
      } catch { /* ignore */ }
    }
  };
}
