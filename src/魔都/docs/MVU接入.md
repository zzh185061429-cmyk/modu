# MVU 接入清单（未做，架构已留）

> **当前状态：MVU 没接。** 架构位置已留好，MVU 缺席时全链路静默降级。
> 这份文档是给"下次真做的时候"的施工清单，照单打勾即可。

---

## 一、已经就位（不需要动）

| 位置 | 内容 |
|---|---|
| `src/utils/mvu.ts` | 就绪探测 `ensureMvuReady` / 三层降级读 `readStatData` / 夹逼 `clampNumber`·`clampStatFields` / 收账订阅 `onVariableUpdateEnded` |
| `src/store/GameContext.tsx` | 收账挂载点已接（`onVariableUpdateEnded` 订阅，回调内留 TODO） |
| `src/utils/interaction.ts` | 重 roll 八步里**步骤 6「变量重算」的挂载点**已留（注释标了 TODO） |
| 降级链 | 无 `Mvu` 全局 / 宿主没装框架脚本 / 空聊天 → 全部走占位值，前端不崩 |

**验证方式**：本地无头验收（`scripts/verify-floors.mjs`）本来就在无 MVU 环境跑，
三套脚本全绿即说明降级链成立。

---

## 二、接入时要补的五件事

### 1. 变量结构（Zod schema）

新建 `src/data/mvuSchema.ts`。参考幻璃镜的写法：

```ts
export const Schema = z.object({
  信赖: z.object({
    京香: z.coerce.number().min(0).max(100).describe('羽前京香对玩家的信赖度').prefault(20),
  }),
  // …
});
```

三条约定：
- **`z.coerce.number()`** —— AI 常把数字写成字符串，不 coerce 会整条 schema 校验失败
- **`describe()`** —— 这段文本会生成给 AI 的变量说明，写法直接决定 AI 输出质量
- **`prefault()`** —— 初始默认值（不是 `default()`）

> 魔都的字段集**还没定**。题材上合理的最小集是「游戏内时间 / 当前地点 /
> 与羽前京香的信赖度 / 疲劳 / 剧情标记」，但**先定玩法再定字段**——
> 没有消费方的字段就是白搭的维护成本。战斗系统重构时再一起定。

### 2. 框架脚本（酒馆助手脚本库两份）

| 脚本 | 内容 |
|---|---|
| Mvu 框架本体 | 一行 `import 'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';`，**固定 UUID** |
| 变量结构 | `import { registerMvuSchema } from '…/mvu_zod.js'; import { Schema } from '../../schema'; $(() => registerMvuSchema(Schema));` |

### 3. 世界书侧三条目（随角色卡发布，**前端不写**）

| 条目 | 蓝灯 | 说明 |
|---|---|---|
| `[initvar]变量初始化勿开` | **禁用** | 初始值来源 |
| `[mvu_update]变量更新规则` | 开 | 教 AI 输出 `<UpdateVariable>` 语法 |
| 变量列表 | 开 | 字段含义（由 `describe()` 生成） |

### 4. 业务 reader

在 `mvu.ts` 里按字段加 reader，形如：

```ts
export function readTrust(messageId?: number): number {
  return clampNumber(readStatData(messageId)?.信赖?.京香, 0, 100, 20);
}
```

**逐字段夹逼 + 缺失回退默认值，不信任 AI 输出的任何数值。**

### 5. 重 roll 的变量重算

`src/utils/interaction.ts` 步骤 6，把 TODO 换成：

```ts
await waitGlobalInitialized('Mvu');
const oldData = Mvu.getMvuData({ type: 'message', message_id: lastFloorId });
await Mvu.parseMessage(filtered, oldData);   // filtered = stripThinking(raw)
```

注意：**写回楼层的仍是 `raw`（含思维链与更新块）**，`filtered` 只用于变量解析。

---

## 三、铁律（写错就出事）

1. **前端不解析变量更新块**（红线 4）。`<UpdateVariable>` 归 MVU 框架，前端只读结果。
2. **收账只在 `VARIABLE_UPDATE_ENDED` 回调内直接改写传入的 `variables`**，
   框架随后落盘。**不要在回调里 `getMvuData` 重读** —— 时序上拿到的是旧值。
3. **MVU 缺席时全部静默降级**，任何一个 reader 都不许抛异常。
4. **回看历史楼层时只读该楼层的 stat_data**，不要回退聊天变量（那是"最新值"，
   用来渲染旧楼层是错的）。这条已经在 `readStatData` 的实现里守住了。
