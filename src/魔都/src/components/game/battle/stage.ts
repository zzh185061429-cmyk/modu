/**
 * 战斗舞台 · 投影数学（S1：空间与投影）
 *
 * 这里**只有纯函数**：不碰 React、不碰 DOM，所以 `scripts/verify-battle-stage.ts`
 * 能直接 import 后逐条断言。
 *
 * 铁律：舞台的每一层（地面网格、脚底落点、立绘高度、焦外模糊）都必须从**这一份**
 * 投影算出来。地面网格用 SVG 按同一组坐标画，而不是另开一套 CSS perspective ——
 * 两套模型一旦对不上，脚就会浮在地面之外，而这种错位靠眼睛很难查。
 *
 * 坐标系：世界单位＝米。x 左右（0＝中轴），depth 纵深（0＝机位平面，越大越远），
 * 地面是 y=0 的平面。
 */

/** 角色身高（世界单位）—— 决定立绘的屏幕高度 */
export const CHAR_H = 1.7;

/** 立绘画布宽高比（693×1149）。立绘的"世界宽度"由它推出来 */
export const SPRITE_ASPECT = 693 / 1149;

/** 立绘画布的世界宽度（含透明留白）——画布比身体宽，并排时会轻微交叠，属正常 */
export const SPRITE_W = CHAR_H * SPRITE_ASPECT;

/** 角色**身体**的大致世界宽度（用于断言不被切出画面，不计透明留白） */
export const BODY_W = 0.6;

/** 设计基准宽高比（1440×900 扣掉 HUD 后大约是这个数） */
export const REF_ASPECT = 1.55;

/** 地平线钉在舞台高度的 42%（从上往下量） */
export const HORIZON_PCT = 42;

/** 基准比例下，我方最前排角色的屏幕高度占舞台高度的比例 */
export const BASE_FRONT_HEIGHT_PCT = 58;

/** 我方最前排脚底落点（%）—— 纵深锚点，相机高度由它反解出来 */
export const FRONT_FEET_PCT = 86;

/**
 * 水平视野下限（半角正切）。
 * 竖屏横向很窄：只按"角色该占多高"定视野的话，前排两个人会被切出画面。
 * 所以竖屏必须一路退到装得下整条阵型宽度为止——代价是角色变小。
 */
export const MIN_TAN_HALF_FOV_X = 0.34;

/** 折线（地面网格）用的纵深采样：等距会在近处太稀、远处糊成一片，所以按几何级数取 */
export const GRID_Z: readonly number[] = [2.4, 2.9, 3.5, 4.3, 5.4, 7, 9.5, 14, 24];

export interface Camera {
  /** 机位水平位置 */
  x: number;
  /** 机位纵深（0＝舞台前沿） */
  depth: number;
  /** 机位离地高度 */
  height: number;
  /** 俯角（弧度，正＝向下看） */
  pitch: number;
  tanHalfFovX: number;
  tanHalfFovY: number;
}

export interface Vec2 {
  x: number;
  depth: number;
}

export interface AirPerspective {
  blurPx: number;
  saturate: number;
  brightness: number;
  opacity: number;
}

export interface Projected {
  /** 屏幕横向位置（% ，0＝左缘 100＝右缘） */
  xPct: number;
  /** 脚底落点（% ，0＝舞台顶 100＝舞台底） */
  groundPct: number;
  /** 该高度的物体在屏幕上占舞台高度的百分比 */
  heightPct: number;
  /** 沿视轴的深度（米）——焦外与遮挡排序都用它 */
  depth: number;
  air: AirPerspective;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 反解相机高度：让 depth = frontZ 的地面点正好落在 wantFeetPct。
 *
 * 地面点比机位低，相机空间里 yc = -h·cosθ + d·sinθ、zc = h·sinθ + d·cosθ，
 * 屏幕位置是 (yc/zc) 的线性分式 —— 对 h 解一次方程就够，不必迭代。
 */
function solveHeight(pitch: number, frontZ: number, wantFeetPct: number, tanHalfFovY: number): number {
  const cos = Math.cos(pitch);
  const sin = Math.sin(pitch);
  const targetNdcY = (50 - wantFeetPct) / 50;
  const k = targetNdcY * tanHalfFovY;
  return (frontZ * (sin - k * cos)) / (cos + k * sin);
}

/**
 * 按容器宽高比推导相机。**这就是"比例自适应"的全部**——没有媒体查询，
 * 一套世界坐标同时服务横屏、竖屏、矮屏。
 *
 * @param aspect   舞台容器（已扣掉 HUD）的宽高比
 * @param frontZ   我方最前排的纵深，脚底落点的锚点
 */
export function deriveCamera(aspect: number, frontZ: number): Camera {
  const safeAspect = clamp(aspect, 0.4, 4);

  // 竖直视野由"最前排角色该占多高"决定
  const baseTanHalfFovY = CHAR_H / (frontZ * 2 * (BASE_FRONT_HEIGHT_PCT / 100));
  // 竖屏必须退到能装下阵型宽度，宁可角色变小也不能切出画面
  const tanHalfFovY = Math.max(baseTanHalfFovY, MIN_TAN_HALF_FOV_X / safeAspect);
  const tanHalfFovX = tanHalfFovY * safeAspect;

  // 地平线位置只由 pitch 与竖直视野决定，与相机高度无关 —— 所以定完视野再定俯角
  const pitch = Math.atan((tanHalfFovY * (50 - HORIZON_PCT)) / 50);
  const height = solveHeight(pitch, frontZ, FRONT_FEET_PCT, tanHalfFovY);

  return { x: 0, depth: 0, height, pitch, tanHalfFovX, tanHalfFovY };
}

/** 地平线在舞台高度的百分比（应当恒等于 HORIZON_PCT） */
export function horizonPct(cam: Camera): number {
  return 50 - (50 * Math.tan(cam.pitch)) / cam.tanHalfFovY;
}

/** 只取屏幕横向位置 —— 画地面的纵深线要用它 */
export function projectX(x: number, depth: number, cam: Camera): number {
  const cos = Math.cos(cam.pitch);
  const sin = Math.sin(cam.pitch);
  const d = depth - cam.depth;
  const zc = cam.height * sin + d * cos;
  return 50 + (50 * ((x - cam.x) / zc)) / cam.tanHalfFovX;
}

/** 某纵深处沿视轴的深度（米） */
export function viewDepth(depth: number, cam: Camera): number {
  const cos = Math.cos(cam.pitch);
  const sin = Math.sin(cam.pitch);
  return cam.height * sin + (depth - cam.depth) * cos;
}

/**
 * 反解：想让实体落在屏幕横向 `sx`（0–1），它在世界里的 x 该是多少。
 *
 * **编队必须走这条反解，不能直接写世界坐标。** 直接写会踩一个很难发现的坑：
 * 前排 x=-0.75/depth=3.30 与后排 x=-0.95/depth=4.45 投到屏幕上是同一列，后排当场消失
 * （更远的纵深刚好抵消了更大的横向偏移）。而"屏幕上该站哪"才是真正想控制的东西——
 * 深度只负责给出尺度阶梯与空气透视。
 *
 * 代价：世界坐标会随宽高比变（竖屏阵型物理上更窄），但屏幕构图恒定，
 * 这正是比例自适应想要的。
 */
export function worldXFromScreen(sx: number, depth: number, cam: Camera): number {
  return cam.x + (sx - 0.5) * 2 * cam.tanHalfFovX * viewDepth(depth, cam);
}

/** 实体在屏幕上的半宽（占舞台宽度的比例，0–0.5） */
export function screenHalfWidth(depth: number, cam: Camera, widthUnits: number): number {
  return (widthUnits / 2) / (viewDepth(depth, cam) * cam.tanHalfFovX) / 2;
}

/**
 * 把站位收进画面。
 *
 * 窄屏下最外侧的人会被切掉（竖屏时后排画布半宽能到 13%，sx=7.5% 直接负出去）。
 * 这里按**身体**半宽夹逼，留一点边距；透明画布溢出无所谓，身体溢出不行。
 * 装不下时（lo > hi）退回中轴——宁可站位难看，也不能让人半边在画面外。
 */
export function fitSlotSx(sx: number, depth: number, cam: Camera, widthUnits: number, margin = 0.012): number {
  const half = screenHalfWidth(depth, cam, widthUnits);
  const lo = margin + half;
  const hi = 1 - margin - half;
  if (lo >= hi) return 0.5;
  return Math.min(hi, Math.max(lo, sx));
}

/**
 * 空气透视：越远越糊、越灰、越淡。
 *
 * 注意 `blurPx` 起步很晚（前 1 米完全不清焦）——手机端最贵的就是 blur，
 * 焦外只对真正靠后的少数几体做模糊，其余靠降饱和压暗顶替。
 */
export function airPerspective(depth: number, focusDepth: number): AirPerspective {
  const t = clamp((depth - focusDepth) / 4.2, 0, 1);
  return {
    blurPx: clamp((depth - focusDepth - 1) * 0.55, 0, 2.4),
    saturate: 1 - t * 0.28,
    brightness: 1 - t * 0.2,
    opacity: 1 - t * 0.12,
  };
}

/**
 * 把一个立在地面上的实体投影到屏幕。
 *
 * @param p            地面点（世界坐标）
 * @param cam          相机
 * @param heightUnits  实体高度（世界单位）——暗影生物按威胁等级比人高
 * @param focusDepth   焦平面纵深（取我方最前排）
 */
export function project(p: Vec2, cam: Camera, heightUnits = CHAR_H, focusDepth = p.depth): Projected {
  const cos = Math.cos(cam.pitch);
  const sin = Math.sin(cam.pitch);
  const d = p.depth - cam.depth;

  const yc = -cam.height * cos + d * sin;
  const zc = cam.height * sin + d * cos;

  return {
    xPct: 50 + (50 * ((p.x - cam.x) / zc)) / cam.tanHalfFovX,
    groundPct: 50 - (50 * (yc / zc)) / cam.tanHalfFovY,
    heightPct: (100 * (heightUnits / zc)) / (2 * cam.tanHalfFovY),
    depth: zc,
    air: airPerspective(zc, focusDepth),
  };
}

/**
 * 遮挡排序 —— **我方与敌方必须共用这一个函数**。
 *
 * 踩过的坑：两边各用一个基数（敌人 300、我方 200）时，敌人深度大、减掉的少，
 * 结果 236 > 166，**远处的敌人被画在近处队友之上**，整套纵深当场失效。
 * 越近的越该盖住越远的，所以基数只能有一个。
 */
export function stackIndex(depth: number): number {
  return 900 - Math.round(depth * 10);
}

/**
 * 实体的横向边缘（%）—— 用来断言"没有切出画面"。
 * 横向与纵向共用同一个 zc，所以只需投影出中心点再按半宽摊开。
 */
export function horizontalSpan(p: Vec2, cam: Camera, widthUnits: number, heightUnits = CHAR_H): [number, number] {
  const center = project(p, cam, heightUnits);
  const half = (50 * (widthUnits / 2)) / (center.depth * cam.tanHalfFovX);
  return [center.xPct - half, center.xPct + half];
}
