# Sidecar Playtest Handoff

临时交接对象：接手 UI 细节、旁路试玩、局域网可访问性验证的 agent。

## 当前状态

- 项目名：`sketch-rts`
- 集成工作目录：`/Users/lexicalmathical/Documents/draft`
- GitHub repo：`https://github.com/shuxueshuxue/sketch-rts`
- 主程序：纯 TypeScript，Express + Vite，前后端一体。
- 旁路试玩服务器是有意保留的进程，不是需要随手清掉的测试残留。
- 当前推荐旁路端口：`34573`
- 当前推荐本地 URL：`http://127.0.0.1:34573/`
- 当前推荐局域网 URL 形式：`http://<LAN-IP>:34573/`

## Worktree 协作设计

`main` 只做集成真相，不作为任何 agent 的长期工作区。每条工作线使用自己的 branch + worktree，避免 UI polish 和 AI/SDK 系统改造互相踩文件、端口、后台进程。

推荐布局：

```bash
# 在集成目录执行
git fetch origin
git worktree add ../sketch-rts-ai -b codex/ai-v2-gauntlet origin/main
git worktree add ../sketch-rts-ui -b codex/ui-sidecar origin/main
cd ../sketch-rts-ai && npm ci
cd ../sketch-rts-ui && npm ci
```

推荐职责：

- `../sketch-rts-ai` / `codex/ai-v2-gauntlet`：AI v2 gauntlet、sim、SDK、save/replay、系统测试、spec ledger。
- `../sketch-rts-ui` / `codex/ui-sidecar`：主菜单、房间 UI、命令面板、Pointer Lock、视觉反馈、小地图、旁路试玩体验。
- `/Users/lexicalmathical/Documents/draft` / `main`：只做同步、审查、最终集成、必要文档真相更新。

推荐端口：

- AI/system dev：`PORT=5173 npm run dev`
- UI/sidecar dev：`PORT=5174 npm run dev`
- 用户 LAN 旁路生产试玩：`NODE_ENV=production HOST=0.0.0.0 PORT=34573 npm run server`

规则：

- 不要让两个 agent 在同一个 worktree 里写代码。
- 任何正在运行的服务器都要能回答四件事：来自哪个 worktree、哪个 branch、哪个 port、dev 还是 production。
- UI agent 不要直接改 AI policy/sim/SDK 语义；AI agent 不要顺手重排 UI。需要跨界时先合并或协调。
- 每条 lane 合入前先从 `origin/main` 更新，并用本 lane 的验收命令证明没有把自己的表面跑绿建立在旧集成状态上。
- 不要靠从另一个 worktree 手动复制文件来“合并”；用 commit、PR、merge/rebase 保持历史可审。

## 旁路部署命令

先构建，再用 LAN host 启动生产静态服务：

```bash
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=34573 npm run server
```

如果要让自动 tick 暂停，便于用 REST/SDK 手动推进：

```bash
NODE_ENV=production HOST=0.0.0.0 PORT=34573 SESSION_AUTOTICK=0 ROOM_AUTOTICK=0 npm run server
```

端口选择规则：

- 默认使用 `34573`。
- 不要用接近 `65535` 的高端口，因为开发模式下 Vite HMR 会使用 `PORT + 20000`。
- 如果端口被占用，选择另一个中低位端口，并同时报告 local 和 LAN URL。

## 浏览器验证

最低验收：

- 本机打开 `http://127.0.0.1:34573/` 能进入主菜单。
- 同一 Wi-Fi/LAN 设备打开 `http://<LAN-IP>:34573/` 能进入主菜单。
- 主菜单背景有动态绘制。
- 创建房间、选择地图、开始游戏、进入结算界面这条路径可走通。
- 如果用 LAN HTTP 访问，浏览器不一定支持 `crypto.randomUUID()`；身份生成必须使用 `crypto.getRandomValues()` 兼容路径，不能再回到只调用 `randomUUID()`。

推荐跑：

```bash
npm run test:e2e-room-flow
npm run build
```

## 进程清理规则

旁路服务器正在给用户试玩时，不要自动杀掉它。清理时先区分：

```bash
ps -axo pid,ppid,pcpu,pmem,command | rg 'src/server/index|tsx scripts|vitest|playwright'
```

可以清理的通常是：

- 结束后的 `vitest`
- 结束后的 `tsx scripts/...`
- 临时 E2E server

不要清理的通常是：

- 用户正在玩的 `NODE_ENV=production HOST=0.0.0.0 PORT=34573 npm run server`

如果用户明确说“关掉旁路/关掉服务器”，再杀对应 PID。

清理或汇报进程时，把 worktree 和 port 一起说清楚。只看到 `src/server/index.ts` 不足以判断它是不是该杀；先用命令行参数、cwd、端口和当前用户请求判断。

## UI 接手边界

另一个 agent 可以优先处理：

- 主菜单层级、房间列表、建房/加入房间 UI。
- 小型 LoL/War3 风格底部命令面板。
- 选中建筑/单位后的按钮显示、快捷键角标、按钮反馈。
- Pointer Lock 虚拟鼠标层级、右键手势冲突、边缘滚屏体验。
- 小地图拖拽视角框和大地图/小地图标记一致性。
- 攻击、移动、建造、训练、施法等操作反馈的视觉 polish。

不要在 UI 线里改坏这些架构约束：

- AI 脚本是策略模块，不是玩家身份。
- 内部电脑玩家和 SDK 控制的人类槽位必须 import 同一套 AI policy。
- 不要为了 UI 简化绕过玩家命令路径。
- 不要删除 debug replay/savegame/SDK dogfood 入口。

## 当前重要红灯

旁路 UI 可以并行推进，但核心 AI 验收还没有过：

- `15v15`、`20v10`、`10v20` 稳定性门槛已经跑通过。
- `v2 1v2 打两个健康 v1，10 张地图，内部/外部/交错 adapter，90% 胜率` 还失败。
- 目前失败事实是 v2 在扩张/野怪/佣兵图上经济和兵力被两个 v1 滚起，不是可以靠一句“调参”糊过去的问题。

接手 UI 的 agent 不需要解决这个红灯，但不要把当前项目描述成“全 spec 已通过”。
