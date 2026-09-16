import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { threatLabel, type ThreatLevel } from '../../../data/enemies';
import {
  BODY_W,
  CHAR_H,
  GRID_Z,
  REF_ASPECT,
  deriveCamera,
  fitSlotSx,
  horizonPct,
  project,
  projectX,
  stackIndex,
  worldXFromScreen,
} from './stage';
import { ENEMY_HEIGHT, PARTY_FRONT_Z, enemySlots, partyFormation } from './formation';
import { ImpactFX, type ImpactSpawn } from './ImpactFX';
import './BattleStage.css';

/**
 * 战斗舞台（S1 空间与投影 + S4 打击演出）
 *
 * 分层（L0→L5）全部由同一份投影算出来：
 *   L0 天际线/霓虹雾 · L1 地平线 · L2 地面网格（SVG，按投影坐标画）
 *   L3 敌方阵 · L4 我方阵 · L5 前景遮挡
 *
 * 四条踩过的坑，改动时别踩回去：
 *   ① 定位用的 translateX(-50%) 不能和动画写在同一元素上——关键帧里的 transform
 *      会把居中位移一起清掉，敌人当场横向跳半个体宽。
 *   ② **入场动画与受击动画必须分成两层**。挂在同一元素上时，切换 data-hit 会让
 *      `animation` 整个换掉，受击结束把 data-hit 摘掉就又把**入场**动画从头播一遍，
 *      敌人会莫名其妙闪一下。
 *   ③ 名条必须在**前景遮挡之上**（depth-index 980 > 950）。遮挡是氛围，不能吃掉名字。
 *   ④ 空气透视的 blur 只贴**画面**，不贴整个敌人节点——否则锁定框和命中特效一起被糊掉。
 */

/** 地面纵向线（等距 0.8 米一条）。1.6 米太稀，地面读不出"往远处收" */
const LATERAL_X: readonly number[] = [-3.2, -2.4, -1.6, -0.8, 0, 0.8, 1.6, 2.4, 3.2];

/** 天际线剪影：写死不用随机，截图才可复现 */
const SKYLINE =
  '0,100 0,62 5,62 5,40 9,40 9,55 13,55 13,28 17,28 17,48 22,48 22,20 26,20 26,44 31,44 31,58 36,58 36,34 40,34 40,50 45,50 45,24 49,24 49,46 54,46 54,16 58,16 58,42 63,42 63,56 68,56 68,32 72,32 72,52 77,52 77,26 81,26 81,48 86,48 86,60 91,60 91,38 95,38 95,54 100,54 100,100';

export interface StageUnit {
  id: string;
  name: string;
  art: string;
  role: string;
  hp: number;
  maxHp: number;
}

export interface StageEnemy {
  id: string;
  name: string;
  threat: ThreatLevel;
  art?: string;
  hp: number;
  maxHp: number;
}

interface BattleStageProps {
  units: readonly StageUnit[];
  activeId: string;
  enemies: readonly StageEnemy[];
  /** 当前锁定的攻击目标 */
  targetId: string;
  /** 本次命中。为 null 表示没有正在播的命中演出 */
  impact?: ImpactSpawn | null;
  onSelect: (id: string) => void;
  onSelectTarget: (id: string) => void;
  selectable?: boolean;
}

export function BattleStage({
  units,
  activeId,
  enemies,
  targetId,
  impact = null,
  onSelect,
  onSelectTarget,
  selectable = true,
}: BattleStageProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(REF_ASPECT);

  // 比例自适应：只量容器，不猜设备。竖屏/横屏/矮屏共用同一条相机公式。
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      if (box.width > 1 && box.height > 1) setAspect(box.width / box.height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const cam = useMemo(() => deriveCamera(aspect, PARTY_FRONT_Z), [aspect]);
  const horizon = useMemo(() => horizonPct(cam), [cam]);

  /** 地面网格 —— 深度线取 project().groundPct，纵向线取两个端点的投影 */
  const grid = useMemo(() => {
    // ⚠️ 这里**不能**写成 `GRID_Z.map(depth => project({ x: 0, depth }, cam))`。
    // 那个简写属性会让 unplugin-auto-import 认不出箭头参数 `depth`，于是注入
    // `import { depth } from 'zod'`；而 zod 在 webpack 里被 external 成全局 `depth`，
    // 裸页面（没有酒馆宿主）加载时光是求值这个引用就 `ReferenceError: depth is not defined`，
    // **整个前端起不来**。产物里连一处 zod 调用都没有，但照样炸。
    const depths = GRID_Z.map(depth => project({ x: 0, depth: depth }, cam).groundPct);
    const near = GRID_Z[0];
    const far = GRID_Z[GRID_Z.length - 1];
    const laterals = LATERAL_X.map(x => {
      const a = project({ x, depth: near }, cam);
      const b = project({ x, depth: far }, cam);
      return { x1: projectX(x, near, cam), y1: a.groundPct, x2: projectX(x, far, cam), y2: b.groundPct };
    });
    return { depths, laterals };
  }, [cam]);

  const enemyLayout = useMemo(
    () =>
      enemySlots(enemies.length).map((slot, index) => {
        const enemy = enemies[index];
        const threat = enemy?.threat ?? 'mid';
        const height = ENEMY_HEIGHT[threat];
        const sx = fitSlotSx(slot.sx, slot.depth, cam, height * (2 / 3));
        const world = { x: worldXFromScreen(sx, slot.depth, cam), depth: slot.depth };
        return { enemy, proj: project(world, cam, height, PARTY_FRONT_Z) };
      }),
    [cam, enemies],
  );

  /** 排兵：选中的那位前踏，其余人紧凑补位（整队往前挪一格，不是把人拉出去） */
  const partyLayout = useMemo(() => {
    const activeIndex = Math.max(
      0,
      units.findIndex(unit => unit.id === activeId),
    );
    const slots = partyFormation(activeIndex, units.length);
    return units.map((unit, index) => {
      const slot = slots[index];
      const sx = fitSlotSx(slot.sx, slot.depth, cam, BODY_W);
      const world = { x: worldXFromScreen(sx, slot.depth, cam), depth: slot.depth };
      return { unit, slot, proj: project(world, cam, CHAR_H, PARTY_FRONT_Z) };
    });
  }, [activeId, cam, units]);

  /**
   * 命中几何：角度由**攻击者 → 目标**现算，所以刀口总是从挥刀的人那一侧来。
   * 横向百分比要乘宽高比才是屏幕上的真实角度，否则超宽屏会算得几乎水平。
   */
  const strike = useMemo(() => {
    const attacker = partyLayout.find(item => item.unit.id === activeId);
    const victim = enemyLayout.find(item => item.enemy?.id === targetId);
    if (!attacker || !victim?.enemy) return { angle: -18, dirX: 1 };
    const ax = attacker.proj.xPct;
    const ay = attacker.proj.groundPct - attacker.proj.heightPct * 0.55;
    const tx = victim.proj.xPct;
    const ty = victim.proj.groundPct - victim.proj.heightPct * 0.58;
    const angle = (Math.atan2(ty - ay, (tx - ax) * aspect) * 180) / Math.PI;
    return { angle, dirX: tx >= ax ? 1 : -1 };
  }, [activeId, aspect, enemyLayout, partyLayout, targetId]);

  const lockedTarget = enemyLayout.find(item => item.enemy?.id === targetId)?.enemy ?? null;

  return (
    <div
      ref={rootRef}
      className="mato-bs"
      data-mato-stage="battle"
      style={{ '--bs-horizon': `${horizon}%` } as CSSProperties}
    >
      {/* 整层做"推镜"：命中瞬间向前顶一下。换 tick 的奇偶来重放，不换 key ——
          key 会让整个舞台重挂，ResizeObserver 与所有动画都要重来。 */}
      <div
        className="mato-bs__punch"
        data-punch={impact ? impact.tick % 2 : undefined}
        style={{ '--punch-x': `${lockedTarget ? enemyLayout.find(i => i.enemy?.id === targetId)?.proj.xPct ?? 50 : 50}%` } as CSSProperties}
      >
        {/* ── L0 天空 + 天际线 + 霓虹雾 ── */}
        <div className="mato-bs__sky" aria-hidden="true">
          <svg className="mato-bs__skyline" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polygon points={SKYLINE} />
          </svg>
          <span className="mato-bs__haze" />
        </div>

        {/* ── L1/L2 地平线 + 地面 ── */}
        <div className="mato-bs__horizon" aria-hidden="true" />
        <div className="mato-bs__ground" aria-hidden="true">
          <svg className="mato-bs__grid" viewBox="0 0 100 100" preserveAspectRatio="none">
            {grid.depths.map((y, index) => (
              <line key={`d${index}`} x1={0} y1={y} x2={100} y2={y} vectorEffect="non-scaling-stroke" />
            ))}
            {grid.laterals.map((l, index) => (
              <line key={`l${index}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        </div>

        {/* ── L3 敌方阵：点谁锁谁 ── */}
        <div className="mato-bs__enemies">
          {enemyLayout.map(({ enemy, proj }) => {
            if (!enemy) return null;
            const down = enemy.hp <= 0;
            const locked = enemy.id === targetId && !down;
            return (
              <div key={enemy.id} className="mato-bs__enemy-anchor">
                <button
                  type="button"
                  className="mato-bs__enemy"
                  data-target={locked || undefined}
                  data-down={down || undefined}
                  aria-pressed={locked}
                  aria-label={`锁定 ${enemy.name}`}
                  disabled={down || !selectable}
                  onClick={() => onSelectTarget(enemy.id)}
                  style={{
                    left: `${proj.xPct}%`,
                    bottom: `${100 - proj.groundPct}%`,
                    height: `${proj.heightPct}%`,
                    zIndex: stackIndex(proj.depth),
                    opacity: proj.air.opacity,
                  }}
                >
                  <span className="mato-bs__enemy-shadow" aria-hidden="true" />
                  {locked && <span className="mato-bs__reticle" aria-hidden="true" />}
                  {/* 层 1：入场动画，恒定不动 */}
                  <div className="mato-bs__enemy-enter">
                    {/* 层 2：受击动画，随 tick 奇偶切换重放 */}
                    <div
                      className="mato-bs__enemy-body"
                      data-hit={locked && impact ? impact.tick % 2 : undefined}
                    >
                      {enemy.art ? (
                        <img
                          src={enemy.art}
                          alt={enemy.name}
                          draggable={false}
                          style={{
                            filter: `saturate(${proj.air.saturate}) brightness(${proj.air.brightness}) blur(${proj.air.blurPx}px)`,
                          }}
                        />
                      ) : (
                        <span
                          className="mato-bs__shade"
                          data-threat={enemy.threat}
                          aria-hidden="true"
                          style={{
                            filter: `saturate(${proj.air.saturate}) brightness(${proj.air.brightness}) blur(${proj.air.blurPx}px)`,
                          }}
                        />
                      )}
                      {locked && impact && (
                        <ImpactFX key={impact.tick} impact={{ ...impact, angle: strike.angle }} />
                      )}
                    </div>
                  </div>
                </button>

                {/* 名条在屏幕空间，不跟着敌人缩放 */}
                <div
                  className="mato-bs__enemy-plate"
                  data-target={locked || undefined}
                  data-down={down || undefined}
                  style={{ left: `${proj.xPct}%`, top: `${proj.groundPct - proj.heightPct}%` }}
                >
                  {locked && <span className="mato-bs__threat">{threatLabel(enemy.threat)}</span>}
                  <b>{enemy.name}</b>
                  <span
                    className="mato-bs__hp"
                    role="progressbar"
                    aria-label={`${enemy.name} HP`}
                    aria-valuemin={0}
                    aria-valuemax={enemy.maxHp}
                    aria-valuenow={enemy.hp}
                  >
                    <i style={{ width: `${Math.max(0, (enemy.hp / enemy.maxHp) * 100)}%` }} />
                    {locked && <em>{enemy.hp}</em>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── L4 我方阵：全员在场，选中的那位前踏 ── */}
        <div className="mato-bs__party">
          {partyLayout.map(({ unit, slot, proj }) => {
            const down = unit.hp <= 0;
            const active = unit.id === activeId;
            return (
              <button
                key={unit.id}
                type="button"
                className="mato-bs__unit"
                data-active={active || undefined}
                data-down={down || undefined}
                aria-pressed={active}
                aria-label={`${unit.name}（${unit.role}）`}
                disabled={down || !selectable}
                onClick={() => onSelect(unit.id)}
                style={{
                  left: `${proj.xPct}%`,
                  bottom: `${100 - proj.groundPct}%`,
                  height: `${proj.heightPct}%`,
                  zIndex: stackIndex(proj.depth),
                  '--lunge-x': `${strike.dirX * 64}%`,
                  '--lunge-y': '-26%',
                } as CSSProperties}
              >
                <span className="mato-bs__unit-shadow" aria-hidden="true" />
                {/* 突进层：单独一层，避免和下面的镜像 transform 打架 */}
                <span
                  className="mato-bs__lunge"
                  data-lunge={active && impact ? impact.tick % 2 : undefined}
                >
                  <span className="mato-bs__sprite" data-mirror={slot.mirror || undefined}>
                    <img
                      src={unit.art}
                      alt=""
                      draggable={false}
                      style={{
                        filter: `saturate(${proj.air.saturate}) brightness(${proj.air.brightness})`,
                      }}
                    />
                  </span>
                </span>
              </button>
            );
          })}

          {/* 名条与血条：屏幕空间，尺寸不随纵深变，小字才不会糊成一团 */}
          {partyLayout.map(({ unit, proj }) => (
            <div
              key={`plate-${unit.id}`}
              className="mato-bs__unit-plate"
              data-active={unit.id === activeId || undefined}
              data-down={unit.hp <= 0 || undefined}
              style={{ left: `${proj.xPct}%`, top: `${proj.groundPct}%` }}
            >
              <b>{unit.name}</b>
              <span className="mato-bs__unit-hp" aria-hidden="true">
                <i style={{ width: `${Math.max(0, (unit.hp / unit.maxHp) * 100)}%` }} />
              </span>
            </div>
          ))}
        </div>

        {/* ── L5 前景遮挡：从画面下缘切过的暗色构件，制造"镜头在人堆里" ── */}
        <div className="mato-bs__foreground" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}

export default BattleStage;
