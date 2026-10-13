# `55d6b3b` 正式验证失败：缓存影响等深对象遮挡

后续正式 mixed 与真实战斗对照发现像素回退。因此 `55d6b3b` 尚未完成最终验收；31 步 held-camera QA 的零差异只描述该固定历史/视图覆盖，不能扩大为所有游戏历史。原 mixed-after、battle-after、comparison 及全部失败 captures 保持不动。

## mixed 的三像素

两次独立 lifetime 都在 battlefield 的同三个像素失败，empty 和 returned 则与 baseline 完全相同。RGBA 为：

| 坐标 | baseline | `55d6b3b` |
| --- | --- | --- |
| 278,157 | 65,51,43,255 | 67,57,56,255 |
| 279,157 | 88,62,52,255 | 80,64,60,255 |
| 280,157 | 108,71,59,255 | 77,59,51,255 |

该位置为第一组 idle 蛛后（unit index 11，305,255）的右腿与红龙（index 12，440,255）的左尾交叠。两个 actor 同 feetY 255、同 704 source 域，并均实际保留 N0。`mixed-pixel-diagnostic.json` 保留 CPU 精确解码结果。

独立 runtime observer 精确复现正式失败 PNG SHA，并观察到：

| 阶段 | 红龙 page | 蛛后 page | 主 pass 默认材质顺序 |
| --- | --- | --- | --- |
| battlefield | material 25 / mesh 29 / 704×704×14，index 0 | material 52 / mesh 38 / 704×704×8，index 0 | 红龙 → 蛛后 |
| returned | 重建 material 121 / mesh 65 / 704×704×16，index 0 | 同 material 52 / mesh 38 / 704×704×8，index 0 | 蛛后 → 红龙 |

因此这对 actor 的差异来自**不同 page 的材质生存期排序**，不是两者 mip 内容或同一 page 内 instance 排序变化。新旧 card buffer 中实例的 local orders 本身为 12 / 11；相机返回后红龙所在页重建，材质 ID 顺序翻转，遮挡恢复 baseline。

`mixed-order-observe/raw.json` 保存完整观察。`mixed-order-sort/raw.json` 通过独立 fixture 在正常 finish 后按 snapshot 单位顺序重排各 page 的实例矩阵、cardRect、cardLayer 和 IDs，并给 page 设置其最早单位 index 的 renderOrder。该**诊断 ablation**使 battlefield、empty、returned 原 PNG SHA 全部精确等于 baseline，直接验证遮挡绘序是病因。

## 此 ablation 不是通用修复

同一 runtime 排序在真实 guard/blood 场景中恢复了原失败的 frame 8，80 个模拟 snapshot SHA 仍全部相同；但是新引入 frame 4 的 **113 个真实 RGBA 像素差异**。frame 4 的原始 FFV1 解码 SHA `ac30f86a52d7c3afd6dc986fd6925f4e08791233f062316721c4a3177c00de36` 已与 archive 中的 frame 4 raw RGBA SHA 核对，排除视频压缩或 PNG 编码因素。

新差异约在 x237–262、y514–517，即同 feetY 825 的长枪兵 sword（520,825）长枪与 wounded footman（567,825）头部交叠。旧 baseline 的这部分遮挡也受 warm/pending 和材质创建顺序影响，不等同于统一 snapshot 顺序。`battle-order-sort/frame4-diagnostic.json` 保留每个差异像素；`battle-order-sort/comparison.json` 明确 PNG mismatch frame 4，模拟 mismatch 为空。

用最早单位 index 排整页不能保证不同 page 中所有单位的全局交错顺序，不能直接作为 production 修复。诊断脚本只修改浏览器测试中的临时 buffer/renderOrder，没有修改生产源码、模拟规则、原 facts 或 raw 失败证据。diagnostic timing 也不属于性能样本。

需要进一步建立不依赖 cache lifetime 的遮挡职责，并验证完整 mixed、80 帧战斗、first-return、晋升与 picking；不能接受容差来绕过这个问题。
