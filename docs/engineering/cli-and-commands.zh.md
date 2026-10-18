# sketch CLI 与命令层统一（设计稿）

状态：设计，待父会话确认后分批实现。来源：2026-10-17/18 夜里各车道（AI、Room、Art、UX Fix、Tower）反复手写的工具，以及当晚修过的命令层 bug。

## 1. 痛点清单

### 1.1 每条车道都在重写的工具

| 重复劳动 | 今晚的例子 |
|---|---|
| 分支对 main 的全量测试差异 | 父会话、Tower、Room 都是手搭：git archive（排除 2.5 GB 的 docs）→ scp → 软链 node_modules → 两棵树各跑一遍 → sed/comm 比失败列表。 |
| 测试差异被环境噪声污染 | think-worker、SDK workers、dashboard、large-battle-think、sim 对局的 CPU 上限，在 A100 负载 40–60、mac1 负载 80 时随机失败，每次都要人工单独重跑一遍；`wrapper-boundary`、`package-boundaries` 在不带 docs/ 的副本上必挂。 |
| 房间 AI 评测 + 直接指标 | AI Lane 每个问题都临时加指标脚本：econ.ts、losses.ts、camps.ts、income.ts、forkfight.ts、exchange-all.sh、stage-probe.sh；Tower 自己写了 naval-eval.ts。 |
| fork 重放 / sim 探针 | trace.ts（每次思考的总指挥 mode 和每条命令的来源 script）、FIX_FROM 环境变量开关、DEBUG_* 环境变量加 `tick % 600 < 15` 的门、Tower 的 zz-*.test.ts 靠 observer.hit 统计伤害、Room 往 connected-decks 里塞的 console.log、UX 用 perl 注入、事后要还原的计数器。 |
| 浏览器 YATU / 截图 | Art 有约 8 个只差场景的截图脚本（每个复制同样 30 行：起服务器、等 /api/catalog、走菜单建房间、reset scenario、点小地图对镜头、框选）；UX 的 start2.js、sync.sh；Room 的 c-shots/proto-shots/scene-shots；Tower 的 tower.mjs、pirate.mjs；每份 mac1/A100 副本自建 node_modules 软链。#435 改了一次菜单，Art 要改 8 处。 |
| 证据文件 | 截图和 webp 直接进仓库，git 涨到 4 GB；A100 上 git archive 735 MB 卡住 scp。 |

### 1.2 工具坑过人的具体例子

- **连到旧服务器**：Art 的 5602 端口上留着旧服务器，脚本静默复用，连续三轮拿旧代码对比旧代码；Tower、Room 各碰到一次；UX 的 Playwright 在没有匹配 BASE 的标签页时复用第一个标签页，两次运行都落在分支服务器上。
- **出错退出没清理**："before" 服务器在异常退出时没被杀掉。
- **pgrep/pkill 匹配到自己**：`pkill -f "logs/nc-fix"`、`pgrep -f "aiperf/tower/..."` 匹配到 ssh 里的 bash，把自己的 shell 杀掉（AI、Tower、Art 都中过，Art 是两个等待的 shell 互相匹配死锁）。
- **写错盘**：AI Lane 把结果写到 A100 的 /tmp（A100 只许写 /codegeex/jeffry/）。
- **调试视图不更新**：`__sketchRtsView` 的 tick 是第一次读取时的快照，等"客户端追上服务器"永远等不到；页面只在加载时读状态，tick 后要 reload 再对回镜头。
- **镜头和选择**：不能把镜头直接移到世界坐标，只能做小地图点击换算，而且落点不准；没有按 id 选择单位的 API，只能框选屏幕中心。
- **座位数错时静默回首页**：lategame.cjs 的座位数和地图不一致时，120 秒后才以超时报错。
- **A100 headless Chromium 没有中文字体**，中文全成方块，只能换 mac1。
- **sync.sh 覆盖回滚**：忘了先 rebase，覆盖时把别人已合并的文件改回旧版（UX 中了三次）。
- **平台差异**：macOS zsh 的 glob 报错和 BSD sed 打断命令链；`gh pr edit` 缺 read:org 权限，只能 `gh api PATCH`。
- **实验场景假设错了没人提醒**：AI Lane 的清营对决场景里对手没军队，总指挥第 4 秒就转去进攻空基地，测出的数据全是错的。

### 1.3 命令层让人卡住的地方

（见第 3 节，附代码位置。）

- 命令被拒、被覆盖、在等待，从外面看不见：Tower 的上船冻结靠打日志才查出是"等待的船员把下一个过桥的人围死了"；Art 的 boardShip 在跳板被毁后订单变成 idle，没有任何原因，查了两轮。
- 登船时"临时把订单换成 frontRank attack 再换回 board"，订单显示 board，实际走 attack 的寻路，而 attack 不过跳板。
- AI 的命令来源只有 trace.ts 这类临时脚本才看得到；script-runner 落地后不留来源。
- 两套入口两种拒绝格式：`issuePlayerCommand` 对非法命令 throw，`checkCommandLegality` 返回 `{ message, reason }`；scenario/reset 没有任何反馈，写进 scenario 的 hold/move 订单在结果里不出现。
- scenario 的资源只能是起始量（不能直接设成中间状态），Art 为了看金矿中期的样子要真的派工人去挖。
- 驻兵指令卡没接上"建筑在做的事"（训练、研究），进度条、取消、退钱要另写。

## 2. CLI 设计

### 2.1 形状

一个入口：`npm run sketch -- <子命令>`，另装一个 `bin/sketch`（`package.json` 的 `bin`），二者等价。实现放在 `tools/cli/`（TypeScript，tsx 运行），每个子命令一个模块，共用：

- **参数解析**：一套 `--flag value` / `--flag=value` / 位置参数的解析器，替代 `scripts/benchmark-cli.ts` 里的 `flag/csvFlag/requiredFlag`；每个子命令声明参数表，`sketch <cmd> --help` 自动生成。
- **输出**：默认人读的表格；`--json` 输出一个对象（最后一行），便于 agent 解析。所有子命令的退出码：0 成功，1 判定失败（例如有新增失败），2 用法或环境错误。
- **机器（--on）**：`--on local|a100|mac1`。远端执行统一由一个 runner 负责：
  - 副本：从指定 git 引用（`--ref`，默认当前分支 HEAD；`--with-local` 带上未提交改动）做一份干净副本，**包含 docs/**（文档测试需要它）但排除大资源目录，放在机器允许写的根目录（A100 只能 `/codegeex/jeffry/sketch-cli/`，mac1 是 `~/work/sketch-cli/`）；以 sha 命名，重复使用。
  - node_modules：每台机器一份按 package-lock 哈希的共享目录，副本里软链；vite 的缓存目录指到副本自己（Room 遇到过共享 .vite 互相竞争）。
  - 环境：自动 source 机器的 env（A100 的 HOME/TMPDIR/缓存重定向、PLAYWRIGHT_BROWSERS_PATH），子命令不再手写。
  - 进程：所有子进程放进一个以 run id 命名的进程组（Linux 上用 `systemd-run --user --scope`，否则 setsid），结束或异常时整组杀掉；**不提供按名字 pkill**，从根上消除"匹配到自己"。
  - 写盘：runner 只在机器的允许根目录下写，其他路径直接报错。

### 2.2 子命令

#### `sketch test diff [--base origin/main] [--ref HEAD] [--on a100] [files…]`
在两份干净副本里各跑一遍同一组 vitest（默认全量 `--dir src`），只报"新增失败"（分支失败、基线通过）和"新增通过"。
- 计时类测试（自动识别：断言消息含 `to be less than` 且和时间有关、`Test timed out`、`took longer than`，再加一个显式清单）在两边各单独重跑一次，仍然只在分支失败才算新增失败；表里标注"计时"。
- 两边都失败的单独列成"基线已坏"，不算这次的账。
- `--json` 给出三个列表和每个用例的耗时。
- 对应 Room 的二分需求：`sketch test bisect <good> <bad> <file>`（第二批再做）。

#### `sketch bench room [--subjects …] [--rivals v8,v9] [--seeds …] [--maps 20] [--metrics …] [--base origin/main]`
包住 `scripts/ai-room-gauntlet-benchmark.ts`，同时跑 base 和 ref，输出胜场对比表和逐局翻转。
- **直接指标插件**：每个指标是一个模块，实现 `onTick(game, ctx)` 和 `summary()`，在评测的同一局里顺带采集，不再另跑一遍。第一批指标就是今晚手写过的：`clear`（第一个营地被清的时刻）、`bases@N`（第 N 分钟的基地数）、`trade@N`（前 N 分钟双方损失金额之比）、`income@N`、`workers@N`、`hire`（首次雇到雇佣兵）。语法：`--metrics clear,bases@4,trade@15`。
- 规模默认 40 局一格（owner 的要求），超过要显式写 `--maps`。

#### `sketch replay <subject> <rival> <seed> <match> [--to TICK] [--every N] [--show army,orders,general,econ,losses] [--fork TICK --patch FILE]`
通用的重放和分叉探针，替代 trace.ts、econ.ts、losses.ts、forkfight.ts 和各车道的 probe。
- `--show` 是一组可组合的视图：`army`（双方单位、位置、hp、订单）、`orders`（每条命令的来源 script 和类型，见第 3.4 节的命令日志）、`general`（总指挥 mode、目标、leash）、`econ`、`losses`。
- `--fork TICK --patch FILE`：从 TICK 起应用补丁。补丁是一个导出覆盖函数的 TS 模块（例如替换某个 script），由 runner 在 TICK 时切换 planner，不再靠改源码加 `FIX_FROM` 环境变量。
- `--from-save FILE`：从存档开始（存档已存在：`/api/savegames`）。

#### `sketch yatu <script> [--ref A] [--ref B] [--on mac1]` 和 `sketch shot <scene> --before <ref> --after <ref> [--at 5,30,55,80] [--sizes desktop,phone]`
统一的浏览器跑法。四条车道里有三条把它列为"只能要一个"的首选。
- **服务器生命周期**：每个 ref 起一个自己的服务器，端口由 runner 分配（先 bind 确认空闲；被占直接退出码 2，绝不复用），记录 pid，结束时整组杀掉；页面加载后先校验 `/api/catalog` 返回的 build sha 等于该 ref，不等就报错（彻底杜绝"连到旧服务器"）。
- **场景 API（给脚本用的 helper）**：`room(map, seats)`（走真实菜单建房间，菜单流程只维护一份，即仓库里的 `scripts/room-ui-flow.mjs`；座位数和地图不符时立即报错）、`scenario(spec)`、`tick(n)`（等到客户端真的追上，不读 `__sketchRtsView` 的快照）、`camera(x, y, zoom)`、`select(ids)`、`command(cmd)`、`shot(name)`、`readDom(selector)`。`camera` 和 `select` 需要客户端新增调试入口（第 3.5 节）。
- **对比图**：`shot --before A --after B` 同种子、同镜头各截一张，拼成一张 webp，加上每张图读回的 DOM JSON；默认输出到证据库（下一条），不进仓库。
- **环境检查**：启动时检查中文字体（A100 的 headless Chromium 没有），缺了直接报错并提示换 mac1。

#### `sketch evidence push <dir|file> [--pr N]` / `sketch evidence get <pointer>`
把大文件推到 A100 证据库（`/codegeex/jeffry/sketch-evidence/<sha256>`），在仓库里只留一个小的指针文件（路径、哈希、大小、来源 PR）。`get` 按指针取回。PR 正文里引用指针，不再把 png、webp、json 提交进 git。仓库加一个 pre-commit 或 CI 检查：单个文件大于 1 MB 且不在白名单里就拒绝。

#### `sketch scripts audit`
列出 `scripts/` 里每个文件是否被 package.json、CI、src 或测试引用，以及最后修改日期。第 5 节的清单就是用它的雏形算出来的。

### 2.3 不做的事

- 不做通用的任务编排（make 或 nx）；子命令就是几个固定的工作流。
- 不替换 vitest、vite；只是包一层。
- 评测规模不放大：`bench` 默认 40 局一格，CLI 不提供"全量 gauntlet"的快捷方式。

## 3. 命令层的统一方案

### 3.1 现状（代码位置均为 main 2707f388）

- **入口一律 throw，没有返回值的路径**：`issueCommand`（`src/shared/sim.ts:447`）只是转调 `issuePlayerCommand`（451–878）。后者只在部分分支调用 `checkCommandLegality`（舱位、登船、老兵技能、加固或驻兵），其余分支各自内联检查后 `throw new Error`（follow 571、mine 582、repair 597–598、build 615–620、research 715、train 2235–2241）。帧路径 `issueFrameCommand`（`src/shared/sim/frame.ts:37–47`）遇到"暂时性"拒绝静默跳过，其余也 throw。
- **至少六种拒绝格式**：sim 里的自由文本 Error；`CommandLegalityError { message, transient, reason?, … }`，其中 `reason` 只有 gold、supply、tier、stock、cooldown、position 六种，而且只有 `refusal()` 会填；`commandValidationError` 返回字符串；四种带前缀的包装（Local command rejected、SDK command frame rejected、AI think rejected）；一组 `*Refusal` 字符串函数；船的枚举拒绝再映射成文本。同一件事两处措辞不同：金币不足是 "Need N gold" 对 "Not enough gold"，最小射程也有两种写法。
- **"走过去再做"有九种各自的实现**（`sim.ts:1468–1520` 的分发）：cast、pickupItem、itemErrand（use、give、drop）、garrison、board、boardShip、build、repair、repairUnit、mine。"够得到"的判定有五种写法：
  - 中心距离，加上目标半径（cast 写了两遍，2577 和 2675）；
  - 72 这个常量在三个文件里各定义一次（sim.ts:165、equipment.ts:11、item-rules.ts:13）；
  - 占地间隙 `buildingWorkGap`，但 build 在 2111 又内联了一份；
  - 船体距离 `alongside`；
  - 矿口 `atMineEntrance`。

  "走不到"的处理也不一致：cast、itemErrand、garrison 用 `walkEnded`；build 用"20 秒移动不到 24"的看门狗；pickupItem、repair、repairUnit、mine 没有处理，会对着走不到的目标一直走。
- **右键上下文命令** `targetCommand`（`src/client/relations.ts:94–130`）不检查选中的单位能不能打到、走到目标：对敌人一律给所有选中单位下 `attack`，返回空就退化成 `move avoidCombat`。打不到的情况由 sim 在 `updateAttackOrder`（1747–1755）里静默换目标或结束，玩家什么也看不到。
- **建筑上需要时间的事是四套机制**：施工（`buildProgress`）、训练（`queue: TrainingJob[]`，可取消、可退钱）、研究（`researchQueue`，**不能取消**）、塔的加固（`fortify?: {remaining}`，挂在 `updateResearch` 里面推进）。
- **AI 命令来源在落地时丢失**：script-runner 给每条命令带上 `scriptId`；被 `withoutUnitsClaimedElsewhere` 和 `removeOrderedUnitConflicts` 丢掉的命令不留任何记录。实时路径把 entry 压缩成 `{playerId, command}`（`src/ai/runtime.ts:131`、`think-worker/host.ts:34`），只剩一个 `staleAiCommands` 计数，而且没人读它。`__sketchRtsView` 只有敌方订单类型的计数，没有逐单位的订单或来源。

### 3.2 一个入口，一种结果

- `tryPlayerCommand(game, owner, command): CommandResult`，其中 `CommandResult = { ok: true } | { ok: false; reason: CommandRefusalReason; message: string; transient: boolean; cooldownTicks?; supplyCap? }`。它判一次合法性，通过了才执行。帧路径在调用它之前先去掉网络延迟期间死掉的操作对象（narrow），这一步只属于帧路径，直接调用的人点名的东西必须存在。
- **合法性只判一次**：`checkCommandLegality` 成为唯一的判定处。issuePlayerCommand 在最开头对所有命令类型调用它，各分支里的内联 throw 全部挪进 validation。客户端按钮状态、服务器拒绝、帧路径读的是同一个对象（今晚 Tower 和 UX 都要分别对照两条路径）。
- **`CommandRefusalReason` 扩成完整的枚举**：在 gold、supply、tier、stock、cooldown、position 之外，加上 gone（发出者、建筑或目标已经不在了）、target（目标不合法）、range（射程或最小射程）、unreachable、occupied、state（单位当前状态不允许）、rules（规则表禁止）。每个拒绝都必须带 reason。sim 里重复的内联检查已经删掉，所以每种拒绝只有一种措辞；message 暂时仍然逐条手写，还不是由 reason 加参数生成的。
- `issuePlayerCommand` 保持"被拒绝就 throw"（抛出 `CommandRefusedError`，带着同一个结果对象），它只是 `tryPlayerCommand` 外面的一层包装。最初的设计是反过来的：让 `issuePlayerCommand` 返回结果，另加一个 `issueCommandOrThrow`。没有这样做，是因为测试里有 1000 多处调用，其他车道在途的 PR 里还有新的调用；这些调用都不读返回值，如果改成返回结果，被拒绝的命令就会被静默吞掉。保留原来的语义，失败才会响。
- **scenario/reset 也返回 `CommandResult[]`**：写进 scenario 的订单逐条报告是否生效（UX：hold/move 订单在结果里看不见）；scenario 的资源允许直接给出 `amount`（Art 想要金矿中期状态）。

### 3.3 errand：一个"走过去再做"的抽象

不改订单的外部形状，先统一实现。新模块 `src/shared/approach.ts`：

```ts
type Reach = { kind: 'center'; range: number } | { kind: 'footprint'; gap: number } | { kind: 'hull' } | { kind: 'mineEntrance' } | { kind: 'weapon' };
approach(game, unit, target, reach): 'arrived' | 'walking' | { ended: OrderEndReason };
type OrderEndReason = 'target-gone' | 'unreachable' | 'blocked' | 'stuck' | 'no-room' | 'refused';
```

- **够得到**：只有一个 `reachGap(unit, target, reach)`，五种判定都在这里。72 收成一个常量，建筑间隙只留 `buildingWorkGap` 一份。
- **走不到**：只有一个判定，用 `walkEnded` 加上 build 现有的"进展看门狗"（N 秒内没有靠近就算 stuck）。所有 errand 都用它，补上 pickupItem、repair、repairUnit、mine 缺的那部分。
- **到了以后**：每个订单只保留自己的"执行"部分，比如 cast 再检查一次冷却、build 再检查一次放置。
- **结束带原因**：订单结束时发一个 `orderEnded { unitId, order, reason }` 效果，取代现在只有登船才有的 `boardingBlocked`。overlay、replay 探针和 YATU 都读它。Art 的"跳板被毁后 boardShip 静默变 idle"、Tower 的上船冻结，都会直接显示原因。
- **登船去掉"借壳"**：board 订单显式记录阶段 `queued | approaching | waiting(blockedBy) | ferrying`，不再临时换成 frontRank attack 再换回来（Tower：订单显示 board，实际走的是 attack 的寻路）。Room 要求的 queued / blocked-by / no-route 可以从这里读到。

### 3.4 右键上下文命令

`targetCommand` 改成返回 `{ command?, refusal? }`，用 3.3 的同一个 `reachGap` 加上 `strikeReach`，逐个判断选中的单位能不能执行：
- 能打到、走到目标的那部分单位拿到命令，其余的退化成 `move`（今晚"工人打不到大单位"就出在这里）；
- 一个都不能时，返回 refusal 并在 HUD 显示原因，不再静默变成 move。

### 3.5 建筑工作队列（和 Tower Lane 对齐，采用他们的形状）

- `Building.work: BuildingJob[]`，取代 `queue`、`researchQueue`、`fortify`。`BuildingJob = { id; kind: 'train' | 'research' | 'upgrade'; remaining; total; paidGold } & ({ unitKind } | { upgradeKind } | { to: BuildingKind })`。
- **一套推进**：同一个函数推进 work。train 有"出生点不空就等"的条件，作为 job 的一个钩子。
- **一套取消**：`cancelBuildingJob { buildingId, jobId }` 退还 `paidGold`；研究因此第一次可以取消。按钮上的进度条也读 `remaining / total`，同一套。
- **加固就是 upgrade job**：命令 `upgradeBuilding { buildingId, to }`，完成时换成 catalog 里的新 kind，然后走一个通用的"换形态后按新占地重新放置"（堵住就拒绝并退钱），这正是 Tower 提的方案。
- **施工暂不并进来**：它的进度取决于工人数，形状不同；等 errand（3.3）落地后再看。
- **存档兼容**：读档时把旧的 `queue`、`researchQueue`、`fortify` 映射进 `work`。用现有的存档测试和 canonical checksum 测试证明行为不变。

### 3.6 命令来源和被拒、被覆盖的可见性

- **不进 sim 状态**（不影响确定性和 checksum）。AI runtime 每次思考写一份命令台账，按单位记 `{ tick, scriptId, command, outcome }`，outcome 是 `applied`、`claimedBy(scriptId)`、`overriddenBy(scriptId)`、`rejected(reason)`、`stale` 之一。runner 现在丢命令的两处（`withoutUnitsClaimedElsewhere`、`removeOrderedUnitConflicts`）各写一条。台账在 runtime 里只保留最近 N 次思考。
- **读出来**：
  - `sketch replay --show orders`：逐单位打印"谁下的、结果如何"；
  - 客户端调试 overlay：开关后在单位头上显示 `script / order / 最近一次结局`；
  - `__sketchRtsView` 的 tick 等字段改成实时 getter（Tower：现在是第一次读取时的快照），并新增 `camera(x, y, zoom)`、`select(ids)`、`command(cmd)` 三个仅开发版可用的入口，给 YATU 和截图用（UX、Art 都要）。

## 4. 分批实施顺序

每一批都是独立的 PR（或一小串），都有明确的"行为不变"或"行为如预期改变"的证据。工具在前，因为后面每一批都要用它们来验证。

| 批 | 范围 | 验证 |
|---|---|---|
| 1 | CLI 骨架（参数、表格/--json、退出码、--on 远端 runner：副本、node_modules、env、进程组、写盘根目录）；`test diff`；`scripts audit`；按第 5 节删除脚本 | 用 `test diff` 复现一次已知结果：#454 合并前后，基线已坏和新增失败的列表要和当晚手工比出来的一致；同一台机器负载 40 时，计时测试不出现在"新增失败"里 |
| 2 | `yatu` / `shot`（服务器生命周期、端口、build sha 校验、场景 helper、中文字体检查）；客户端调试入口（实时 tick、camera、select、command） | 把 Art 的 8 个截图脚本改写成 8 个场景文件；对一个已合并的视觉 PR 重新出一张 before/after，和当时的证据一致；故意占住端口，确认它直接报错 |
| 3 | `bench room --metrics`（clear、bases@N、trade@N、income@N、workers@N、hire）；`replay` 和 `--fork --patch` | 复现今晚的数：#454 的 156 对 144、交换比 1.692/1.388/1.101，ladder-63 分叉的 4335:345 对 360:230，逐局一致 |
| 4 | 命令结果统一（3.2）；`evidence push/get` 和大文件检查 | 240 局评测逐局一致；canonical checksum 不变；全量测试通过（只有改了拒绝文案的断言要更新） |
| 5 | errand 抽象和 `orderEnded` 原因（3.3），登船的显式阶段；右键改造（3.4） | 每种 errand 加一个"走不到会结束并给出原因"的回归测试；240 局评测只允许出现预期内的差异（pickupItem、repair、mine 原来会对着走不到的目标一直走），差异逐局列出来解释 |
| 6 | 建筑工作队列（3.5），和 Tower Lane 的加固重做一起做 | 存档测试和 checksum 测试；训练、研究的取消和退钱测试；240 局评测逐局一致 |
| 7 | 命令台账和 overlay（3.6） | 用 `replay --show orders` 重放 ladder-63 和 ladder-11：能直接看到当晚靠 trace.ts 才查出来的 creep/defend 来回切换和 skirmish 撤退，信息要和当时一致 |

第 1–3 批纯属工具，不碰游戏行为，可以和其他车道并行。第 4–7 批碰 sim，一次只做一批，每批都要先过 240 局逐局一致（或者把差异逐局解释清楚）。

## 5. scripts/ 清理清单

完整清单见同目录的 `scripts-inventory.zh.md`。摘要：
- `scripts/` 共 347 个文件，**在用 48 个**：被 package.json、CI、src 引用，或被在用脚本 import，或者是 vitest 会跑的 `*.test.ts`，或者本周还在用。
- **需要确认后删除 18 个**：package.json 里还挂着条目的一次性 AI 对比（ai-v3-vs-prod-v2、ai-v4-tr-vs-v3、ai-v5-vs-hybrid、ai-v5-economy-stress、ai-control、ai-cross-race、v6/v7/v8 gauntlet、ai-version-benchmark、ai-matrix、sdk-ai-matrix 及其测试），连同 package.json 里对应的条目一起删。
- **建议直接删除 281 个**：没有任何引用。其中 art-card 系列 116 个，是 10 月 12–14 日 GPU 卡片排查留下的 fixture、profiler、proof 和它们的 v2/v4 版本；其余 art-viewport、art-spirit、render-* 等也都是一次性证明脚本。git 历史里随时可以找回。
- 删除后，package.json 的脚本条目从 45 个降到大约 30 个，常用的入口改成 `sketch` 的子命令。
