# cda746b4：题3冷启动适配层合同缺口

**原K20冷检查0/1，结构稳定；原Vitest exit1。** 第6次think起实际规划输出有ready，末帧12原子计划为ready，但公共checker需要的实际allocation为null，因此公开首通过/首可执行think仍为null。不能用“已ready”改记通过。

固定生产`cda746b4a8ae52c4f4233fedfc2bbde589dc2489`，独立实际源码`1b8103c5dabad721f0f62905f61c0837d70aec1c`。此源码在独立分支接原公开测试；生产差异为0，场景/世界/6144/原checker/结构判法未改。主PR报告线仍基于d888，未将cda未来船生产改动混入题1。[原597冷帧失败](navy-zero-59792793-cold.zh.md)另存：597是没有未来船候选、0动作/ready；本轮已有完整未来船链，失败类别为冷适配层未导出真实分配，两者不合并。

| 记录 | 第1次think | 第20次think |
| --- | --- | --- |
| 计划状态 | waiting-facts | ready |
| 选中原子 | 12 | 12 |
| ready原子种类 | 无 | build、assemble |
| search work/expansions/depth | 807/807/5 | 818/818/5 |
| search limitReason | null | null |
| FactWork总量 | 5491/6144 | 818/6144 |
| 原公共失败 | actual allocation trace…null | 同第1次 |

20次完整保留，最大6144、合计40656，各次services求和一致；搜索与几何/场服务分列在[原逐think账本](navy-zero-cda746b4-cold.validation.json)。19次失败消息为`actual allocation trace, not a hand-authored amount: expected null not to be null`；另1次为`army transport before camp: predecessor: expected 0 to be greater than 0`，未删除中间图失败。末三次结构稳定不免除资本合同。

末帧动作顺序是船厂build→运输船train→assemble→position-transport→transport-force→assemble→clear-camp→position-transport→transport-worker→大厅build→assemble→hold-position。存在计划依赖不代表未来船已生产、已获真实grant或已执行；本轮没有原生建造、训练、海上spawn、运输或付款结果。

## 精确适配层缺口

冷入口只调用planGoals及正常事实scope，未经过正常allocator/ledger。以下位置均指实际固定源码1b，不是后续WIP：

- [goal-planner-native.ts:16](https://github.com/shuxueshuxue/sketch-rts/blob/1b8103c5dabad721f0f62905f61c0837d70aec1c/src/ai/strategy/puzzles/goal-planner-native.ts#L16)的withInput只进入withGoalPlannerInput；该模块导出createExecution，未导出allocation。
- [planner-binding.ts:59](https://github.com/shuxueshuxue/sketch-rts/blob/1b8103c5dabad721f0f62905f61c0837d70aec1c/src/ai/strategy/puzzles/planner-binding.ts#L59)以可选导出读取allocation，实际为undefined。
- [frozen-planning.ts:70](https://github.com/shuxueshuxue/sketch-rts/blob/1b8103c5dabad721f0f62905f61c0837d70aec1c/src/ai/strategy/puzzles/frozen-planning.ts#L70)传入`publicPuzzlePlanner.allocation?.(input, output) ?? null`，本轮checker得到null。
- [planner-checks.ts:101](https://github.com/shuxueshuxue/sketch-rts/blob/1b8103c5dabad721f0f62905f61c0837d70aec1c/src/ai/strategy/puzzles/planner-checks.ts#L101)要求真实allocation，且大厅400预算必须和实际objective/method/action/generation联接；不能拿goalPlanCapital的未来估值或手写金额顶替。

准确代码片段、Git blob/SHA及本轮原输出已交32。按184安排，26到此停止：不改checker、不往生产接分配、不跑动态。32先完成缓存配方/97f席位门槛，之后从正常生产分配口补只读冷观察投影；新固定头和该投影都交付后，再按原判法重跑K20。

## 覆盖与封存

原6项中，三个场景构造/几何准入/native scope合同通过，K20失败，执行和人工解两项过滤未跑。没有runtime目录、SDK应用或动态模拟。正常collector、目标、收益、未来事实均未手填。源码准备预检root/tools-ai/tools-cli tsc均exit0、SDK7/7；不把预检或32的通用收敛闸算公开题通过。

原snapshot tick=1、JSON.stringify共19535B，SHA`8d29faf796809089ee8856f34f49a2c613ed7f04eeaed2c7c549a4a65bf38103`，与597同题原snapshot逐字相同，20次输入均未改。[身份核验](navy-zero-cda746b4-cold.snapshot-identity.json)。同步时沿用的Git auto-GC缺历史ancestor警告已保留；当前固定源码clean、生产diff0、类型与边界检查通过，没有修写历史或删除日志。

完整证据SHA`67048e71e6169d7b97cef9aafd8f078af3f1ee07c68217774f00e683cf978bc2`，8689588B，存储端字节/SHA已核。[指针](navy-zero-cda746b4-cold.evidence.json)包含原20次完整scope/output/memory/账本、原exit1与native测试报告、首末/逐轮原始分析、适配层源码片段和预检。原冷gzip SHA`ea50bfa5930de1e2213cc42a3aa7c5bdcfe3f0eef814b46f3dcc5867197560c3`。[紧凑结论](navy-zero-cda746b4-cold.summary.json)、[原命令](navy-zero-cda746b4-cold.commands.json)、[原测试结果](navy-zero-cda746b4-cold.native-tests.json)。
