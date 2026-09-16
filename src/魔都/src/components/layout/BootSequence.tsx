import React, { memo, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import './BootSequence.css';
import { OFFICIAL_LOGO } from '../../data/assets';
import { ART } from '../../data/art';

type BootPhase = 'idle' | 'loading' | 'ready' | 'cut' | 'error';
interface SystemBootProps {
  prepare: (signal: AbortSignal) => Promise<void>;
  onComplete: () => void;
  onCancel: () => void;
  motionPaused?: boolean;
}

// The cut, light, and both clipping masks share exactly the same geometry.
// SVG coordinates stretch WITH the iframe, rather than rotating a vw-sized bar.
const CUT = 'M -100 740 L 1100 260';
const SHARDS = Array.from({ length: 16 }, (_, i) => ({
  x: 14 + ((i * 17) % 74),
  delay: 140 + (i % 4) * 18,
  dx: (i % 2 ? 1 : -1) * (35 + (i % 5) * 20),
  dy: (i % 2 ? 1 : -1) * (75 + (i % 4) * 35),
}));

/** 静态双线徽记，不包含旋转环或魔法阵。 */
export const Seal = memo(function Seal({ className = 'mato-boot__seal' }: { className?: string }) {
  return (
    <svg className={`mato-seal ${className}`} viewBox="0 0 400 400" fill="none" aria-hidden="true" focusable="false">
      <rect x="28" y="28" width="344" height="344" stroke="currentColor" strokeWidth="1" />
      <rect x="40" y="40" width="320" height="320" stroke="currentColor" strokeWidth="0.5" />
    </svg>
  );
});

/** 纸面与锁链保持静态，进度跳字不触发底衬重渲染。 */
const BootBackdrop = memo(function BootBackdrop({ phase }: { phase: BootPhase }) {
  const ready = phase === 'ready' || phase === 'cut';
  return (
    <>
      <div className="mato-boot__frame" data-ready={ready} aria-hidden="true" />
      <div className="mato-boot__watermark" aria-hidden="true">七</div>
      <img className="mato-boot__chain mato-boot__chain--left" src={ART.chains} alt="" draggable={false} />
      <img className="mato-boot__chain mato-boot__chain--right" src={ART.chains} alt="" draggable={false} />
    </>
  );
});

/** 品牌区保留 memo，避免逐帧重复处理内联图片。 */
const BootEmblem = memo(function BootEmblem() {
  return (
    <>
      <div className="mato-boot__logo">
        <img src={OFFICIAL_LOGO} alt="魔都精兵的奴隶" draggable={false} />
      </div>
      <span className="mato-boot__eyebrow">CHAINED SOLDIER</span>
    </>
  );
});

/** 进度叶子沿用既有状态，不改变实际准备与转场时序。 */
function BootProgress({ progress, phase }: { progress: number; phase: BootPhase }) {
  const ready = phase === 'ready' || phase === 'cut';
  return (
    <>
      <div className="mato-boot__progress-heading">
        <span>{phase === 'error' ? '载入失败' : ready ? '载入完成' : '正在载入'}</span>
        <span className="mato-boot__number">{String(progress).padStart(2, '0')}<small>%</small></span>
      </div>
      <div className="mato-boot__track"><div style={{ transform: `scaleX(${progress / 100})` }} /></div>
    </>
  );
}

function BootSurface({ progress, phase }: { progress: number; phase: BootPhase }) {
  const idle = phase === 'idle';
  return (
    <div className="mato-boot__surface">
      <BootBackdrop phase={phase} />
      <div className="mato-boot__composition">
        <BootEmblem />
        <div className="mato-boot__status-area">
          {!idle && <BootProgress progress={progress} phase={phase} />}
        </div>
      </div>
    </div>
  );
}

/** Mounted only after fullscreen is established. Original load / draw / split timing is retained. */
export function BootSequence({ prepare, onComplete, onCancel, motionPaused = false }: SystemBootProps) {
  const [phase, setPhase] = useState<BootPhase>('loading');
  const [progress, setProgress] = useState(0);
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = systemReducedMotion || motionPaused;
  const completed = useRef(false);
  const completeRef = useRef(onComplete);
  const surfaceRef = useRef<HTMLElement>(null);
  completeRef.current = onComplete;

  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    completeRef.current();
  };

  useEffect(() => { surfaceRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const controller = new AbortController();
    let raf = 0;
    let prepared = false;
    let failed = false;
    const start = performance.now();
    // Progress describes startup staging, NOT fictitious download bytes.
    // It cannot reach 100 until the actual game preparation has resolved.
    Promise.resolve().then(() => prepare(controller.signal)).then(() => {
      if (!controller.signal.aborted) prepared = true;
    }).catch(() => {
      if (!controller.signal.aborted) {
        failed = true;
        setPhase('error');
      }
    });
    const tick = (now: number) => {
      if (controller.signal.aborted || failed) return;
      const elapsed = now - start;
      const next = Math.min(94, Math.floor((1 - Math.exp(-elapsed / 680)) * 100));
      if (prepared && elapsed >= (reducedMotion ? 250 : 1650)) {
        setProgress(100);
        setPhase('ready');
        return;
      }
      setProgress(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      controller.abort();
      cancelAnimationFrame(raf);
    };
  }, [phase, prepare, reducedMotion]);

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'cut') return;
    const timer = window.setTimeout(() => {
      if (phase === 'ready') setPhase('cut');
      else if (!completed.current) {
        completed.current = true;
        completeRef.current();
      }
    }, phase === 'ready' ? (reducedMotion ? 80 : 460) : (reducedMotion ? 180 : 1380));
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);

  const slicing = phase === 'cut';
  const message = phase === 'idle' ? '点击进入，准备出击。' : phase === 'loading' ? '正在加载游戏界面。' : phase === 'error' ? '界面准备失败，请重试。' : '加载完成，进入游戏。';

  return (
    <section ref={surfaceRef} tabIndex={-1} className="mato-boot" data-phase={phase} data-reduced-motion={Boolean(reducedMotion)} role="dialog" aria-modal="true" aria-label="魔都精兵的奴隶 · 出击准备" onKeyDown={event => {
      if (event.key === 'Tab') {
        const button = surfaceRef.current?.querySelector('button');
        if (button) { event.preventDefault(); button.focus(); }
      }
    }}>
      <div className="mato-boot__sr" role="status" aria-live="polite">{message}</div>
      {/* 两块半屏是同一棵树的实例；树内静态部分已 memo 化，逐帧只有进度叶子重渲染。 */}
      <div className="mato-boot__panels" aria-hidden="true">
        <div className="mato-boot__half mato-boot__half--upper"><BootSurface progress={progress} phase={phase} /></div>
        <div className="mato-boot__half mato-boot__half--lower"><BootSurface progress={progress} phase={phase} /></div>
      </div>
      {phase === 'loading' && <div className="mato-boot__sr" role="progressbar" aria-label="启动进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} />}
      {(phase === 'idle' || phase === 'error') && (
        <div className="mato-boot__action">
          <button type="button" className="mato-boot__start" onClick={onCancel}>
            <span>返回入口</span><span aria-hidden="true">／</span>
          </button>
        </div>
      )}
      {phase === 'ready' && <div className="mato-boot__command" aria-hidden="true"><span>七</span></div>}
      {slicing && (
        <div className="mato-boot__fx" aria-hidden="true">
          <svg className="mato-boot__slash" viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none">
            <path className="mato-boot__wake" d="M-100 747 Q485 396 1100 260 Q456 506 -100 747Z" fill="var(--mato-line, #d4c8c7)" />
            <path className="mato-boot__stroke mato-boot__stroke--ink" d={CUT} pathLength="1" stroke="var(--mato-ink, #261e29)" strokeWidth="11" />
            <path className="mato-boot__stroke mato-boot__stroke--aura" d={CUT} pathLength="1" stroke="var(--mato-red, #9d1831)" strokeWidth="6" />
            <path className="mato-boot__stroke mato-boot__stroke--core" d={CUT} pathLength="1" stroke="var(--mato-paper, #f6f3ef)" strokeWidth="1.7" />
            <path className="mato-boot__echo" d="M-60 741Q430 535 1000 317" stroke="var(--mato-muted, #796b70)" strokeWidth="0.6" />
          </svg>
          <div className="mato-boot__glint"><i /><b /></div>
          <div className="mato-boot__impact" />
          {SHARDS.map((shard, i) => (
            <i key={i} className="mato-boot__shard" style={{
              left: `${shard.x}%`, top: `${70 - shard.x * 0.4}%`,
              '--dx': `${shard.dx}px`, '--dy': `${shard.dy}px`, '--r': `${(i % 2 ? 1 : -1) * (60 + i * 23)}deg`,
              animationDelay: `${shard.delay}ms`,
            } as React.CSSProperties} />
          ))}
        </div>
      )}
      {phase === 'loading' && <button className="mato-boot__skip" onClick={onCancel}>取消进入</button>}
      {(phase === 'ready' || phase === 'cut') && <button className="mato-boot__skip" onClick={finish}>跳过转场 <span aria-hidden="true">↗</span></button>}
    </section>
  );
}
