/**
 * 重新生成当前楼层（重 roll）—— 静默原位替换，**不删楼、不建楼**
 *
 * 为什么不能用「删楼 + 重建」：那样楼层会先消失再出现，iframe 重挂载，
 * 全屏被踢掉、阅读进度丢失，玩家看到的就是"闪一下"。正解是静默生成后
 * 用 setChatMessages 直接替换原楼内容（`refresh: 'none'`，不触发重载）。
 *
 * ⚠️ 一条容易写错的铁律：**写回的是模型原文，不是剥净文本**。
 * 楼层即存档，读取端（解析器 / 历史视图）统一剥离思维链；如果把剥净后的
 * 正文写回去，就销毁了楼层自身的格式，后续解析会退化、变量块也会丢。
 */

import { stripThinking } from './stripThinking';
import {
  emitStoryUpdated,
  generateSilently,
  getLastFloorId,
  readFloor,
  readFloorRange,
  replaceFloorText,
} from './tavernBridge';

/** 重生成时历史窗口保留的最近 AI 楼层数（窗口内的玩家楼一并带上） */
const REGEN_ASSISTANT_FLOORS = 5;

export type RegenResult = { success: true } | { success: false; error: string };

export async function regenerateCurrentFloor(): Promise<RegenResult> {
  try {
    // ── 步骤 1：定位最后一楼，必须是我们能播的 AI 楼层 ──
    const lastFloorId = getLastFloorId();
    if (lastFloorId == null) return { success: false, error: '未找到最后一楼层' };
    const lastFloor = readFloor(lastFloorId);
    if (!lastFloor) return { success: false, error: '未找到最后一楼层' };
    if (lastFloor.role !== 'assistant') {
      return { success: false, error: '最后一楼层不是 AI 楼层，无法重新生成' };
    }

    // ── 步骤 2：向上找最近的玩家楼层作输入 ──
    let userText = '';
    let userFloorId = -1;
    for (let i = lastFloorId - 1; i >= 0; i--) {
      const m = readFloor(i);
      if (m?.role === 'user') {
        userText = m.message || '';
        userFloorId = i;
        break;
      }
    }
    if (!userText) return { success: false, error: '未找到上一层的玩家输入' };

    // ── 步骤 3：窗口化历史 ──
    // 关键不变量：**被重生成的旧楼层不在窗口内**，否则模型会照抄旧输出。
    // AI 楼剥思维链后再发：楼层原文含思考块，裸发既泄露格式又浪费 token。
    const historyEnd = userFloorId - 1;
    const all = historyEnd >= 0 ? readFloorRange(0, historyEnd) : [];
    let windowed = all;
    let assistantSeen = 0;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].role === 'assistant' && ++assistantSeen >= REGEN_ASSISTANT_FLOORS) {
        windowed = all.slice(i);
        break;
      }
    }
    const historyPrompts = windowed.map(m => ({
      role: m.role as 'system' | 'assistant' | 'user',
      content: m.role === 'assistant' ? stripThinking(m.message || '') : m.message || '',
    }));

    // ── 步骤 4：静默生成（不建新楼层）──
    const raw = await generateSilently({ userInput: userText, historyPrompts });
    if (!raw) return { success: false, error: 'AI 返回了空响应' };

    // ── 步骤 5：剥思维链 —— 只用于后续变量解析，写回的仍是原文（见步骤 7）──
    void stripThinking(raw);

    // ── 步骤 6：变量重算（MVU）──
    // 魔都尚未接入 MVU（S5 才做）。MVU 缺席时静默降级：正文照常原位替换，
    // 变量不重算。接入后在此处补 Mvu.parseMessage(filtered, oldData)。

    // ── 步骤 7：原位替换楼层内容（写回模型原文，见文件头铁律）──
    await replaceFloorText(lastFloorId, raw);

    // ── 步骤 8：通知各楼刷新（不触发全屏退出，红线 11）──
    emitStoryUpdated();

    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error)?.message || '重新生成失败' };
  }
}
