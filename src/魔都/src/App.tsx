import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { DialogueBox } from './components/game/DialogueBox';
import { ChatInput } from './components/game/ChatInput';
import { CombatP5, type CombatResult } from './components/game/CombatP5';
import { parseBattleTrigger } from './scriptParser';
import { StageBackdrop } from './components/game/StageBackdrop';
import { SpriteStage } from './components/game/SpriteStage';
import { OptionsPanel } from './components/game/OptionsPanel';
import { HUD } from './components/layout/HUD';
import { SystemBoot } from './components/layout/SystemBoot';
import { TacticalModal } from './components/ui/TacticalComponents';
import { NotificationSystem } from './components/ui/NotificationSystem';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { AtmosphereLayer } from './components/fx/AtmosphereLayer';
import { ModalType, NotificationItem } from './types';
import { ArchivePanel, SettingsPanel, TerritoryPanel, HistoryPanel } from './components/game/GamePanels';
import { ThinkingPanel } from './components/game/ThinkingPanel';
import { ManualPanel } from './components/game/ManualPanel';
import { DeleteFloorPanel } from './components/game/DeleteFloorPanel';
import { GameProvider, useGameContext } from './store/GameContext';
import { useFloorNav } from './store/useFloorNav';

// ── 酒馆适配层 ──
import { useIsMobile } from './hooks';
import { startIframeGuard, type GuardHandle } from './utils/iframeGuard';
import {
  applyPseudoFullscreen,
  clearPseudoFullscreen,
  isFullscreenActive,
  enterFullscreen,
  exitFullscreen,
} from './utils/fullscreen';
import { installTTFullscreenReassert } from './utils/ttFullscreenCompat';
import { readPlayerName, savePlayerName, validatePlayerName } from './utils/playerProfile';

// ══════════════════════════════════════════════════════════════
// 外壳：通知状态 + 玩家名 + GameProvider
// ══════════════════════════════════════════════════════════════
function AppShell() {
  const [playerName, setPlayerName] = useState(readPlayerName);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const notificationTimers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const addNotification = useCallback((title: string, message: string, type: NotificationItem['type']) => {
    const id = Math.random().toString(36).slice(2, 11);
    setNotifications(prev => [...prev, { id, title, message, type }]);
    const timer = setTimeout(() => {
      notificationTimers.current.delete(timer);
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
    notificationTimers.current.add(timer);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  useEffect(
    () => () => {
      for (const timer of notificationTimers.current) clearTimeout(timer);
      notificationTimers.current.clear();
    },
    [],
  );

  return (
    <GameProvider playerName={playerName} onNotify={addNotification}>
      <AppContent
        playerName={playerName}
        setPlayerName={setPlayerName}
        notifications={notifications}
        addNotification={addNotification}
        removeNotification={removeNotification}
      />
    </GameProvider>
  );
}

// ══════════════════════════════════════════════════════════════
// 主体：入口 / 全屏 / 舞台
// ══════════════════════════════════════════════════════════════
interface AppContentProps {
  playerName: string;
  setPlayerName: (name: string) => void;
  notifications: NotificationItem[];
  addNotification: (title: string, message: string, type: NotificationItem['type']) => void;
  removeNotification: (id: string) => void;
}

function AppContent({ playerName, setPlayerName, notifications, addNotification, removeNotification }: AppContentProps) {
  const [isBooting, setIsBooting] = useState(true);
  const [gameRequested, setGameRequested] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [entryKey, setEntryKey] = useState(0);
  const [isAuto, setIsAuto] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [textSpeed, setTextSpeed] = useState(2);
  const [textScale, setTextScale] = useState(1);
  const [activeModal, setActiveModal] = useState<ModalType>('none');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsDismissed, setOptionsDismissed] = useState(false);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [draft, setDraft] = useState('');
  const [inputOpen, setInputOpen] = useState(false);
  const [inputMode, setInputMode] = useState(false);
  const [dialogueCollapsed, setDialogueCollapsed] = useState(false);
  /** 非 null 即处于战斗场景（story=true 表示由剧情标签触发） */
  const [battle, setBattle] = useState<{ enemy: string; story: boolean } | null>(null);

  // ── 事件层信号（唯一来源是 GameContext）──
  const script = useGameContext(c => c.script);
  const options = useGameContext(c => c.options);
  const floorText = useGameContext(c => c.floorText);
  const targetFloorId = useGameContext(c => c.targetFloorId);
  const isGenerating = useGameContext(c => c.isGenerating);
  const pendingMessage = useGameContext(c => c.pendingMessage);
  const setPendingMessage = useGameContext(c => c.setPendingMessage);
  const send = useGameContext(c => c.send);

  const isFullscreenRef = useRef(false);
  const nativeSeen = useRef(false);
  const gameRef = useRef<HTMLDivElement>(null);
  const startupRef = useRef<AbortController | null>(null);
  const startupPending = useRef(false);
  const guardRef = useRef<GuardHandle | null>(null);
  const isMobile = useIsMobile();
  /** 与 index.css 的 700px 断点一致：决定输入走文本框内还是底部输入栏 */
  const narrow = useIsMobile(700);
  const nav = useFloorNav();

  const currentLine = script[Math.min(currentLineIndex, Math.max(0, script.length - 1))];
  const atLastLine = currentLineIndex >= script.length - 1;

  /** 正文尾部 [battle:敌方名] —— 整楼播完才切战斗画面 */
  const battleTrigger = useMemo(() => parseBattleTrigger(floorText ?? ''), [floorText]);
  const lastBattleFloorRef = useRef<number | null>(null);

  useEffect(() => {
    if (!battleTrigger || targetFloorId == null || isBooting) return;
    // 同一楼只触发一次（读完最后一行才切，中途不打断阅读）
    if (lastBattleFloorRef.current === targetFloorId) return;
    if (!atLastLine) return;
    lastBattleFloorRef.current = targetFloorId;
    setBattle({ enemy: battleTrigger.enemy, story: true });
  }, [battleTrigger, targetFloorId, atLastLine, isBooting]);

  // ── 阅读进度保持（防抖②）──
  // 区分「回到看过的楼层（恢复进度）」与「本楼重新生成（从头读）」；
  // 事件抖动触发的同层重解析、正文未变时，阅读位置不动。
  const lastParseKeyRef = useRef<{ floor: number | null; content?: string }>({ floor: null, content: undefined });
  const progressRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const prev = lastParseKeyRef.current;
    const isRegen = prev.floor === targetFloorId && prev.content !== floorText;
    lastParseKeyRef.current = { floor: targetFloorId, content: floorText ?? undefined };
    if (isRegen && targetFloorId != null) progressRef.current.delete(targetFloorId);
    const saved = targetFloorId != null ? progressRef.current.get(targetFloorId) : undefined;
    setCurrentLineIndex(saved != null && saved < script.length ? saved : 0);
    // script.length 进依赖：楼层切换后行数变了要重新决定起点
  }, [targetFloorId, floorText, script.length]);

  useEffect(() => {
    guardRef.current = startIframeGuard(isMobile, true);
    return () => {
      guardRef.current?.destroy();
      guardRef.current = null;
    };
  }, [isMobile]);

  /** 回到入口页（同时是退出沉浸的唯一出口） */
  const returnToEntry = useCallback(() => {
    startupRef.current?.abort();
    nativeSeen.current = false;
    isFullscreenRef.current = false;
    setIsFullscreen(false);
    setGameRequested(false);
    setIsBooting(true);
    setIsAuto(false);
    setActiveModal('none');
    setOptionsOpen(false);
    setEntryKey(key => key + 1);
    void exitFullscreen().finally(() => guardRef.current?.burst());
  }, []);

  const prepareGame = useCallback(
    async (rawName: string, signal: AbortSignal) => {
      const name = validatePlayerName(rawName);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (startupPending.current) throw new Error('上一次全屏请求仍在结束，请稍后重试。');
      const attempt = new AbortController();
      startupRef.current = attempt;
      startupPending.current = true;
      const abort = () => attempt.abort();
      signal.addEventListener('abort', abort, { once: true });
      const checkActive = () => {
        if (attempt.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!isFullscreenActive()) throw new Error('未能进入全屏。请允许全屏权限，或在酒馆楼层内重试。');
      };
      try {
        // First await follows the native request, preserving the original click activation.
        const entered = await enterFullscreen();
        checkActive();
        if (!entered) throw new Error('未能进入全屏，请检查酒馆助手或浏览器权限。');
        isFullscreenRef.current = true;
        nativeSeen.current = Boolean(document.fullscreenElement);
        setIsFullscreen(true);
        // Mount only AFTER successful fullscreen. Nothing game-related runs on the entry.
        setGameRequested(true);
        await new Promise<void>((resolve, reject) => {
          let frame = 0;
          let frames = 0;
          let fontsReady = !document.fonts;
          const started = performance.now();
          const cleanup = () => {
            cancelAnimationFrame(frame);
            clearTimeout(timeout);
            attempt.signal.removeEventListener('abort', onAbort);
          };
          const fail = (error: unknown) => {
            cleanup();
            reject(error);
          };
          const onAbort = () => fail(new DOMException('Aborted', 'AbortError'));
          const timeout = setTimeout(() => fail(new Error('界面准备超时，请重试。')), 8000);
          attempt.signal.addEventListener('abort', onAbort, { once: true });
          if (document.fonts)
            document.fonts.ready.then(
              () => {
                fontsReady = true;
              },
              () => {
                fontsReady = true;
              },
            );
          const tick = (now: number) => {
            try {
              checkActive();
            } catch (error) {
              fail(error);
              return;
            }
            frames = gameRef.current ? frames + 1 : 0;
            if (frames >= 2 && (fontsReady || now - started >= 1800)) {
              cleanup();
              resolve();
              return;
            }
            frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        });
        checkActive();
        // One synchronous commit; no draft writes and no delayed writes after chat switch.
        savePlayerName(name);
        setPlayerName(name);
      } catch (error) {
        isFullscreenRef.current = false;
        nativeSeen.current = false;
        setIsFullscreen(false);
        setGameRequested(false);
        await exitFullscreen();
        guardRef.current?.burst();
        throw error;
      } finally {
        signal.removeEventListener('abort', abort);
        if (startupRef.current === attempt) startupRef.current = null;
        startupPending.current = false;
      }
    },
    [setPlayerName],
  );

  const completeBoot = useCallback(() => {
    if (!isFullscreenActive()) {
      returnToEntry();
      return;
    }
    setHasEntered(true);
    setIsBooting(false);
  }, [returnToEntry]);

  useEffect(() => {
    if (!isBooting) gameRef.current?.focus({ preventScroll: true });
  }, [isBooting]);

  const handleToggleFullscreen = returnToEntry;

  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) {
        nativeSeen.current = true;
        return;
      }
      if (nativeSeen.current) returnToEntry();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isFullscreenActive()) return;
      // 兜底：覆盖层自己处理 Esc。焦点万一跑到覆盖层外，也绝不能顺手把游戏退了。
      if (document.querySelector('.mato-modal, [data-mato-sidebar], .mato-battle')) return;
      returnToEntry();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('keydown', onEscape);
    };
  }, [returnToEntry]);

  useEffect(() => {
    try {
      if (typeof eventOn !== 'function' || typeof tavern_events === 'undefined') return;
      const listener = eventOn(tavern_events.CHAT_CHANGED, () => {
        returnToEntry();
        setPlayerName(readPlayerName());
        setHasEntered(false);
        setCurrentLineIndex(0);
        setOptionsDismissed(false);
      });
      return () => {
        try {
          listener.stop();
        } catch {
          /* Host may already have disposed it. */
        }
      };
    } catch {
      return;
    }
  }, [returnToEntry, setPlayerName]);

  useEffect(
    () =>
      installTTFullscreenReassert(
        () => {
          applyPseudoFullscreen();
        },
        () => isFullscreenRef.current,
      ),
    [],
  );

  useEffect(
    () => () => {
      startupRef.current?.abort();
      isFullscreenRef.current = false;
      nativeSeen.current = false;
      clearPseudoFullscreen();
    },
    [],
  );

  // 自动播放：等当前行打完字再计时；生成期间不自动推进
  useEffect(() => {
    if (!isAuto || isBooting || isTyping || isGenerating || activeModal !== 'none' || optionsOpen) return undefined;
    if (atLastLine) {
      setIsAuto(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setCurrentLineIndex(prev => prev + 1), 3200);
    return () => clearTimeout(timer);
  }, [isAuto, isBooting, isTyping, isGenerating, atLastLine, currentLineIndex, activeModal, optionsOpen]);

  /** 选项起草：桌面进文本框输入模式、手机拉出底部输入栏；都只回填，等玩家确认再发 */
  useEffect(() => {
    if (pendingMessage == null) return;
    setDraft(pendingMessage);
    if (narrow) {
      setInputMode(false);
      setInputOpen(true);
      requestAnimationFrame(() => (document.getElementById('mato-input') as HTMLTextAreaElement | null)?.focus());
    } else {
      setInputMode(true);
    }
  }, [pendingMessage, narrow]);

  /** 提示该玩家出手了：桌面把文本框变成输入框，手机拉出底部输入栏 */
  const focusDraft = useCallback(() => {
    if (narrow) {
      setInputOpen(true);
      requestAnimationFrame(() => (document.getElementById('mato-input') as HTMLTextAreaElement | null)?.focus());
      return;
    }
    setInputMode(true);
  }, [narrow]);

  /**
   * 翻页：还有下一行就前进；到末尾则交给选项面板，没选项就提示本层结束。
   * 生成期间一律不动（画面锁定）。
   */
  const handleNext = useCallback(() => {
    if (isBooting || isGenerating) return;
    if (currentLineIndex < script.length - 1) {
      const next = currentLineIndex + 1;
      if (targetFloorId != null) progressRef.current.set(targetFloorId, next);
      setCurrentLineIndex(next);
      return;
    }
    if (options.length > 0 && !optionsDismissed) {
      setOptionsOpen(true);
      return;
    }
    focusDraft();
  }, [isBooting, isGenerating, currentLineIndex, script.length, targetFloorId, options.length, optionsDismissed, focusDraft]);

  /** 上一句：回退一行（读快了想重看的刚需，幻璃镜式控制条里的「上句」） */
  const handlePrev = useCallback(() => {
    if (isBooting || isGenerating) return;
    if (currentLineIndex <= 0) return;
    const next = currentLineIndex - 1;
    if (targetFloorId != null) progressRef.current.set(targetFloorId, next);
    setCurrentLineIndex(next);
  }, [isBooting, isGenerating, currentLineIndex, targetFloorId]);

  /** 语速四档循环：瞬发 → 舒缓 → 适中 → 迅疾（不必再进设置弹窗） */
  const cycleTextSpeed = useCallback(() => {
    setTextSpeed(prev => (prev >= 3 ? 0 : prev + 1));
  }, []);

  const handleEnterInput = useCallback(() => {
    if (isGenerating) return;
    setInputMode(true);
  }, [isGenerating]);

  const handleExitInput = useCallback(() => setInputMode(false), []);

  /** 抽屉里的「战斗演习」：开一场练习战，不影响剧情 */
  const handleOpenModal = useCallback((type: ModalType) => {
    if (type === 'combat') {
      setBattle(current => current ?? { enemy: '丑鬼', story: false });
      return;
    }
    setActiveModal(type);
  }, []);

  const handleBattleExit = useCallback(
    (result: CombatResult) => {
      if (battle?.story && result === 'win') {
        addNotification('战斗结束', '目标已歼灭。可以继续行动了。', 'success');
      }
      setBattle(null);
    },
    [battle, addNotification],
  );

  /** 选中选项：只起草（回填输入框），不直发 */
  const handleSelectOption = useCallback(
    (option: string) => {
      setOptionsOpen(false);
      setOptionsDismissed(true);
      setPendingMessage(option);
    },
    [setPendingMessage],
  );

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isGenerating) return;
    setDraft('');
    setOptionsDismissed(false);
    setPendingMessage(null);
    // 发完回到阅读态，等新楼层播出来（否则会一直停在输入框上）
    setInputMode(false);
    void send(text);
  }, [draft, isGenerating, send, setPendingMessage]);

  return (
    <div className="mato-shell relative h-full w-full overflow-hidden bg-ink-950 font-sans text-paper-200">
      {isBooting && (
        <SystemBoot
          key={entryKey}
          prepare={prepareGame}
          onComplete={completeBoot}
          onCancel={returnToEntry}
          initialName={playerName}
          returning={hasEntered}
          fullscreen={isFullscreen}
        />
      )}

      {gameRequested && isFullscreen && (
        <div
          ref={gameRef}
          data-mato-game="true"
          data-mato-staged={isBooting ? 'true' : undefined}
          tabIndex={-1}
          aria-label="魔都游戏界面"
          inert={isBooting}
          aria-hidden={isBooting}
          className="mato-game relative h-full w-full outline-none"
          style={{ '--mato-reading-size': `${[18, 21, 25][textScale]}px` } as React.CSSProperties}
        >
          {/* ── 舞台（全部静止：没有任何一层跟鼠标位移）──
              层级令牌见 index.css：场景 z-0 · 角色 z-10 · 氛围 z-15
              · 文本框 z-20 · 选项 z-25 · HUD z-30 · 弹窗 z-40 */}

          <StageBackdrop location={currentLine?.location} />

          <SpriteStage lines={script} index={currentLineIndex} playerName={playerName} />

          <AtmosphereLayer motes={!isBooting} />

          <DialogueBox
            active={!isBooting && !optionsOpen && activeModal === 'none' && !isGenerating}
            speaker={currentLine?.speaker}
            text={currentLine?.text ?? ''}
            lineType={currentLine?.type ?? 'narrator'}
            theme={currentLine?.theme}
            isAuto={isAuto}
            toggleAuto={() => setIsAuto(v => !v)}
            onOpenLog={() => setActiveModal('history')}
            onNext={handleNext}
            textSpeed={textSpeed}
            onTypingStateChange={setIsTyping}
            canPrev={currentLineIndex > 0}
            onPrev={handlePrev}
            onCycleSpeed={cycleTextSpeed}
            canPrevFloor={nav.canPrev}
            canNextFloor={nav.canNext}
            onPrevFloor={nav.goPrev}
            onNextFloor={nav.goNext}
            onFollowLatest={nav.goLatest}
            isViewingHistory={nav.isViewingHistory}
            canReshowOptions={options.length > 0 && optionsDismissed}
            onReshowOptions={() => {
              setOptionsDismissed(false);
              setOptionsOpen(true);
            }}
            collapsed={dialogueCollapsed}
            onToggleCollapse={() => setDialogueCollapsed(v => !v)}
            inputMode={inputMode}
            draft={draft}
            onDraftChange={setDraft}
            onDraftSend={handleSend}
            onEnterInput={handleEnterInput}
            onExitInput={handleExitInput}
            isGenerating={isGenerating}
            showDraftEntry={!narrow}
          />

          {/* 按端分工：桌面走文本框内输入，手机走底部输入栏 —— 屏幕上永远只有一个输入位 */}
          {narrow && !inputMode && (
            <ChatInput
              value={draft}
              onChange={setDraft}
              onSend={handleSend}
              isGenerating={isGenerating}
              open={inputOpen}
              onOpenChange={setInputOpen}
            />
          )}

          <OptionsPanel
            show={optionsOpen && !isBooting && !isGenerating}
            options={options}
            onSelect={handleSelectOption}
            onDismiss={() => {
              setOptionsOpen(false);
              setOptionsDismissed(true);
            }}
          />

          <HUD
            onOpenModal={handleOpenModal}
            onToggleFullscreen={handleToggleFullscreen}
            isFullscreen={isFullscreen}
            playerName={playerName}
            locationName={currentLine?.location?.displayName}
          />

          {/* 屏幕颗粒质感：压在 UI 之上、弹窗之下（模拟屏幕玻璃） */}
          <div className="noise-overlay pointer-events-none absolute inset-0 z-[38] opacity-[0.035] mix-blend-overlay" />

          <NotificationSystem notifications={notifications} removeNotification={removeNotification} />

          <AnimatePresence>
            {battle && (
              <CombatP5
                key="mato-battle"
                enemyName={battle.enemy}
                story={battle.story}
                onExit={handleBattleExit}
              />
            )}
          </AnimatePresence>

          <TacticalModal id="modal-settings" isOpen={activeModal === 'settings'} onClose={() => setActiveModal('none')} title="设置">
            <SettingsPanel speed={textSpeed} setSpeed={setTextSpeed} textScale={textScale} setTextScale={setTextScale} />
          </TacticalModal>
          <TacticalModal id="modal-database" isOpen={activeModal === 'database'} onClose={() => setActiveModal('none')} title="人物档案">
            <ArchivePanel />
          </TacticalModal>
          <TacticalModal id="modal-map" isOpen={activeModal === 'map'} onClose={() => setActiveModal('none')} title="魔都领域">
            <TerritoryPanel />
          </TacticalModal>
          <TacticalModal id="modal-history" isOpen={activeModal === 'history'} onClose={() => setActiveModal('none')} title="记录">
            <HistoryPanel lines={script.slice(0, currentLineIndex + 1)} />
          </TacticalModal>
          <TacticalModal id="modal-thinking" isOpen={activeModal === 'thinking'} onClose={() => setActiveModal('none')} title="推演记录">
            <ThinkingPanel />
          </TacticalModal>
          <TacticalModal id="modal-manual" isOpen={activeModal === 'manual'} onClose={() => setActiveModal('none')} title="操作手册">
            <ManualPanel />
          </TacticalModal>
          <TacticalModal id="modal-delete" isOpen={activeModal === 'delete'} onClose={() => setActiveModal('none')} title="删除楼层">
            <DeleteFloorPanel onDone={() => setActiveModal('none')} />
          </TacticalModal>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
