/**
 * 魔都 · 剧本解析器
 *
 * 纯函数：楼层文本 → ScriptLine[]。零酒馆依赖，可在浏览器外单测。
 * 这是 S1 的核心交付物，也是前端与 AI 之间「合同」的前端一侧。
 *
 * ── 协议（世界书「格式」条目与这里必须逐字对齐）──
 *
 *   角色名[情绪]:"对话"         → dialog
 *   <user>:"对话"               → dialog（玩家，不占立绘位）
 *   角色名[情绪]:*内心独白*      → thought
 *   <user>:*内心独白*            → thought
 *   纯文本                      → narrator（旁白）
 *   [scene:父/子/末级场景]       → 控制行，不显示，更新当前场景（后续行继承）
 *
 * 行锚定铁律：对话行整行只允许这一个表达式，行首行尾不得有其他文字；
 * 引号冒号一律英文半角。想「边动边说」就拆成旁白行 + 对话行。
 * 这样做是为了让旁白里的引号台词不会被误认成对话——只做行首整行匹配，
 * 绝不扫描自由文本。
 *
 * ── 正文来源 ──
 * 优先取 <content>…</content>（"首开到末闭"合并，支持思维链夹心的多块正文）；
 * 没有 <content> 标签时降级为「剥思维链后全文视为剧本」——AI 忘包标签不该让
 * 整个楼层播不出来。顺序铁律：先剥思维链、再提取正文。
 */

import {
  DEFAULT_EMOTION,
  findCastMember,
  isPlayerSpeaker,
  occupiesSpriteSlot,
  resolveEmotion,
  type CastTheme,
} from './data/cast';
import { extractContentBody, separateThinking, stripVariableBlocks } from './utils/stripThinking';

export type LineType = 'narrator' | 'dialog' | 'thought';

/** 场景位置（由 [scene:] 控制行解析，后续行继承） */
export interface SceneLocation {
  /** 完整路径，如 "魔都/第七区/废弃车站/站台" */
  path: string;
  /** 显示用短名（路径最后一段） */
  displayName: string;
}

export interface ScriptLine {
  type: LineType;
  /** 说话人；旁白行为 undefined */
  speaker?: string;
  /** AI 原样写的中文情绪名（如 "冷静"），保留供世界书回显与调试 */
  emotion?: string;
  /** 解析后的情绪 key（如 "calm"），查不到时回落 'default' */
  emotionKey?: string;
  text: string;
  /** 角色主题色族（决定名牌与强调色） */
  theme?: CastTheme;
  /** 立绘 URL —— **资产待定，当前恒为 undefined**，渲染层走氛围色兜底 */
  sprite?: string;
  /** 是否玩家发言（玩家不占立绘位） */
  isPlayer?: boolean;
  /** 当前场景（继承语义：控制行「从此生效直到下一个控制行」） */
  location?: SceneLocation;
}

// ── 正则 ──

/** 角色名[情绪]:"对话内容" */
const DIALOG_RE = /^(.+?)\[(.+?)\]:"(.+)"$/s;
/** <user>:"对话内容" —— 玩家发言不需要情绪标签 */
const USER_DIALOG_RE = /^<user>:"(.+)"$/s;
/** 角色名[情绪]:*内心独白* */
const THOUGHT_RE = /^(.+?)\[(.+?)\]:\*(.+)\*$/s;
/** <user>:*内心独白* */
const USER_THOUGHT_RE = /^<user>:\*(.+)\*$/s;
/** [scene:父/子/末级场景] —— 行首独占一行 */
const SCENE_RE = /^\[scene:([^\]]+?)\]$/;

/**
 * [battle:敌方名] —— 战斗触发标签（兼容「战斗」写法与全角冒号）。
 * 约定写在**正文尾部**：整楼播完才切战斗画面。它是控制行，不产生可播行，
 * 正文里会被滤掉，不会以旁白身份被念出来。
 */
const BATTLE_TAG_RE = /\[(?:battle|战斗)[:：]([^\]]*?)\]/gi;

/**
 * 行首标签前缀（如 `[队员:甲,状态=警戒]`）——AI 有时把标签和对话写在一行。
 * 剥成标签里的角色名再走对话正则，否则标签会被 DIALOG_RE 当成说话人。
 * 只在行首匹配，且要求含冒号，不会误伤 `角色名[情绪]:"…"`（那种不以 `[` 开头）。
 */
const TAG_PREFIX_RE = /^\[([^[\]:]+):([^\]]+?)\]\s*/;

/** 行首选项序号（1. / 2、/ 3) / 全角数字） */
const INDEX_PREFIX_RE = /^\s*[0-9０-９]+\s*[.、)）:：]\s*/;

// ── 内部工具 ──

/** 剥行首标签前缀，提取其中的角色名（无前缀时原样返回） */
function stripTagPrefix(line: string): string {
  return line.replace(TAG_PREFIX_RE, (_m, _kind: string, body: string) => {
    const name = body.split(/[，,]/)[0]?.trim();
    return name ? `${name} ` : '';
  });
}

/** 取场景显示短名（路径最后一段） */
function sceneDisplayName(path: string): string {
  const parts = path
    .split('/')
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * 解析一层楼层的剧本正文。
 *
 * @param rawText    楼层原文（含思维链 / 变量块 / content 标签 / 选项块）
 * @param playerName 玩家自定名（用于识别玩家发言，可不传）
 * @returns 可直接逐行播放的 ScriptLine[]；彻底无内容时返回空数组
 */
export function parseScriptContent(rawText: string, playerName?: string): ScriptLine[] {
  if (!rawText) return [];

  // 顺序铁律：先剥思维链，再提取正文
  const { mainText } = separateThinking(rawText);
  const body = extractContentBody(mainText);
  // 无 <content> 标签 → 降级全文（变量更新块不进剧本）
  let content = stripVariableBlocks(body ?? mainText).trim();
  if (!content) return [];
  // 战斗标签是控制行：先从正文滤掉，免得它以旁白身份被念出来
  content = content.replace(BATTLE_TAG_RE, '').trim();
  if (!content) return [];

  const result: ScriptLine[] = [];
  let currentLocation: SceneLocation | undefined;

  // 单遍逐行状态机：控制行改写状态，内容行继承当前状态
  for (const rawLine of content.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 控制行：[scene:路径] —— 独占一行，不产生可播行
    const sceneMatch = line.match(SCENE_RE);
    if (sceneMatch) {
      const path = sceneMatch[1].trim();
      if (path) currentLocation = { path, displayName: sceneDisplayName(path) };
      continue;
    }

    // 归一化：剥掉行首标签前缀（[队员:甲] 之类）
    const stripped = stripTagPrefix(line).trim();
    if (!stripped) continue;

    // 1. 角色名[情绪]:"对话"
    const dialog = stripped.match(DIALOG_RE);
    if (dialog) {
      result.push(buildLine('dialog', dialog[1].trim(), dialog[3], dialog[2].trim(), currentLocation, playerName));
      continue;
    }

    // 2. <user>:"对话"
    const userDialog = stripped.match(USER_DIALOG_RE);
    if (userDialog) {
      result.push(buildLine('dialog', '<user>', userDialog[1], undefined, currentLocation, playerName));
      continue;
    }

    // 3. 角色名[情绪]:*内心独白*
    const thought = stripped.match(THOUGHT_RE);
    if (thought) {
      result.push(buildLine('thought', thought[1].trim(), thought[3], thought[2].trim(), currentLocation, playerName));
      continue;
    }

    // 4. <user>:*内心独白*
    const userThought = stripped.match(USER_THOUGHT_RE);
    if (userThought) {
      result.push(buildLine('thought', '<user>', userThought[1], undefined, currentLocation, playerName));
      continue;
    }

    // 5. 旁白兜底
    result.push({ type: 'narrator', text: stripped, location: currentLocation });
  }

  return result;
}

/** 组装一条剧本行（统一查表：主题色 / 情绪 key / 立绘位） */
function buildLine(
  type: 'dialog' | 'thought',
  speaker: string,
  text: string,
  emotion: string | undefined,
  location: SceneLocation | undefined,
  playerName?: string,
): ScriptLine {
  const member = findCastMember(speaker);
  const player = isPlayerSpeaker(speaker, playerName);
  const emotionKey = resolveEmotion(emotion) || DEFAULT_EMOTION;
  const takesSlot = occupiesSpriteSlot(speaker, playerName);
  return {
    type,
    // `<user>` / `我` 是协议标记，不该印在名牌上 —— 换成玩家自定名。
    // 角色表里标了 isPlayer 的具名角色（如「和仓优希」）保持原名。
    speaker: player && (speaker === '<user>' || speaker === '我') ? playerName?.trim() || '我' : speaker,
    emotion,
    emotionKey,
    text,
    theme: member?.theme,
    // 立绘资产待定：只有占了立绘位且角色表里确实绑了图才给 URL
    sprite: takesSlot ? member?.sprites?.[emotionKey] ?? member?.sprites?.[DEFAULT_EMOTION] : undefined,
    isPlayer: player,
    location,
  };
}

/**
 * 提取选项列表（三路并取 —— AI 记不住只用一种格式，故全兼容）。
 *
 * 1. `<options>` 块内的 `<option>` 包裹条目（优先）
 * 2. `<options>` 块内的 `>` 前缀行（旧协议）
 * 3. `<choice>` 块级标签 / 多个独立 `<choice>` 标签
 *
 * 选项块在 stripThinking 里已从正文滤净，所以这里从**原文**提取。
 */
export function parseOptions(rawText: string): string[] {
  if (!rawText) return [];
  const { mainText } = separateThinking(rawText);
  const options: string[] = [];
  const push = (text: string) => {
    const t = text.trim();
    if (t && !options.includes(t)) options.push(t);
  };

  // 1. <options> 块
  const block = rawText.match(/<options\b[^>]*>([\s\S]*?)<\/options>/i);
  if (block) {
    const inner = block[1];
    let matched = false;
    for (const m of inner.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
      if (m[1].trim()) {
        push(m[1]);
        matched = true;
      }
    }
    if (!matched) {
      for (const line of inner.split(/\n/)) {
        const gt = line.trim().match(/^>(.+)$/);
        if (gt) {
          push(gt[1]);
          matched = true;
        }
      }
    }
    // 兜底：模型偶发漏标记，只写纯行
    if (!matched) {
      for (const line of inner.split(/\n/)) {
        if (line.trim()) push(line.replace(/<\/?option\b[^>]*>/gi, ''));
      }
    }
  } else {
    // 1b. 无包裹块时，扫独立 <option> 标签（在滤净文本上扫，避免思维链回显误报）
    for (const m of mainText.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
      push(m[1]);
    }
  }

  // 2. <choice> 块级（标签内含换行 = 多项）
  const choiceBlock = mainText.match(/<choice>([\s\S]*?)<\/choice>/);
  if (choiceBlock) {
    for (const line of choiceBlock[1].split(/\n/)) {
      const t = line.trim().replace(INDEX_PREFIX_RE, '');
      if (t) push(t);
    }
  }

  // 3. 多个独立 <choice>text</choice> —— 限单行内容。
  //    若放开换行，块级写法会被这条路再匹配一次，整块当成一个选项混进列表
  //    （重复项去重挡不住，因为文本与逐行拆分的结果不同）。
  for (const m of mainText.matchAll(/<choice>([^<\n]+?)<\/choice>/g)) {
    push(m[1].replace(INDEX_PREFIX_RE, ''));
  }

  return options;
}

/** 当前剧本的剧本行总数（UI 侧显示进度用） */
export function scriptLength(lines: ScriptLine[]): number {
  return lines.length;
}

/** 战斗触发信息 */
export interface BattleTrigger {
  /** 敌方名（原样保留，交给 data/enemies.ts 建档） */
  enemy: string;
}

/**
 * 正文**尾部**战斗触发检测。
 *
 * 只认尾部（标签之后只剩空白）：战斗是「这一幕演完 → 切战场」的收尾动作，
 * 正文中段出现的示例标签或思维链回显不该把玩家踢进战斗。
 */
export function parseBattleTrigger(rawText: string): BattleTrigger | null {
  if (!rawText) return null;
  const { mainText } = separateThinking(rawText);
  const body = extractContentBody(mainText) ?? mainText;
  const tail = stripVariableBlocks(body).slice(-240);
  const matches = [...tail.matchAll(BATTLE_TAG_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const after = tail.slice((last.index ?? 0) + last[0].length);
  if (after.trim()) return null;
  return { enemy: (last[1] || '').trim() || '未知目标' };
}
