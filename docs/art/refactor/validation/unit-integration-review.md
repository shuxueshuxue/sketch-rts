# 规则 2 整合验证

2026-10-11，独占性能采样已结束后运行。完整首轮结果保留，不覆盖失败证据。

- `npx vitest run --reporter=default --reporter=json --outputFile=docs/art/refactor/validation/unit-integration-tests.json`：537 文件中 528 通过、9 失败；5195 项中 5183 通过、12 失败；228.50 秒，退出码 1。
- `npm run build:production`：TypeScript、Vite（401 模块）和服务端 bundle 均完成，退出码 0。Vite 仍提示部分 chunk 大于 500 kB；没有因此调整告警阈值。
- 日志：`unit-integration-tests.log`、`unit-integration-tests.json`、`unit-integration-failures.json`、`unit-production-build.log`。

## 首轮新增集成问题（6 项）

| 文件 | 观察与归属 |
| --- | --- |
| ai/policy.test.ts | 旧 Ember 治疗单位购买预算固定 130，合并后仍要求购买共享 priest；由主线程审查机械预算迁移，不改 AI 策略。 |
| ai/policy/humanized-combat.test.ts | 旧两行改名后，同一 priest/summoner 留有两套历史射程断言，2 项失败；由主线程审查 canonical 规则对应测试数据。 |
| shared/aiming.test.ts | 治疗单位仍期望旧 HP 78，现共享 priest 90；由主线程审查合并后的规则断言。存档恢复另有不治疗验证。 |
| sdk/package-boundaries.test.ts | animation 注释和测试变量命中了既有禁止命名；交 animation 机械改名。 |
| scripts/painted-sprite-bounds.test.ts | lancer/attack/0/-1 报 4 个边界像素；需核对旧固定 tile 尺寸与实际混合尺寸绘制，交美术车道定位。 |

## 与规则 1 基线逐项比较（6 项仍未通过）

四项导航失败的测试名称、断言和观察值与基线对应：原地恢复路径点数 2（要求 1）、六舰一艘未开火（unit-player-warship-1006）、正向投影 0（要求大于 0）、exact 标志 false（要求 true）。本任务未修改这些导航测试、阈值或导航生产模块。这里记录重复失败，不能称为验收通过。

佣兵集结两项名称/断言相同，但规则 2 数值改变后轨迹并不相同：

| planner / v9_archer / ember | 规则 1 基线末位佣兵位置 | 本轮规则 2 末位佣兵位置 |
| --- | --- | --- |
| mirror=false | (772.9914, 541.8564) | (881.5050, 565.2190) |
| mirror=true | (3433.9036, 626.9800) | (3334.4157, 659.7495) |

两轮都是 gold=19、paid=320，并在既有集结范围断言失败。单位 ID/招募顺序也改变。本轮证据不能支持“AI 结果完全不变”；未修改策略或放宽阈值，交主线程保留规则变化影响的说明。

## 指定新增路径

本轮 targetKind 存档迁移、混合 crop tile/source texel 世界位置、world-layer 卡片实例、unit-facing、action-direction、release-socket、projectile-origins、recorder 全部通过。CPU 集成测试模拟 GPU renderer，不能将其当成真实 GPU 性能或浏览器视觉验收。

## 定向修复后续

主线程已安排责任车道复测，不重复全套：catalog 车道修复预算和历史数值的重复 fixture，68 项通过，日志 `unit-fixture-followup.log`；rig 车道将旧固定 128 边界检查改为真实 128/160 绘制域，同时补外围像素检查，4 项通过。没有放宽边界阈值、AI 或导航标准。

`unit-integration-followup.log` 是收到主线程去重指示后中止的冗余合并复测（退出 130），不能作为完整通过证据；部分测试虽已输出通过，最终结论以责任车道完整日志为准。animation 命名修复后边界 7 项通过，日志 `animation-boundaries-final.log`；动作 27、朝向 11、recorder 6 共 44 项通过，日志 `animation-final-targeted.log`。

结论：首轮新增的 6 项集成失败已经修复并由各责任车道定向复测通过；6 项已有验收契约仍未通过，其中佣兵两项在新规则下轨迹改变。未将中断复测当成通过或新增失败，也未重跑全套来覆盖首次证据。当前不宣称整个仓库全绿。
