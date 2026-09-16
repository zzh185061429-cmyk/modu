/** 操作手册 —— 静态说明，用于玩家上手与遗忘后自查。 */

const SECTIONS: Array<{ title: string; items: string[] }> = [
  {
    title: '推进剧情',
    items: ['点击文本框任意处推进一句', '键盘 Enter / 空格同样可推进', '正在打字时点击 = 立刻显示整句'],
  },
  {
    title: '阅读控制',
    items: [
      '上句：回退一行，读快了想重看时用',
      '自动：按固定间隔自动推进，遇到选项会停下',
      '语速：瞬发 / 舒缓 / 适中 / 迅疾，点一下切一档',
    ],
  },
  {
    title: '做出抉择',
    items: [
      '播到选项时弹出抉择面板',
      '点击选项只是「起草」，先填进输入框',
      '确认无误再发送，避免误触直接消耗生成',
    ],
  },
  {
    title: '输入行动',
    items: [
      '桌面：点文本框右下角「发送」，文本框原地变为输入框',
      '手机：底部输入栏直接输入',
      'Enter 发送，Shift + Enter 换行，Esc 收合',
    ],
  },
  {
    title: '楼层',
    items: [
      '文本框右下角「上卷 / 下卷」翻阅楼层',
      '菜单 → 篇章，可跳到任意一层',
      '回看历史楼层时出现「跟随」，一键回到最新',
    ],
  },
  {
    title: '指挥终端',
    items: [
      '顶栏「菜单」打开右侧终端',
      '人物档案 / 魔都领域 / 战斗演习 / 系统设置',
      '重新生成：本楼内容原位替换，不新增楼层',
      '删除楼层：按范围彻底删除，不可恢复',
    ],
  },
  {
    title: '退出',
    items: ['Esc 或 菜单 → 返回标题'],
  },
];

export function ManualPanel() {
  return (
    <div className="mato-manual">
      {SECTIONS.map((section, i) => (
        <section key={section.title} className="mato-manual__section">
          <h3>
            <span>{String(i + 1).padStart(2, '0')}</span>
            {section.title}
          </h3>
          <ul>
            {section.items.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default ManualPanel;
