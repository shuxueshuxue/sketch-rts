# 搜索判法工具：语义收敛、解题和切换

依据 [搜索实现约定 §6](goal-search-implementation.zh.md#6-验收与实施顺序) 和 32 于 2026-10-22 07:19 交付的第 1 步格式。
本工具只读显式观察投影，不导入规划器、allocator、ledger、SDK、Situation 或模拟器。
尚未接入新的正常 owner 观察入口；生产固定头到位后，再从同一次正常调用导出数据。
旧题原始结果、原 checker 和缺失的分配证据均不回写。

## 三项读数

1. **决策收敛**：开跑前固定 K、尾窗 N，默认 20 和 3。尾窗比较 `state + plan + ready`。
   稳定空计划、稳定失效计划可以“收敛”，但不能据此判解题。新发布事实随尾窗记录，不能把变化抹掉或临时移动尾窗。
2. **解题**：分别记录因果完整、非空有效计划首次出现，以及它首次有非空 ready 前沿的 think/tick。
   完整性必须由正常因果重放观察提供，非空 DAG 本身不证明目标已闭合。
   K20 通过还需原 checker 同帧通过；默认要求正常实际分配已被观察。
   `allocation: missing` 不用未来资本预计值补齐；`complete: null` 不猜完整。
   截止第 K 次仍须保留原 checker 已证的有效非空 ready；若曾 ready 后又丢成稳定空图/失效图，首次指标照报，解题仍失败。
   本工具不替代每题的原结构、SDK、安全和付款断言，也不将该指标称为动态执行成功。
3. **真实对局切换**：按 run、席位、目标分别跟踪有效选中计划，汇总每游戏分钟的切换数。
   ready 前沿变化不计换方案；无计划和失效分别报样本数、进入次数及原因。
   无计划/失效不清空上一个有效选择，避免 A → 无计划 → B 漏计切换；恢复到 A 计修复，不计换方案。
   缺失 think 显式报 observation gap，不插值成连续覆盖或逐 tick 在岗证明。

计划键为全局步骤选择、实际/条件 bindings、依赖拓扑的规范 JSON。
全局步骤键为 `goal-step:1:` 加 `[goalId, provider, kind, 按字段名排序的 grounding 二元组]`，不截断 hash。
grounding 只接受有限 JSON 原子；局部 `step-output` 改成指向全局步骤键的条件 output，不能生成真实 entityId。
本地重编号、数组枚举顺序、schedule epoch、相对/绝对时刻、版本和报价不进入比较键。
坐标若属于 grounding 选择本身，变化仍是方案变化；本工具不会任意剔除域字段。

## 输入

`scripts/planner-semantic-report.ts` 读 JSONL 或相同 JSONL 的 gzip，每行一个目标的观察：

```json
{"run":"frozen-run","seat":"planner","goalId":"island","think":1,"tick":15,"incumbent":null,"complete":null,"puzzleCheck":"unavailable","allocation":"missing"}
```

有计划时，`incumbent` 使用第 1 步格式：`goalId`、`steps`、`ready`、`condition`。
每个 step 包含 `id`、`selector: {provider, kind, grounding}`、`bindings`、`dependsOn`。
真实 incumbent 的 schedule/quote 等额外字段可以保留，判法忽略它们。
`condition` 为 `{state: "valid"}` 或 `{state: "invalid", step, reason}`；没有 incumbent 必须显式写 `null`。
不把漏导出或漏行当作 no-plan。不同 run/席位/目标分别判断，同组 think 和 tick 必须严格递增。

其余必传字段：

| 字段 | 可取值 | 出处 |
| --- | --- | --- |
| `complete` | `true / false / null` | 正常因果重放是否确认完整，未导出为 null |
| `puzzleCheck` | `passed / failed / unavailable` | 未改的原题 checker 同帧结果 |
| `allocation` | `observed / missing / not-required` | 同一次正常 allocator/ledger 的观察状态 |

可附 `reason` 和 `publications: [{key, revision}]`。切换/失效/恢复事件保留这些原值，不自行归因。
所有冷帧 1…K 都须保存；第 K+1 次的成功不能补进 K20。

## 运行

```sh
node --import tsx scripts/planner-semantic-report.ts \
  --input projection.jsonl.gz --out report.json --mode cold \
  --k 20 --tail 3 --start-tick 1 --ticks-per-minute 1200 \
  --require-allocation true
```

真实对局使用 `--mode live`，不套冷 K20 的通过/失败。时钟由开跑前的真实规则固定；当前原生为每秒 20 tick，故每分钟 1200 tick。
分钟区间为 `[startTick + m×1200, startTick + (m+1)×1200)`。
报告保存输入压缩/plain SHA、固定参数、尾窗完整语义键、首次完整/ready、原 checker、缺证和每分钟事件。
冷模式任一组收敛或解题未通过时 exit 1，输入格式/缺字段错误直接失败；不默默跳过坏记录。

仅测试判法合同：

```sh
node node_modules/vitest/vitest.mjs run scripts/goal-semantic-judgment.test.ts \
  --maxWorkers=1 --minWorkers=1
```

这些合同不运行 AI、SDK 或模拟；它们不是题库结果，也不是新的正式验收头。
