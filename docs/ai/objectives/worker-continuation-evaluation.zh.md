# 工人救命中断续行：三版对照（未通过验收）

这份报告保留失败结果。三版都没有修改原有五组场景断言。[#572](https://github.com/shuxueshuxue/sketch-rts/pull/572) 已关闭、代码分支 `codex/worker-safety-continuation` 保留。2026-10-20 决定把续行留到分配器与 HTN 前置阶段；本轮不在旧执行器之间手接施工到护送/清障，也不继续加战斗绕营、挡路营分类或清营借兵规则。

## 冻结版本与口径

| 版本 | 源码 | 差异 |
| --- | --- | --- |
| M | e00868758661c75dfc1b760695792f31b578d6d5 | 本次新跑的 main 对照 |
| A | 188d28a0583aff9d0c5d9f9894807709ad0c08f0 | 只续行已经实际执行、被 safety 打断的建造命令；不做保留父行动去重 |
| B | eccda81b4fb1c37ab55135aadfd6758f45a6ed5b | 共用施工责任判定，保留父行动也占位，避免经济重复派工 |
| C | 17aac68fdedc87142d6af7e4f6067f92026e15b7 | 同一判定也进入原 pendingCost，保留未支付的施工预算 |

复用原 11 图 `cases`（4 陆、7 海）、房间席位/种族/版本，think 间隔 15 tick，截止 18000 tick。每个版本都运行全部席位的原房间 AI。M/A 是 22 局成对运行；B 和 C 各 11 局复用这批新 M。不是胜率测试。A/C 的 gullIsland 分别在 17722/16858 tick 正常结束，不能把终局之后无法观测的目标直接当作失败，也不能把少观察的尾段算作存活收益。其余均到 18000。44 局死亡计数与原生损失逐席位核对一致，observer errors 为空。44 份实际命令回放的终局 snapshot/canonical/checksum 共 132 项均一致；这是各局回放与自己的原局一致，不是声称各版本行为相同。

旧 #569 的 57 次重派属于旧 main；e0086875 的新配对 M 用同一计数器得到 45 次，不能拿旧数字冒充本次 M。金额均为单位目录金，不是净资源回报；召唤物计入死亡次数、目录金为零。

## 死亡账本 v2

| 版本 | 正常 数/金 | 存疑 数/金 | 异常 数/金 | 未知 数/金 | 总死亡 数/金 | 原始全局总额差（未裁窗） |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M | 181/18090 | 95/9030 | 57/5870 | 20/1630 | 353/34620 | +0 |
| A | 254/23060 | 101/8300 | 58/5820 | 21/1485 | 434/38665 | +4045 |
| B | 197/18060 | 78/7020 | 48/4805 | 25/2310 | 348/32195 | -2425 |
| C | 181/18555 | 60/6330 | 62/6630 | 23/1595 | 326/33110 | -1510 |

上表是各局实际终点的原始汇总，A/C 与 M 的观测时长不同，不能据此下收益结论。按每张图 `min(M终点,候选终点)` 的共同观测窗重算如下（各层仍为次数/目录金）：

| 对照 | 正常 M→候选 | 存疑 M→候选 | 异常 M→候选 | 未知 M→候选 | 总额 M→候选 / 差 |
| --- | --- | --- | --- | --- | --- |
| M/A | 177/17545 → 254/23060 | 95/9030 → 101/8300 | 57/5870 → 58/5820 | 20/1630 → 21/1485 | 34075→38665 / +4590 |
| M/B | 181/18090 → 197/18060 | 95/9030 → 78/7020 | 57/5870 → 48/4805 | 20/1630 → 25/2310 | 34620→32195 / -2425 |
| M/C | 173/17045 → 181/18555 | 94/8915 → 60/6330 | 57/5870 → 62/6630 | 20/1630 → 23/1595 | 33460→33110 / -350 |

共同窗中 A 总死亡金额上升 4590 金。B 总金额虽下降，但未知金额增加 680 金，并有 4 条同身份单位从异常翻为未知，不能把它们说成消灭异常。C 的总金额只少 350 金，正常战损金额增加 1510 金，异常增加 5 次、760 金；存疑减少不抵消这一验收失败。三版都不能只看重派计数下降来宣布收益。包内 `worker-common-window.json` 保留逐图裁切终点、尾段死亡和重算双向表。

双向翻转只连接 **同 native id + 同 owner/kind/birth tick** 的死亡记录；出生不一致者分列，不解释成救活。完整分类、交战证据、两侧死亡 tick 及未匹配计数均在包内 `analysis/comparison.json`。

| 版本 | M→候选翻转（含同层主标签变化） |
| --- | --- |
| A | normal->suspicious: 6；suspicious->normal: 9；abnormal->normal: 1；suspicious->suspicious: 1 |
| B | abnormal->unattributed: 4；suspicious->normal: 8；abnormal->normal: 1 |
| C | normal->suspicious: 3；suspicious->normal: 2；suspicious->abnormal: 1 |

## 重派与实际续行

重派口径仍是：同工人、同建造点，被 miningJobSafety 下令撤离或换矿后 120 tick 内再次下 build。连续至少两次才称循环。候选里的合法续行也会被这个原始计数器记到，所以保留原命令和续行事件供复核。续行按每次 retain→end 的 episode 去重；`admit` 是发出提议，只有原生命令确认的 `resume` 或 `native-parent-observed` 才算实际续行。

| 版本 | safety 后重派 | 连续循环 episode | 保留父行动 | 实际续行 episode / 地图内去重工人 | 续行后到局末死亡的去重工人 | 局末仍保留 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| M | 45 | 9 | — | — | — | — |
| A | 5 | 1 | 67 | 13/10 | 0 | 8 |
| B | 2 | 0 | 54 | 22/19 | 2 | 7 |
| C | 6 | 2 | 43 | 23/16 | 1 | 6 |

C 的 1 名后续死亡工人为 turtleLake p2 `unit-p2-worker-3`：11797、12007 两次原生父行动确认；12143 阵亡，v2 为正常战损。B 的 2 名是 reedwater p0 worker-2（12273，存疑）和 turtleLake p2 worker-1061（16687，正常）。同一个工人有多次续行，不把同一死亡重复算成多次。这里的“后来死亡”是到局末的时间关联，不能直接归因于续行路线。

按实际下令脚本复核，M 的 45 次均为 v6Economy；A 为 v6Economy 1 次、miningJobSafety 4 次；B 的 2 次、C 的 6 次均为 miningJobSafety 的续行。也就是说，B/C 的经济原样重派为 0；上表保留包含安全续行的旧计数，不能把 C 的 6 次误称为经济重派循环。包内 `retry-issuers-*.json` 逐条保留 tick、单位、目标与实际执行器。

## 逐图目标时间

下表只展示 p0；每个格内固定顺序 **M / A / B / C**，单位 tick。`—` 表示截止时没有满足该指标的观测，不把未建立任务或别人清掉的营冒充本方夺岛清营。岛营开始/完成来自已有夺岛任务与其营地成员的关联，再查原生攻击订单和成员死亡；完整逐席位及逐目标的记录在 native-metrics 中。

| 地图 | 首次扩张完工 | 首次夺岛清营开始 | 首次夺岛清营完成 | 首次对敌出击 |
| --- | --- | --- | --- | --- |
| brokenSea | — / — / — / — | 9741 / 9741 / 9741 / 9741 | 9793 / 9793 / 9793 / 9793 | — / — / — / — |
| greystonePass | 3766 / 3766 / 3766 / 3766 | — / — / — / — | — / — / — / — | 6993 / 6993 / 6993 / 6993 |
| gullIsland | 3620 / 3620 / 3620 / 3620 | — / — / 13646 / — | — / — / 13978 / — | 5403 / 5403 / 5403 / 5403 |
| pineshade | 5101 / 5101 / 5101 / 5101 | — / — / — / — | — / — / — / — | 10533 / 10533 / 10533 / 10533 |
| reedwater | 4423 / 4423 / 4423 / 4423 | — / — / — / — | — / — / — / — | 9798 / 9798 / 9798 / 9798 |
| ringwater | 4917 / 4917 / 4917 / 4917 | — / — / — / — | — / — / — / — | 11733 / 11733 / 11733 / 11733 |
| sapphireArchipelago | 16657 / 16380 / 16360 / 16518 | 15458 / — / — / 15458 | 15660 / — / — / 15627 | — / — / — / — |
| templeSpring | 3890 / 3890 / 3890 / 3890 | — / — / — / — | — / — / — / — | 8163 / 8163 / 8163 / 8163 |
| turtleLake | 5248 / 5248 / 5248 / 5248 | — / — / — / — | — / — / — / — | 7668 / 7668 / 7668 / 7668 |
| twoShores | 5074 / 5074 / 5074 / 5074 | — / — / — / — | — / — / — / — | 7338 / 7338 / 7338 / 7338 |
| veiledHill | 5832 / 5832 / 5832 / 5832 | — / — / — / — | — / — / — / — | 7773 / 7773 / 7773 / 7773 |

p0 的首次扩张/首次对敌出击大多没有变化，不能据此忽略其他席位和后续矿厅。所有席位的回退项如下；各矿按 owner+mineId 匹配物理完工事件，同一矿若有重建则完整事件仍保留。A/C gullIsland 分别有最后 278/1142 tick 被正常终局截断，单独注明。

| 版本 | 地图/席位 | 指标 | M | 候选 |
| --- | --- | --- | ---: | ---: |
| A | sapphireArchipelago/p1 | firstEnemySortie | 13625 | 17195 |
| A | sapphireArchipelago/p3 | firstEnemySortie | 13795 | — |
| A | sapphireArchipelago/p4 | firstExpansion | 12466 | 12483 |
| A | gullIsland/p1 | 矿厅完工 gold-gen-5 | 13608 | 13952 |
| A | gullIsland/p1 | 矿厅完工 gold-gen-1 | 15861 | 16134 |
| A | gullIsland/p1 | 矿厅完工 gold-gen-6 | 17964 | —（终局截断） |
| A | sapphireArchipelago/p4 | 矿厅完工 gold-satellite-3 | 12466 | 12483 |
| A | turtleLake/p3 | 矿厅完工 gold-gen-5 | 15960 | 16904 |
| A | twoShores/p2 | 矿厅完工 gold-gen-6 | 17687 | — |
| A | veiledHill/p1 | 矿厅完工 gold-gen-3 | 16769 | 16784 |
| B | sapphireArchipelago/p1 | firstEnemySortie | 13625 | — |
| B | sapphireArchipelago/p3 | firstEnemySortie | 13795 | — |
| B | sapphireArchipelago/p4 | firstExpansion | 12466 | 12483 |
| B | sapphireArchipelago/p5 | firstExpansion | 12527 | 12583 |
| B | twoShores/p2 | firstEnemySortie | 13165 | 13180 |
| B | gullIsland/p1 | 矿厅完工 gold-gen-1 | 15861 | — |
| B | gullIsland/p1 | 矿厅完工 gold-gen-6 | 17964 | — |
| B | sapphireArchipelago/p4 | 矿厅完工 gold-satellite-3 | 12466 | 12483 |
| B | sapphireArchipelago/p5 | 矿厅完工 gold-satellite-4 | 12527 | 12583 |
| B | turtleLake/p3 | 矿厅完工 gold-gen-5 | 15960 | 16275 |
| B | veiledHill/p1 | 矿厅完工 gold-gen-3 | 16769 | — |
| C | sapphireArchipelago/p1 | firstEnemySortie | 13625 | — |
| C | sapphireArchipelago/p3 | firstEnemySortie | 13795 | — |
| C | sapphireArchipelago/p5 | firstExpansion | 12527 | 13348 |
| C | turtleLake/p3 | firstEnemySortie | 12869 | — |
| C | twoShores/p2 | firstEnemySortie | 13165 | 13180 |
| C | gullIsland/p1 | 矿厅完工 gold-gen-5 | 13608 | 13726 |
| C | gullIsland/p1 | 矿厅完工 gold-gen-6 | 17964 | —（终局截断） |
| C | sapphireArchipelago/p5 | 矿厅完工 gold-satellite-4 | 12527 | 13348 |
| C | turtleLake/p1 | 矿厅完工 gold-gen-9 | 10821 | 10823 |
| C | twoShores/p2 | 矿厅完工 gold-gen-6 | 17687 | — |
| C | veiledHill/p1 | 矿厅完工 gold-gen-3 | 16769 | — |

## 各矿厅物理完工全表

不含开局已完工厅。每个格为 M / A / B / C；这是原生命令回放中 complete 从 false 变 true 的实际 tick，不以计划阶段代替建成。— 仍受各局观测终点限制。

| 地图 | 席位 / 矿 | 完工 tick（M / A / B / C） |
| --- | --- | --- |
| brokenSea | p1 / gold-mainland-2 | 8163 / 8163 / 8163 / 8163 |
| brokenSea | p2 / gold-mainland-4 | 15237 / 15237 / 15237 / 15237 |
| greystonePass | p0 / gold-gen-1 | 3766 / 3766 / 3766 / 3766 |
| greystonePass | p0 / gold-gen-4 | 6317 / 6317 / 6317 / 6317 |
| greystonePass | p1 / gold-gen-2 | 4432 / 4432 / 4432 / 4432 |
| greystonePass | p1 / gold-gen-3 | 7596 / 7596 / 7596 / 7596 |
| gullIsland | p0 / gold-gen-1 | 3620 / 3620 / 3620 / 3620 |
| gullIsland | p0 / gold-gen-4 | — / — / 14079 / — |
| gullIsland | p0 / gold-gen-6 | — / — / 15163 / — |
| gullIsland | p1 / gold-gen-1 | 15861 / 16134 / — / 15790 |
| gullIsland | p1 / gold-gen-2 | 4645 / 4645 / 4645 / 4645 |
| gullIsland | p1 / gold-gen-5 | 13608 / 13952 / 12390 / 13726 |
| gullIsland | p1 / gold-gen-6 | 17964 / — / — / — |
| gullIsland | p1 / gold-gen-7 | 8266 / 8266 / 8266 / 8266 |
| pineshade | p0 / gold-gen-1 | 5101 / 5101 / 5101 / 5101 |
| pineshade | p1 / gold-gen-2 | 5332 / 5332 / 5332 / 5332 |
| pineshade | p1 / gold-gen-3 | 14600 / 14600 / 14600 / 14600 |
| pineshade | p1 / gold-gen-5 | 7285 / 7285 / 7285 / 7285 |
| reedwater | p0 / gold-gen-1 | 4423 / 4423 / 4423 / 4423 |
| reedwater | p0 / gold-gen-4 | 10349 / 10349 / 10349 / 10349 |
| reedwater | p1 / gold-gen-2 | 5020 / 5020 / 5020 / 5020 |
| reedwater | p1 / gold-gen-3 | 9163 / 9163 / 9163 / 9163 |
| reedwater | p1 / gold-gen-4 | — / 17981 / — / — |
| ringwater | p0 / gold-gen-1 | 4917 / 4917 / 4917 / 4917 |
| ringwater | p0 / gold-gen-9 | 8191 / 8191 / 8191 / 8191 |
| ringwater | p1 / gold-gen-11 | 8205 / 8205 / 8205 / 8205 |
| ringwater | p1 / gold-gen-3 | 5148 / 5148 / 5148 / 5148 |
| ringwater | p2 / gold-gen-10 | 7293 / 7293 / 7293 / 7293 |
| ringwater | p2 / gold-gen-2 | 4617 / 4617 / 4617 / 4617 |
| ringwater | p3 / gold-gen-12 | 8673 / 8673 / 8673 / 8673 |
| ringwater | p3 / gold-gen-4 | 5613 / 5613 / 5613 / 5613 |
| sapphireArchipelago | p0 / gold-mainland-1 | 16657 / 16380 / 16360 / 16518 |
| sapphireArchipelago | p1 / gold-satellite-0 | 11749 / 11749 / 11749 / 11749 |
| sapphireArchipelago | p1 / gold-satellite-1 | — / 15264 / — / 15368 |
| sapphireArchipelago | p4 / gold-satellite-3 | 12466 / 12483 / 12483 / 12431 |
| sapphireArchipelago | p5 / gold-satellite-4 | 12527 / 12478 / 12583 / 13348 |
| templeSpring | p0 / gold-gen-1 | 3890 / 3890 / 3890 / 3890 |
| templeSpring | p0 / gold-gen-5 | 7225 / 7225 / 7225 / 7225 |
| templeSpring | p0 / gold-gen-6 | — / — / — / 16444 |
| templeSpring | p1 / gold-gen-3 | 4600 / 4600 / 4600 / 4600 |
| templeSpring | p1 / gold-gen-7 | 8110 / 8110 / 8110 / 8110 |
| templeSpring | p2 / gold-gen-2 | 3592 / 3592 / 3592 / 3592 |
| templeSpring | p2 / gold-gen-6 | 6757 / 6757 / 6757 / 6757 |
| templeSpring | p3 / gold-gen-4 | 4712 / 4712 / 4712 / 4712 |
| templeSpring | p3 / gold-gen-8 | 8193 / 8193 / 8193 / 8193 |
| turtleLake | p0 / gold-gen-1 | 5248 / 5248 / 5248 / 5248 |
| turtleLake | p0 / gold-gen-6 | 8989 / 8989 / 8989 / 8989 |
| turtleLake | p1 / gold-gen-3 | 4851 / 4851 / 4851 / 4851 |
| turtleLake | p1 / gold-gen-5 | — / 17361 / 16746 / 13063 |
| turtleLake | p1 / gold-gen-8 | 7364 / 7364 / 7364 / 7364 |
| turtleLake | p1 / gold-gen-9 | 10821 / 10821 / 10821 / 10823 |
| turtleLake | p2 / gold-gen-2 | 3988 / 3988 / 3988 / 3988 |
| turtleLake | p2 / gold-gen-7 | 7963 / 7963 / 7963 / 7963 |
| turtleLake | p3 / gold-gen-4 | 5036 / 5036 / 5036 / 5036 |
| turtleLake | p3 / gold-gen-5 | 15960 / 16904 / 16275 / 13007 |
| turtleLake | p3 / gold-gen-9 | 10103 / 10103 / 10103 / 10103 |
| twoShores | p0 / gold-gen-1 | 5074 / 5074 / 5074 / 5074 |
| twoShores | p0 / gold-gen-8 | 8321 / 8321 / 8321 / 8321 |
| twoShores | p1 / gold-gen-2 | 5812 / 5812 / 5812 / 5812 |
| twoShores | p1 / gold-gen-9 | 11208 / 11208 / 11208 / 11208 |
| twoShores | p2 / gold-gen-10 | 7348 / 7348 / 7348 / 7348 |
| twoShores | p2 / gold-gen-3 | 4780 / 4780 / 4780 / 4780 |
| twoShores | p2 / gold-gen-6 | 17687 / — / 16319 / — |
| twoShores | p2 / gold-gen-8 | 9696 / 9696 / 9696 / 9696 |
| twoShores | p3 / gold-gen-11 | 8132 / 8132 / 8132 / 8132 |
| twoShores | p3 / gold-gen-4 | 5453 / 5453 / 5453 / 5453 |
| twoShores | p3 / gold-gen-9 | 11062 / 11062 / 11062 / 11062 |
| veiledHill | p0 / gold-gen-1 | 5832 / 5832 / 5832 / 5832 |
| veiledHill | p0 / gold-gen-4 | 9589 / 9589 / 9589 / 9589 |
| veiledHill | p1 / gold-gen-2 | 5289 / 5289 / 5289 / 5289 |
| veiledHill | p1 / gold-gen-3 | 16769 / 16784 / — / — |
| veiledHill | p1 / gold-gen-5 | 7779 / 7779 / 7779 / 7779 |

## 召唤真实帧的交接缺口

使用原 `summoner-safe-hold-9m10.json` 从 11000 跑到 15000，原生战斗和所有房间 AI 保持开启。按本次逐 think 的 `v6.general.mode`，下一次 attack 在 C 为 13132、M 为 13147；这项观察不代表第四矿和中间决策状态相同，也不替代上面的整局对敌出击口径。

- **11077**：`unit-v9_summoner-worker-1256` 实际执行在 `(3024,2128)` 建 townHall，被 camp9 两名成员逼退。续行只在接受这次 safety 命令后保留父行动。
- **12232**：B 因没有 native build，原 pendingCost 没预留建矿金，买了 390 金 weaponTraining；C 把有效父行动纳入原 pendingCost，修复这个预算遗漏。这项修复有共享判定回归测试。
- **12247**：M 的三名现有护卫 spirit-5108/4855/5283 跟随实际 builder 的 steering 前缀，attackMove `(1875.8184488912302,3448.871932345571)`；C 没有 native build 可供 escort 识别，三名现有护卫被发往矿中心 `(3205,2265)`。不是新借兵，也没有改护卫数量。
- **13054/13171/13286**：M 的 camp9 三名成员依次死亡；M 到 14137 的 think 已观察到第四矿完工（旧场景验收基线为 14138）。C 只在 12975 消灭其中一名，到 15000 另两名仍活、第四矿未完成。
- **12232/12262/14992**：C 保留工人到目标点的实际 native road 694/702/694 tick，点本身没有暴露，但路线进入 murlocPeon 的 229、murlocHunter 的 280 安全半径；路段距成员约 149–221，安全绕路无解。12247、13012 两帧对全部 16 名工人重查，所有人的实际路线都碰营地或敌塔；不能以“换个工人就能安全建造”解释。

精确代码边界是 `construction-assignment.ts:assignedConstruction` 让经济看见救命中断中的施工责任；`expansion-mission.ts:planMiningScreen` 的 escort builder 仍只读 `unit.order.type === build`。责任保留并没有让负责保护这次施工的既有动作看见阻塞。补这条接口可能要把 blocked 路线/清营前置传回父目标，已经触到本次明确搁置的战斗/清营调度边界，所以此候选没有擅自加借兵或营地分类补丁。

## 验证与未完成项

根目录 `npx tsc --noEmit -p .` 通过。新增的实际命令捕获、相同口径路线、序列化 fork、外部相同改令取消、worker 线程在途结果取消、施工责任与预算、父行动结束后下一 think 正常派工均有测试。碎海 7293 闲置工人不挪动、7458 新建矿命令逐字节等于 M 的回归通过。

C 全量 `vitest run --dir src --maxWorkers=8 --minWorkers=1`：7926 通过、2 失败。一条是原 attack-objective.scene 在 tick 12262 的 admission 观察没发生（不能把断言改成新值）；另一条是 A100 Node 22.23.3 在线程入口加载无扩展名的 `host` 模块失败，随后客户端等待 30 秒超时，不能把它归为负载波动。同机 M 单独重跑也有相同入口错误；本机 Node 24.22.0 同源码 C 单独运行 think-worker 为 5/5。其余四组原行为场景通过。完整日志保留最初的模块加载堆栈。

因为语义验收已经失败，这份草稿没有执行候选 ABBA 和 mac1 正面证明，也不宣称性能或浏览器验收通过。后续若继续修，必须重新冻结源码、跑 11 图、五组原断言、ABBA p95/max≤110% 和 mac1 证据。

## 证据与复跑

原始数据在 A100 `/codegeex/jeffry/sketch-rts-defense/runs/worker-continuation-20261020/`。内容哈希指针见 [worker-continuation.evidence.json](./worker-continuation.evidence.json)。包内含四版本 44 局 initial/final、原始 commands/traces/worlds、逐死亡/出生/建筑损失、续行事件、三版比较与双向翻转、44 份原生命令回放、11 图配置、采集/分析脚本、真实 handoff 帧、全量测试与根 tsc 日志。

```sh
SKETCH_MACHINES=/tmp/sketch-defense-machines-owned.json \
  bin/sketch evidence get docs/ai/objectives/worker-continuation.evidence.json \
  --on a100 --out /tmp/worker-continuation-review
```

复跑配置使用包内 cases.json 的 cases；每份 summary 的 source 是实际对局源码 SHA。report/docs 提交可以晚于它，不把文档提交说成重新跑过的源码。`ai-objective-clearing-replay.ts` 验证一局：

```sh
node_modules/.bin/tsx scripts/ai-objective-clearing-replay.ts \
  /path/to/the/summary-source-tree /path/to/map-export /tmp/native-objective-metrics.json
```
