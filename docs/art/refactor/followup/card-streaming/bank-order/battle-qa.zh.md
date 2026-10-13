# 同 source 联合配置：真实战斗 80 帧通过

本页的 `.gz` 数据链接保存原始输入的完整字节；解压恢复与校验方式见[归档说明](../../release-readiness/README.md)。

生产 source `e02b24ef8de3c96cec111a1178a7daf697fc8378`，同一已修复的稳定绘序，reference 为 **1 bank + full original mip chain**，candidate 为 **8 banks + native gate**。配置在 `World3DLayer.create` 后、prepare / first draw 前设置；两侧 paint、source RGBA、几何、原密度策略、shadow 和模拟完全相同。

[reference](battle-before/proof.json)、[candidate](battle-after/proof.json) 与 [严格比较](battle-comparison.json.gz) 已完成：

- 原 guard/blood 场景执行 **160 真实 simulation ticks、80 captures**；两侧 **80 个实际 PNG 文件字节 SHA 完全相同**，足以证明 decoded RGBA 零差异，没有图像容差或 MP4 比较。
- 两侧 **80 个 simulation snapshot SHA 全部相同**。source/client/helper/harness/upstream 与 normalized fact-program SHA 核对一致；唯一差异是显式 bank/mip variant。
- 两侧 self-validation 均通过：真实命中的身体和武器沾血、退步与 idle 预备持械、方向一致及 guard 到期覆盖保留；GL error 为 0。
- 早期 frame 1 / tick 2 的原相机仍有 **30 个真实 airborne droplets**。相机移开时 tracker 仍有 30，而 GPU 提交 0 / cull 30；回视口后重新提交 32（30 airborne + 2 body）。两侧同 clock 的 original / empty / returned PNG SHA 相同，返回图与原图相同，模拟 hash 不变。

两侧全部 80 PNG 的原编码字节保存在[精确归档](../../png-archives/README.md)，选定关键帧仍在原路径直接浏览；可恢复全部原图重跑比较。MP4 仅作观看副本，不参与严格比较。该证明是图像与模拟正确性验证，其捕获/编码时序**不是正式性能样本**。正式帧时间、资源变化及卡顿由独立的唯一性能窗口完成。

oracle 是同 source 的 **corrected-order reference**，不是旧 cache-dependent 遮挡。旧 `55d6b3b` 的战斗 frame 8 失败以及 min-page ablation 新增 frame 4 的失败证据继续独立保留；这里不声称新稳定绘序与旧版 80 帧完全相同。新的 3 个 merc 不在这个 guard/blood 场景中，其实际雇佣流程使用独立 proof，不能从本报告扩大覆盖范围。
