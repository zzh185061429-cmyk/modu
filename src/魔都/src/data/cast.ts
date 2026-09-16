/**
 * 魔都 · 角色表与情绪映射（协议的数据侧）
 *
 * 这里是「前端认人」的唯一依据：剧本解析器拿说话人名字来查表，得到主题色、
 * 别名、立绘位。AI 侧世界书的「格式」条目与这份表必须同一条心——两端都假设
 * 对方会出错，所以查不到时一律走兜底（默认情绪 / 中性主题色），绝不抛异常。
 *
 * 立绘资产当前为待定状态（sprites 全部留空）：查不到立绘时渲染层走氛围色兜底，
 * 舞台结构照常成立。资产到位后只需往 sprites 里填 URL，不必动解析器与布局。
 */

export type CastTheme = 'rose' | 'orchid' | 'paper';

export interface CastMember {
  id: string;
  /** 正式名（AI 输出的说话人名） */
  name: string;
  /** 别名/称呼（如「组长」「优希」，AI 有时会换称呼） */
  alias?: string[];
  title?: string;
  /** 主题色族：决定名牌与对话框强调色 */
  theme: CastTheme;
  /** 玩家角色：不占立绘位 */
  isPlayer?: boolean;
  /** 系统播报：不占立绘位，名牌走中性色 */
  isSystem?: boolean;
  /** 情绪 key → 立绘 URL。**资产待定，当前一律为空** */
  sprites?: Record<string, string>;
}

/** 角色表（新增角色只改这里，解析器与 UI 自动跟上） */
export const CAST: CastMember[] = [
  {
    id: 'kyoka',
    name: '羽前京香',
    alias: ['京香', '组长', '羽前组长', '羽前'],
    title: '魔都防卫队 · 第七组组长',
    theme: 'rose',
  },
  {
    id: 'yuuki',
    name: '和仓优希',
    alias: ['优希', '和仓'],
    title: '第七组 · 特殊单位',
    theme: 'orchid',
    isPlayer: true,
  },
  {
    id: 'system',
    name: '系统',
    alias: ['SYSTEM', '系统消息', '战术网络'],
    title: '战术通信网络',
    theme: 'paper',
    isSystem: true,
  },
];

/**
 * 中文情绪名 → 情绪 key。
 * AI 侧按中文写（"羽前京香[冷静]:"），前端按 key 查立绘与样式。
 * 取不到时 fallback 到 'default'——**永不因情绪写错而丢行**。
 */
export const EMOTION_MAP: Record<string, string> = {
  默认: 'default',
  冷静: 'calm',
  微笑: 'smile',
  严厉: 'stern',
  愤怒: 'angry',
  惊讶: 'surprised',
  担忧: 'worried',
  疲惫: 'tired',
  嘲讽: 'sneer',
  温柔: 'gentle',
  痛苦: 'pain',
  决然: 'resolve',
};

/** 情绪兜底 key */
export const DEFAULT_EMOTION = 'default';

/** 情绪中文名 → key（查不到回落默认） */
export function resolveEmotion(emotion?: string): string {
  if (!emotion) return DEFAULT_EMOTION;
  return EMOTION_MAP[emotion.trim()] || DEFAULT_EMOTION;
}

/** 主题色族 → CSS 令牌（名牌强调色 / 辉光） */
export const THEME_TOKENS: Record<CastTheme, { accent: string; glow: string }> = {
  rose: { accent: 'var(--color-rose-500)', glow: 'rgba(255, 92, 133, 0.26)' },
  orchid: { accent: 'var(--color-orchid-400)', glow: 'rgba(150, 104, 201, 0.28)' },
  paper: { accent: 'var(--color-paper-400)', glow: 'rgba(189, 182, 194, 0.22)' },
};

/** 按名字或别名查角色（查不到返回 null，由调用方兜底） */
export function findCastMember(name: string): CastMember | null {
  const target = name.trim();
  if (!target) return null;
  for (const member of CAST) {
    if (member.name === target) return member;
    if (member.alias?.includes(target)) return member;
  }
  return null;
}

/**
 * 判断说话人是否为玩家。
 * 三路并判：协议标记 `<user>` / 中文自称「我」 / 角色表里标了 isPlayer 的名字（含玩家自定名）。
 * 玩家不占立绘位——这是立绘层的关键约定。
 */
export function isPlayerSpeaker(speaker: string, playerName?: string): boolean {
  const target = speaker.trim();
  if (target === '<user>' || target === '我') return true;
  if (playerName && target === playerName) return true;
  return findCastMember(target)?.isPlayer === true;
}

/** 说话人是否不占立绘位（玩家或系统播报） */
export function occupiesSpriteSlot(speaker: string, playerName?: string): boolean {
  if (isPlayerSpeaker(speaker, playerName)) return false;
  return findCastMember(speaker)?.isSystem !== true;
}
