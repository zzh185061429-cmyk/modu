import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * 打字机文本 —— **独立叶子组件**（红线 2）
 *
 * 打字进度是这里的内部 state。父组件（DialogueBox / 舞台）对每帧吐字零感知：
 * 每吐一个字只重渲染本组件，立绘、背景、HUD、文本框外壳一概不动。
 *
 * 反面教材（本项目 v2 的写法）：打字进度放在播放屏的 state 里，每次 setState
 * 都重渲染整棵舞台树——一个字一次全树 diff，长台词直接掉帧。
 *
 * 驱动用 requestAnimationFrame + 时间累积，不用 setInterval（后者在后台标签页
 * 会漂移、且无法与帧率对齐）。跳过走 skipRef：父组件把它置 true，下一帧即补全。
 */

interface TypingTextProps {
  /** 本行完整文本 */
  text: string;
  /** 速度档：0 = 瞬发，1 = 慢，2 = 普通，3 = 快 */
  textSpeed?: number;
  /** 整段跳过（自动播放 / 快进模式下置 true） */
  isSkipping?: boolean;
  /** 行类型 —— 决定正文配色 */
  lineType?: 'dialog' | 'narrator' | 'thought';
  /** 上抛打字状态：父组件据此拦截翻页（打字中第一次点击 = 跳过，第二次 = 下一行） */
  onTypingStateChange?: (isTyping: boolean) => void;
  /** 跳过开关（父组件持有，点击时置 true） */
  skipRef?: React.RefObject<boolean>;
  /** 附加类名（排版由父组件决定，本组件只管吐字） */
  className?: string;
}

/** 速度档 → 每字符毫秒 */
const SPEED_DELAY: Record<number, number> = { 0: 0, 1: 58, 2: 34, 3: 16 };

/** 行类型 → 正文配色（对话框 / 旁白 / 内心独白三态） */
const LINE_TONE: Record<'dialog' | 'narrator' | 'thought', string> = {
  dialog: 'text-paper-100',
  narrator: 'text-paper-300',
  thought: 'text-orchid-200 italic',
};

export const TypingText = React.memo(
  function TypingText({
    text,
    textSpeed = 2,
    isSkipping = false,
    lineType = 'dialog',
    onTypingStateChange,
    skipRef,
    className,
  }: TypingTextProps) {
    const [displayed, setDisplayed] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const localSkipRef = useRef(false);
    const effectiveSkipRef = skipRef ?? localSkipRef;

    const notify = useCallback(
      (typing: boolean) => {
        setIsTyping(typing);
        onTypingStateChange?.(typing);
      },
      [onTypingStateChange],
    );

    useEffect(() => {
      let rafId = 0;
      let cancelled = false;
      effectiveSkipRef.current = false;

      // 瞬发档 / 整段跳过：直接给全文，不进 rAF 循环
      if (textSpeed === 0 || isSkipping) {
        setDisplayed(text);
        notify(false);
        return;
      }

      setDisplayed('');
      notify(true);

      const delay = SPEED_DELAY[textSpeed] ?? SPEED_DELAY[2];
      let i = 0;
      let last = performance.now();

      const step = (now: number) => {
        if (cancelled) return;
        if (effectiveSkipRef.current) {
          setDisplayed(text);
          notify(false);
          return;
        }
        if (now - last < delay) {
          rafId = requestAnimationFrame(step);
          return;
        }
        last = now;
        if (i < text.length) {
          // 快档一次吐 3 字，长台词不至于等太久
          const batch = textSpeed >= 3 ? 3 : 1;
          const end = Math.min(i + batch, text.length);
          setDisplayed(text.slice(0, end));
          i = end;
          rafId = requestAnimationFrame(step);
        } else {
          notify(false);
        }
      };

      rafId = requestAnimationFrame(step);
      return () => {
        cancelled = true;
        if (rafId) cancelAnimationFrame(rafId);
      };
    }, [text, textSpeed, isSkipping, effectiveSkipRef, notify]);

    return (
      <p
        className={`${LINE_TONE[lineType]} ${className ?? ''}`}
        data-line-tone={lineType}
      >
        {displayed}
        {isTyping && (
          <span
            aria-hidden="true"
            className="ml-1 inline-block h-[0.9em] w-[0.45em] translate-y-[0.08em] animate-pulse bg-rose-400/85 align-baseline"
          />
        )}
      </p>
    );
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.textSpeed === next.textSpeed &&
    prev.isSkipping === next.isSkipping &&
    prev.lineType === next.lineType &&
    prev.className === next.className,
);

export default TypingText;
