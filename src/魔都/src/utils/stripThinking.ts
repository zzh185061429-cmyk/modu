/**
 * 思维链统一分离工具（魔都版）
 *
 * 单一真相：所有消费端（剧本解析 / 选项解析 / 历史溯回 / 思维链面板 / 后续重生成）
 * 共用同一份分离结果，保证"面板看到的思维链"与"正文剥掉的思维链"完全一致。
 * 多处各写一份实现是本项目最容易踩的坑——剥不干净会让思维链以旁白身份漏进剧本。
 *
 * 处理范围：
 * - 成对思维标签：<think> / <thinking> / <draft> / <Chain_of_Thought> / <simple_thinking>
 * - 流式期尾部未闭合思维标签：视为"尚未写出的正文"从渲染路径掐掉（不动落盘原文）
 * - 附加块滤净：<summary>（预设摘要）/ <disclaimer> / <Reference_Example>（防截断块）
 * - 预设选项块：<SUOT> / <options>（由 parseOptions 从原文单独提取，正文里不留）
 * - 残留壳标签：思考块内回显格式示例后残留的孤立标签
 *
 * 顺序铁律：**先剥思维链、再提取正文**。反了会把思维链里的格式示例当成正文。
 */

/** 思维链段（展示用） */
export interface ThinkingSection {
  /** 展示名（思考 / 草稿 / 思维链），同名多段时带序号（如"思考 #2"） */
  label: string;
  content: string;
}

export interface SeparatedThinking {
  /** 按出现顺序提取的思维链段（一楼几段提几段） */
  sections: ThinkingSection[];
  /** 滤净思维链与附加块后的正文候选文本 */
  mainText: string;
}

/** 成对思维标签（标签名小写 → 展示名） */
const THINKING_TAG_LABELS: Record<string, string> = {
  'draft': '草稿',
  'chain_of_thought': '思维链',
  'thinking': '思考',
  'think': '思考',
  'simple_thinking': '思考',
};

/** 思维标签记号：开（捕获标签名）/ 闭 */
const THINK_TOKEN_RE = /<(\/?)(draft|Chain_of_Thought|thinking|simple_thinking|think)>/gi;

/** 流式期尾部未闭合思维标签：其后直到结尾都没有闭合标签 */
const UNCLOSED_TAIL_RE =
  /<(?:thinking|simple_thinking|think)>(?:(?!<\/(?:thinking|simple_thinking|think)>)[\s\S])*\s*$/i;

/** 附加块（防截断声明 / 预设摘要） */
const APPENDIX_BLOCK_RE = /<(disclaimer|Reference_Example|summary)>[\s\S]*?<\/\1>/gi;

/** 预设选项块（<SUOT> 行动选项 / <options> 选项组）——parseOptions 从原文单独提取 */
const SUOT_BLOCK_RE = /<SUOT\b[^>]*>[\s\S]*?<\/SUOT>/gi;
const OPTIONS_BLOCK_RE = /<options\b[^>]*>[\s\S]*?<\/options>/gi;

/** 思考块内回显成对思维标签后残留的孤立壳标签 */
const RESIDUAL_THINK_TAG_RE = /<\/?(?:thinking|simple_thinking|think|draft|Chain_of_Thought)>\s*/gi;

/** MVU 变量更新块：<UpdateVariable>…</UpdateVariable>（含 Analysis 与 _.set 指令行） */
const VARIABLE_BLOCK_RE = /<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable>/gi;

/**
 * 一次分离，两端共用：
 * - sections → 思维链面板按序展示
 * - mainText → 剧本解析 / 选项 / 历史等所有正文消费端的滤净文本
 */
export function separateThinking(raw: string): SeparatedThinking {
  // 嵌套感知的逐段提取：思考块内可能回显 <thinking></thinking> 格式示例，
  // 惰性配对会被回显提前截断导致内容漏进正文，故按开合深度取段。
  const found: { start: number; end: number; label: string; content: string }[] = [];
  let depth = 0;
  let secStart = -1;
  let contentStart = -1;
  let secLabel = '思考';
  for (const m of raw.matchAll(THINK_TOKEN_RE)) {
    const at = m.index ?? 0;
    if (!m[1]) {
      if (depth === 0) {
        secStart = at;
        contentStart = at + m[0].length;
        secLabel = THINKING_TAG_LABELS[m[2].toLowerCase()] || '思考';
      }
      depth++;
    } else {
      depth--;
      if (depth <= 0) {
        depth = 0;
        if (secStart >= 0) {
          found.push({
            start: secStart,
            end: at + m[0].length,
            label: secLabel,
            content: raw.slice(contentStart, at).trim(),
          });
          secStart = -1;
        }
      }
    }
  }
  // 流式期尾部未闭合的思考段：一直延伸到结尾，整体视作思维链
  if (secStart >= 0) {
    found.push({ start: secStart, end: raw.length, label: secLabel, content: raw.slice(contentStart).trim() });
  }

  const sections: ThinkingSection[] = [];
  const ranges: { start: number; end: number }[] = [];
  const labelCount: Record<string, number> = {};
  for (const f of found) {
    ranges.push({ start: f.start, end: f.end });
    if (!f.content) continue;
    labelCount[f.label] = (labelCount[f.label] || 0) + 1;
    sections.push({
      label: labelCount[f.label] > 1 ? `${f.label} #${labelCount[f.label]}` : f.label,
      content: f.content,
    });
  }

  // 正文 = 原文删去思维链段（倒序避免位移），再滤净附加块与壳标签
  let cleaned = raw;
  for (let i = ranges.length - 1; i >= 0; i--) {
    cleaned = cleaned.slice(0, ranges[i].start) + cleaned.slice(ranges[i].end);
  }

  const mainText = cleaned
    .replace(UNCLOSED_TAIL_RE, '')
    .replace(SUOT_BLOCK_RE, '')
    .replace(OPTIONS_BLOCK_RE, '')
    .replace(APPENDIX_BLOCK_RE, '')
    .replace(RESIDUAL_THINK_TAG_RE, '')
    .trim();

  return { sections, mainText };
}

/** 剥离 AI 回复中的思维链与附加块，返回滤净后的正文候选 */
export function stripThinking(raw: string): string {
  return separateThinking(raw).mainText;
}

/**
 * 剥离 MVU 变量更新块（展示 / 剧本解析路径专用）。
 *
 * 刻意不并入 separateThinking 主链——重生成链路的 Mvu.parseMessage 需要原文中的
 * 更新块，只有消费端的展示与剧本解析才剥离。
 */
export function stripVariableBlocks(raw: string): string {
  return raw.replace(VARIABLE_BLOCK_RE, '');
}

/**
 * 提取正文体（"首开到末闭"合并策略）：
 * 取第一个 <content> 开标签到最后一个 </content> 闭标签之间的全部内容；
 * 中间夹带的其余 content 壳标签（思维链夹心分块 / 嵌套包裹）一律剥掉留字。
 *
 * 闭标签都在开标签之前、或末尾仍有未闭合的开标签（流式生成中）时取到文本末尾；
 * 无 content 开标签时返回 null，由调用方决定降级行为（降级 = 全文视为剧本）。
 */
export function extractContentBody(cleaned: string): string | null {
  const openMatch = /<content\b[^>]*>/i.exec(cleaned);
  if (!openMatch) return null;
  const start = openMatch.index + openMatch[0].length;
  let end = cleaned.length;
  let lastCloseIndex = -1;
  for (const m of cleaned.matchAll(/<\/content\s*>/gi)) {
    if ((m.index ?? 0) >= start) lastCloseIndex = m.index ?? 0;
  }
  let lastOpenIndex = -1;
  for (const m of cleaned.matchAll(/<content\b[^>]*>/gi)) {
    lastOpenIndex = m.index ?? 0;
  }
  // 闭标签都在开标签之前，或末尾还有未闭合的开标签（流式生成中）→ 取到文本末尾
  if (lastCloseIndex >= start && lastOpenIndex <= lastCloseIndex) end = lastCloseIndex;
  return cleaned.slice(start, end).replace(/<\/?content\b[^>]*>/gi, '').trim();
}
