# Sketch RTS

**手绘风格的浏览器即时战略游戏，也是一套可以编程控制的 AI 对战环境。**

[English](../README.md) · [快速开始](#快速开始) · [游戏画面](#游戏画面) · [SDK 与 AI](#sdk-与-ai) · [美术设计](woodland-atlas.md)

![Sketch RTS「林野战记」主菜单](art/woodland-home.png)

建造基地，派农民采金，带领军队探索地图。从近战、远程到施法单位，配合物品与升级，争夺野怪营地和雇佣兵资源。

你可以直接在浏览器里玩，也可以写一个 AI 来玩。SDK、回放与 AI 基准测试使用同一套按命令帧推进的游戏模拟。

> **项目持续开发中。** 当前在完善浏览器游玩、联机和 AI 工具。新版美术「林野战记 / Woodland Atlas」采用暖纸色地图、墨绿界面与黄铜点缀，单位和建筑使用有明暗与投影的插画造型。

## 可以做什么

| 游玩 | 开发与实验 |
| --- | --- |
| 采金、建造基地、训练军队与研究升级 | 通过 TypeScript SDK 控制比赛 |
| 探索地图，争夺野怪、物品与雇佣兵营地 | 组合 AI 策略，用普通玩家命令控制单位 |
| 创建房间、与电脑对战、观看服务器上的比赛 | 读取状态、推进模拟、保存和回放比赛 |
| 在浏览器本地游玩，或使用服务器联机 | 并行对比 AI 版本，在面板中查看结果 |

## 种族与兵种

两个种族都能造城镇大厅、农场和防御塔，训练农民，也都能在中立营地雇佣雇佣兵、契约弓手和战地医师。其余都不一样。

| | 林野族 Grove Kin | 余烬盟约 Ember Pact |
| --- | --- | --- |
| 基础兵 | 步兵、长枪兵、林地守卫（兵营）；弓箭手（靶场）；掠袭者（马厩） | 余烬劫掠者、余火奔袭者（余烬熔炉）；火花弓手（烬火尖塔） |
| 法师 | 牧师、召唤师、女巫（圣所） | 余烬侍僧、灰烬巫师、薪火召唤者（烬火尖塔） |
| 精英 | 骑士（马厩）；魔像（工坊） | 灰烬酋长、余烬复生者（灰烬战殿） |
| 治疗建筑 | 月井 | 余烬神龛 |

- **重甲**：四种精英受到射手和法师攻击只承受 50% 伤害，防御塔 70%，近战照常。
- **余烬精英各有分工**：灰烬酋长对法师和召唤生物多造成 50% 伤害；余烬复生者生命值较低，但每秒恢复 7 点生命。
- **单位会还手**：没有命令的单位挨打时会转身反击，300 范围内闲着的士兵也会过来帮忙，射手没法站在远处白打一支闲置的部队。单位自己发起的追击离原位超过 600 就放弃并走回来。移动命令和你亲手下的命令不会被打断。

## 快速开始

需要 **Node.js 20.19+ 或 22.12+**，以及 npm。

```bash
git clone https://github.com/shuxueshuxue/sketch-rts.git
cd sketch-rts
npm ci
npm run dev
```

打开 **[localhost:5173](http://127.0.0.1:5173/)**。这会启动包含房间 API 和 SDK 接口的开发服务器。

1. 进入「**房间 → 创建房间**」。
2. 选择地图。初次体验可保留一个人类槽位和一个电脑槽位。
3. 点击「开始比赛」，按提示锁定鼠标进入战场。
4. 选中农民，右键金矿开始采金，再建造兵营、训练士兵。

界面根据浏览器语言显示英文或简体中文。

| 操作 | 作用 |
| --- | --- |
| 左键单击 / 拖动 | 选择单位或建筑 / 框选多个单位 |
| 右键 | 根据目标执行移动、采金或攻击 |
| 选中农民后按 `B` | 打开建造菜单 |
| 按钮上的快捷键 | 建造、训练、研究或施法 |
| 方向键 / `WASD` | 移动镜头；当前可用的命令快捷键优先 |
| `Esc` | 释放鼠标；取消当前目标选择模式 |

## 游戏画面

实际对局：农民正在采金，兵营正在建造，主城队列中正在训练农民。

![Sketch RTS 实际对局：基地、农民、金矿和指令栏](art/woodland-match.png)

守在金矿旁的中立营地：石背蛮兽、荆刺射手、树皮医者和林间女巫。

![战场上的中立野怪营地](art/woodland-camp.png)

<details>
<summary><strong>展开查看 30 种单位（按阵营与等级分组）与 13 种建筑图鉴</strong></summary>

![「林野战记」单位和建筑图鉴](art/woodland-catalog.png)

</details>

这套插画由 Canvas 代码绘制，在战场、选中头像和指令按钮中共用。单位装备随价格分级：初级兵（≤120 金）穿布甲皮甲，进阶的法师与雇佣兵（130–160 金）有镶边长袍和法器，精英（≥190 金、3+ 人口）才有板甲、披风和羽饰。只有马厩训练的掠袭者和骑士骑马。[美术设计说明](woodland-atlas.md)还包含建筑放置预览与改造前的画面。

## 选择运行方式

| 模式 | 适合场景 | 比赛如何运行 |
| --- | --- | --- |
| 静态浏览器模式 | 本地与 AI 对战、静态网站托管 | 游戏直接运行在浏览器里，不需要游戏后端 |
| 服务器模式 | 共享房间、联机、观战、SDK 和基准测试 | 服务器管理房间并协调命令帧 |

### 静态浏览器模式

安装依赖后，可以直接启动不依赖房间后端的本地游戏：

```bash
npm run dev:static
```

运行 `npm run build:static` 可生成静态站点，再用静态服务器托管 `dist/` 目录。

<details>
<summary>Windows PowerShell 命令</summary>

静态模式的 npm 脚本使用 Bash 风格的环境变量写法。在 PowerShell 中请显式设置：

```powershell
$env:VITE_SKETCH_RTS_DEPLOYMENT = 'static'
npx vite --host 127.0.0.1 --port 5173
```

需要构建静态生产版本时，保留该变量并执行 `npm run build`。切回服务器模式前，执行 `Remove-Item Env:VITE_SKETCH_RTS_DEPLOYMENT` 清除该变量。

</details>

### 服务器模式

本地开发使用 `npm run dev`。如果要在网络中提供生产构建：

```bash
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=34573 npm run server
```

<details>
<summary>Windows PowerShell 命令</summary>

```powershell
npm run build
$env:NODE_ENV = 'production'
$env:HOST = '0.0.0.0'
$env:PORT = '34573'
npm run server
```

</details>

房间链接使用 `#room=room-id` 这样的哈希路由，也支持部署到子路径。[开发指南](development.md#deployment-modes)列出了服务器接口与各运行模式的职责。

## SDK 与 AI

TypeScript SDK 支持创建房间、重置场景、读取状态、发出命令、推进时间，以及保存和回放比赛。先启动服务器，再从仓库中导入 SDK：

```ts
import { SketchRtsSdk } from './src/sdk/client';

const sdk = new SketchRtsSdk('http://127.0.0.1:5173');
const room = await sdk.createRoom({
  id: 'sdk-demo',
  host: { id: 'agent-host', name: 'Agent Host' },
  mapId: 'bareDuel',
  visibility: 'private',
  humanCount: 1,
  aiCount: 1,
});

const { snapshot } = await sdk.resetRoom(room.id, 'bareDuel', {
  aiPlayers: ['enemy'],
  races: { player: 'grove', enemy: 'ember' },
});

const worker = snapshot.units.find(u => u.owner === 'player' && u.kind === 'worker');
const mine = snapshot.resources.find(r => r.id === 'gold-player-main');
if (!worker || !mine) throw new Error('Missing starting worker or mine');

await sdk.roomCommand(room.id, 'player', {
  type: 'mine',
  unitIds: [worker.id],
  resourceId: mine.id,
});
```

AI 策略读取状态快照，输出普通 `GameCommand` 命令。浏览器操作、内置电脑、外部 SDK 智能体、回放和基准测试，都通过共用的命令帧运行时推进游戏。

也可以在终端创建一场可复现的 AI 对局：

```bash
npm run play:ai -- new --file .playtest/match.json --map bareDuel --you v2 --enemy v1
npm run play:ai -- step-until --file .playtest/match.json --condition tick --tick 1200
npm run play:ai -- plan --file .playtest/match.json --owner v2
npm run play:ai -- commands
```

最后一条命令会输出机器可读的命令清单。完整 SDK 示例、AI 策略组合、回放与基准测试命令见[开发指南](development.md)。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动服务器模式的开发环境 |
| `npm run build` | TypeScript 检查与前端构建 |
| `npm run build:production` | 构建前端和服务器包 |
| `npm test -- --run` | 运行一次完整测试 |
| `npx vitest --run src/client` | 运行前端测试 |
| `npm run test:sdk-smoke` | 启动测试服务器并验证 SDK |
| `npm run benchmark:ai` | 运行 AI 基准测试 |

服务器还提供 `benchmark.html` 基准测试面板。实验设计与测试流程可参考[开发指南](development.md#benchmark-system)和 [AI 规范](ai-spec.md)。

### 新增单位或建筑

一个单位或建筑只写在两处：

1. **规则**：[`src/shared/catalog.ts`](../src/shared/catalog.ts) 里 `UNIT_RULES` 或 `BUILDING_RULES` 的一行。这一行写属性、训练它的建筑（`trainedAt`）、所属种族，以及写成数据的特殊规则（`armor`、`casterSlayer`、`regenPerSecond`）。单位与建筑的种类、每座建筑的训练列表、每个种族的兵种表，都从这些行推导出来。
2. **卡片**：[`src/client/content/`](../src/client/content/) 里的一项。卡片写中英文名称和说明、指令图标和快捷键、图形标识、美术档次，以及绘制它的函数。名称、提示框、指令面板和图鉴页都从卡片读取。

漏写卡片时 TypeScript 会报错。`src/client/content/cards.test.ts` 会检查名称和说明是否中英文齐全、每个单位的训练建筑是否属于它的种族、同一建筑或同一建造菜单里有没有重复的快捷键。想看游戏自己的绘制代码画出的全部单位和建筑，运行 `npx vite` 后打开 `/unit-sheet.html`。

## 后续方向

- 更多种族，以及有差异的科技树与单位能力。
- 更强的 AI，包括用大语言模型进行侦察分析与策略选择的实验。
- 更好的断线重连、观战体验与联机性能。
- 单位动画、更丰富的战斗反馈和更清楚的新手引导。
- 地图、战役与 Mod 制作工具。
- 更方便外部智能体使用的 SDK 和 CLI 分发方式。

## 致谢

Sketch RTS 会在 [linux.do](https://linux.do/) 与社区交流并收集反馈。

游戏深受 **Warcraft III** 启发：农民与基地、野怪营地、种族差异，以及从小规模军队逐步发展为大战场的节奏。
