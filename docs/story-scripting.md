# 剧情脚本：用 TypeScript 写战役

这份文档讲 `src/story/`（剧情运行时）和 `src/campaigns/ashen-march/`（用它写成的战役《灰烬边境》）是怎么设计的、为什么这样设计。

目标只有一句话：**创作者写的就是普通 TypeScript。** 没有“事件-条件-动作”表格，没有触发器编辑器；一段剧情是一个函数，它的局部变量就是剧情状态，它停在哪一行，剧情就走到哪里。

```ts
export const prologue: Chapter<Vars> = {
  id: "prologue",
  title: { zh: "序章 · 雾中巡逻", en: "Prologue · Patrol in the Mist" },
  *play(story) {
    const lynn = yield* bringHero(story, "lynn", PLACES.fenwatch);
    yield* stage.title("序章 · 雾中巡逻", "Prologue · Patrol in the Mist");
    yield* say(story, du, "雾这么大，狼都懒得出门。");
    yield* say(story, lynn, "狼不出门，人会。三块界碑，天黑前查完。");

    const outcome = yield* race({
      arrived: () => until(() => world.inside(lynn, mill)),
      ambushed: () => on("hit", { target: { owner: "wardens" } }),
    });
    switch (outcome.kind) {
      case "arrived": /* ... */ break;
      case "ambushed": /* outcome.value 的类型已经收窄成 hit 事件 */ break;
    }
  },
};
```

## 1. 协程是剧本的基本单位

剧本是 **generator 函数**，每个 `yield*` 是一个等待点：等一段时间、等一个事件、等某个条件成立、等一句台词念完、等玩家做出选择。

为什么是 generator 而不是 `async/await`：

- `async` 的恢复时机由宿主的微任务队列决定，不归游戏时钟管。剧本必须在**模拟的第 N 个 tick** 恢复，而且每次都一样。
- generator 把“什么时候恢复”完全交给调度器：脚本只描述它要等什么，调度器（Director）决定何时把值送回去。这正是代数效应（algebraic effects）的做法——脚本 *执行* 效应，处理器 *解释* 效应。同一段脚本换一个处理器就能在没有游戏的环境里做单元测试（见 `src/story/kernel.test.ts`）。
- generator 可以被 `return()` 从外部结束，并执行它的 `finally`——这是取消的基础，`async` 函数做不到。

### 内核只有三条指令（`src/story/kernel.ts`）

| 指令 | 含义 |
| --- | --- |
| `suspend(wait)` | 挂起，直到有人唤醒（定时器、事件、子任务结束……） |
| `spawn(body)` | 启动一个子任务，立即返回它的句柄 |
| `current()` | 取得当前任务（用于上下文和清理） |

`wait / until / on / race / all / scope / within / each / every` 全部由这三条搭出来。内核足够小，才好推理。

## 2. 结构化并发：剧情没有“孤儿触发器”

WC3 触发器最常见的 bug：一段剧情结束了，它开的计时器、注册的事件还在后台跑。这里任务是一棵树：

- **子任务活不过父任务。** 任务正常结束时，它留下的子任务被 halt；halt 一个任务先 halt 它的整棵子树。
- **halt = `generator.return()`**，所以 `finally` 一定执行。场景的清理就写在它的 `finally` 里（或 `ensure(...)`，相当于任务级的 Go `defer`），而不是指望谁记得去关。
- **错误沿树向上抛。** 子任务出错，错误被抛进父任务正在等待的那一行；没人 `catch` 就一路升到根，Director 抛出——剧本 bug 不会被吞掉。

战役里的实际用法：

```ts
// 一段过场：字幕黑边、镜头、它生出的一切，都随过场结束而收回。
export function* cutscene<T>(story, body: () => Operation<T>) {
  return yield* scope(function* scene() {
    yield* story.stage.cinematic();          // 注册了“结束时收起黑边”
    return yield* body();
  });
}

// 单位的技能活在单位的“生命”里：施法者死了，施法中的协程（包括地上的红圈预警）一起消失。
const powers = yield* empower(world, pyremancer, [fireRain({ radius: 105, damage: 42, windUp: 1.6, least: 2 })]);

// 缠绕：把目标速度设为 0，无论怎样结束（包括施法者半路阵亡），finally 都把速度还回去。
yield* scope(function* rooted() {
  const speed = target.speed;
  yield* ensure(() => { if (world.unit(target)?.speed === 0) target.speed = speed; });
  target.speed = 0;
  yield* wait(seconds(3.5));
});
```

这套规则在开发中抓到过真实 bug：波次任务启动 squad 大脑后立即返回，大脑作为它的子任务被 halt，整波敌人原地不动——修法是让波次任务等 `squad.defeated()`。在触发器系统里这种 bug 是“敌人偶尔发呆”，在这里是确定性地、每次都发生，一眼能查出来。

## 3. 时间是带单位的值（`src/story/time.ts`）

`Duration`（一段时长）和 `Instant`（时钟上的一个时刻）是两种 brand 类型，都是整数 tick（20 tick/秒，与模拟同拍）。`wait(seconds(3))`、`at(later(now, seconds(90)))` 读起来就是它的意思；把 tick 数当时长传、把两个时刻相加，都编译不过。

## 4. 事件是带类型的流（`src/story/events.ts`）

`StoryEvent` 是 discriminated union：`hit / died / departed / arrived / destroyed / founded / completed / pickedUp / chose / signal`。模式是“字段的形状”或谓词，按结构递归匹配：

```ts
const death = yield* on("died", { unit: { owner: "ember", variant: "ashen/colossus" } });
// death 的类型是 Extract<StoryEvent, { type: "died" }>，death.killer 可直接用
```

模拟本身不负责“广播事件”：Director 通过 sim 的观察者拿到每一次命中（谁打了谁、是否致死），再每 tick 比较一次世界（谁来了、谁走了、哪栋建筑完工、谁捡起了物品），把发生的事按顺序写下来。`on` 等下一个事件，`subscribe` 是带缓冲的订阅（处理上一个事件时不会漏掉下一个），`each` 在子任务里逐个处理。

**每个事件是一个回合：** Director 一次只投递一个事件，被它唤醒的脚本跑到下一次等待，再投递下一个。所以 `for (;;) yield* on("died")` 能看到同一 tick 里的每一个死亡，一个不漏。

## 5. 确定性与存档（`src/story/director.ts`）

每个 tick：①玩家命令 + 模拟前进一步（和对战同一个 command-frame runtime）；②剧情阶段：输入（选择）、舞台前进、到期的定时器、逐个投递事件、询问条件。

协程的续体（continuation）不是数据，不能序列化。所以存档不去写它，而是**让它可以被重建**：

- 剧本不许读时钟、随机源或任何世界之外的东西（`src/story/purity.test.ts` 静态检查 `Math.random / Date / performance.now / setTimeout / async / Promise`）；随机数用 Director 的带种子 PRNG（`world.roll()`），它的状态随检查点保存。
- 于是剧本的每一步都只取决于“起点状态 + 输入”。**存档 = 最近的检查点（章节开头：游戏状态、剧情变量、随机状态、舞台上持久的部分）+ 之后的全部玩家输入**；读档就是从检查点重新运行本章剧本，并按 tick 重放输入。
- 重放后的游戏必须与存档时的哈希一致，否则读档失败（存档来自别的剧本版本，或剧本不确定）——这同时是确定性的证明。Temporal / Azure Durable Functions 用同样的方法恢复 generator 形式的工作流代码。
- 检查点只在“两个 tick 之间、世界安静时”拍下（没有待投递的命中、没人在说话、没有打开的选择），读档后从这一点重新开始，与原来的运行逐 tick 相同。

测试：`src/story/director.test.ts`（同一剧本两次运行逐字相同；存档→读档哈希一致；篡改输入后读档报错）、`src/campaigns/ashen-march/campaign.test.ts`（整个战役在第 21 分钟存档，读档后哈希一致）。

## 6. 战役自定义单位 = 目录单位的“变体”（`src/shared/catalog.ts` `@@@unit-variants`）

像 WC3 基于某个单位复制出自定义单位：变体声明它的 **base 单位种类**，只写它改动的数字（血量、攻击、射程、速度、体型、护甲、回血、经验、赏金……），其余继承。

- 单位的 `kind` 仍是 base。所有按 kind 查表的代码（AI 启发式、命令卡、提示框）把它当 base——子类型可以替换父类型（Liskov）。认识变体的地方（模拟、渲染、剧本）按变体结算和绘制。
- 变体表存放在**这一局游戏里**（`Game.variants`，随快照与存档走），从不写进 `UNIT_DEFS`。一个战役不可能改变任何其他对局的平衡。
- 变体的技能沿用 base 的（治疗、诅咒、召唤、冲锋照常自动施放）；战役自己的能力是**脚本**（`src/story/powers.ts`：`aim` 决定何时值得放，`cast` 是一个可以蓄力、引导、持续的协程）。
- 英雄：`heroic` 变体不吃老兵星级，成长由剧情决定——等级、装备写在剧情变量里（纯数据），单位的规则每次都从“基础 + 等级成长 + 装备”重新计算并通过变体改写（`src/story/rpg.ts`），不会有“某个属性被手工改过、下次派生又被冲掉”的问题。
- 单位可以变成另一个变体：伊格破坏巨像的封印后，巨像换成“封印破碎”的变体（没有重甲，外观也不同）。
- **模型是程序**：一个用游戏自己的画笔（`src/client/art/kit.ts`）围绕脚底作画的函数，渲染器按“模型 × 队伍色”缓存成精灵，和目录单位一视同仁（`src/campaigns/ashen-march/models.ts`，22 个单位）。场景道具同理（`scenery.ts`：茅屋、渡船、篝火、烽火台、心木……带状态，比如 `burning / ruined / lit`）。

## 7. 舞台（`src/story/stage.ts` + `src/client/story-renderer.ts`）

舞台是纯数据，由 `world-renderer.ts` 的 `drawWorld` 画出——浏览器和无头录像画的是同一份：

- **气泡**：说话人名牌（角色颜色）、手写字体、逐字浮现、尾巴指向说话者；**每个说话人一次一句，其余排队**；两个人可以同时说；说话者阵亡，后面的台词作废；念台词的任务被 halt，气泡立刻撤下。语气：say / shout（锯齿边）/ whisper（虚线）/ think（泡泡尾巴）。
- 字幕旁白、章节标题（毛笔下划线）、目标清单（完成打勾划线）、通知、选择框（选中项高亮停留片刻）、地面标记（任务点 / 集结点 / 攻击目标 / **红色预警圈** / 荆棘 / 遗物光）、飘字、英雄面板（等级、血量、经验、技能冷却）、字幕黑边、淡入淡出、震屏。
- **镜头**：舞台可以要求跟随某些单位或看向某点（`framing` 随作用域恢复）；过场里默认看向最后一个说话的人；否则录像机把镜头放在主角身上并朝附近的战斗偏移。

## 8. 玩家一方：自动驾驶（`src/campaigns/ashen-march/pilot.ts`）

录像里的“玩家”也是一段脚本，但它只拿到人类玩家拥有的东西：**命令**和**选择**，外加“屏幕”（游戏状态与舞台）。它碰不到剧情本身（`PlayerControls` 是一个能力对象）。它像一个稳健的玩家那样玩：读目标和地图标记决定去哪、守哪、打谁；看见红圈就躲开；用 squad AI（`src/ai/squad/squad.ts`）控制部队（评估强弱、集火、伤兵后撤）；在前哨经营经济（采矿、造兵营靶场农场箭塔、持续出兵）；按这一次通关的人设做出四个选择。它的命令和人类的一样经过命令校验。

## 9. 对标准对局零影响

模拟的改动全部挂在只有战役局才有的可选字段上：`Game.variants`（及快照里的同名字段）、`Game.observer`、`Game.scriptedVictory`，外加几个只被剧本调用的导出函数。标准对局里这些字段不存在，走的分支与原来逐条相同，快照里也不出现 `variants` 键，校验和不变。

证明：`scripts/standard-match-fingerprint.ts` 按 V7 gauntlet 的方式（V7 对 V3/V5/V6 的组合、两种族、天梯的丰富地图）跑对局，每 1000 tick 和结束时打印整局的规范校验和。在改动前的树（ecf6e39）和本分支上用同样参数运行，输出逐字节相同，即每一局都逐 tick 相同。

## 10. 录像（`src/recorder/`）

`npm run record -- --scene ashen-march --fps 30 --hide-orders --locale zh --out x.mp4`。剧情场景通过 `RecordingScene.story` 接入：录像机每 tick 推进 Director，画出舞台，用剧情镜头取景。

`--from <秒>`：先不画、只推进模拟和镜头到指定时刻再开始拍——确定性保证了它与从头拍到这里完全一样，于是 45 分钟的片子可以切成几段并行渲染，再用 ffmpeg 无损拼接，拼缝处镜头平滑衔接。中文字体：macOS 的下载字体（手札体、楷体）不在常规目录，录像时用 `SKETCH_FONTS=路径:路径` 注册。

## 目录

```
src/story/
  kernel.ts      协程调度器：三条指令、结构化并发、上下文
  ops.ts         等待：wait / at / until / on / subscribe / each / every / within / signal
  time.ts        Duration / Instant
  events.ts      StoryEvent、模式匹配
  watch.ts       从模拟推导事件
  stage.ts       舞台（气泡、标题、目标、选择、标记、镜头……）
  world.ts       剧本对世界的能力：生成、命令、打击、改写变体、squad、单位生命
  cast.ts        自定义单位与模型、场景道具画笔
  powers.ts      剧本技能
  rpg.ts         英雄等级与装备
  director.ts    运行、检查点、存档/读档
  campaign.ts    战役 = 演员表 + 章节 + 变量；录像驱动
src/campaigns/ashen-march/   《灰烬边境》：6 章、22 个自定义单位、4 个选择、自动驾驶
src/client/story-renderer.ts 舞台的画法
```
