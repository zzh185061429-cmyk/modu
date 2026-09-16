import { useState, useEffect } from 'react';

/**
 * 检测当前是否为手机端。
 *
 * 注意：在酒馆 iframe 中 matchMedia 测的是 **iframe 自身视口**，
 * 电脑上全屏（iframe 撑到 100vw）时会误判 —— 所以这个 hook 只用于
 * 「高度守卫取 700 还是 800」这种非致命场景，界面布局不依赖它。
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [autoMobile, setAutoMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
      const handler = (e: MediaQueryListEvent) => setAutoMobile(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } catch {
      return;
    }
  }, [breakpoint]);

  return autoMobile;
}
