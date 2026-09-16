import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronsDown,
  FastForward,
  ListChecks,
  Pause,
  Play,
  Send,
  Zap,
} from 'lucide-react';
import { TypingText } from './TypingText';
import { THEME_TOKENS, type CastTheme, findCastMember } from '../../data/cast';

/** 语速档位文案（与 TypingText 的 SPEED_DELAY 对齐：0 瞬发 → 3 迅疾） */
const SPEED_LABEL = ['瞬发', '舒缓', '适中', '迅疾'] as const;

interface DialogueBoxProps {
  active?: boolean;
  speaker?: string;
  text: string;
  lineType?: 'dialog' | 'narrator' | 'thought';
  theme?: CastTheme;
  isAuto: boolean;
  toggleAuto: () => void;
  onOpenLog: () => void;
  onNext: () => void;
  textSpeed?: number;
  skipAllRef?: React.RefObject<boolean>;
  onTypingStateChange?: (typing: boolean) => void;
  // ── 阅读控制 ──
  canPrev?: boolean;
  onPrev?: () => void;
  onCycleSpeed?: () => void;
  // ── 楼层翻卷（原来在 HUD，现在跟阅读动作放一起）──
  canPrevFloor?: boolean;
  canNextFloor?: boolean;
  onPrevFloor?: () => void;
  onNextFloor?: () => void;
  onFollowLatest?: () => void;
  isViewingHistory?: boolean;
  // ── 抉择重展 ──
  canReshowOptions?: boolean;
  onReshowOptions?: () => void;
  // ── 折叠 ──
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  // ── 输入模式（正文原地变输入框）──
  inputMode?: boolean;
  draft?: string;
  onDraftChange?: (value: string) => void;
  onDraftSend?: () => void;
  onEnterInput?: () => void;
  onExitInput?: () => void;
  isGenerating?: boolean;
  /** 底部输入栏已展开时传 false：任一时刻只暴露一个「发送」入口，避免视觉重复 */
  showDraftEntry?: boolean;
}

/**
 * 文本框 —— 上下分层：名牌骑压上缘 / 正文 / 控制条。
 *
 * 打字机仍由 TypingText 这个叶子组件驱动（红线 2），本组件对每帧吐字零感知：
 * 只有 TypingText 内部 state 变，名牌、控制条、按钮一概不重渲染。
 */
export function DialogueBox({
  active = true,
  speaker,
  text,
  lineType = 'dialog',
  theme = 'rose',
  isAuto,
  toggleAuto,
  onOpenLog,
  onNext,
  textSpeed = 2,
  skipAllRef,
  onTypingStateChange,
  canPrev = false,
  onPrev,
  onCycleSpeed,
  canPrevFloor = false,
  canNextFloor = false,
  onPrevFloor,
  onNextFloor,
  onFollowLatest,
  isViewingHistory = false,
  canReshowOptions = false,
  onReshowOptions,
  collapsed = false,
  onToggleCollapse,
  inputMode = false,
  draft = '',
  onDraftChange,
  onDraftSend,
  onEnterInput,
  onExitInput,
  isGenerating = false,
  showDraftEntry = true,
}: DialogueBoxProps) {
  const [isTyping, setIsTyping] = useState(false);
  const localSkipRef = useRef(false);
  const skipRef = skipAllRef ?? localSkipRef;
  const draftRef = useRef<HTMLTextAreaElement>(null);

  // 进输入模式即聚焦（选项回填也走这条路）
  useEffect(() => {
    if (!inputMode) return;
    const frame = requestAnimationFrame(() => draftRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [inputMode]);

  const handleTypingState = useCallback(
    (typing: boolean) => {
      setIsTyping(typing);
      onTypingStateChange?.(typing);
    },
    [onTypingStateChange],
  );

  const handleClick = useCallback(() => {
    if (!active) return;
    // 打字中第一次点击 = 跳过，第二次 = 下一句
    if (isTyping) {
      skipRef.current = true;
      return;
    }
    onNext();
  }, [active, isTyping, onNext, skipRef]);

  const handleDraftKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onExitInput?.();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        onDraftSend?.();
      }
    },
    [onDraftSend, onExitInput],
  );

  // ── 收起点：只在右下角留一枚还原按钮 ──
  if (collapsed) {
    return (
      <section className="mato-dialogue" data-collapsed="true">
        <button className="mato-dialogue__expand" onClick={onToggleCollapse} aria-label="展开文本框">
          <ChevronUp size={16} />
          <span>正文</span>
        </button>
      </section>
    );
  }

  const showName = Boolean(speaker) && lineType !== 'narrator';
  const speedLabel = SPEED_LABEL[textSpeed] ?? SPEED_LABEL[2];

  return (
    <section
      className="mato-dialogue"
      data-line-type={lineType}
      data-input-mode={inputMode ? 'true' : undefined}
      style={{ '--plate-accent': THEME_TOKENS[theme].accent } as React.CSSProperties}
    >
      {/* 上缘：名牌骑压（对话）/ 朱印方章（旁白） */}
      <div className="mato-dialogue__plate">
        {showName ? (
          <span className="nameplate">
            {speaker}
            {findCastMember(speaker!)?.title && <small>{findCastMember(speaker!)?.title}</small>}
          </span>
        ) : (
          <span className="mato-dialogue__seal" title="旁白">
            叙
          </span>
        )}
      </div>

      <div
        id="vn-textbox"
        className="mato-dialogue__body surface-vn"
        onClick={inputMode ? undefined : handleClick}
        role={inputMode ? undefined : 'button'}
        tabIndex={inputMode ? -1 : active ? 0 : -1}
        aria-label={inputMode ? undefined : '推进剧情'}
        onKeyDown={
          inputMode
            ? undefined
            : event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  handleClick();
                }
              }
        }
      >
        {inputMode ? (
          <textarea
            ref={draftRef}
            id="mato-draft"
            className="mato-dialogue__draft"
            value={draft}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            disabled={isGenerating}
            placeholder={isGenerating ? '续写中…' : '行动…'}
            onChange={event => onDraftChange?.(event.target.value)}
            onKeyDown={handleDraftKeyDown}
          />
        ) : (
          <>
            <TypingText
              text={text}
              textSpeed={textSpeed}
              lineType={lineType}
              skipRef={skipRef}
              onTypingStateChange={handleTypingState}
              className="mato-dialogue__text"
            />
            {!isTyping && (
              <span className="mato-dialogue__next" aria-hidden="true">
                ◆
              </span>
            )}
          </>
        )}
      </div>

      <div className="mato-dialogue__bar">
        {inputMode ? (
          <div className="mato-dialogue__controls">
            <button
              id="btn-draft-send"
              className="is-primary"
              onClick={onDraftSend}
              disabled={!draft.trim() || isGenerating}
            >
              <Send size={15} />
              <span>发送</span>
            </button>
            <button onClick={onExitInput} disabled={isGenerating}>
              <span>收合</span>
            </button>
          </div>
        ) : (
          <div className="mato-dialogue__controls">
            <button title="记录" onClick={onOpenLog}>
              <BookOpen size={15} />
              <span>记录</span>
            </button>
            <button title="上一句" disabled={!canPrev} onClick={onPrev}>
              <ChevronLeft size={15} />
              <span>上句</span>
            </button>
            <button title="自动播放" aria-pressed={isAuto} onClick={toggleAuto}>
              {isAuto ? <Pause size={15} /> : <Play size={15} />}
              <span>自动</span>
            </button>
            <button title={`语速：${speedLabel}（点击切换）`} onClick={onCycleSpeed}>
              {textSpeed >= 3 ? <Zap size={15} /> : <FastForward size={15} />}
              <span>{speedLabel}</span>
            </button>
            {canReshowOptions && (
              <button title="重展抉择" onClick={onReshowOptions}>
                <ListChecks size={15} />
                <span>抉择</span>
              </button>
            )}
            {showDraftEntry && (
              <button className="is-primary" title="起草行动" onClick={onEnterInput}>
                <Send size={15} />
                <span>发送</span>
              </button>
            )}
          </div>
        )}

        <div className="mato-dialogue__tools">
          <button id="btn-floor-prev" aria-label="上一卷" title="上一卷" disabled={!canPrevFloor} onClick={onPrevFloor}>
            <ChevronUp size={15} />
          </button>
          <button id="btn-floor-next" aria-label="下一卷" title="下一卷" disabled={!canNextFloor} onClick={onNextFloor}>
            <ChevronDown size={15} />
          </button>
          {isViewingHistory && (
            <button id="btn-floor-latest" aria-label="回到最新楼层" title="回到最新楼层" onClick={onFollowLatest}>
              <ChevronsDown size={15} />
            </button>
          )}
          <button className="mato-dialogue__collapse" aria-label="收起文本框" title="收起文本框" onClick={onToggleCollapse}>
            <ChevronDown size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

export default DialogueBox;
