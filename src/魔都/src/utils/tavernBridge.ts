/**
 * 酒馆 API 适配层（tavernBridge）
 *
 * 全项目**唯一**直接调用酒馆助手楼层类全局函数的地方。规则：
 *   - 每个调用都包 `typeof` 守卫 + try/catch —— 浏览器裸跑（无酒馆助手注入）时
 *     一律降级，绝不抛异常、绝不白屏（红线 5）。
 *   - **无宿主时走内存楼层模拟**：本地无头验收因此能跑完整条链路
 *     （读楼层 → 解析 → 发送 → 落新楼 → 跳楼 → 删楼），而不是只能验个静态界面。
 *     真机与本地两条路径在这里分流，且各自可辨认——本地通过不许冒充真机通过。
 *
 * 真值边界（务必分清）：
 *   - 本地能验：楼层三态、生成锁状态机、解析位置保持、导航 UI、降级不崩
 *   - 只有真酒馆能验：事件真的从宿主来、iframe 提升、界面正则、MVU 落盘、CDN
 */

import { DEMO_FLOORS } from '../data/story';

/** 自定义事件名 —— 命名前缀第一天定死（红线 9） */
export const STORY_UPDATED_EVENT = 'mato_story_updated';

export interface FloorMessage {
  message_id: number;
  role: string;
  message: string;
}

// ── 宿主探测 ──

/** 是否有酒馆宿主（TavernHelper 注入的楼层函数存在） */
export function hasTavernHost(): boolean {
  return typeof getChatMessages === 'function' && typeof getLastMessageId === 'function';
}

/** 是否处于本地降级（无宿主）模式 —— UI 据此提示"本地演示" */
export function isLocalDemoMode(): boolean {
  return !hasTavernHost();
}

/** 宿主事件名（宿主未就绪时回落到字面量，避免读 undefined 崩掉） */
export function tavernEventName(
  key: 'CHAT_CHANGED' | 'MESSAGE_RECEIVED' | 'MESSAGE_UPDATED',
  fallback: string,
): string {
  try {
    const ev = typeof tavern_events !== 'undefined' ? (tavern_events as Record<string, string> | undefined) : undefined;
    const v = ev?.[key];
    if (typeof v === 'string' && v) return v;
  } catch {
    /* 宿主未就绪 */
  }
  return fallback;
}

/** iframe 事件名（GENERATION_ENDED 在 iframe_events 下） */
export function iframeEventName(key: 'GENERATION_ENDED', fallback: string): string {
  try {
    const ev = typeof iframe_events !== 'undefined' ? (iframe_events as Record<string, string> | undefined) : undefined;
    const v = ev?.[key];
    if (typeof v === 'string' && v) return v;
  } catch {
    /* 宿主未就绪 */
  }
  return fallback;
}

// ── 内存楼层模拟（无宿主时的降级路径）──

let mockFloors: FloorMessage[] = [];
let mockReplyCursor = 0;

function ensureMock(): FloorMessage[] {
  if (mockFloors.length === 0) {
    mockFloors = [
      { message_id: 0, role: 'user', message: '（开局）' },
      { message_id: 1, role: 'assistant', message: DEMO_FLOORS[0] },
    ];
    mockReplyCursor = 1;
  }
  return mockFloors;
}

function mockGet(floorId: number): FloorMessage | null {
  const list = ensureMock();
  // 支持负数索引（-1 = 最后一楼），与酒馆 API 同语义
  const idx = floorId < 0 ? list.length + floorId : floorId;
  return list[idx] ?? null;
}

// ── 楼层读取 ──

/** 扫出全部 assistant 楼层号（升序） */
export function listAssistantFloors(): number[] {
  if (!hasTavernHost()) {
    return ensureMock()
      .filter(m => m.role === 'assistant')
      .map(m => m.message_id);
  }
  try {
    const messages = getChatMessages('0-{{lastMessageId}}', { role: 'assistant' });
    return messages.map(m => m.message_id).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/** 取最新 assistant 楼层号（最后一楼不是 assistant 时向前回退一层） */
export function getLatestAssistantFloorId(): number | null {
  if (!hasTavernHost()) {
    const assistants = listAssistantFloors();
    return assistants.length > 0 ? assistants[assistants.length - 1] : null;
  }
  try {
    const lastId = getLastMessageId();
    if (lastId == null) return null;
    const msg = getChatMessages(lastId)[0];
    if (!msg) return null;
    if (msg.role === 'assistant') return msg.message_id;
    if (lastId > 0) {
      const prev = getChatMessages(lastId - 1)[0];
      if (prev && prev.role === 'assistant') return prev.message_id;
    }
    return null;
  } catch {
    return null;
  }
}

/** 最后一楼的层号（不要求是 assistant —— 重roll 要判它到底是不是 AI 楼） */
export function getLastFloorId(): number | null {
  if (!hasTavernHost()) {
    const list = ensureMock();
    return list.length > 0 ? list[list.length - 1].message_id : null;
  }
  try {
    const id = getLastMessageId();
    return typeof id === 'number' ? id : null;
  } catch {
    return null;
  }
}

/** 读单楼原文（楼层即存档，读的是原文含思维链/标签） */
export function readFloorText(floorId: number): string | null {
  if (!hasTavernHost()) return mockGet(floorId)?.message ?? null;
  try {
    const msgs = getChatMessages(floorId);
    return msgs?.[0]?.message ?? null;
  } catch {
    return null;
  }
}

/** 读一层楼（含 role） */
export function readFloor(floorId: number): FloorMessage | null {
  if (!hasTavernHost()) return mockGet(floorId);
  try {
    const m = getChatMessages(floorId)?.[0];
    if (!m) return null;
    return { message_id: m.message_id, role: m.role, message: m.message ?? '' };
  } catch {
    return null;
  }
}

/** 读一段楼层（含 role），用于重生成的历史窗口 */
export function readFloorRange(start: number, end: number): FloorMessage[] {
  if (!hasTavernHost()) {
    const list = ensureMock();
    return list.filter(m => m.message_id >= start && m.message_id <= end);
  }
  try {
    if (end < start) return [];
    return (getChatMessages(`${start}-${end}`) ?? []).map(m => ({
      message_id: m.message_id,
      role: m.role,
      message: m.message ?? '',
    }));
  } catch {
    return [];
  }
}

// ── 事件 ──

/** 本地事件总线：无宿主时替代酒馆事件源（本地验收靠它驱动刷新） */
const localBus = new EventTarget();

/**
 * 监听宿主事件。返回 stop 函数（永远可用，宿主不可用时退化为本地总线）。
 * 无宿主时只有 `mato_story_updated` 会在本地总线上被触发。
 */
export function onTavernEvent(name: string, handler: (...args: unknown[]) => void): () => void {
  let stop: (() => void) | undefined;
  try {
    if (typeof eventOn === 'function') {
      const ret = eventOn(name, handler as (...args: never[]) => void);
      stop = () => {
        try {
          ret?.stop?.();
        } catch {
          /* 宿主可能已自行销毁 */
        }
      };
    }
  } catch {
    /* 宿主事件不可用 → 走本地总线 */
  }
  if (!stop) {
    const local = () => handler();
    localBus.addEventListener(name, local);
    stop = () => localBus.removeEventListener(name, local);
  }
  return stop;
}

/**
 * 通知各楼刷新（删楼 / 重roll 后用）。
 * 红线 11：刷新绝不 location.reload()——重载会退出全屏、丢阅读进度与前端状态。
 */
export function emitStoryUpdated(): void {
  let emitted = false;
  try {
    if (typeof eventEmit === 'function') {
      eventEmit(STORY_UPDATED_EVENT);
      emitted = true;
    }
  } catch {
    /* 宿主不可用 → 走本地总线 */
  }
  if (!emitted) localBus.dispatchEvent(new Event(STORY_UPDATED_EVENT));
}

// ── 写入 / 生成 ──

/**
 * 发送一条玩家消息并触发生成。
 *
 * 必须走 STScript `/send`（不用 createChatMessages / triggerGeneration）——
 * 只有走 /send 才过酒馆设置：预设、世界书、正则全部生效。
 */
export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (!hasTavernHost()) {
    // 本地降级：模拟一次生成往返（含 user 楼 + assistant 楼），供本地验收
    await new Promise(resolve => setTimeout(resolve, 500));
    const list = ensureMock();
    list.push({ message_id: list.length, role: 'user', message: trimmed });
    const reply = DEMO_FLOORS[mockReplyCursor % DEMO_FLOORS.length];
    mockReplyCursor++;
    list.push({ message_id: list.length, role: 'assistant', message: reply });
    emitStoryUpdated();
    return;
  }

  await triggerSlash('/send ' + trimmed);
  await triggerSlash('/trigger await=true');
}

/** 删楼（/cut 是彻底删除；deleteChatMessages 只清内容，别用错） */
export async function cutFloors(start: number, end: number): Promise<void> {
  if (!hasTavernHost()) {
    await new Promise(resolve => setTimeout(resolve, 200));
    ensureMock();
    mockFloors = mockFloors.filter(m => m.message_id < start || m.message_id > end);
    emitStoryUpdated();
    return;
  }
  await triggerSlash(`/cut ${start}-${end}`);
}

/** 原位替换楼层内容（重roll 用：不删楼、不建楼，iframe 零重载） */
export async function replaceFloorText(floorId: number, text: string): Promise<void> {
  if (!hasTavernHost()) {
    const target = ensureMock().find(m => m.message_id === floorId);
    if (target) target.message = text;
    emitStoryUpdated();
    return;
  }
  await setChatMessages([{ message_id: floorId, message: text }], { refresh: 'none' });
}

/** 静默生成（不建新楼层），重roll 用 */
export async function generateSilently(params: {
  userInput: string;
  historyPrompts: { role: 'system' | 'assistant' | 'user'; content: string }[];
}): Promise<string> {
  if (!hasTavernHost()) {
    await new Promise(resolve => setTimeout(resolve, 400));
    // 本地降级：换个楼层池里的下一段当"重生成结果"
    const reply = DEMO_FLOORS[(mockReplyCursor + 1) % DEMO_FLOORS.length];
    mockReplyCursor++;
    return reply;
  }
  const result = await generate({
    user_input: params.userInput,
    should_stream: false,
    should_silence: true,
    overrides: {
      chat_history: { prompts: params.historyPrompts },
    },
  });
  return typeof result === 'string' ? result : '';
}
