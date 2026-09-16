import { ART } from './art';

/**
 * 魔都 · 敌方表（战斗场景的数据侧）
 *
 * 与 cast.ts 同构：解析器/AI 给一个名字，前端查表得到危险等级、体量、立绘。
 * **敌方立绘资产待定**（art 目前为空）：查不到图时渲染层走"氛围色剪影 + 名号"
 * 兜底，舞台结构照常成立。资产到位后往 art 里填 URL 即可，不必动组件。
 */
export type ThreatLevel = 'low' | 'mid' | 'high' | 'boss';

export interface EnemyDef {
  id: string;
  /** 正式名（AI 输出的敌人名） */
  name: string;
  alias?: string[];
  /** 远景立绘 —— 资产待定，为空时走剪影兜底 */
  art?: string;
  threat: ThreatLevel;
  maxHp: number;
  /** 一句话描述，战报里当副标题 */
  note?: string;
}

const DANGER_LABEL: Record<ThreatLevel, string> = {
  low: '低危',
  mid: '警戒',
  high: '高危',
  boss: '特级',
};

/** 敌方表（新增敌人只改这里） */
export const ENEMIES: EnemyDef[] = [
  { id: 'shuuki', name: '丑鬼', alias: ['丑鬼群', '小型丑鬼', '杂鬼'], threat: 'low', maxHp: 96, note: '成群出没的低阶魔物' },
  { id: 'shuuki-brute', name: '大型丑鬼', alias: ['巨躯丑鬼', '肥大丑鬼'], threat: 'mid', maxHp: 210, note: '体量数倍于常体' },
  { id: 'unknown', name: '未知种', alias: ['未识别', '异形'], threat: 'high', maxHp: 320, note: '形态未收录' },
  { id: 'boss', name: '特级丑鬼', alias: ['特级', '首领'], threat: 'boss', maxHp: 520, note: '需要全组协同' },
];

/** 兜底敌人：AI 写了表里没有的名字也不算错误，按中危建档 */
export function findEnemy(name: string): EnemyDef {
  const target = name.trim();
  for (const enemy of ENEMIES) {
    if (enemy.name === target) return enemy;
    if (enemy.alias?.includes(target)) return enemy;
  }
  return { id: `dyn-${target || 'unknown'}`, name: target || '未知目标', threat: 'mid', maxHp: 180 };
}

export function threatLabel(threat: ThreatLevel): string {
  return DANGER_LABEL[threat];
}

/**
 * 我方出战名单 —— 有立绘的角色即出战位（点击选中谁出手）。
 * 玩家（和仓优希）是操作者，不占出战位；系统播报同理。
 */
export interface CombatUnit {
  id: string;
  name: string;
  art: string;
  /** 战报里的定位 */
  role: string;
}

export const SQUAD: CombatUnit[] = [
  { id: 'kyoka', name: '羽前京香', art: ART.kyoka, role: '组长 · 无穷之锁' },
  // 桃之能力名从「学习」修正为「青云之志」——旧的写法只存在于本文件，
  // 已与设计稿、后续技能表统一。改名前请先看 docs/战斗系统重构方案.md 的 7.5.3。
  { id: 'himari', name: '东日万凛', art: ART.himari, role: '副组长 · 青云之志' },
  { id: 'shushu', name: '骏河朱朱', art: ART.shushu, role: '队员 · 玉体革命' },
  { id: 'nei', name: '大川村宁', art: ART.nei, role: '队员 · 一定会找到你' },
];
