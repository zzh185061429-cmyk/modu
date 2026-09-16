import type { MapSector } from '../types';

/**
 * 战术地图分区（占位数据，与 mock 剧本同源，等接楼层解析后替换）。
 *
 * 说明：这份数据是为了让 HUD 的「战术地图 (MAP)」按钮有个名副其实的落点。
 * 原项目该按钮误接在系统设置上 —— 这里只补齐按钮应有的去处，不引入任何玩法。
 */
export const MAP_SECTORS: MapSector[] = [
  {
    id: 'hq-7th',
    name: '第七组驻地',
    code: 'ANTI-DEMON CORPS // 7TH UNIT HQ',
    threat: 'LOW',
    squad: '羽前京香',
    desc: '防卫队第七组的常驻据点，设有战术指挥室与灵力补给设施。当前处于战备值守状态。',
  },
  {
    id: 'shuuki-nest',
    name: '丑鬼巢穴',
    code: 'SHUUKI NEST // RESTRICTED',
    threat: 'HIGH',
    squad: '未派遣',
    desc: '探测到高浓度魔都能量反应，丑鬼群落正在聚集。需组长级战力方可突入。',
  },
  {
    id: 'downtown',
    name: '魔都商业区',
    code: 'DOWNTOWN // CIVILIAN ZONE',
    threat: 'MEDIUM',
    squad: '出云天花',
    desc: '平民活动区域，偶发小型丑鬼出没。第六组负责日常巡逻与疏散。',
  },
  {
    id: 'training',
    name: '桃园训练场',
    code: 'TRAINING GROUND // RESONANCE TEST',
    threat: 'NONE',
    squad: '东日万凛',
    desc: '同步率校准与能力演练场地。与主人建立链接后的首次共鸣测试在此进行。',
  },
];
