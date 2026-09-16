import type { CSSProperties } from 'react';
import { SWEEP_FRAMES, SWEEP_MS, kitFor, type ImpactKind } from './fx';
import './ImpactFX.css';

/**
 * 命中特效
 *
 * 一记命中 = **硬层 + 序列帧**，柔光层已经全部删掉。
 *
 * 为什么删柔光：上一版用 Kenney 的柔光贴图 + mix-blend-mode: screen 叠了一层
 * 白色放射线和网点。那不是"P5 味"，那是**手游打击光效**——
 * 加色、低对比、软边、没有黑色。读起来就是廉价。
 *
 * 现在这版的分工：
 *
 *   序列帧（主角）  13 帧真扫击，沿攻击者的方向扫过去。**动起来**才是关键，
 *                   一张静态柔光贴图无论多大都不可能有这个信息量。
 *   硬切割线        3px 纯白直线，沿刀口方向，缩放进场后定格再抽长。
 *   硬速度线 ×6     2px 不透明实线，不是渐变辉光。
 *   冲击波环        一张 mask 贴图，收窄成细环。
 *   刮痕            仅强袭，实色 mask。
 *   伤害数字        硬字 + 红描边，不参与任何混色。
 *
 * 定格（hit-stop）依旧烤在关键帧里（7%→22% 的保持段），不做全局暂停。
 */

/** 硬速度线的角度（相对刀口方向）。少而实，不要一圈渐变 */
const STREAK_ANGLES: readonly number[] = [-64, -38, -15, 16, 40, 66];

export interface ImpactSpawn {
  /** 每次命中自增。换 key 就重放整条动画——这是"重放"的唯一机制 */
  tick: number;
  value: number;
  kind: ImpactKind;
}

export interface Impact extends ImpactSpawn {
  /** 命中角度（度）：由舞台按攻击者→目标现算 */
  angle: number;
}

interface ImpactFXProps {
  impact: Impact;
}

export function ImpactFX({ impact }: ImpactFXProps) {
  const kit = kitFor(impact.kind);
  const vars = {
    '--fx-angle': `${impact.angle}deg`,
    '--fx-sweep': `url(${kit.sweep})`,
    '--fx-ring': `url(${kit.ring})`,
    '--fx-claw': kit.claw ? `url(${kit.claw})` : 'none',
    '--fx-sweep-ms': `${SWEEP_MS}ms`,
    '--fx-sweep-steps': String(SWEEP_FRAMES),
  } as CSSProperties;

  return (
    <span className="mato-fx" data-kind={impact.kind} style={vars} aria-hidden="true">
      {/* 主角：13 帧真扫击 */}
      <span className="mato-fx__sweep" />

      {/* 硬速度线：不透明实线，定格后抽长 */}
      {STREAK_ANGLES.map(angle => (
        <span key={angle} className="mato-fx__streak" style={{ '--a': `${angle}deg` } as CSSProperties} />
      ))}

      {/* 刀口：一条 3px 纯白直线 + 一道暗红衬底，硬边 */}
      <span className="mato-fx__cut" />

      {/* 冲击波：细环 */}
      <span className="mato-fx__ring" />

      {/* 强袭签名：三道刮痕 */}
      {kit.claw ? <span className="mato-fx__claw" /> : null}

      {/* 伤害数字：硬字，不参与混色 */}
      {impact.value > 0 ? <b className="mato-fx__damage">{impact.value}</b> : null}
    </span>
  );
}

export default ImpactFX;
