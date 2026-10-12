# 导航失败同环境归因：981 → 9de

2026-10-11，未修改导航生产代码、测试或阈值，未覆盖任何既有日志。本次只覆盖 **4 项导航失败**；原整合报告的另外 2 项是 AI 佣兵集结，不属于这组导航复跑。

结论：这 4 项全部在原冻结 `9819046b3820c9f843f0d57beaa198e7970fd5a7` 重现，在当前 `9de6820` 仍以相同的首个断言和实值失败。针对这四个观察点，没有发现本次美术/单位迁移引入的新失败。它们仍是未满足的契约，本归因不等于修复，也不表示后续被首个失败阻断的断言已通过。

## 环境和命令

两次串行运行于同一机器、Node、Vitest 2.1.9，基线 node_modules 符号链接至当前工作树同一依赖目录。环境版本、完整提交号和路径见 [environment.json](environment.json)。基线开始 12:35:23 UTC，用时 6.01s；当前开始 12:35:34 UTC，用时 5.12s。这里的时间只是测试运行时间，不是渲染/模拟性能测量。

两边命令参数相同（仅输出文件路径不同）：

```bash
npx vitest run src/shared/ship-maneuver-recovery.test.ts src/shared/ship-voyage-quality.test.ts src/shared/ship-voyage.test.ts \
  -t 'starts a forward recovery when traffic permits|brings six incoming friendly batteries|backs less than one hull length|marks a zero-margin reference' \
  --reporter=default --reporter=json --outputFile=<本次独立结果文件>
```

两边都是 3 文件失败，4 测试失败、82 未选择，退出码 1。没有运行这 82 项，不能把它们列为通过。

## 精确失败比较

| 精确测试名 | 断言位置及要求 | 冻结 981 实值 | 当前 9de 实值 | 分类 |
| --- | --- | --- | --- | --- |
| starts a forward recovery when traffic permits an on-the-spot turn but blocks a sailing circle | ship-maneuver-recovery.test.ts:140；reference.points 长度应为 1 | 2 | 2 | 基线已有、当前仍未满足 |
| brings six incoming friendly batteries into distinct usable stations around one stopped heavy hull | ship-voyage-quality.test.ts:132；75 秒内未开火舰艇列表应为空 | [unit-player-warship-1006] | [unit-player-warship-1006] | 基线已有、当前仍未满足 |
| backs less than one hull length into an aligned berth without two U-turns | ship-voyage.test.ts:90；首航点沿其 heading 的相对前进投影应大于 0 | 0 | 0 | 基线已有、当前仍未满足 |
| marks a zero-margin reference for exact control instead of smoothing through it | ship-voyage.test.ts:109；所有航点 exact 应为 true | false | false | 基线已有、当前仍未满足 |

原始证据：[981 日志](baseline-981-tests.log)、[981 JSON](baseline-981-tests.json)、[9de 日志](current-9de-tests.log)、[9de JSON](current-9de-tests.json)。机器逐项比较见 [comparison.json](comparison.json)：失败名称新增/消失均为空，每项首个 AssertionError 消息相同。

## 源码归属与 #320

[source-attribution.json](source-attribution.json) 列出 70 个 ship/naval/sailing/terrain/det-math 相关源码和测试的双侧 Git blob；全部相同。三项失败测试文件也完全相同，不存在本次放松或修改验收标准。

共享 sim.ts 与 catalog.ts 确有本次集成改动，完整差异保存在 [sim-and-catalog.diff](sim-and-catalog.diff)，不能笼统说整个模拟代码未变：catalog 改为共享单位与种族生产关系，sim 的相关变更是训练/研究入口及战斗表现事实数据。上述四个测试不使用施法单位、训练、研究或 AI 策略。其中三个在规划阶段即失败，舰队测试通过真实 stepGame/射击运行后失败。

[981 船参数](baseline-981-ship-rules.json) 和 [9de 船参数](current-9de-ship-rules.json) 对照 transport、warship、shipOfTheLine 的全部规则，排除从 UnitDef 移出的生产来源字段 trainedAt/race 后完全相同，包括 HP、速度、半径、射程、冷却和武器。三种船正是这组复现用到的船种。

#320 原提交 `4df34db4007e435dc7268085ecc7868de85cefd8` 与已保留的对应提交 `a3e3d78c638518fb604deb602c7dfd2e34e5d55c` 的 stable patch-id 均为 `5282d50a4be9a15b0a0d9331384fce13e0ba314e`。后者是 9de 的祖先。该提交修改的四个文件，从该提交到 9de 仅 general.ts 的 isSummoner 判定删除已合并的旧名称，#320 的护卫施工条件、新增测试和文档未被覆盖；完整后续 diff 也保存在 source-attribution.json。这里确认的是补丁保留，不额外声称这次导航测试验证了 #320 的 AI 行为。

## 限制和后续

这次是精确失败复跑，不是导航全套通过证明；没有更改策略、规划器、阈值，也没有通过跳过失败制造绿色结果。对这四项现象已有同环境基线重现和同源代码证据，未找到本次引入的回归原因。若要修复既有导航缺陷，应另行授权对应导航车道处理，保留这些验收约束。
