# 执行器失败原因审计：行为不变

清营、陆地扩张和夺岛的失败原因现在来自实际命中的决策分支。碎海 tick 9585 有足够兵力，却因接近几何不可行而停在 assemble；旧版统一写 `await-clearing-force`，本次改为 `blocked:clearing-geometry-blocked`。本次不改变路线、选兵、任务阶段、优先级、重试或命令。

11 张图、22 局全部跑到 tick 18000。共 43,200 次 think、129,557 条实际命令；计划命令、实际命令、去掉明确诊断叶后的 memory、世界检查点四份序列逐字节一致，最终 snapshot、canonical、checksum 也一致。完整差异仅存在于下文枚举的 reason 叶和输出诊断中。

## 真实帧

`src/ai/bootstrap_1/fixtures/executor-broken-sea-9585.json.gz` 保存了 #569 分析中抓到的真实 snapshot 和 think 前 memory。该帧本身来自旧实验；期望命令及行为 memory 哈希重新由 main `9e90ebf2` 计算，未把旧实验的行为当作基线。

该帧 p0 的任务为 `island:gold-mainland-0:3060`，目标营成员为 `guard-0-0`、`guard-0-1`。六名 emberRavager 的清营战力约 5.6768，要求约 3.4477；兵力门槛通过，`bootstrapCampApproach` 返回无可行接近方案。回归测试同时断言真实命令逐字节不变、行为 memory 哈希不变、实体未被诊断修改，以及 plan delta 可以保留新诊断。船上没有战斗乘员时的 `no-combat-crew` 仍然正确，它描述的是另一个执行器，不能用来解释已在岛上的六人为何不清营。

## 审计清单

| 位置 / 实际分支 | 记录的真实原因 | 说明 |
| --- | --- | --- |
| `policy/v7/creep.ts`：选择清营候选 | `no-clearing-units`、`clearing-party-not-gathered`、`insufficient-clearing-force`、`camp-retry-delay`、`clearing-geometry-blocked` | 保留原门槛和判定顺序；先验兵力，不重复估算一套原因。 |
| 同上：扩张守营未选中 / 自愿清营未选中 | `no-expansion-guard`、`no-camp-candidate`、`insufficient-voluntary-clearing-margin`、`multiple-clearing-blockers` | 单个候选被拒与整个选择失败分开记录；不同候选有不同阻碍时不伪称只有一种。 |
| `continueV7Creep`：原清营组不可用 | `defense-task-recall`、`transport-reassignment`、`clearing-group-unavailable`、`clearing-group-no-longer-present` | 仅活跃防守 claim 才能证明回防召走；船上或 board 订单证明转运；从可用池消失不等于死亡。 |
| 同上：交战或到场兵力低于既有退出线 | `engaged-clearing-force-below-minimum`、`arrival-clearing-force-below-minimum` | 若缺席的存活成员确被防守或运输拿走，附 `with-defense-task-recall` / `with-transport-reassignment`。 |
| 同上：敌军争夺 | `enemy-force-at-camp`、`enemy-force-at-clearing-party` | 分别记录营地或部队所在处的既有判定。 |
| `bootstrap_1/camp-geometry.ts` | 消费上述 assessment，几何失败为 `clearing-geometry-blocked` | `chooseBootstrapCamp` 仍返回同一个 choice；没有更换接近算法或集结点。 |
| `prepareExpansionMission`：资金 / 目标失效 | `insufficient-hall-capital`、`mine-missing`、`mine-exhausted`、`mine-occupied`、`ally-mine-claim` | 完成建矿和达到既有基地需求不当成失败。没有可选目标只报 `no-eligible-expansion-target`，不凭空断言缺兵。 |
| 同上：既有全局暂停 | `home-threat`、`mining-threat`、`mine-threat` | 这只是原暂停分支，不把“看到威胁”谎报成“兵已被召走”。该整体开关的契约缺口仍保留。 |
| `planMiningScreen`：无可用屏护 / 换营 / 不再需要清营 | `no-mining-screen-units` 或已证实的归属原因；`clearing-target-superseded`、`clearing-prerequisite-no-longer-needed` | guard 真正被清除属于成功，不新增失败记录。既有 roadCamp 选择、重试和清营派兵不变。 |
| 同上：assemble / clear / escort | `await-clearing-force` 只用于真实兵力门槛；其余 `blocked:<实际原因>`；集结用 `gathering-clearing-party` | `clear` 阶段中仍在 gather 时不再声称已开始打营；这些只是解释，不改变 stage。 |
| `prepareIslandConquests`：目标或登岛队不可用 | `mine-missing`、`mine-exhausted`、`enemy-mine-occupied`、`ally-mine-claim`、`no-landed-party-or-inbound-ferry` | 没有岸上队伍和入航任务，并不能证明原队伍全死了，故去掉 `landing-party-lost` 的过度归因。 |
| `planConquestEngineers`：有效 escort 任务缺工程运输条件 | `no-complete-home-for-engineers`、`no-surplus-engineer`、`no-eligible-engineer-transport`、`engineer-load-coast-unavailable`、`engineer-landing-water-outgunned` | 已有岛上工人或入航工程船时，不额外报缺工人。运输船的多重筛选未全部通过，只报“没有合格船”，不猜是哪一项。 |
| `planConquestReinforcements`：有效清营增援受阻 | `no-eligible-reinforcement-transport`、`no-eligible-reinforcement-crew`、`reinforcement-load-coast-unavailable`、`reinforcement-landing-defense`、`reinforcement-landing-water-outgunned`、`target-retries-exhausted`、`no-additional-clearing-payload` | 没有合格船只是候选被拒；不据此谎报任务需要额外兵力。原有“清营需求已消失”的标记清理仍是正常结束。 |
| `islandConquestCommands`：屏护池为空 | `no-conquest-screen-units` 或已证实的回防 / 运输原因 | 不再留下上一帧的“正在增援 / 缺兵”等过期说明。 |
| `policy/naval.ts::ferryCommands`：既有航次门槛及取消 | 原本准确的 `no-home`、`retry-delay`、`repair-needed`、岸线、登岸火力、本土预留、登船等待等原因保留；取消时记录同一 think 的原因 | `colony-claimed` 拆成盟友认领 / 敌建筑；`colony-unavailable` 拆成矿消失 / 枯竭 / 无殖民方案 / 已存在己方矿厅。无法取得取消原因时明确报 `cancellation-cause-not-recorded`。 |
| 同上：40 秒无物理进展 | `no-loading-progress`、`no-sailing-progress`、`no-return-progress`、`no-physical-progress` | 无位移不能证明路线不通。若上一次已有明确的 gate 原因则保留，不伪造几何结论。计时、次数、返航及冷却完全不动。 |
| `planBootstrapNaval`：既有枯矿调运取消 | `mine-exhausted` | 外层已检查到的原因传给 `cancelFerry`，不猜测。 |

旧的 `plays['creep:enemy' / 'creep:abort' / 'creep:worn']` 是兼容计数器，保持原值，不能把这些粗标签当作新的精确失败事实。`ferryFailures.reason === 'landing-defense'` 被重试恢复逻辑读取，因此这个值原样保留；本次变更的其他 reason 值均不参与选兵、任务阶段或下令。

## 诊断边界

`AiPlanTrace.executorReasons` 是本次 think 命中分支的输出，记录 executor、outcome、reason，以及可定位时的 taskId、目标 ID 和单位 ID。outcome 区分候选被拒、整个动作受阻、放弃和暂停；这些是执行器分支事实，不冒充正式 Assignment、HTN 子目标或死亡归因。

`beginExecutorReasons` 在规划入口安装收集器，嵌套任务继承它。记录复制到以根 memory 为键的外部 WeakMap，不写入 Game、memory、snapshot、存档或校验和；下一次 think 替换该帧。恢复中途 memory 后再次 think 会重新产生事实；未重新 think 时不会展示伪造的历史分支证据。读出也复制，调用方不能修改已有证据。

审计只允许剔除以下诊断叶，逐 think 对剩余完整 JSON 字节比较，不使用泛化的“删除所有 reason”规则：

```text
landExpansion.reason
naval.conquests[task].reason
naval.ferryDecisions[boat].reason
naval.ferryDecisions[boat].lastBlock.reason
naval.ferryFailures[boat][target].reason
naval.firstCombatDelivery.attempts[boat].reason
naval.firstCombatDelivery.firstMinuteBlock.reason
```

stage、claim、group、订单、计时、重试次数、`interruptions[].reason` 以及其余行为字段全部参与逐字节比较。测试专门锁住此白名单，修改重试、时间、阶段或中断原因都会导致比较失败。

`ferryFailures.reason === 'landing-defense'` 还有控制含义，因此没有只依赖剔除 reason 后的比较：`verify-reason-controls.py` 从两边完整 reason 序列重新投影这个谓词，逐次核对全部 43,200 次 think，结果完全一致。详细哈希在 `reason-controls.json`；将 `landing-defense` 错改为其他值会被此检查拒绝。

## 11 图验证

模拟基线为 `9e90ebf273c47e3adc40df4ab2556b1694c7d6db`，候选为 `e18060eff5e8a237905ea93ad5a6980d7f26b4e0`。之后 rebase 到 #573 的 `ad84670a`，产生 `c692c3cf`；两候选的 `src` 与 `scripts` tree 完全一致，main 中间只有文档变化。

使用原 11 图 seed / 房间席位 / 版本配置，think 间隔 15 tick，A100 同机 8 workers。每局保存计划命令、实际命令、每次 think 的行为 memory 与 reason 叶、分支诊断、初末 snapshot。世界检查点包含初始、每 1200 tick 和终点的 snapshot SHA-256、canonical SHA-256 与 checksum；这些序列也逐字节比较。不是胜率测试。

下表的 reason 变化数是“同一 owner 在某次 think 中，一个诊断叶不同”的数量，包含跨帧保留的相同原因；不能当成失败次数。每行四份序列及终点三项哈希均一致。

| 地图 | think 数 | 实际命令数 | reason 叶变化数 |
| --- | ---: | ---: | ---: |
| brokenSea | 4,800 | 5,461 | 2,986 |
| greystonePass | 2,400 | 5,443 | 2,230 |
| gullIsland | 2,400 | 7,186 | 2,196 |
| pineshade | 2,400 | 9,407 | 2,018 |
| reedwater | 2,400 | 9,752 | 2,147 |
| ringwater | 4,800 | 15,415 | 4,476 |
| sapphireArchipelago | 7,200 | 4,294 | 1,090 |
| templeSpring | 4,800 | 17,992 | 5,427 |
| turtleLake | 4,800 | 27,559 | 3,799 |
| twoShores | 4,800 | 17,138 | 3,880 |
| veiledHill | 2,400 | 9,910 | 1,940 |
| **合计** | **43,200** | **129,557** | **32,189** |

原始 memory 的哈希预期不同，未宣称原始 memory 全字节一致。全部变化分为 35 组，精确索引路径和逐帧证据保存在包内；下表仅将 task / boat 的具体 ID 折叠为字段族。

| 字段族 | 旧值 | 新值 | 叶变化数 |
| --- | --- | --- | ---: |
| `landExpansion` | 字段不存在 | `garrison-established` | 8,289 |
| `landExpansion` | 字段不存在 | `await-clearing-force` | 5,296 |
| `landExpansion` | 字段不存在 | `escorting-construction-site` | 4,381 |
| `landExpansion` | 字段不存在 | `building-hall` | 1,835 |
| `landExpansion` | 字段不存在 | `blocked:no-mining-screen-units` | 1,812 |
| `landExpansion` | 字段不存在 | `clearing-camp` | 1,418 |
| `landExpansion` | 字段不存在 | `paused:home-threat` | 1,362 |
| `landExpansion` | 字段不存在 | `await-garrison` | 1,076 |
| `landExpansion` | 字段不存在 | `paused:mining-threat` | 873 |
| `landExpansion` | 字段不存在 | `blocked:clearing-geometry-blocked` | 840 |
| `naval.ferryFailures` | `loading` | `no-loading-progress` | 829 |
| `naval.conquests` | `await-clearing-force` | `blocked:camp-retry-delay` | 751 |
| `naval.conquests` | `mine-occupied` | `enemy-mine-occupied` | 713 |
| `naval.ferryFailures` | `sailing` | `no-sailing-progress` | 555 |
| `naval.conquests` | `await-clearing-force` | `blocked:clearing-geometry-blocked` | 542 |
| `landExpansion` | 字段不存在 | `gathering-clearing-party` | 395 |
| `naval.conquests` | `landing-party-lost` | `no-landed-party-or-inbound-ferry` | 328 |
| `naval.conquests` | `reinforcing-beachhead` | `blocked:no-conquest-screen-units` | 323 |
| `landExpansion` | 字段不存在 | `paused:mine-threat` | 281 |
| `landExpansion` | 字段不存在 | `blocked:transport-reassignment` | 48 |
| `naval.conquests` | `mine-occupied` | `ally-mine-claim` | 46 |
| `naval.conquests` | `await-clearing-force` | `blocked:no-conquest-screen-units` | 44 |
| `landExpansion` | 字段不存在 | `blocked:camp-retry-delay` | 32 |
| `naval.conquests` | `clearing-camp` | `gathering-clearing-party` | 26 |
| `landExpansion` | 字段不存在 | `blocked:clearing-party-not-gathered` | 25 |
| `naval.conquests` | `await-clearing-force` | `blocked:enemy-force-at-camp` | 24 |
| `naval.conquests` | `await-clearing-force` | `blocked:no-clearing-units` | 18 |
| `naval.ferryDecisions` | `stalled:loading` | `stalled:no-loading-progress` | 12 |
| `landExpansion` | 字段不存在 | `blocked:enemy-force-at-clearing-party` | 3 |
| `naval.ferryDecisions` | `colony-unavailable` | `colony-plan-unavailable` | 3 |
| `landExpansion` | 字段不存在 | `blocked:enemy-force-at-camp` | 2 |
| `naval.conquests` | `landing-established` | `blocked:no-conquest-screen-units` | 2 |
| `naval.ferryDecisions` | `stalled:sailing` | `stalled:no-sailing-progress` | 2 |
| `naval.firstCombatDelivery.attempts` | `stalled:loading` | `stalled:no-loading-progress` | 2 |
| `naval.conquests` | `await-clearing-force` | `blocked:arrival-clearing-force-below-minimum` | 1 |

## 复现与检查

`scripts/ai-executor-reason-audit.ts` 接收不可变 source tree、case.json、输出目录和同一份 reason 白名单工具，两个版本使用同一个采集脚本。证据包内 `run.py`、`cases.json`、`compare.py` 保留完整运行和逐行比较方法；`reason-leaf-changes.jsonl.gz` 逐条记录每个 tick、owner、精确字段路径的旧值 / 新值（含字段不存在），`comparison.json` 提供完整哈希及分组结果。

根目录 `npx tsc --noEmit -p .` 通过。完整 `vitest run --dir src`：715 文件通过，7915 项通过、1 项跳过。原有清营 / 扩张 / 夺岛场景断言未修改。新增真实几何帧、缺兵反例、防守 claim 召回、外部诊断生命周期及严格 reason 白名单回归；原有 plan-stream round trip 保留新字段。

原始记录及运行配置见 [证据指针](./executor-reasons.evidence.json)。本次仅使失败原因可信；被阻断目标如何报价、如何补前置，仍由分配器 / HTN 阶段处理。
