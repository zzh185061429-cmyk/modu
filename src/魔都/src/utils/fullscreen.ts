import { getParentJQuery, getSelfIframe } from './iframeGuard';
import { enterTTFullscreenCompat, exitTTFullscreenCompat } from './ttFullscreenCompat';

export const HIDE_STYLE_ID = 'mato-fs-hide';
export const LOCK_ATTR = 'data-mato-locked';
export const LOG = '[魔都]';

// Only restore properties we own, including their original !important priority.
type StyleRecord = { el: HTMLElement; prop: string; value: string; priority: string };
let styles: StyleRecord[] = [];
let ownedStyle: HTMLStyleElement | null = null;
let ownedMes: HTMLElement | null = null;
let previousLock: string | null = null;

function patch(el: HTMLElement, values: Record<string, string>) {
  for (const [prop, value] of Object.entries(values)) {
    if (!styles.some(record => record.el === el && record.prop === prop)) {
      styles.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
    }
    el.style.setProperty(prop, value, 'important');
  }
}

export function getSelfMes(): any | null {
  try {
    const iframe = getSelfIframe();
    const mes = iframe?.closest('.mes');
    const parent$ = getParentJQuery();
    return mes && parent$ ? parent$(mes) : null;
  } catch { return null; }
}

export function getSelfFloorId(): number | null {
  const value = getSelfIframe()?.closest('.mes')?.getAttribute('mesid');
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
}

export function isPseudoFullscreenActive(): boolean {
  return window.__matoFullscreen === true && Boolean(ownedMes?.isConnected);
}

export function isFullscreenActive(): boolean {
  return isPseudoFullscreenActive() || Boolean(document.fullscreenElement);
}

/** No fake success flag and no fallback to someone else's last message. */
export function applyPseudoFullscreen(): boolean {
  try {
    const iframe = getSelfIframe();
    const mes = iframe?.closest<HTMLElement>('.mes');
    if (!iframe || !mes || !mes.isConnected) return false;
    const doc = mes.ownerDocument;
    const existing = doc.getElementById(HIDE_STYLE_ID);
    if (existing && existing !== ownedStyle) return false;
    if (!ownedMes) {
      ownedMes = mes;
      previousLock = mes.getAttribute(LOCK_ATTR);
    }
    mes.setAttribute(LOCK_ATTR, '1');
    if (!ownedStyle) {
      ownedStyle = doc.createElement('style');
      ownedStyle.id = HIDE_STYLE_ID;
      ownedStyle.textContent = `#chat .mes:not([${LOCK_ATTR}="1"]) { display:none !important; }`;
      doc.head.append(ownedStyle);
    }
    const full = { position: 'fixed', inset: '0', width: '100%', height: '100%', 'max-width': 'none', 'max-height': 'none', 'min-height': '0', margin: '0', padding: '0', border: '0', 'box-sizing': 'border-box', 'z-index': '2147483000' };
    patch(mes, full);
    patch(iframe, { ...full, display: 'block' });
    // A transformed/contained wrapper must not become the fixed frame's viewport.
    const traps = { transform: 'none', translate: 'none', rotate: 'none', scale: 'none', contain: 'none', filter: 'none', 'backdrop-filter': 'none', perspective: 'none', 'will-change': 'auto', 'content-visibility': 'visible', 'container-type': 'normal', overflow: 'visible', 'clip-path': 'none' };
    for (let el = iframe.parentElement; el; el = el.parentElement) patch(el, traps);
    patch(doc.body, { overflow: 'hidden' });
    window.__matoFullscreen = true;
    enterTTFullscreenCompat(mes);
    return true;
  } catch (error) {
    console.warn(`${LOG} 沉浸窗口无法建立`, error);
    clearPseudoFullscreen();
    return false;
  }
}

export function clearPseudoFullscreen(): void {
  // Release the lock before restoring host geometry. Never remove another frame's style.
  try {
    if (ownedMes) {
      if (previousLock === null) ownedMes.removeAttribute(LOCK_ATTR);
      else ownedMes.setAttribute(LOCK_ATTR, previousLock);
    }
    exitTTFullscreenCompat();
    for (const { el, prop, value, priority } of styles.reverse()) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
    ownedStyle?.remove();
  } finally {
    styles = [];
    ownedStyle = null;
    ownedMes = null;
    previousLock = null;
    window.__matoFullscreen = false;
  }
}

export async function tryNativeFullscreen(): Promise<boolean> {
  try {
    if (document.fullscreenElement) return true;
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
      return Boolean(document.fullscreenElement);
    }
  } catch { /* Host policies may forbid native fullscreen; pseudo fullscreen remains valid. */ }
  return false;
}

export async function tryExitNativeFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch { /* Geometry is restored independently below. */ }
}

/** Call directly in the click handler, before any await, to preserve user activation. */
export async function enterFullscreen(): Promise<boolean> {
  if (isFullscreenActive()) return true;
  const pseudo = applyPseudoFullscreen();
  const native = await tryNativeFullscreen();
  return (pseudo && isPseudoFullscreenActive()) || native;
}

export async function exitFullscreen(): Promise<void> {
  clearPseudoFullscreen();
  await tryExitNativeFullscreen();
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreenActive()) { await exitFullscreen(); return false; }
  return enterFullscreen();
}
