# bootstrap_1

目标：冻结 v5、v7、v8，新增 v9_archer、v9_summoner、v9_knight。每种新策略在每张正式地图上都必须战胜 v5、v7、v8、v5+v7、v5+v8、v7+v8、v5+v5、v7+v7、v8+v8。

## 验收规则

- 15 张正式地图 × 3 个新版本 × 9 组对手 × 2 种族 × 2 出生方向，每组共 1620 局；修正后的冻结控制组与候选组分别运行，总计 3240 局。对手共同组队，新版独自组队；每人正常 500 初始金币、一个基地、三个农民。
- 保留正式地图完整席位生成的地形、野怪、资源和据点；移除未使用席位的基地和单位。4/6/8 人图使用原出生位。两人图按用户确认的规则增加同侧第三个独立玩家，不重新生成地形，并保证两位队友各有最近的主矿。
- 逻辑 20 Hz，各 AI 每 15 个逻辑帧思考。最多 48000 帧；超时和失败都不计胜利。命令经过真实 SDK 模拟入口，策略不能获得额外金币、人口、伤害、视野或其他特殊规则。
- 小样本用于定位机制问题。正式矩阵全部胜利后，再用预先固定的未见种子生成同类地图做泛化验收；不能把总胜率代替逐地图逐对阵结果。
- 策略依据兵种、位置、部队与经济状态决策，不依据对手版本或地图名称写分支。

## 冻结

初始基线为 `1518a8529cd85c31e46864e18dc8f26dbd1693ed`；用户批准修正 workshop 的种族选择错误后，冻结于 `983fbb376101e98633432dabdbffca9680f68b38`（PR #193、#194）。之后用户要求实际运输采矿、基地与矿的最小距离，以及相应 AI 调整；PR #195 将公共规则更新于 `58cac102b5bc04578e76533a89df18c27efe3082`，此次重新冻结并重测控制组和候选组。

`frozen-policy.json` 保存共享策略依赖的 SHA-256 与获批修正记录；`frozen-traces.json` 保存 `58cac10` 引擎下旧三版、两种族的完整命令流及最终状态摘要。更早引擎的六组摘要留存在 `frozen-traces-engine-983fbb3.json`，其完整 1620 局控制组记录在 `baseline-engine-983fbb3.csv`；不同引擎的结果不能混作胜负对照。

采矿修正统一基地所属矿的识别范围，并按实际人数迁移富余工人，保留原矿五人。兵种选择与战术表未改变，具体文件与前后 SHA-256 见 `approvedCorrections`。

上游 PR #197 于 `dce756f903aeb3e89485267f47d631d107c2d449` 引入老兵技能、统一伤害和机械单位规则，也修改了公共 AI。验收对手仍冻结于 `58cac10`：`bootstrap_1-planner.ts` 从该提交导出原始源码，在临时目录编译一次并执行历史策略；当前生产 AI 继续接收上游修改。控制组和候选组都由当前 SDK 和模拟引擎推进，只更换旧版本的命令规划器。策略依赖检查针对这份固定源码，历史轨迹检查也在其原始引擎上执行；当前引擎的胜负须另行验收，不能要求两个规则不同的引擎产生相同状态摘要。

PR #198 的风帆与八分钟风变规则已于 `09be683` 合入，公共施工突袭时间修复 PR #201 已于 `1ba7abf` 合入。候选已同步这两项；新的开局与局部存档由当前引擎生成。正式验收须重新取得同一引擎的控制／候选证据，不能将此前航行引擎的测量混入。

## 运行

```bash
node --import tsx scripts/bootstrap_1-freeze.ts
npx vitest run src/ai/bootstrap_1/benchmark.test.ts
node --import tsx scripts/bootstrap_1.ts --dry-run
node --import tsx scripts/bootstrap_1.ts --baseline --out .playtest/bootstrap_1/baseline.json
node --import tsx scripts/bootstrap_1.ts --out .playtest/bootstrap_1/full.json
node --import tsx scripts/bootstrap_1.ts --unseen --seed <held-out-seed> --out .playtest/bootstrap_1/unseen.json
```

定位一类对局可使用 `--maps`、`--subjects`、`--opponents`、`--race`、`--side`。每局完成立即保存完整报告；最终报告保留每局胜者、经济、伤亡与实际部队组成。元数据记录当前提交、固定旧策略提交、实际控制器和策略版本，以及 AI、SDK、模拟代码的 SHA-256，避免将未提交试验混作同一候选。候选任何一局未胜，运行退出码为 1。运行需要仓库中存在固定旧提交，Actions 因此检出完整 Git 历史。

日常迭代以手操观察、复盘与局部模拟为主，不随开发提交启动完整矩阵。`bootstrap_1-inspect.ts` 默认只推进五分钟，保存实际购买命令和每三十秒的独立状态，`--ticks` 可进一步缩短；`--frames` 输出真实模拟状态供画面观察。`--resume <上一段观察.json>` 同时恢复保存的世界和策略记忆，继续观察下一段；与原段使用相同的地图、家族、对手、种族和方向参数，并为新段指定不同的 `--out`。观察记录不计作完整胜负验收。

```bash
node --import tsx scripts/bootstrap_1-inspect.ts --map grandEstuary --subject v9_archer --opponents v8 --race grove --side 1 --ticks 3600 --frames --out /tmp/bootstrap_1-opening.json
```

完整矩阵只在明确请求验收时运行：提交 `docs/engineering/bootstrap_1/acceptance-request.json` 的改动触发 Actions。PR #197 改变公共引擎，下一次验收按地图、家族和控制／候选角色执行 90 项任务，重新获得同一引擎的两组证据；该引擎控制组完成后，同引擎的日常候选迭代可复用控制证据。先验证冻结，再运行对局，失败任务仍保存证据。尚未达到验收时不合并或部署为完成版本。

## 当前状态

工作进行中。`58cac10` 引擎的冻结控制组全部 1620 局完成，无缺失；记录见 `baseline-engine-58cac10.csv`。同引擎、提交 `7d31b5c` 的候选完成 1618 局，602 胜、743 负、273 超时，另有 2 局因任务超时缺失；逐格记录见 `candidate-7d31b5c-engine-58cac10.csv`。包含 PR #197、#198 的当前引擎尚未重跑完整矩阵；这些旧成绩不能作为当前候选成绩。候选仍未达标，最终 holdout 种子仍未使用。完整测量和已否决方案见 `development.zh.md`；PR #192 保持草稿。
