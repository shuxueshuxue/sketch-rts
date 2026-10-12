# 佣兵控制两项失败归因

2026-10-11；相同容器、Node/Vitest、测试命令，未运行 AI benchmark。生产代码、冻结 AI 策略、阈值、测试军队数量及正式测试截止均未修改。

## 结论

这两项属于**981 已有的 2400 tick 集结截止失败，叠加共享治疗单位涨价造成的可测延迟**。不是共享生产关系或机械改名引入的新失败断言；也不能称为合并对 AI 结果没有影响。新规则第二次雇佣晚 30 tick（1.5 秒），截止时距离更远。这里没有足够理由放宽原验收标准或自动改 fixture：它测试正常经济规划下的集结及时性，不是精确预算购买一个指定单位的目录测试。两项仍未通过，若要修复及时性需要父线程另行决定策略/验收范围。

## 原样复现

运行 `npx vitest run src/ai/bootstrap_1/mercenary-control.test.ts`：

| 版本 | 原样结果 | 非镜像第二佣兵距家 | 镜像第二佣兵距家 |
| --- | --- | --- | --- |
| 原基线 9819046 | 22 通过 / 2 失败 | 276.182 | 205.911 |
| 主树 9de6820 | 22 通过 / 2 失败 | 387.039 | 306.507 |
| units 8727533 | 22 通过 / 2 失败 | 387.039 | 306.507 |

主树 9de 已包含共享单位目录，不能把它当旧数值对照。三个原始日志分别为 `baseline-981-original.log`、`main-9de-original.log`、`rules2-original.log`。两失败均为 v9_archer / Ember / planner 的两种镜像，原断言要求第 2400 tick 所有佣兵距家不超过 180。所有版本均花费 320 招募两名佣兵、仅派 scout 一个信使、最终 gold=19。

## 隔离双向数值对照

`isolate-and-trace.py` 用 `git archive` 将明确的 9819046 / 9de6820 源码复制到 `/tmp/mercenary-isolated`，共享同一个 node_modules；仅在临时测试文件中注入数值和观测。生产源码、仓库中的正式测试均不改动。完整测试仪器 diff、日志、逐 15 tick 规划命令、金币、佣兵位置、所有出生单位和最终状态均保存在此目录。

- 9de-oldstats：共享 priest/summoner 恢复对应旧 Ember 单位的全部不同标量；保留新 canonical 名称、共享能力、生产关系与所有新代码。
- 981-newstats：旧 emberAcolyte/pyreCaller 改用共享 priest/summoner 标量；保留旧名称、能力、生产关系与所有旧代码。
- 比较时仅归一化四个旧名称（包括 ID 中的 kind）：emberAcolyte→priest、pyreCaller→summoner、emberMend→heal、cinderSoul→summon。没有归一化坐标、数字 ID 后缀、金币、时间或命令顺序。

两种镜像中，**9de-oldstats 与 981、981-newstats 与 9de 的全部 160 次规划命令、金币观测、佣兵轨迹采样以及最终诊断均相等**，见 `comparison.json`、带 assert 的 `analyze.py` 与 `comparison.log`。这比“同样失败”更强，排除了本用例中目录关系/机械接口适配带来的额外轨迹差异；不外推到其他场景。

实际本场景没有训练 summoner：两次治疗单位、两次 ashWarden、两次佣兵构成相关购买序列。能力定义在旧版就是相同 behavior/数值，此处不改能力。

## 将原因缩小到价格

保持 9de 其余全部新数值，只在隔离测试中分别恢复 priest 的旧 cost 或 trainTime：

| 临时变体 | 第二次雇佣 tick（两镜像相同） | 截止距离 非镜像 / 镜像 |
| --- | --- | --- |
| 981 原值 | 1980 | 276.182 / 205.911 |
| 9de 原值 | 2010 | 387.039 / 306.507 |
| 9de 仅 cost 135→130 | 1980 | 276.182 / 205.911 |
| 9de 仅 trainTime 185→175 | 2010 | 387.039 / 306.507 |
| 9de cost + trainTime 均恢复 | 1980 | 276.182 / 205.911 |

规划在 tick 0、1530 各购买一名治疗单位。共享价格使累计支出增加 10；tick 1980 旧规则 gold=169、新规则 gold=159，而佣兵价格为 160，因此新规则等到 tick 2010、gold=169 才雇佣。首次雇佣始终是 tick 735。

第一处分歧在 tick 180：旧规则金币 215，安排 workshop 建造及已出生治疗单位后移；新规则金币 210 且治疗单位还在训练，等到 195 才下发对应命令。这不是仅由训练时间解释的差异。恢复训练时间只能改变出生/ID及微小碰撞轨迹，不能恢复第二次雇佣时刻；恢复价格则足以恢复末位佣兵在正式截止时的精确坐标。首名佣兵镜像坐标仍有微小差异，只有全标量恢复才使全部轨迹相等。

## 截止失败还是无法返回

额外诊断只在临时测试副本将观察时长延长到 3000 tick，正常运行同一个 planner/simulation，不改 tick 速度、180 范围或任何策略。981 和 9de 的两个用例在这个延长诊断中均完成原其余断言。不能把它作为正式 2400 tick 验收通过。

第二佣兵首次被 15 tick 采样观测到进入 180 范围：981 非镜像 2430、镜像 2415；9de 非镜像 2460、镜像 2445。实际进入发生在上一个采样与本次采样之间，不能将这些采样点宣称为逐 tick 精确到达时间。结果支持迟到而非持续卡死，并显示新规则增加 30 tick 的延迟。

## Fixture 与生产边审计

`fixture-migration.patch` 保存 981→9de 正式测试差异：只变更 import、v9_summoner 的 kind 选择及 trainedAt→trainingBuildingFor 查询；两组各 6 个单位的循环、7 farms、scout、500 初始金币、佣兵 cost=160/stock=2/cooldown=16秒、2400 tick、每15 tick规划、180集结范围均未改。

本次失败使用 v9_archer，初始军队是 6 sparkArcher，查询结果仍为 cinderSpire；不存在删除重复数组导致的军队缩水。`production-mercenary.patch` 为空：mercenary-control.ts、mercenary-goals.ts、policy/mercenary-model.ts 在两个版本间无修改。原来 Ember 医师和现在共享 priest 都在 cinderSpire 合法生产；两者训练请求均真实进入模拟。全数值双向对照进一步验证此用例相关生产/研究 API 机械适配没有产生额外命令差异。

## 重现

在当前工作区执行：

```sh
python docs/art/refactor/followup/mercenary/isolate-and-trace.py
python docs/art/refactor/followup/mercenary/isolate-variants.py
python docs/art/refactor/followup/mercenary/analyze.py
```

脚本需要记录中的三个本地 worktree、Git 9819046/9de6820 及现有 node_modules。`*-instrumented.log` / `*-old-*.log` 保留原有断言失败；`*-extended.log` 是明确标记的延长诊断。所有失败原始证据均保留，没有覆盖完整首轮验收日志。
