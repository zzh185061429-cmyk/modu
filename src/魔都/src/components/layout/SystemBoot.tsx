import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BootSequence, Seal } from './BootSequence';
import './SystemBoot.css';
import { validatePlayerName } from '../../utils/playerProfile';
import { OFFICIAL_LOGO } from '../../data/assets';
import { ART } from '../../data/art';

type BootPhase = 'idle' | 'entering' | 'error';
interface SystemBootProps {
  prepare: (name: string, signal: AbortSignal) => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
  initialName: string;
  returning: boolean;
  fullscreen: boolean;
}

export function SystemBoot({ prepare, onComplete, onCancel, initialName, returning, fullscreen }: SystemBootProps) {
  const [name, setName] = useState(initialName);
  const [phase, setPhase] = useState<BootPhase>('idle');
  const [error, setError] = useState('');
  const [motionPaused, setMotionPaused] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const busy = phase === 'entering';
  const preparation = useRef<Promise<void> | null>(null);
  const sheet = useRef<HTMLElement>(null);
  const waitForGame = useCallback(() => {
    return preparation.current ?? Promise.reject(new Error('启动请求尚未创建。'));
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  // SillyTavern injects this UI straight into its own document (the load script does
  // $('body').load(url)), so the sheet is NOT inside an iframe. Two things break a
  // wheel that lands on the sheet:
  //   1. the sheet is only as tall as its content, so a wheel over it has nothing to
  //      consume, yet the element still swallows the gesture instead of letting the
  //      chat log behind it scroll;
  //   2. when the sheet does scroll, reaching either end must hand the rest of the
  //      gesture back to the host, or scrolling "sticks".
  // Handle the wheel explicitly and forward the leftover delta to the nearest
  // scrollable ancestor, so the pointer never becomes dead space.
  useEffect(() => {
    const root = sheet.current;
    if (!root) return;

    const scrollableAncestor = (): HTMLElement | null => {
      let node: HTMLElement | null = root.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
        if (scrollable && node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    };

    const onWheel = (event: WheelEvent) => {
      // Leave horizontal gestures (trackpads) to the browser.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      let delta = event.deltaY;
      if (event.deltaMode === 1) delta *= 16;                          // lines
      else if (event.deltaMode === 2) delta *= root.clientHeight;      // pages

      const maxTop = root.scrollHeight - root.clientHeight;
      const canOwn = maxTop > 1;

      if (!canOwn) {
        // Nothing to scroll here: forward the whole gesture so the page behind the
        // sheet keeps moving under the pointer.
        const host = scrollableAncestor();
        if (host) {
          event.preventDefault();
          host.scrollTop += delta;
        }
        return;
      }

      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop >= maxTop - 1;
      const wantsUp = delta < 0;
      if ((wantsUp && atTop) || (!wantsUp && atBottom)) {
        // At the end of our own range: pass the remainder to the host.
        const host = scrollableAncestor();
        if (host) {
          event.preventDefault();
          host.scrollTop += delta;
        }
        return;
      }

      event.preventDefault();
      root.scrollTop = Math.max(0, Math.min(maxTop, root.scrollTop + delta));
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  // Same iframe problem on touch: a drag on the sheet is often claimed by the host
  // page as a page swipe, so the sheet never moves. Own the gesture once it is
  // clearly a vertical drag, while leaving taps, caret placement and text
  // selection in the name field completely alone.
  useEffect(() => {
    const root = sheet.current;
    if (!root) return;

    let startX = 0;
    let startY = 0;
    let startTop = 0;
    let tracking = false;
    let decided = false;
    let owned = false;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { tracking = false; return; }
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTop = root.scrollTop;
      tracking = true;
      decided = false;
      owned = false;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (!decided) {
        // Wait until the gesture is unambiguous: 8px of travel and clearly more
        // vertical than horizontal. Anything else belongs to the page or the field.
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true;
        owned = Math.abs(dy) > Math.abs(dx);
        if (!owned) { tracking = false; return; }
      }

      // Let the browser keep a gesture when the sheet is already at that end, so
      // the host page can still scroll behind the frame.
      const canScrollUp = root.scrollTop > 0;
      const canScrollDown = root.scrollTop + root.clientHeight < root.scrollHeight - 1;
      if ((dy > 0 && !canScrollUp) || (dy < 0 && !canScrollDown)) { tracking = false; return; }

      if (event.cancelable) event.preventDefault();
      root.scrollTop = startTop - dy;
    };

    const onEnd = () => { tracking = false; decided = false; owned = false; };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd, { passive: true });
    root.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    if (controller.current || composing.current) return;
    let value: string;
    try { value = validatePlayerName(name); } catch {
      setError('请填写 1–12 个字符的名字。');
      setPhase('error');
      input.current?.focus();
      return;
    }
    const attempt = new AbortController();
    controller.current = attempt;
    setError('');
    setPhase('entering');
    try {
      // Do NOT defer this to an effect: native fullscreen requires the original gesture.
      preparation.current = prepare(value, attempt.signal);
      // Resolving preparation only unlocks 100%; the original split animation owns completion.
      await preparation.current;
    } catch (reason) {
      if (attempt.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : '暂时无法进入，请重试。');
      setPhase('error');
    } finally {
      if (controller.current === attempt) controller.current = null;
    }
  };

  // Replace, rather than cover, the entry sheet: split panels must reveal the game,
  // not an opaque name form. The sequence cannot mount before fullscreen succeeds.
  if (busy && fullscreen) {
    return <BootSequence prepare={waitForGame} onComplete={onComplete} onCancel={onCancel} motionPaused={motionPaused} />;
  }

  return (
    <section ref={sheet} className="mato-entry" data-phase={phase} data-motion-paused={motionPaused} aria-labelledby="mato-entry-title" aria-busy={busy}>
      <div className="mato-entry__sheet">
        <div className="mato-entry__content">
          <header className="mato-entry__cover">
            <div className="mato-entry__logo">
              <img src={OFFICIAL_LOGO} alt="" draggable={false} />
              <h1 id="mato-entry-title" className="mato-entry__title">魔都精兵<span>的奴隶</span></h1>
            </div>
            <span className="mato-entry__brand">CHAINED SOLDIER</span>
          </header>
          <form className="mato-entry__form" onSubmit={start} noValidate>
            <label htmlFor="mato-player-name">姓名</label>
            <input ref={input} id="mato-player-name" name="mato-player-name" value={name} autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={Boolean(error)} aria-describedby="mato-entry-feedback" onChange={event => { setName(event.target.value); setError(''); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
            <button type="submit" className="mato-entry__enter" disabled={busy}>
              <span>{busy ? (fullscreen ? '正在载入' : '正在进入全屏') : (returning ? '继续游戏' : '开始游戏')}</span>
              <span className="mato-entry__arrow" aria-hidden="true" />
            </button>
            <div id="mato-entry-feedback" className="mato-entry__feedback" role="status" aria-live="polite">{error}</div>
            {busy && <button className="mato-entry__cancel" type="button" onClick={() => { controller.current?.abort(); onCancel(); }}>取消进入</button>}
          </form>
          <button className="mato-entry__motion" type="button" aria-label={motionPaused ? '恢复动效' : '暂停动效'} title={motionPaused ? '恢复动效' : '暂停动效'} aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}><span aria-hidden="true" /></button>
        </div>
        <div className="mato-entry__portrait" aria-hidden="true">
          <span className="mato-entry__seven">七</span>
          <img className="mato-entry__hero" src={ART.kyoka} alt="" draggable={false} />
          <img className="mato-entry__chains" src={ART.chains} alt="" draggable={false} />
        </div>
      </div>
    </section>
  );
}
