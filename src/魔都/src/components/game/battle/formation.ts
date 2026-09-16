/**
 * 战斗编队（S1：全员站位）
 *
 * 三条目标，按重要性排：
 *   ① **我方是一个紧凑的群**，不是一排拉开的人。四个人肩并肩站着，
 *      被选中的那位前踏一步到"第一位"——其余人保持紧凑，不跟着漂。
 *   ② **敌我永不在屏幕上压叠**：靠纵深分段（我方 2.95–4.15 米，敌方 6.3 米开外），
 *      中间那条空地就是"距离"读出来的地方。
 *   ③ **后排不能被前排吃掉**：站位用**屏幕横向比例 sx** 定义，再由
 *      `worldXFromScreen()` 反解世界坐标（理由见 stage.ts）。
 *      直接写世界坐标的话，后排会被前排精确遮住，而且很难查出原因。
 *
 * 世界纵深（depth）只负责两件事：尺度阶梯，和空气透视。
 *
 * ⚠️ 这个坐标原本叫 `z`，后来改名了。原因是 unplugin-auto-import 的扫描器会把
 * 裸记号 `z` 当成未绑定标识符，注入 `import { z } from 'zod'`；而 zod 在 webpack
 * 里 external 成全局 `z`，**没有酒馆宿主的页面加载时直接 ReferenceError，整个前端起不来**。
 * 新代码别再用单字母 `z` 当变量名。
 */

import type { ThreatLevel } from '../../../data/enemies';

export interface FormationSlot {
  /** 目标屏幕横向位置（0–1，0.5＝中轴） */
  sx: number;
  /** 纵深（米）。相机在 depth=0 */
  depth: number;
  /** 要不要水平镜像 —— 四个人朝同一侧站会像一排证件照 */
  mirror: boolean;
}

/** 前踏位（第一位）：P5 的聚焦感来自"那个人往前站了一步" */
export const ACTIVE_SLOT: FormationSlot = { sx: 0.3, depth: 2.95, mirror: false };

/**
 * 我方群内站位（除前踏位之外的补位格）。
 *
 * 第一个坑：这四个格子曾经按"给敌人让路"的思路铺开，结果队伍横跨 61% 屏宽，
 * 最右边那位像是掉队出画了。**紧凑**是这里的硬要求，不是审美偏好。
 * 第二个坑：格子必须**互不同列**——同列的两格会互相吞掉（深度只差 0.5 米时，
 * 后排会被前排盖住七成）。
 */
export const PARTY_CLUSTER: readonly FormationSlot[] = [
  { sx: 0.155, depth: 3.45, mirror: false },
  { sx: 0.425, depth: 3.45, mirror: true },
  { sx: 0.05, depth: 4.15, mirror: true },
  { sx: 0.52, depth: 4.15, mirror: false },
];

/** 我方最前排纵深 —— 相机推导与焦平面都取前踏位 */
export const PARTY_FRONT_Z = 2.95;

/**
 * 排兵：被选中的那位站前踏位，其余人按**原顺序紧凑补位**（不留空洞）。
 *
 * 这就是"根据选中的角色决定第一位是谁"——不是把谁拉出来单独站到远处，
 * 而是整队往前挪一格。
 *
 * @param activeIndex 当前行动者在名单里的下标
 * @param size        出战人数
 * @returns 与名单同下标的站位数组
 */
export function partyFormation(activeIndex: number, size: number): FormationSlot[] {
  const slots: FormationSlot[] = [];
  let rank = 0;
  for (let i = 0; i < size; i++) {
    if (i === activeIndex) slots.push(ACTIVE_SLOT);
    else slots.push(PARTY_CLUSTER[rank++ % PARTY_CLUSTER.length]);
  }
  return slots;
}

/**
 * 敌方阵型 —— 1 / 2 / 3 体的错落，全部落在远段（depth ≥ 6.3）并整体靠右。
 *
 * 靠右是被我方群逼出来的：我方群占掉左侧约 46%，敌方就从 0.6 之后开始，
 * 这样两组身体在宽屏下零重叠。竖屏下敌人之间会互相压叠——那读起来是
 * "一群暗影挤在一起"，不是 bug（竖屏摆不下，见 verify 脚本末尾说明）。
 */
export const ENEMY_FORMATION: Record<number, readonly FormationSlot[]> = {
  1: [{ sx: 0.78, depth: 6.6, mirror: false }],
  2: [
    { sx: 0.7, depth: 6.4, mirror: false },
    { sx: 0.88, depth: 7.0, mirror: true },
  ],
  3: [
    { sx: 0.69, depth: 6.3, mirror: false },
    { sx: 0.79, depth: 7.1, mirror: true },
    { sx: 0.88, depth: 6.5, mirror: false },
  ],
};

/** 威胁等级 → 默认体量（米）与默认体数 */
export const ENEMY_HEIGHT: Record<ThreatLevel, number> = {
  low: 1.4,
  mid: 2.0,
  high: 2.6,
  boss: 3.6,
};

export const ENEMY_COUNT: Record<ThreatLevel, number> = {
  low: 3,
  mid: 2,
  high: 2,
  boss: 1,
};

/**
 * 体数来源：威胁等级推导，标签可显式覆盖（`[battle:丑鬼×3]`）。
 * 夹到 1–3 —— 阵型只画了三套，超出的等 S3 再谈。
 */
export function enemyCountFor(threat: ThreatLevel, override?: number): number {
  const n = override ?? ENEMY_COUNT[threat];
  return Math.max(1, Math.min(3, Math.round(n)));
}

export function enemySlots(count: number): readonly FormationSlot[] {
  return ENEMY_FORMATION[Math.max(1, Math.min(3, count))];
}

/**
 * 把一位敌人的总血量摊到多体上：**威胁等级决定总血量，体数只决定怎么分**。
 *
 * 这样"低危 ×3"和原来"低危 ×1"的总血量一致，不会因为改了体数就偷偷加难度。
 * 余数记在第一体上，保证总和精确。
 */
export function splitHp(total: number, count: number): number[] {
  const safeCount = Math.max(1, count);
  const base = Math.floor(total / safeCount);
  const remainder = total - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => base + (index === 0 ? remainder : 0));
}
