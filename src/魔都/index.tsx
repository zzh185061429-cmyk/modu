import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './src/App';
import './src/index.css';

// 逐楼层入口：界面正则把每个 AI 楼层替换为加载本文件的 iframe，
// 应用直接挂载到自身文档的 #root（与幻璃镜 / 租借男友同款引导）。
//
// 两条必须守住的规矩（白屏事故根因，别改回去）：
//   1. 用 `typeof $` 守卫分流 —— 浏览器裸跑（无酒馆助手注入 jQuery）时
//      裸写 `$(() => …)` 会抛 ReferenceError 白屏；没有 $ 就退 DOMContentLoaded。
//   2. 不要用 createScriptIdIframe 脚本模式引导 —— 正则 iframe 环境里该 API 不存在。
function onReady(fn: () => void): void {
  try {
    if (typeof $ === 'function') {
      $(fn);
      return;
    }
  } catch {
    /* $ 未定义 */
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function onPageHide(fn: () => void): void {
  try {
    if (typeof $ === 'function') {
      $(window).on('pagehide', fn);
      return;
    }
  } catch {
    /* $ 未定义 */
  }
  window.addEventListener('pagehide', fn, { once: true });
}

onReady(() => {
  const container = document.getElementById('root');
  if (!container) return;

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  onPageHide(() => {
    try {
      root.unmount();
    } catch {
      /* 卸载失败不阻塞页面销毁 */
    }
  });
});
