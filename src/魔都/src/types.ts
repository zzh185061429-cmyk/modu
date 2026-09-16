export interface DialogueLine {
  id: string;
  speaker: string;
  text: string;
  avatar?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

// 'map' 是补的：原项目 HUD 的「战术地图 (MAP)」按钮误接在 'settings' 上，
// 点它弹出来的是系统设置。拆出独立模态后按钮才名副其实。
// 'thinking' / 'manual' / 'delete' 对齐幻璃镜的 神识 / 通鉴 / 焚卷 三个通用模块。
// 'combat' 由抽屉的「战斗演习」触发（剧情战走正文尾部 [battle:] 标签，不走这里）。
export type ModalType = 'none' | 'settings' | 'database' | 'history' | 'map' | 'thinking' | 'manual' | 'delete' | 'combat';

/** 战术地图分区 */
export type ThreatLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface MapSector {
  id: string;
  name: string;
  code: string;
  threat: ThreatLevel;
  squad: string;
  desc: string;
}

// Combat System Types
export interface CombatCard {
  id: string;
  name: string;
  type: 'attack' | 'defend' | 'skill';
  cost: number;
  damage?: number;
  syncBoost: number;
  description: string;
}

export interface BattleLog {
  id: string;
  text: string;
  type: 'system' | 'player' | 'enemy' | 'critical';
  timestamp: string;
}
