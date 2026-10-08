# bootstrap_1

目标：冻结 v5、v7、v8，新增 v9_archer、v9_summoner、v9_knight。每种新策略在每张正式地图上都必须战胜 v5、v7、v8、v5+v7、v5+v8、v7+v8、v5+v5、v7+v7、v8+v8。

## 验收规则

- 15 张正式地图 × 3 个新版本 × 9 组对手 × 2 种族 × 2 出生方向，每组共 1620 局；修正后的冻结控制组与候选组分别运行，总计 3240 局。对手共同组队，新版独自组队；每人正常 500 初始金币、一个基地、三个农民。
- 保留正式地图完整席位生成的地形、野怪、资源和据点；移除未使用席位的基地和单位。4/6/8 人图使用原出生位。两人图按用户确认的规则增加同侧第三个独立玩家，不重新生成地形，并保证两位队友各有最近的主矿。
- 逻辑 20 Hz，各 AI 每 15 个逻辑帧思考。最多 48000 帧；超时和失败都不计胜利。命令经过真实 SDK 模拟入口，策略不能获得额外金币、人口、伤害、视野或其他特殊规则。
- 小样本用于定位机制问题。正式矩阵全部胜利后，再用预先固定的未见种子生成同类地图做泛化验收；不能把总胜率代替逐地图逐对阵结果。
- 策略依据兵种、位置、部队与经济状态决策，不依据对手版本或地图名称写分支。

## 冻结

初始基线为 `1518a8529cd85c31e46864e18dc8f26dbd1693ed`；修正唯一获批旧版错误后，重新冻结在 `983fbb376101e98633432dabdbffca9680f68b38`（PR #193、#194）。`frozen-policy.json` 保存共享策略依赖的 SHA-256；`frozen-traces.json` 保存旧三版在两种族下的完整命令流摘要和模拟状态摘要。

用户已批准仅修正 `training-choice.ts` 中 workshop 的种族选择错误：Ember 选择 `catapult`，Grove 在第二阶选择 `ballista`，第三阶解锁后选择 `golem`，并重新冻结；修正前后 SHA-256 见 `approvedCorrections`。除这一点之外，旧版不改经济、部队和战术算法。四个集成文件只加入新的策略表、支援目标注入或版本注册；旧版本不传入新策略表。每次验证必须保持六组旧版轨迹和最终状态完全一致。

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

`bootstrap_1` 分支上的 Actions 按地图与新版本分成 45 项任务执行候选的完整矩阵；冻结控制组只需在基线改变时测量一次，本次由运行 37714494058 的 45 项控制任务执行；先验证冻结，再运行对局，失败的任务仍保存对局证据。尚未达到验收时不合并或部署为完成版本。

## 当前状态

工作进行中。类型检查与 34 项相关测试已通过，兵种选择修正后的六组冻结命令轨迹及最终状态保持一致。新策略尚未达标；完整测量和已否决方案见 `development.zh.md`。未达标前保持草稿 PR，不合并或部署为完成版本。
