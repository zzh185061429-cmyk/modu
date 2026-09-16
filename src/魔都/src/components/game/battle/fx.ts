/**
 * 打击特效的素材表
 *
 * ── 来源 A：Kenney Particle Pack（CC0 1.0，可商用可改免署名）
 *    那个包是**单张贴图**，且绝大多数是"柔和辉光"——正是这些把画面拖成手游味。
 *    现在只留两张真正有形状的（冲击波环、三道刮痕），其余不再内联。
 *
 * ── 来源 B：フリー素材サイトギャラリーハウス
 *    「赤い斬撃エフェクトAPNGアニメーション【商用可・フリー素材】」
 *    **真序列帧**：13 帧 / 429ms / 30fps / 1080×1080 / RGBA。
 *    条款：商用可、加工自由、免署名、"作为作品的一部分使用可以"、
 *    禁止直链（必须下载）。⚠️ 同时禁止用于「過激な性表現」——整张卡的定位由项目方判断。
 *
 * 用法约定：
 *   ① 单张贴图一律当 `mask-image` 用、不当图片用（一张白图吃任意颜色与渐变）
 *   ② 序列帧横向拼成 strip，用 `background-position-x` + steps 逐帧推进，
 *      **不逐帧 setState**（30fps 重渲染是白给的开销）
 */

import claw from '../../../assets/fx/claw.png?url';
import ringA from '../../../assets/fx/ring-a.png?url';
import slashSweep from '../../../assets/fx/slash-sweep.png?url';

export const FX_ASSETS = {
  claw,
  ringA,
  slashSweep,
} as const;

/** 序列帧的参数 —— CSS 的 steps 步数与时长由这两个数推出来 */
export const SWEEP_FRAMES = 13;
export const SWEEP_MS = 429;

/** 命中类型：普通出手 / 强袭（重击）/ 解放（本作高光） */
export type ImpactKind = 'strike' | 'assault' | 'release';

export interface ImpactKit {
  /** 斩击序列帧 strip */
  sweep: string;
  /** 冲击波环（mask） */
  ring: string;
  /** 三道刮痕（mask）：重击签名 */
  claw?: string;
}

export const STRIKE_KIT: ImpactKit = {
  sweep: slashSweep,
  ring: ringA,
};

export const ASSAULT_KIT: ImpactKit = {
  sweep: slashSweep,
  ring: ringA,
  claw,
};

/** 解放：与强袭同层（全屏 cut-in 是另一件事，见设计稿 S4 的"明确没做"） */
export const RELEASE_KIT: ImpactKit = ASSAULT_KIT;

export function kitFor(kind: ImpactKind): ImpactKit {
  if (kind === 'assault') return ASSAULT_KIT;
  if (kind === 'release') return RELEASE_KIT;
  return STRIKE_KIT;
}
