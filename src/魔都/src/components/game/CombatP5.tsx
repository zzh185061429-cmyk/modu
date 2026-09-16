import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, Shield, Sparkles, Swords, Zap } from 'lucide-react';
import { findEnemy, SQUAD, type EnemyDef } from '../../data/enemies';
import { enemyCountFor, splitHp } from './battle/formation';
import { BattleStage, type StageEnemy, type StageUnit } from './battle/BattleStage';
import type { ImpactSpawn } from './battle/ImpactFX';
import type { ImpactKind } from './battle/fx';
import './CombatP5.css';

/**
 * 战斗场景 —— P5 式：全员在场，一次只聚焦当前行动者，换手（Baton Pass）切镜头。
 *
 * 这个文件**只管编排**：空间在 `battle/stage.ts`，编队在同目录 `formation.ts`，
 * 舞台与命中演出在 `BattleStage.tsx` / `ImpactFX.tsx`。这里保留规则与流程。
 *
 * 出手的时间线（S4 定的）：
 *
 * ```
 *   0ms            前摇：行动者后仰蓄力，还没接触
 *   100ms          接触：伤害结算 + 命中特效 + 推镜 + 震屏（定格烤在动画关键帧里）
 *   100→860ms      收势：特效散尽，交还指挥权（或转敌方回合）
 * ```
 *
 * 为什么把结算推到 100ms：原来是"按下即结算"，命中特效跟人物动作同一帧起，
 * 读起来像贴纸。**前摇那 100ms 是打击感的成本**，省不掉。
 *
 * 还没做的：完整运镜（S2）· 程序化暗影生物（S3）· P5 语言 HUD（S5）。
 */

type Phase = 'intro' | 'command' | 'resolving' | 'enemy' | 'result';
export type CombatResult = 'win' | 'lose' | 'retreat';

interface CommandDef {
  id: 'attack' | 'assault' | 'guard';
  label: string;
  sub: string;
  cost: number;
}

const MAX_AP = 5;
const UNIT_MAX_HP = 120;
const MAX_BATON = 3;

/** 前摇到接触的时间。必须和 `.mato-bs__lunge` 关键帧的 22% 对齐（0.5s × 22% = 110ms） */
const DASH_MS = 100;
/** 接触之后到交还指挥权的时间，要够特效与伤害数字播完 */
const SETTLE_MS = 760;

const COMMANDS: CommandDef[] = [
  { id: 'attack', label: '攻击', sub: '1 AP', cost: 1 },
  { id: 'assault', label: '强袭', sub: '3 AP', cost: 3 },
  { id: 'guard', label: '防御', sub: '1 AP', cost: 1 },
];

const COMMAND_ICON = { attack: Swords, assault: Zap, guard: Shield } as const;

/**
 * 建敌方阵：体数由威胁等级推导，**总血量摊到各体**。
 * 所以"低危 ×3"和原来"低危 ×1"的总血量一致——改体数不会偷偷改难度。
 */
function buildEnemies(def: EnemyDef): StageEnemy[] {
  const count = enemyCountFor(def.threat);
  const hps = splitHp(def.maxHp, count);
  return Array.from({ length: count }, (_, index) => ({
    id: `${def.id}-${index}`,
    name: def.name,
    threat: def.threat,
    art: def.art,
    hp: hps[index],
    maxHp: hps[index],
  }));
}

interface CombatP5Props {
  enemyName: string;
  story?: boolean;
  onExit: (result: CombatResult) => void;
}

export function CombatP5({ enemyName, story = false, onExit }: CombatP5Props) {
  const enemy = useMemo(() => findEnemy(enemyName), [enemyName]);
  const [enemies, setEnemies] = useState<StageEnemy[]>(() => buildEnemies(enemy));
  const [targetId, setTargetId] = useState<string>(() => `${enemy.id}-0`);
  const [units, setUnits] = useState<StageUnit[]>(() =>
    SQUAD.map(unit => ({ ...unit, hp: UNIT_MAX_HP, maxHp: UNIT_MAX_HP })),
  );
  const [activeId, setActiveId] = useState(SQUAD[0].id);
  const [ap, setAp] = useState(MAX_AP);
  const [sync, setSync] = useState(0);
  const [baton, setBaton] = useState(0);
  const [transformed, setTransformed] = useState(false);
  const [phase, setPhase] = useState<Phase>('intro');
  const [round, setRound] = useState(1);
  const [log, setLog] = useState('遭遇战');
  const [impact, setImpact] = useState<ImpactSpawn | null>(null);
  const [shake, setShake] = useState(false);
  const busyRef = useRef(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /**
   * 命中计数必须用 ref 存。放在 impact 对象里会出事：impact 被清成 null 之后
   * 下一击又从 1 开始，奇偶没变，动画就不会重放——第二刀会"哑火"。
   */
  const impactTickRef = useRef(0);

  const activeUnit = units.find(unit => unit.id === activeId) ?? units[0];
  const batonMultiplier = 1 + baton * 0.3;

  /** 锁定的目标；它倒了就顺位到下一个还站着的（不用玩家手动再点一次） */
  const target =
    enemies.find(item => item.id === targetId && item.hp > 0) ?? enemies.find(item => item.hp > 0) ?? null;

  const allEnemiesDown = enemies.length > 0 && enemies.every(item => item.hp <= 0);

  useEffect(() => {
    const current = enemies.find(item => item.id === targetId);
    if (current && current.hp > 0) return;
    const next = enemies.find(item => item.hp > 0);
    if (next) setTargetId(next.id);
  }, [enemies, targetId]);

  const later = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current = timers.current.filter(t => t !== timer);
      fn();
    }, ms);
    timers.current.push(timer);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    },
    [],
  );

  // 开场演出：敌方登场 → 交还指挥权
  useEffect(() => {
    later(() => {
      setPhase('command');
      setLog(`第 1 回合 · ${SQUAD[0].name} 待命`);
    }, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!allEnemiesDown || phase === 'result') return;
    setPhase('result');
    setLog(`目标「${enemy.name}」已歼灭`);
  }, [allEnemiesDown, phase, enemy.name]);

  useEffect(() => {
    if (units.some(unit => unit.hp > 0) || phase === 'result') return;
    setPhase('result');
    setLog('全员失去战斗能力');
  }, [units, phase]);

  const enemyTurn = useCallback(() => {
    setPhase('enemy');
    setLog(`${enemy.name} 反击`);
    later(() => {
      let struck = '';
      setUnits(prev => {
        const standing = prev.filter(unit => unit.hp > 0);
        if (standing.length === 0) return prev;
        const victim = standing[Math.floor(Math.random() * standing.length)];
        const value = 12 + Math.floor(Math.random() * 13);
        struck = `${victim.name} 受创 ${value}`;
        return prev.map(unit => (unit.id === victim.id ? { ...unit, hp: Math.max(0, unit.hp - value) } : unit));
      });
      setShake(true);
      later(() => setShake(false), 300);
      later(() => {
        setAp(MAX_AP);
        setRound(value => value + 1);
        setPhase('command');
        setLog(struck);
      }, 520);
    }, 820);
  }, [enemy.name, later]);

  const act = useCallback(
    (command: CommandDef) => {
      if (busyRef.current || phase !== 'command' || ap < command.cost) return;
      busyRef.current = true;
      setPhase('resolving');
      const remaining = ap - command.cost;
      setAp(remaining);

      const guard = command.id === 'guard';
      const hold = (ms: number) =>
        later(() => {
          busyRef.current = false;
          if (remaining <= 0) enemyTurn();
          else setPhase('command');
        }, ms);

      // 防御不接触，所以没有前摇与命中演出
      if (guard) {
        setLog(`${activeUnit.name} 架起锁链防御`);
        hold(520);
        return;
      }

      const transformedMultiplier = transformed ? 2 : 1;
      const base = command.id === 'assault' ? 34 : 14;
      const value = Math.round(base * transformedMultiplier * batonMultiplier * (1 + sync / 200));
      const lockedId = target?.id ?? null;
      const lockedName = target?.name ?? '';
      const kind: ImpactKind = command.id === 'assault' ? 'assault' : 'strike';

      // 前摇结束 → 接触：伤害、特效、推镜、同步一起结算
      later(() => {
        if (lockedId) {
          setEnemies(prev =>
            prev.map(item => (item.id === lockedId ? { ...item, hp: Math.max(0, item.hp - value) } : item)),
          );
        }
        impactTickRef.current += 1;
        setImpact({ tick: impactTickRef.current, value, kind });
        setShake(true);
        setSync(prev => Math.min(100, prev + (command.id === 'assault' ? 26 : 12)));
        setLog(
          `${activeUnit.name} · ${command.label} → ${lockedName} ${value}${baton > 0 ? `（接力 ×${baton}）` : ''}`,
        );
        setBaton(0); // 出手后接力清零：想再吃加成得重新换手
        later(() => setShake(false), 300);
      }, DASH_MS);

      // 收势：清掉命中演出，同时交还指挥权
      later(() => {
        setImpact(null);
        hold(0);
      }, DASH_MS + SETTLE_MS);
    },
    [activeUnit.name, ap, baton, batonMultiplier, enemyTurn, later, phase, sync, target, transformed],
  );

  /**
   * 换手（Baton Pass）：免费切人，每换一次叠一层接力加成。
   * 入口是**点场上那个人**——全员在场之后，换手不再是列表操作。
   */
  const passBaton = useCallback(
    (id: string) => {
      if (busyRef.current || phase === 'result') return;
      const unit = units.find(item => item.id === id);
      if (!unit || unit.hp <= 0) return;
      if (unit.id === activeId) return;
      setActiveId(id);
      const next = Math.min(MAX_BATON, baton + 1);
      setBaton(next);
      setLog(`换手 → ${unit.name}　接力加成 ×${next}`);
    },
    [activeId, baton, phase, units],
  );

  /** 锁定攻击目标：点场上那个敌人（再点一次也不取消，总得有个目标） */
  const lockTarget = useCallback(
    (id: string) => {
      if (busyRef.current || phase !== 'command') return;
      const item = enemies.find(entry => entry.id === id);
      if (!item || item.hp <= 0 || item.id === targetId) return;
      setTargetId(id);
      setLog(`锁定目标 → ${item.name}`);
    },
    [enemies, phase, targetId],
  );

  const transform = useCallback(() => {
    if (busyRef.current || sync < 100 || transformed || phase === 'result') return;
    setTransformed(true);
    setAp(MAX_AP);
    setSync(0);
    impactTickRef.current += 1;
    setImpact({ tick: impactTickRef.current, value: 0, kind: 'release' });
    setLog(`${activeUnit.name} · 奴隶形态解放`);
    later(() => setImpact(null), 900);
  }, [activeUnit.name, later, phase, sync, transformed]);

  const finish = useCallback(
    (result: CombatResult) => {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      busyRef.current = false;
      onExit(result);
    },
    [onExit],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish('retreat');
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [finish]);

  const finished = phase === 'result';
  const won = finished && allEnemiesDown;

  return (
    <section className="mato-battle" data-phase={phase} data-threat={enemy.threat} aria-label="战斗场景">
      {/* 震动作用在内层：根节点上换 animation 会把入场动画（含 fill-mode）一起重置，
          结果是整层变半透明、下面游戏 UI 全透出来 */}
      <div className="mato-battle__inner" data-shake={shake ? 'true' : undefined}>
        <BattleStage
          units={units}
          activeId={activeId}
          enemies={enemies}
          targetId={target?.id ?? ''}
          impact={impact}
          selectable={phase === 'command'}
          onSelect={passBaton}
          onSelectTarget={lockTarget}
        />

        {/* ── 底部行动区（屏幕空间；S5 换成 P5 语言）── */}
        <div className="mato-battle__hud">
          <div className="mato-battle__turn">
            <span className="mato-battle__round">回合 {round}</span>
            <div className="mato-battle__ap" role="status" aria-label={`行动点 ${ap} / ${MAX_AP}`}>
              <small>行动点</small>
              <span className="mato-battle__pips">
                {Array.from({ length: MAX_AP }, (_, index) => (
                  <i key={index} data-filled={index < ap} />
                ))}
              </span>
            </div>
            <div className="mato-battle__sync">
              <small>同步 {sync}%</small>
              <span className="mato-battle__sync-bar">
                <i style={{ width: `${sync}%` }} />
              </span>
            </div>
            {baton > 0 && <em className="mato-battle__baton">接力 ×{baton}</em>}
          </div>

          <p className="mato-battle__log" role="status" aria-live="polite">
            {log}
          </p>

          <div className="mato-battle__commands">
            {finished ? (
              <button
                type="button"
                className="mato-battle__cmd mato-battle__cmd--primary"
                onClick={() => finish(won ? 'win' : 'lose')}
              >
                <span>{won ? '战斗结束' : '撤退'}</span>
                <small>{won ? '返回剧情' : '重整态势'}</small>
              </button>
            ) : (
              <>
                {COMMANDS.map(command => {
                  const Icon = COMMAND_ICON[command.id];
                  const needsTarget = command.id !== 'guard';
                  return (
                    <button
                      key={command.id}
                      type="button"
                      className="mato-battle__cmd"
                      data-command={command.id}
                      disabled={phase !== 'command' || ap < command.cost || (needsTarget && !target)}
                      onClick={() => act(command)}
                    >
                      <Icon size={17} />
                      <span>{command.label}</span>
                      <small>{command.sub}</small>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="mato-battle__cmd mato-battle__cmd--transform"
                  disabled={sync < 100 || transformed || phase !== 'command'}
                  onClick={transform}
                >
                  <Sparkles size={17} />
                  <span>{transformed ? '已解放' : '解放'}</span>
                  <small>{transformed ? '本战生效' : '同步 100%'}</small>
                </button>
              </>
            )}
            <button
              type="button"
              className="mato-battle__cmd mato-battle__cmd--exit"
              onClick={() => finish('retreat')}
            >
              <LogOut size={17} />
              <span>{story ? '撤退' : '退出'}</span>
              <small>Esc</small>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default CombatP5;
