# Sketch RTS

[English README](../README.md)

Sketch RTS 是一个运行在浏览器里的 RTS 游戏，带有 AI-native SDK、CLI 工作流，以及可组合的脚本系统。

项目仍在 WIP。当前重点是稳定的浏览器游玩、确定性的 command-frame 联机、SDK 控制的 AI 实验，以及高吞吐 benchmark。

## 特色

- 浏览器 RTS：农民、采金、建筑、升级、近战/远程/施法单位、物品、野怪营地、雇佣兵营地、集结点、聊天和房间设置。
- AI-native 脚本：AI policy script 只发普通玩家命令，不直接改 simulation。
- SDK 控制面：创建房间、重置场景、读取 snapshot、注入命令、快进 tick、等待 effect、保存/回放 debug trace、运行探针。
- 灵活部署：静态浏览器模式用于本地游玩；hosted server 模式用于房间、观战、WebSocket lockstep、存档、SDK 控制和 benchmark dashboard。
- 联机走 command frame，支持可回放的房间流量和确定性的比赛推进。
- Hosted 房间有实时 room lifecycle stream，开局前的玩家槽位会跨设备更新。
- 房间 URL 使用稳定 hash route，例如 `#room=room-id`，玩家可以刷新或分享房间，而不需要服务器额外配置 SPA 路由。
- 高性能 AI benchmark：并行 worker、dashboard、rich score/control/probe/combat 多条 lane。

## 快速开始

```bash
npm ci
npm run dev
```

打开 `http://127.0.0.1:5173/`。

常用脚本：

```bash
npm run dev:static          # 静态浏览器 runtime
PORT=34573 npm run server   # hosted server runtime
npm run build               # 默认/server 生产构建
npm run build:static        # 静态生产构建
npm run benchmark:ai        # AI benchmark runner
npm run play:ai             # exact AI playtest CLI
```

## Command-Frame 工作流

Sketch RTS 用 command frame 串起浏览器操作、AI 控制、replay 和 benchmark probe。

```text
browser input
internal AI
SDK agent
replay frame
benchmark worker
        |
        v
ordinary GameCommand entries
        |
        v
shared command-frame runtime
        |
        v
simulation core
```

AI policy script、SDK agent 和 benchmark probe 都产出普通 `GameCommand`。这让 AI 决策可以被 replay、检查、快进，并在不同 benchmark lane 之间对比。

## 部署模式

### 静态浏览器

```bash
npm run build:static
```

静态模式不需要后端。浏览器自己拥有本地房间、本地 AI、command-frame adapter 和比赛流程。

### Hosted Server

```bash
npm run build
HOST=0.0.0.0 PORT=34573 npm run server
```

Hosted 模式提供共享房间控制面：

- `GET/POST /api/rooms*` 用于房间设置。
- `GET /api/rooms/:roomId/events` 用于开局前的房间生命周期更新。
- `/ws/rooms/:roomId` 用于实时 lockstep command frames。
- 存档和 debug replay endpoint。
- SDK 控制 endpoint。
- Benchmark dashboard 的存储和 API。

LAN 游玩、公网联机、SDK 控制比赛、benchmark dashboard 都应该走 hosted 模式。

Hosted room 页面在浏览器内使用 hash route，例如：

```text
https://example.com/sketch-rts/#room=room-id
```

这样部署到 `/sketch-rts/` 这类子路径时仍然很直接：服务器只需要在 mounted base path 下提供 app 和 API，浏览器自己保留足够的 room identity，刷新或重新进入时可以回到同一个房间。

## SDK

SDK 是给程序控制 RTS 用的，不是为了模拟人类点击。它可以创建房间、重置场景、检查 snapshot、发命令、快进 tick、等待 effect、保存 replay，并运行各种 probe。

```ts
import { SketchRtsSdk } from "./src/sdk/client";

const sdk = new SketchRtsSdk("http://127.0.0.1:5173");

const room = await sdk.createRoom({
  id: "sdk-demo",
  host: { id: "agent-host", name: "Agent Host" },
  mapId: "bareDuel",
  visibility: "private",
  humanCount: 1,
  aiCount: 1,
});

const { snapshot } = await sdk.resetRoom(room.id, "bareDuel", {
  aiPlayers: ["enemy"],
  races: { player: "grove", enemy: "ember" },
});

const worker = snapshot.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
const mine = snapshot.resources.find((resource) => resource.id === "gold-player-main");
if (!worker || !mine) throw new Error("demo setup missing worker or mine");

await sdk.roomCommand(room.id, "player", {
  type: "mine",
  unitIds: [worker.id],
  resourceId: mine.id,
});

const result = await sdk.tickRoomUntil(room.id, {
  until: (next) => next.players.player.gold > snapshot.players.player.gold,
  maxTicks: 1400,
  chunkTicks: 140,
});

console.log(result.snapshot.players.player.gold);
```

## AI 脚本

AI script 是可复用 policy。它读取 snapshot，输出 command-frame entries，可以给内置电脑、SDK 控制的人类槽位、benchmark、replay/debug 流程共用。

```ts
import { planAiCommandFrameFromSnapshot } from "./src/ai/runtime";
import { SketchRtsSdk } from "./src/sdk/client";

const sdk = new SketchRtsSdk("http://127.0.0.1:5173");
const snapshot = await sdk.roomSnapshot("room-id");

const planned = planAiCommandFrameFromSnapshot(
  snapshot,
  [{ playerId: "player", source: "external-agent", version: "v2" }],
  { teams: { player: "north", enemy: "south" } },
);

await sdk.roomCommands(
  "room-id",
  planned.commands.map(({ playerId, command }) => ({ playerId, command })),
);
```

这里的优雅点是：AI 没有特权 mutation channel。AI 也必须像玩家一样发命令来玩游戏。

## CLI 工作流

当前 CLI 表面通过项目 scripts 暴露：

```bash
npm run play:ai -- new --file /tmp/match.json --map bareDuel --you v2 --enemy v1
npm run play:ai -- step-until --file /tmp/match.json --condition tick --tick 1200
npm run play:ai -- plan --file /tmp/match.json --owner v2
npm run play:ai -- commands

npm run benchmark:ai
npm run benchmark:ai-control
npm run test:sdk-smoke
npm run test:sdk-agent-player
```

这个流程适合 exact reproduction：创建 save-backed session，打印当前 snapshot，检查 planner 输出，step 到指定 tick，然后再改代码。

`npm run play:ai -- commands` 会输出机器可读的 command manifest。这个 manifest 和 help 文本、tactical command parser 共用同一张命令表，所以后续工具可以直接发现可用动作，而不用抓 help 文本或复制 CLI 知识。

## Benchmark 系统

Benchmark 是 AI 开发的一等循环：

- deterministic benchmark manifest；
- serial 和 parallel runner；
- command stats 和 policy telemetry；
- rich score、control、probe、combat 多条 lane；
- dashboard JSON/log 存储；
- 浏览器 dashboard：`benchmark.html`。

Benchmark 路径必须贴近真实 SDK/runtime 路径。它测的是实际会玩游戏的 AI，不应该是 benchmark-only 私有实现。

## Roadmap

- 更多种族：独立 tech tree、单位辨识度和战略压力。
- 更强、更变化的 AI，包括 LLM integration：嘲讽、侦察理解、战略针对、对手建模。
- 更强的联机性能、断线重连、观战体验和公网房间运营。
- Mod、地图、战役系统，以及配套 authoring tools。
- 更完整的 SDK/CLI packaging，方便外部 agent 和实验系统接入。
- 更强的浏览器 UX：控制、快捷键、新手引导、replay 和 accessibility。

## Credit

Sketch RTS 会在 [linux.do](https://linux.do/) 上宣传和收集反馈，感谢社区的关注与讨论。

游戏深受 Warcraft III 启发。感谢 War3：工人、基地、creeping、种族感、单位可读性和 RTS 节奏都从中借鉴了许多。
