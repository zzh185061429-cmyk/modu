import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { parseOptions, parseScriptContent, type ScriptLine } from '../scriptParser';
import type { NotificationItem } from '../types';
import {
  cutFloors,
  getLatestAssistantFloorId,
  iframeEventName,
  isLocalDemoMode,
  listAssistantFloors,
  onTavernEvent,
  readFloorText,
  sendMessage,
  STORY_UPDATED_EVENT,
  tavernEventName,
} from '../utils/tavernBridge';
import { regenerateCurrentFloor } from '../utils/interaction';
import { onVariableUpdateEnded } from '../utils/mvu';

/**
 * GameContext —— **唯一的事件接入点**（架构铁律 1）
 *
 * 所有 `eventOn` 监听只写在这一个文件里，UI 只吃四个信号：
 *   lastAssistantFloorId / generatingFloorId / isGenerating / storyVersion
 * 播放屏对酒馆事件零感知：它拿到楼层号后用 `readFloorText` 拉正文做纯函数解析。
 *
 * 为什么必须收口：监听散落各处时，任何一个组件都能 bump storyVersion，
 * 于是"生成期间播放位置莫名跳回第 0 行"这类 bug 会变得无法定位。
 *
 * ── 楼层三态（S4 的核心模型）──
 *   targetFloorId = viewingFloorId ?? lastAssistantFloorId
 *   viewingFloorId === null  → 跟随最新（生成完自动落到新楼）
 *   viewingFloorId !== null  → 回看历史（画面锁住不动）
 *
 * ── 三处防抖（本阶段头号 bug 农场）──
 *   ① 流式生成期间不 bump storyVersion（否则把锁定中的楼层误判为"本楼重生成"，
 *      播放屏重置回第 0 行、背景与立绘提前切换）
 *   ② 同楼层正文未变时保阅读进度 —— 在播放屏里做（它才知道 currentLineIndex）
 *   ③ 双路径生成结束：应用内发送流程不在 GENERATION_ENDED 时 bump
 *      （finishGenerating 更新 lastAssistantFloorId 自会触发重算）
 */

interface GameContextValue {
  // ── 四个信号 ──
  lastAssistantFloorId: number | null;
  generatingFloorId: number | null;
  isGenerating: boolean;
  storyVersion: number;

  // ── 楼层三态 ──
  viewingFloorId: number | null;
  setViewingFloor: (floorId: number | null) => void;
  /** 实际渲染的楼层号 = viewingFloorId ?? lastAssistantFloorId */
  targetFloorId: number | null;
  isViewingHistory: boolean;

  // ── 楼层列表与当前剧本 ──
  floors: number[];
  floorText: string | null;
  script: ScriptLine[];
  options: string[];

  // ── 动作 ──
  send: (text: string) => Promise<void>;
  removeFloor: (floorId: number) => Promise<void>;
  /** 焚卷：按范围彻底删除楼层（/cut start-end）。删楼是破坏性动作，只走这一个口子。 */
  cutFloorRange: (start: number, end: number) => Promise<void>;
  regenerate: () => Promise<void>;

  // ── 选项起草（点击只起草，确认才发送）──
  pendingMessage: string | null;
  setPendingMessage: (text: string | null) => void;

  /** 是否处于本地降级模式（无酒馆宿主） */
  isLocalDemo: boolean;
}

const GameContext = createContext<GameContextValue | undefined>(undefined);

interface GameProviderProps {
  children: ReactNode;
  playerName?: string;
  onNotify: (title: string, message: string, type: NotificationItem['type']) => void;
}

export function GameProvider({ children, playerName, onNotify }: GameProviderProps) {
  // ── 四信号 state ──
  const [lastAssistantFloorId, setLastAssistantFloorId] = useState<number | null>(null);
  const [generatingFloorId, setGeneratingFloorId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storyVersion, setStoryVersion] = useState(0);

  // ── 三态 ──
  const [viewingFloorId, setViewingFloorId] = useState<number | null>(null);
  const [floors, setFloors] = useState<number[]>([]);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  // ── ref 镜像：事件回调闭包拿不到最新 state，必须镜像 ──
  const isGeneratingRef = useRef(false);
  const generatingFloorIdRef = useRef<number | null>(null);
  const viewingFloorIdRef = useRef<number | null>(null);
  const lastAssistantFloorIdRef = useRef<number | null>(null);
  isGeneratingRef.current = isGenerating;
  generatingFloorIdRef.current = generatingFloorId;
  viewingFloorIdRef.current = viewingFloorId;
  lastAssistantFloorIdRef.current = lastAssistantFloorId;

  const onNotifyRef = useRef(onNotify);
  onNotifyRef.current = onNotify;

  /** 楼层列表刷新（内容不变时保持原引用，避免无谓重渲染） */
  const refreshFloors = useCallback(() => {
    const next = listAssistantFloors();
    setFloors(prev => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
  }, []);

  // ── 事件监听：全部收在这里 ──
  useEffect(() => {
    const syncLatestFloor = () => {
      const latestId = getLatestAssistantFloorId();
      refreshFloors();
      if (latestId == null) return;
      if (isGeneratingRef.current) {
        // 生成中：新楼层号进 generatingFloorId，不动 lastAssistantFloorId
        if (generatingFloorIdRef.current == null || latestId > generatingFloorIdRef.current) {
          setGeneratingFloorId(latestId);
        }
      } else {
        setLastAssistantFloorId(prev => (prev === latestId ? prev : latestId));
      }
    };

    const stops: (() => void)[] = [];

    stops.push(
      onTavernEvent(tavernEventName('CHAT_CHANGED', 'chat_changed'), () => {
        // 切聊天：重建全部派生状态，回跟随模式
        refreshFloors();
        setLastAssistantFloorId(getLatestAssistantFloorId());
        setViewingFloorId(null);
        setGeneratingFloorId(null);
        setIsGenerating(false);
        setStoryVersion(v => v + 1);
      }),
    );

    stops.push(
      onTavernEvent(tavernEventName('MESSAGE_RECEIVED', 'message_received'), () => {
        syncLatestFloor();
      }),
    );

    stops.push(
      onTavernEvent(tavernEventName('MESSAGE_UPDATED', 'message_updated'), (...args: unknown[]) => {
        const messageId = typeof args[0] === 'number' ? (args[0] as number) : undefined;
        syncLatestFloor();
        // 防抖①：新楼层流式生成期间，MESSAGE_UPDATED 携带的是新楼层号；
        // 此时 bump 会让播放屏把锁定中的楼层误判为"本楼重生成"而重置回第 0 行。
        // 只有被更新的正是锁定中的楼层（本楼重生成）才刷新。
        if (isGeneratingRef.current && messageId != null && messageId !== viewingFloorIdRef.current) return;
        setStoryVersion(v => v + 1);
      }),
    );

    stops.push(
      onTavernEvent(iframeEventName('GENERATION_ENDED', 'generation_ended'), () => {
        setTimeout(syncLatestFloor, 300);
        // 防抖③：应用内发送流程（isGenerating 中）不在此 bump ——
        // finishGenerating 更新 lastAssistantFloorId 本身就会触发重算。
        if (!isGeneratingRef.current) setStoryVersion(v => v + 1);
      }),
    );

    // 自定义事件：删楼 / 重roll 的兜底刷新（红线 11：绝不 location.reload()）
    stops.push(
      onTavernEvent(STORY_UPDATED_EVENT, () => {
        syncLatestFloor();
        setStoryVersion(v => v + 1);
      }),
    );

    syncLatestFloor();
    return () => stops.forEach(stop => stop());
  }, [refreshFloors]);

  // ── MVU 收账挂载点（架构预留，MVU 尚未接入）──
  // 无 `Mvu` 全局时 onVariableUpdateEnded 直接返回空操作，前端不受影响。
  // 接入后要做的事见 docs/MVU接入.md：变量结构定稿 → 在此按 ClampRule[] 夹逼
  // → 同步派生 UI（HUD 数值）→ 阈值提醒（对比 variablesBefore 判断增减）。
  //
  // 收账铁律：只在回调内**直接改写传入的 variables**（框架随后落盘）；
  // 不要在这里 readStatData() 重读——时序上会拿到旧值。
  useEffect(() => {
    const stop = onVariableUpdateEnded((variables, variablesBefore) => {
      void variables;
      void variablesBefore;
      // TODO(MVU): 变量结构定稿后在此夹逼 + 派生同步。
    });
    return stop;
  }, []);

  // ── 三态派生 ──
  const targetFloorId = viewingFloorId ?? lastAssistantFloorId;
  const isViewingHistory = viewingFloorId !== null;

  // ── 剧本：楼层原文 → 解析器（纯函数）──
  const floorText = useMemo(() => {
    void storyVersion; // 版本变化时强制重读楼层原文
    if (targetFloorId == null) return null;
    return readFloorText(targetFloorId);
  }, [targetFloorId, storyVersion]);

  const script = useMemo(() => (floorText ? parseScriptContent(floorText, playerName) : []), [floorText, playerName]);
  const options = useMemo(() => (floorText ? parseOptions(floorText) : []), [floorText]);

  // ── 生成锁 ──
  const startGenerating = useCallback(() => {
    // 锁定画面到当前楼层：生成期间播放位置不动
    const lockFloor = viewingFloorIdRef.current ?? lastAssistantFloorIdRef.current;
    if (lockFloor != null) setViewingFloorId(lockFloor);
    setIsGenerating(true);
  }, []);

  const finishGenerating = useCallback(() => {
    setIsGenerating(false);
    const newFloorId = getLatestAssistantFloorId();
    if (newFloorId != null) {
      setGeneratingFloorId(newFloorId);
      setLastAssistantFloorId(newFloorId);
    }
    refreshFloors();
    // 解锁 → targetFloorId 切到新楼 → 解析重跑 → 从新楼第 0 行开始
    setViewingFloorId(null);
  }, [refreshFloors]);

  // ── 动作：发送 ──
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (isGeneratingRef.current) {
        onNotifyRef.current('正在生成', '请等待当前生成完成。', 'warning');
        return;
      }
      setPendingMessage(null);
      startGenerating();
      try {
        await sendMessage(trimmed);
        finishGenerating();
      } catch (err) {
        setIsGenerating(false);
        setViewingFloorId(null);
        onNotifyRef.current('发送失败', (err as Error)?.message || '未知错误', 'error');
      }
    },
    [startGenerating, finishGenerating],
  );

  // ── 动作：删楼（范围）──
  const cutFloorRange = useCallback(
    async (start: number, end: number) => {
      if (isGeneratingRef.current) {
        onNotifyRef.current('正在生成', '生成期间不能删除楼层。', 'warning');
        return;
      }
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      try {
        await cutFloors(from, to);
        const viewing = viewingFloorIdRef.current;
        if (viewing != null && viewing >= from && viewing <= to) setViewingFloorId(null);
        refreshFloors();
        setLastAssistantFloorId(getLatestAssistantFloorId());
        setStoryVersion(v => v + 1);
        onNotifyRef.current(
          '已删除楼层',
          from === to ? `第 ${from} 楼已移除。` : `第 ${from} 至 ${to} 楼已移除。`,
          'info',
        );
      } catch (err) {
        onNotifyRef.current('删除失败', (err as Error)?.message || '未知错误', 'error');
      }
    },
    [refreshFloors],
  );

  // ── 动作：删当前楼（范围删除的单楼特例）──
  const removeFloor = useCallback((floorId: number) => cutFloorRange(floorId, floorId), [cutFloorRange]);

  // ── 动作：重新生成当前楼层（静默原位替换，不删楼不建楼）──
  const regenerate = useCallback(async () => {
    if (isGeneratingRef.current) {
      onNotifyRef.current('正在生成', '请等待当前生成完成。', 'warning');
      return;
    }
    startGenerating();
    try {
      const result = await regenerateCurrentFloor();
      if (result.success) {
        onNotifyRef.current('已重新生成', '本楼内容已原位替换。', 'success');
      } else {
        onNotifyRef.current('重新生成失败', result.error, 'warning');
      }
      finishGenerating();
    } catch (err) {
      setIsGenerating(false);
      setViewingFloorId(null);
      onNotifyRef.current('重新生成失败', (err as Error)?.message || '未知错误', 'error');
    }
  }, [startGenerating, finishGenerating]);

  const value = useMemo<GameContextValue>(
    () => ({
      lastAssistantFloorId,
      generatingFloorId,
      isGenerating,
      storyVersion,
      viewingFloorId,
      setViewingFloor: setViewingFloorId,
      targetFloorId,
      isViewingHistory,
      floors,
      floorText,
      script,
      options,
      send,
      removeFloor,
      cutFloorRange,
      regenerate,
      pendingMessage,
      setPendingMessage,
      isLocalDemo: isLocalDemoMode(),
    }),
    [
      lastAssistantFloorId,
      generatingFloorId,
      isGenerating,
      storyVersion,
      viewingFloorId,
      targetFloorId,
      isViewingHistory,
      floors,
      floorText,
      script,
      options,
      send,
      removeFloor,
      cutFloorRange,
      regenerate,
      pendingMessage,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGameContext<T>(selector: (value: GameContextValue) => T): T {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGameContext 必须在 <GameProvider> 内使用');
  return selector(ctx);
}

export type { GameContextValue };
