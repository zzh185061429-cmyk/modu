/**
 * 战斗舞台 · 投影与编队断言（S1 里唯一"能自动验"的部分）
 *
 * 跑法：node 魔都/scripts/verify-battle-stage.ts
 *
 * 它**不判断好不好看**——构图好看与否是人的事。它只钉住那些"错了也不会报警、
 * 但一旦错了整套空间就塌"的不变量：
 *   1. 地平线真的落在设计位置（比例自适不能把地平线带跑）
 *   2. 脚底落点都在舞台内，且敌我脚底之间留有间隙（那条空地就是"距离"）
 *   3. 身体没有被切出画面
 *   4. 最前排角色的屏幕高度在设计区间（太大顶天、太小就没压迫感）
 *   5. 站位的屏幕→世界反解自洽（算出去再投回来要回到原处）
 *   6. 同一纵深上的自己人不互相压叠
 *   7. 宽屏下**敌我身体零重叠**（竖屏做不到，只报告不判死——见文件末尾说明）
 *   8. 我方是一个**紧凑的群**：跨度不超限、缝隙不超 1.8 个身宽（没人掉队）
 */

import {
  BODY_W,
  CHAR_H,
  HORIZON_PCT,
  SPRITE_W,
  deriveCamera,
  fitSlotSx,
  horizonPct,
  horizontalSpan,
  project,
  worldXFromScreen,
} from '../src/components/game/battle/stage.ts';
import {
  ENEMY_HEIGHT,
  PARTY_FRONT_Z,
  enemyCountFor,
  enemySlots,
  partyFormation,
} from '../src/components/game/battle/formation.ts';
import type { ThreatLevel } from '../src/data/enemies.ts';

/** HUD 高度必须跟 CombatP5.css 的 --bs-hud 保持一致 */
const HUD_DESKTOP = 146;
const HUD_NARROW = 196;
const HUD_SHORT = 104;

const VIEWPORTS = [
  { name: '桌面 1440×900', w: 1440, h: 900 - HUD_DESKTOP },
  { name: '竖屏 390×844', w: 390, h: 844 - HUD_NARROW },
  { name: '横屏 844×390', w: 844, h: 390 - HUD_SHORT },
  { name: '极窄 320×568', w: 320, h: 568 - HUD_NARROW },
];

const SQUAD_SIZE = 4;
const ACTIVE_INDEX = 1;
const THREATS: ThreatLevel[] = ['low', 'mid', 'boss'];

interface Body {
  label: string;
  depth: number;
  l: number;
  r: number;
  feet: number;
  height: number;
  blurPx: number;
}

let failures = 0;
const fail = (viewport: string, message: string) => {
  failures++;
  console.error(`  ✗ [${viewport}] ${message}`);
};
const check = (viewport: string, ok: boolean, message: string) => {
  if (!ok) fail(viewport, message);
};
const round = (v: number, digits = 1) => Number(v.toFixed(digits));
/** 两段区间的重叠宽度（% ），不重叠返回 0 */
const overlap = (a: Body, b: Body) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l));

console.info('战斗舞台 · 投影断言\n');

for (const vp of VIEWPORTS) {
  const aspect = vp.w / vp.h;
  const cam = deriveCamera(aspect, PARTY_FRONT_Z);
  const horizon = horizonPct(cam);

  console.info(
    `${vp.name}　舞台 ${vp.w}×${vp.h}　宽高比 ${round(aspect, 3)}\n` +
      `  相机：高度 ${round(cam.height, 3)}m　俯角 ${round((cam.pitch * 180) / Math.PI, 2)}°　` +
      `fovX/2 ${round((Math.atan(cam.tanHalfFovX) * 180) / Math.PI, 1)}°　fovY/2 ${round((Math.atan(cam.tanHalfFovY) * 180) / Math.PI, 1)}°`,
  );

  // 1. 地平线必须钉在设计位置
  check(vp.name, Math.abs(horizon - HORIZON_PCT) < 0.01, `地平线 ${round(horizon, 2)}% ≠ ${HORIZON_PCT}%`);

  // 5. 站位反解自洽：算出去再投回来（夹逼之后的 sx 才算数）
  const partySlots = partyFormation(ACTIVE_INDEX, SQUAD_SIZE);
  const activeSlot = partySlots[ACTIVE_INDEX];
  const activeSx = fitSlotSx(activeSlot.sx, activeSlot.depth, cam, BODY_W);
  const activeWorld = { x: worldXFromScreen(activeSx, activeSlot.depth, cam), depth: activeSlot.depth };
  const activeBack = project(activeWorld, cam, CHAR_H, PARTY_FRONT_Z).xPct;
  check(
    vp.name,
    Math.abs(activeBack - activeSx * 100) < 0.01,
    `站位反解不自洽：sx ${round(activeSx * 100, 2)}% → 投回 ${round(activeBack, 2)}%`,
  );

  // ── 我方 ──
  const party: Body[] = [];
  for (let i = 0; i < SQUAD_SIZE; i++) {
    const slot = partySlots[i];
    const sx = fitSlotSx(slot.sx, slot.depth, cam, BODY_W);
    const world = { x: worldXFromScreen(sx, slot.depth, cam), depth: slot.depth };
    const p = project(world, cam, CHAR_H, PARTY_FRONT_Z);
    const [l, r] = horizontalSpan(world, cam, BODY_W);
    const [cl, cr] = horizontalSpan(world, cam, SPRITE_W);
    const label = i === ACTIVE_INDEX ? '行动者' : `队员 ${i}`;
    party.push({ label, depth: p.depth, l, r, feet: p.groundPct, height: p.heightPct, blurPx: p.air.blurPx });

    console.info(
      `    ${label.padEnd(5, '　')} depth=${slot.depth}m sx=${round(sx * 100)}%${sx !== slot.sx ? '（已夹逼）' : ''}  ` +
        `脚底 ${round(p.groundPct)}%  高 ${round(p.heightPct)}%  深度 ${round(p.depth, 2)}m  ` +
        `身体 ${round(l)}–${round(r)}%  画布 ${round(cl)}–${round(cr)}%  模糊 ${round(p.air.blurPx, 2)}px`,
    );

    check(vp.name, p.groundPct > 40 && p.groundPct < 99, `${label} 脚底跑出舞台：${round(p.groundPct)}%`);
    check(vp.name, l > -1 && r < 101, `${label} 身体被切出画面：${round(l)}–${round(r)}%`);
  }

  // 8. 紧凑性：我方必须是一个"群"，不能散成一条线、更不能有人掉队到画面另一头。
  //    这一条是看过效果之后补的——原来的阵型为了给敌人让位铺到了 61% 屏宽，
  //    最右边那位看着像出画了。写成断言，免得以后又被"让位"改回去。
  //
  //    缝隙用**相对身宽**判，不用绝对百分比：超宽屏上人物本来就窄（横屏身体只占 6%），
  //    同一个阵型算出来的绝对缝隙自然更大，拿绝对数判会把正确构图判死。
  const sorted = party.map(b => [b.l, b.r] as const).sort((a, b) => a[0] - b[0]);
  const partySpan = sorted[sorted.length - 1][1] - sorted[0][0];
  const widestBody = Math.max(...party.map(b => b.r - b.l));
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) maxGap = Math.max(maxGap, sorted[i][0] - sorted[i - 1][1]);
  maxGap = Math.max(0, maxGap);
  const spanLimit = aspect >= 1.4 ? 50 : 60;
  const gapLimit = widestBody * 1.8;
  console.info(
    `  我方群跨度 ${round(partySpan)}%（上限 ${spanLimit}%）　` +
      `最大空隙 ${round(maxGap)}%（上限 ${round(gapLimit)}% ＝ 1.8 个身宽）`,
  );
  check(vp.name, partySpan <= spanLimit, `我方群散得太开：跨度 ${round(partySpan)}% > ${spanLimit}%`);
  check(vp.name, maxGap <= gapLimit, `我方群里有 ${round(maxGap)}% 的空隙——有人掉队了`);

  // ── 敌方 ──
  const enemyBodies: Body[] = [];
  let enemyMaxFeet = -Infinity;
  for (const threat of THREATS) {
    const count = enemyCountFor(threat);
    for (const slot of enemySlots(count)) {
      const width = ENEMY_HEIGHT[threat] * (2 / 3);
      const sx = fitSlotSx(slot.sx, slot.depth, cam, width);
      const world = { x: worldXFromScreen(sx, slot.depth, cam), depth: slot.depth };
      const p = project(world, cam, ENEMY_HEIGHT[threat], PARTY_FRONT_Z);
      const [l, r] = horizontalSpan(world, cam, width);
      const label = `${threat}×${count}`;
      enemyBodies.push({ label, depth: p.depth, l, r, feet: p.groundPct, height: p.heightPct, blurPx: p.air.blurPx });
      enemyMaxFeet = Math.max(enemyMaxFeet, p.groundPct);

      console.info(
        `    ${label.padEnd(7, '　')} depth=${slot.depth}m sx=${round(sx * 100)}%${sx !== slot.sx ? '（已夹逼）' : ''}  ` +
          `脚底 ${round(p.groundPct)}%  高 ${round(p.heightPct)}%  深度 ${round(p.depth, 2)}m  ` +
          `身体 ${round(l)}–${round(r)}%  模糊 ${round(p.air.blurPx, 2)}px`,
      );

      check(vp.name, l > -1 && r < 101, `敌方 ${label} 身体被切出画面：${round(l)}–${round(r)}%`);
      check(vp.name, p.groundPct > horizon, `敌方 ${label} 脚底跑到地平线之上：${round(p.groundPct)}%`);
    }
  }

  // 2. 敌我脚底间隙
  const nearestPartyFeet = Math.min(...party.map(b => b.feet));
  const gap = nearestPartyFeet - enemyMaxFeet;
  console.info(
    `  最近我方脚底 ${round(nearestPartyFeet)}%　最远敌方脚底 ${round(enemyMaxFeet)}%　` +
      `间隙 ${round(gap)}%　地平线 ${round(horizon, 2)}%`,
  );
  check(vp.name, gap >= 6, `敌我脚底间隙只有 ${round(gap)}%，会在屏幕上压叠`);

  // 4. 最前排角色屏幕高度
  const front = project(
    { x: worldXFromScreen(0.3, PARTY_FRONT_Z, cam), depth: PARTY_FRONT_Z },
    cam,
    CHAR_H,
    PARTY_FRONT_Z,
  );
  check(
    vp.name,
    front.heightPct >= 38 && front.heightPct <= 68,
    `最前排角色屏幕高度 ${round(front.heightPct)}% 不在 38–68% 区间`,
  );

  // 6. 同一纵深上的自己人不互相压叠
  for (let i = 0; i < party.length; i++) {
    for (let j = i + 1; j < party.length; j++) {
      if (Math.abs(party[i].depth - party[j].depth) > 0.01) continue;
      const share = overlap(party[i], party[j]) / (party[i].r - party[i].l);
      check(vp.name, share < 0.02, `${party[i].label} 与 ${party[j].label} 同深度却重叠 ${round(share * 100)}%`);
    }
  }

  // 7. 敌我身体重叠：宽屏必须为零
  let worst = { label: '', share: 0 };
  for (const e of enemyBodies) {
    const eWidth = e.r - e.l;
    for (const p of party) {
      const share = eWidth > 0 ? overlap(e, p) / eWidth : 0;
      if (share > worst.share) worst = { label: `${e.label} ← ${p.label}`, share };
    }
  }
  console.info(
    `  敌我最大身体重叠：${worst.label || '无'} ${round(worst.share * 100)}%` +
      `${aspect >= 1.4 ? '（宽屏要求 0%）' : '（竖屏只报告）'}`,
  );
  if (aspect >= 1.4) {
    check(vp.name, worst.share < 0.001, `宽屏下敌方被压住 ${round(worst.share * 100)}%：${worst.label}`);
  }

  console.info('');
}

/*
 * 为什么不给竖屏设"零重叠"：
 * 竖屏舞台只有 390px 宽，四个身体各占 ~25%（前排）/19%（后排），加上敌人已经超过
 * 100%——**物理上摆不下**。所以竖屏的策略是"接受压叠、但保证名条与血条永远可读"
 * （名条是屏幕空间且 depth-index 高于前景遮挡）。这一条属于人眼验收，不是断言。
 */

if (failures > 0) {
  console.error(`✗ ${failures} 项断言失败`);
  process.exitCode = 1;
} else {
  console.info('✓ 全部断言通过');
}
