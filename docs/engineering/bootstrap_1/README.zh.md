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

`frozen-policy.json` 保存共享策略依赖的 SHA-256 与获批修正记录；`frozen-traces.json` 保存当前引擎下旧三版、两种族的完整命令流及最终状态摘要。旧引擎的六组摘要留存在 `frozen-traces-engine-983fbb3.json`，其完整 1620 局控制组记录在 `baseline-engine-983fbb3.csv`；这些结果不能与新引擎的候选组混作胜负对照。

采矿修正统一基地所属矿的识别范围，并按实际人数迁移富余工人，保留原矿五人。兵种选择与战术表未改变，具体文件与前后 SHA-256 见 `approvedCorrections`。此后四个集成文件只加入新策略注入或版本注册；旧版本不传入新策略表。每次候选验证必须保持当前引擎下六组旧版轨迹及最终状态完全一致。

## 运行

```bash
node --import tsx scripts/bootstrap_1-freeze.ts
npx vitest run src/ai/bootstrap_1/benchmark.test.ts
node --import tsx scripts/bootstrap_1.ts --dry-run
node --import tsx scripts/bootstrap_1.ts --baseline --out .playtest/bootstrap_1/baseline.json
node --import tsx scripts/bootstrap_1.ts --out .playtest/bootstrap_1/full.json
node --import tsx scripts/bootstrap_1.ts --unseen --seed <held-out-seed> --out .playtest/bootstrap_1/unseen.json
```

定位一类对局可使用 `--maps`、`--subjects`、`--opponents`、`--race`、`--side`。每局完成立即保存完整报告；最终报告保留每局胜者、经济、伤亡与实际部队组成。元数据记录实际控制器和策略版本，以及 AI、SDK、模拟代码的 SHA-256，避免将未提交试验混作同一候选。任何一局未胜，运行退出码为 1。

`bootstrap_1` 分支上的 Actions 按模式、地图与家族分成 90 项任务执行两组完整矩阵。冻结控制组在基线改变时重新测量；之后候选迭代可以复用同一引擎下完成的控制组。先验证冻结，再运行对局，失败任务仍保存证据。尚未达到验收时不合并或部署为完成版本。

## 当前状态

工作进行中。采矿规则已合并，正在重新冻结和测量控制组。新策略尚未达标；完整测量和已否决方案见 `development.zh.md`。未达标前保持草稿 PR，不合并或部署为完成版本。
