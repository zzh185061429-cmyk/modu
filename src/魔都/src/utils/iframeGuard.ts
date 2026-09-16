/**
 * iframe 高度守卫 — 事件驱动，替代暴力定时器
 *
 * 为什么需要它：酒馆给楼层 iframe 的默认高度是固定值（常见 500px 左右），
 * 而本前端是满屏战术界面（100vh 布局）。不撑高就会出现「画面被压扁 + 内部滚动条」。
 *
 * 策略：
 * 1. ResizeObserver 监听 iframe 自身 body 尺寸变化（内容撑高时主动通知父页）
 * 2. MutationObserver 监听 iframe 元素的 style 属性被外部篡改（酒馆会重写）
 * 3. MutationObserver 监听父元素 style/class 变化（酒馆框架操作）
 * 4. rAF 合帧：同一帧内多次触发只执行一次，避免抖动
 * 5. 差值比对：只有当前高度与目标高度差 > 1px 时才写入，减少 DOM 操作
 * 6. 退出全屏后用短暂 burst 修复竞态（3 次 × 100ms）
 *
 * 全屏期间跳过（全屏时父页接管了尺寸，守卫再写会打架）。
 */

/** 安全获取父页 jQuery（跨域 / 无酒馆环境时返回 null，调用方降级） */
export function getParentJQuery(): any | null {
  try {
    if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
      const p$ = (window.parent as any).$;
      if (p$) return p$;
    }
  } catch {
    // 跨域安全异常
  }
  return null;
}

/** 安全获取自身 iframe 元素 */
export function getSelfIframe(): HTMLIFrameElement | null {
  try {
    return window.frameElement as HTMLIFrameElement | null;
  } catch {
    return null;
  }
}

/**
 * 计算目标高度：取视口高度与默认最大值中的较小值
 * 保证 iframe 不会超过可视区域，也不会低于内容所需最小高度
 */
export function computeTargetHeight(isMobile: boolean, entry = false): number {
  const defaultH = entry ? (isMobile ? 640 : 540) : (isMobile ? 700 : 800);
  // 如果父页视口高度比默认值小，就适配到视口高度（减去少量边距）
  try {
    const parentH = window.parent.innerHeight;
    if (parentH > 0 && parentH < defaultH + 40) {
      return Math.max(entry ? 240 : 400, parentH - 20);
    }
  } catch {
    // 跨域时无法读取父页视口
  }
  return defaultH;
}

/** 全屏标志位（供高度守卫与外部读取） */
declare global {
  interface Window {
    __matoFullscreen?: boolean;
  }
}

/**
 * 退出全屏后恢复 iframe 高度
 * 清除全屏时的内联样式，然后撑大到目标高度
 */
export function restoreIframeHeight(isMobile: boolean): void {
  const parent$ = getParentJQuery();
  const iframe = getSelfIframe();
  if (!parent$ || !iframe) return;
  try {
    parent$(iframe).css({ width: '', position: '', top: '', left: '', 'z-index': '', 'max-width': '', 'max-height': '' });
    const targetH = computeTargetHeight(isMobile);
    parent$(iframe).css({ height: `${targetH}px` });
  } catch {
    // ignore
  }
}

export type GuardHandle = {
  /** 手动触发一次高度修复 */
  force: () => void;
  /** 退出全屏后的 burst 修复 */
  burst: () => void;
  /** 销毁所有监听 */
  destroy: () => void;
};

/**
 * 启动 iframe 高度守卫
 *
 * @param isMobile 是否手机模式
 * @returns 守卫句柄
 */
export function startIframeGuard(isMobile: boolean, entry = false): GuardHandle {
  const parent$ = getParentJQuery();
  const iframe = getSelfIframe();

  // 浏览器裸跑（file:// 或普通页面）没有父页 jQuery / 没有 iframe 宿主 → 空操作
  if (!parent$ || !iframe) {
    return { force: () => {}, burst: () => {}, destroy: () => {} };
  }

  let rafId = 0;
  let destroyed = false;

  /** 获取当前目标高度（动态计算） */
  const getTargetH = () => computeTargetHeight(isMobile, entry);

  /** 实际写入高度的函数（带差值比对） */
  const applyHeight = () => {
    if (destroyed) return;
    // 全屏时跳过：父页已把 .mes / iframe 设成 100%，守卫再写会打架
    if (window.__matoFullscreen) return;
    try {
      const targetH = getTargetH();
      const currentH = parent$(iframe).height();
      if (Math.abs(currentH - targetH) > 1) {
        parent$(iframe).css({ height: `${targetH}px` });
      }
    } catch {
      // ignore
    }
  };

  /** rAF 合帧触发 */
  const scheduleApply = () => {
    if (rafId || destroyed) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applyHeight();
    });
  };

  // 立即执行一次
  applyHeight();

  // ── 1. MutationObserver: 监听 iframe style 被外部篡改 ──
  let styleObserver: MutationObserver | null = null;
  try {
    styleObserver = new MutationObserver(scheduleApply);
    styleObserver.observe(iframe, { attributes: true, attributeFilter: ['style'] });
  } catch {
    // ignore
  }

  // ── 2. MutationObserver: 监听父元素 class/style 变化（酒馆框架操作） ──
  let parentObserver: MutationObserver | null = null;
  try {
    const parentEl = iframe.parentElement;
    if (parentEl) {
      parentObserver = new MutationObserver(scheduleApply);
      parentObserver.observe(parentEl, { attributes: true, attributeFilter: ['style', 'class'] });
    }
  } catch {
    // ignore
  }

  // ── 3. ResizeObserver: 监听自身 body 尺寸变化（内容增减时主动撑高） ──
  let resizeObserver: ResizeObserver | null = null;
  try {
    resizeObserver = new ResizeObserver(scheduleApply);
    resizeObserver.observe(document.body);
  } catch {
    // ignore
  }

  // ── 4. window resize 事件（视口变化时重新计算 targetH） ──
  const onResize = () => scheduleApply();
  window.addEventListener('resize', onResize);

  return {
    force: applyHeight,
    burst: () => {
      // 退出全屏后 burst：3 次 × 100ms（全屏改了父页内联样式，退出后未恢复是必现坑）
      applyHeight();
      setTimeout(applyHeight, 100);
      setTimeout(applyHeight, 200);
    },
    destroy: () => {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      styleObserver?.disconnect();
      parentObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onResize);
      // 清除时恢复默认高度
      try {
        parent$(iframe).css({ height: '' });
      } catch {
        // ignore
      }
    },
  };
}
