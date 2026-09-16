/**
 * MVU (MagVarUpdate) 前端适配层 —— **架构骨架，尚未接入**
 *
 * ⚠️ 当前状态：MVU **没做**。本文件只把架构位置留好，不含任何业务字段。
 *
 * 已就位（不依赖 MVU 存在，缺席时全部静默降级）：
 *   - 就绪探测 `ensureMvuReady` —— 宿主装了 MVU 框架脚本才为 true
 *   - 三层降级读 `readStatData` —— 楼层 stat_data → 聊天变量 stat_data → null
 *   - 数值夹逼 `clampNumber` / `clampStatFields`
 *   - 收账订阅 `onVariableUpdateEnded`
 *
 * 刻意留空（等变量结构定稿再做，见 `docs/MVU接入.md` 的接入清单）：
 *   - 业务字段定义（信赖度 / 疲劳 / 剧情标记 / 时间地点…）
 *   - Zod schema 与 `registerMvuSchema` 脚本
 *   - 世界书侧三条目（[initvar] / [mvu_update] / 变量列表）
 *   - 各业务字段的 reader 与夹逼规则
 *
 * 设计总纲：**MVU 缺席时全部静默降级，前端绝不崩**。
 * 浏览器裸跑 / 宿主没装框架脚本 / 空聊天，这三种情况都必须走降级而不是报错。
 *
 * 架构铁律（技能红线 4）：**前端不解析变量更新块**。AI 输出的 `<UpdateVariable>`
 * 由 MVU 框架解析落盘，前端只读结果、做夹逼、做派生 UI 同步。
 */

/** 无 MVU 时的占位（读不到任何东西时的兜底，业务侧自行决定怎么用） */
export const NO_STAT_DATA: Readonly<Record<string, never>> = Object.freeze({});

/** 宿主是否装了 MVU 框架脚本（同步探测，不等待） */
export function isMvuAvailable(): boolean {
  try {
    return typeof (globalThis as { Mvu?: unknown }).Mvu === 'object' && (globalThis as { Mvu?: unknown }).Mvu !== null;
  } catch {
    return false;
  }
}

/**
 * 就绪探测：`waitGlobalInitialized('Mvu')` 带超时竞速；
 * 超时后回退 `window.Mvu` 直接探测；仍不行则返回 false（调用方静默降级）。
 * 注意 `waitGlobalInitialized` 只在 iframe 语境存在，主页面没有——拿不到不是漂移。
 */
export async function ensureMvuReady(timeoutMs = 8000): Promise<boolean> {
  try {
    const waitGlobal = (globalThis as { waitGlobalInitialized?: (name: string) => Promise<void> }).waitGlobalInitialized;
    await Promise.race([
      typeof waitGlobal === 'function' ? waitGlobal('Mvu') : Promise.reject(new Error('no waitGlobalInitialized')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('mvu wait timeout')), timeoutMs)),
    ]);
    return isMvuAvailable();
  } catch {
    return isMvuAvailable();
  }
}

/**
 * 读 stat_data（三层降级链的第一、二层）。
 *
 * - 指定楼层号：只读该楼层的 MVU 存储，失败返回 null（不回退聊天变量——
 *   回看历史楼层时拿聊天变量的"最新值"是错的）
 * - 不指定（读最新）：楼层读不到再回退聊天变量 `stat_data`
 * - 两层都落空 → null，由调用方用占位常量兜底
 */
export function readStatData(messageId?: number): Record<string, unknown> | null {
  try {
    const mvu = (globalThis as { Mvu?: { getMvuData?: (arg: unknown) => { stat_data?: unknown } } }).Mvu;
    if (mvu?.getMvuData) {
      const data = mvu.getMvuData({ type: 'message', message_id: messageId ?? 'latest' });
      const sd = data?.stat_data;
      if (sd && typeof sd === 'object') return sd as Record<string, unknown>;
    }
  } catch {
    /* 楼层读取失败（空聊天 / 无 MVU）→ 走下一层 */
  }
  if (messageId == null) {
    try {
      if (typeof getVariables === 'function') {
        const chat = getVariables({ type: 'chat' }) as { stat_data?: unknown };
        const sd = chat?.stat_data;
        if (sd && typeof sd === 'object') return sd as Record<string, unknown>;
      }
    } catch {
      /* 无酒馆环境（浏览器裸跑）→ 返回 null */
    }
  }
  return null;
}

/** 数值夹逼：非法值（NaN / Infinity / 非数字）回退默认值，其余收进 [lo, hi] */
export function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/** 单字段夹逼规则 */
export interface ClampRule {
  /** 从 stat_data 取值的路径，如 ['信赖', '京香'] */
  path: string[];
  min: number;
  max: number;
  fallback: number;
}

/**
 * 按规则表就地夹逼 stat_data 里的数值字段。
 *
 * **收账铁律**：只能在 `onVariableUpdateEnded` 回调内、直接改写传入的 variables
 * （框架随后落盘）；**不要在回调里 `readStatData()` 重读**——时序上会拿到旧值。
 *
 * @returns 是否发生了修改
 */
export function clampStatFields(variables: unknown, rules: ClampRule[]): boolean {
  try {
    const sd = (variables as { stat_data?: Record<string, unknown> } | null)?.stat_data;
    if (!sd) return false;
    let changed = false;
    for (const rule of rules) {
      let cursor: Record<string, unknown> | undefined = sd;
      for (const key of rule.path.slice(0, -1)) {
        const next = cursor?.[key];
        if (!next || typeof next !== 'object') {
          cursor = undefined;
          break;
        }
        cursor = next as Record<string, unknown>;
      }
      const leaf = rule.path[rule.path.length - 1];
      if (!cursor || leaf == null || cursor[leaf] == null) continue;
      const clamped = clampNumber(cursor[leaf], rule.min, rule.max, rule.fallback);
      if (clamped !== cursor[leaf]) {
        cursor[leaf] = clamped;
        changed = true;
      }
    }
    return changed;
  } catch {
    return false;
  }
}

/**
 * 订阅 MVU 变量更新结束事件（透传更新后 / 更新前两份变量表）。
 * MVU 未接入或框架未就绪时返回空操作——调用方无需判空。
 */
export function onVariableUpdateEnded(
  cb: (variables: Record<string, unknown>, variablesBefore: Record<string, unknown>) => void,
): () => void {
  try {
    const mvu = (globalThis as { Mvu?: { events?: { VARIABLE_UPDATE_ENDED?: string } } }).Mvu;
    const evt = mvu?.events?.VARIABLE_UPDATE_ENDED;
    if (!evt || typeof eventOn !== 'function') return () => {};
    const ret = eventOn(evt, (variables: unknown, variablesBefore: unknown) => {
      cb(
        (variables ?? {}) as Record<string, unknown>,
        (variablesBefore ?? {}) as Record<string, unknown>,
      );
    });
    return () => {
      try {
        ret?.stop?.();
      } catch {
        /* 宿主可能已自行销毁 */
      }
    };
  } catch {
    return () => {};
  }
}
