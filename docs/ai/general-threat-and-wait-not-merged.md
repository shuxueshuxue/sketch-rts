# General 威胁去重与 hold 计时：试验后不合并（2026-10-18）

## 尝试与验收决定

`codex/general-threat-and-wait` 保留作证据，不合并。baseline 是 `b42249cb`（#514 后），不是 #514 前海军存钱的版本。

- `8e782a74`：facing 与 incoming 按敌军 ID 去重，同时保留原 incoming 的 `distance > LOCAL_RANGE` 条件，避免把隔水、隔崖但近中心的敌军新增为 incoming。中心判定的 v8/v9 对手计算结果不变；any-front 的房间 AI 会变。
- `04ee5b53`：hold 的等待年龄经过短暂 defend/guard 仍保留，attack/creep 消耗它。该逻辑在共享 order 中，因此也改变 v8/v9 对手的出兵时机。
- `codex/general-front-dedup` 保留仅去重的消融版本。没有仅 hold 的独立验收，不把 combined 与 dedup 的差值当作无交互的因果效应。

三组各在 A100 跑240局，v8/v9分开各120局，32 workers。表为胜/负/平：

| 房间 AI | 对手 | base b42249cb | 仅去重 8e782a74 | 两个提交 04ee5b53 |
|---|---|---:|---:|---:|
| archer | v8 | 29/8/3 | 30/8/2 | 33/6/1 |
| archer | v9 | 29/3/8 | 25/4/11 | 27/7/6 |
| summoner | v8 | 29/10/1 | 28/10/2 | 28/11/1 |
| summoner | v9 | 22/14/4 | 18/19/3 | 19/19/2 |
| knight | v8 | 35/4/1 | 35/5/0 | 33/4/3 |
| knight | v9 | 20/10/10 | 21/9/10 | 24/12/4 |
| 合计 | | **164/49/27** | **157/55/28** | **164/59/17** |

仅去重相对 base：W→L 11、L→W 7、W→D 10、D→W 7、D→L 5、L→D 3；两个提交：W→L 15、L→W 13、W→D 6、D→W 8、D→L 11、L→D 3。修复卡住或保持总胜场，并不能抵消直接赢变输的回退。summoner/v9 两组共同的 W→L 为01、12、14、20 grove，以下重放前两局。

验收命令（每个 commit 各运行一次，每个对手各运行一次）：

```sh
npx tsx scripts/ai-room-gauntlet-benchmark.ts \
  --subjects v9_archer,v9_summoner,v9_knight --rivals v8 \
  --seeds v5-final-1 --map-count 20 --workers 32 \
  --metrics trade@15,trade@20,stall@60 --out-dir <directory> --label <label>
# 同参数把 --rivals 换成 v9；逗号写 v8,v9 会变为一局多个对手，不能用来代替两批对局。
```

完整三组结果、指标和逐局翻转见[验收数据](general-threat-and-wait-results.json)。`stall@60` 统计 move/attackMove 停滞，不等同于军团在集结点等待。

回归测试覆盖重复计入和 hold 被短暂打断的情况，在 main 失败，候选版本通过；combined 的2556项测试和 tsc、仅去重的2554项测试和 tsc 均通过。测试说明规则实现正确，240局显示规则变化仍使实战回退，故不合并、不调整0.8来追榜。先单独处理可证实的路线与撤退锚点，再诊断实际接战力量和行军塔群风险。

## 首次分叉诊断

结论：两局的首个分叉都是原版因 incoming 撤退、去重版继续；没有漏掉一支敌方军队。01 是现有军队在野外把分散的召唤阵容打穿，12 则踩进已知塔群，撤退路线又穿塔。数据不能支持“只把 RETREAT_LINE 调高”；PR1 暂停，诊断后没有继续修改生产代码。

对照：main `b42249cb` 与仅去重 `8e782a74`，相同 `v5-final-1`、20 图抽样、v9_summoner grove 对 v9。所有多局和本次四个完整重放均在 A100。本报告行号按 b42249cb；探针只在独立 diag worktree，不在提交内。

| 地图 | 布局 seed | 首次不同判定 | 我方有效力量 | facing | incoming 原/去重 | 0.8×总威胁 原/去重 |
|---|---|---:|---:|---:|---:|---:|
| ladder-01 | v9_summoner-layout:v5-final-1:ladder-01:4 | 10927 (9:06.35) | 16.955 | 9.356 | 13.006 / 3.650 | 17.889 / 10.405 |
| ladder-12 | v9_summoner-layout:v5-final-1:ladder-12:1 | 10417 (8:40.85) | 15.943 | 7.986 | 12.242 / 4.257 | 16.183 / 9.794 |

以上数值在 base 和 dedup 的首次分叉快照完全一致。实际下发命令首次差异均在判定后 3 tick：10930、10420。入口为 `src/ai/policy/v6/general.ts:359`，原版 outrun=true，去重版 false，均无 worn，holds=true；`general.ts:360` 继续进攻分支因此放行。

## ladder-01 grove：同一队 lancer 击穿，没有塔或新军包围

- 分叉时主力前排中心 (1519,3295)，敌军中心 (2013,1928)，敌主基地 (3280,816)，距离约 1454 / 3042。我方 8 summoner、11 spirit、4 footman、1 raider。敌方 8 lancer、2 priest、1 witch、1 raider；所有这些敌兵都已在 facing 或 unique incoming 中，没有去重漏掉的第三类成员。facing 的 8 lancer 原来全部又进 incoming。
- 我方并非紧密成团：领先 footman-1037 在 (1605,2746) 正打野怪，其他常驻前排在 y3162–3424，8 summoner 在 y3394–3536。strengthOf 把整个 group 当前存量等价相加，不看接战时能否到场、spirit 剩余寿命或召唤冷却（`strength.ts:41–45`，`general.ts:351/358`）。11 spirit 中 3 个在 0.9–3.9 秒内到期，另 2 个在 9.9–12.9 秒内到期。
- 原版 tick10927 退出 gather → hold，10957 改为 creep，summoner-1417/2942 在10945补召唤；去重版多走4.5秒 gather，直到11017被防守分支截走才退出，补召唤延到11035。
- 去重版11017转 defend（`general.ts:232`），11087首次遭现有 lancer 伤害，11171–11296丢3 footman+1 raider。11377时现有前排已从16体掉到1体左右，召唤陆续赶到、逐个送掉；11548–12031，原有8 summoner全死。lancer 速度68、summoner56，失去屏障后回撤跑不掉。
- 这60秒内所有 summoner 的最后一击都来自分叉时已经存在的8 lancer；塔伤害为0。summoner 有效受伤936来自 lancer、16来自 priest（含期间治疗后再次受伤）。15 spirit被杀、4到期；lancer对spirit造成1127有效伤害，witch169、priest21。witch有驱散/诅咒作用，但它已经按0.9计入 incoming，不能称为漏掉一队军。
- 第一波敌方新兵 golem 在11443出现，witch11703、raider11813；均未参与这8次 summoner击杀，未形成新兵合围。
- 分叉后60秒，付费军队损失 **2340 : 475**，另丢5 worker=375；原版同期 **0 : 0**，8 summoner全部活着。120秒原版军队交换550:1035，去重版不再有召唤核心，16个工人累计丢1200；约13200副矿被拆、14400前主基地也没了。原版31270胜，去重版19506负。

解释的边界：此局证明去重放松了一个原本碰巧保命的战斗门槛；没有证明“漏算生产、塔或第二军团”。更具体的可疑点是实际接战力量和纸面力量不同（到场、剩余召唤寿命、伤害/施法模型）。仅凭这一局不能把某一种权重修正定为已经证实的修法，更不能直接改阈值。

## ladder-12 grove：沿路8塔，局部检测到塔时已深入；后排撤退仍走进塔群

- 分叉时主力前排中心 (2845,2000)，敌军中心 (2478,798)，敌主基地 (3248,848)，距离约1256 /1220。我方 effective15.943含warlord +15%；敌军总12.242，所有15个敌兵均在 facing∪unique incoming，去重没有丢敌兵。towerPower=0。
- 实际去敌主基地的 steering 路线绕西侧：footman1037 从(2769,1579)→(2544,1200)→(2480,688)→北侧绕回主基地。它经过8座已完成塔的射程：1323、1407、1436、1447、1505、1557、1696、2041。目标主基地 intel 关联4塔，路径还要经过另一个基地的塔。
- `ground-threat.ts:38–39` 仅算当前前排将在一个 THINK_TICKS(15tick/0.75秒)内进入射程的塔，不算正在执行的路线前方覆盖；`approachingPower` 只算移动单位，不补塔。因此在继续推进时没有把这条路线的防守算进来。
- 第一发塔伤 tick10616；10747 facing已有2塔，10792有3塔；到10807，towerPower=5.2（4塔）、总facing16.444，own13.000 < 0.8*facing=13.155，才退出attack转hold。此时已经在塔群入口，退得晚。
- 更直接的第二个 bug：`backline.ts:110–113` 只检查锚点本身离塔多远，未检查可走性/撤退路。tick11000 summoner1559 在(2537,1072)，收到“向(2259,1422)回撤”；该点不可走，sim `sim.ts:4866` 把目标吸附到(2160,1424)。真正路线为(2544,976)→(2480,880)→(2448,816)→(2352,816)→(2256,848)→(2160,1360)，先向北深入塔群，随后才绕回南侧。其余5个主力summoner同行。账面向南撤，实际向北绕。
- 11188后 summoner开始吃塔伤，11239–11384这6人全死；最后一击2次塔、3次原有守军、1次原有priest。有效伤害291来自塔、357来自原有ravager、5 cinderRunner、1 priest。新出生的priest等提供支援，但不是这批人的主要杀伤来源。
- 分叉后60秒，付费军队损失 **1280 : 360**；原版 **300 : 120**，原版7 summoner全部活着，去重版仅剩没随主队到场的1人。去重版之后虽重建，第三矿约17400丢失、约22400只剩主基地，24443负；原版30133胜。

## 判断与下一步

- 12属于真实的路线防守漏算和不安全撤退，修复应围绕实际 steering 道路、退路与施法者可到达锚点，不能把敌军重复算回去充当塔。
- 01没有找到未计入的敌方成员，显示当前力量模型/阵型与继续进攻门槛存在耦合；暂不动RETREAT_LINE。
- 历史核对：0.8在 `f45af00c` 已存在；any-front 的 groundFrontThreat 到 `eb71abaf` (#338) 才加入。因此不能声称这个阈值“当初就是基于这次重复计数调出来的”。是否后来形成依赖仍需独立战斗验证。
- 诊断没有修改生产代码或调阈值，只有本说明与验收数据作为后续文档提交；没有开PR。诊断结果支持撤回“纯去重可独立合并”的判断。

数据：每局 base/dedup 的 `first-counterfactual-flip.json`、`gates.jsonl`、`general.jsonl`、`commands.jsonl`、每10秒`samples.jsonl`、`deaths.jsonl`、`spawns.jsonl` 在 `sketch-rts-codex-diagnostics/`；逐次攻击伤害和道路探针在 `sketch-rts-codex-diagnostic-detail/`。对应压缩包保留在A100 `/codegeex/jeffry/`；本目录另有每10秒汇总CSV。

参考：[Tower Lane 的 arrival-posts 不合并记录](https://github.com/shuxueshuxue/sketch-rts/blob/96ed40fd862c1a5c3a6249010a08d985ae045da7/docs/naval/arrival-posts-not-merged.md)。
