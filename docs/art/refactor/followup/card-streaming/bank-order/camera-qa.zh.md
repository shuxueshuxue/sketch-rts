# 最终 source 的稳定绘序相机对照

本页的 `.gz` 数据链接保存原始输入的完整字节；解压恢复与校验方式见[归档说明](../../release-readiness/README.md)。

同一生产 source `e02b24ef8de3c96cec111a1178a7daf697fc8378`，reference 为 **1 bank + full mip chain**，candidate 为 **8 banks + native residency gate**。两侧都使用已修复的稳定绘序、同一 paint/cache/完整几何/原密度策略和实际 2048px 阴影。配置只在 `World3DLayer.create` 后、prepare / first draw 前改变 cached bank 数和 reference mip override，没有每帧额外 pose/key 观察器。

[严格比较](camera-comparison.json) 的 **31 步全部通过**：原生 actors 和三层 composite 每个 decoded RGBA 通道相同；原始 WebGL drawing-buffer RGBA（包括透明区 RGB、alpha 和实际阴影 alpha）、production picking、snapshot facts、固定 now 也全部相同，GL error 为 0。相机返回第一帧、high → low → high 晋升第一帧和 repeat 均相同。每步 posed 数一致，不用减少可见内容换取资源变化。source/client/helper/harness/underlying fact fixture SHA 全部核对相同，实际 setup 记录 cached bank 数为 1 / 8，prepare 前 pages/chunks 为 0。

原始 [reference](camera-before/proof.json.gz)、[candidate](camera-after/proof.json.gz) 保留全部输入脚本；所有原 PNG 编码字节保存在[精确归档](../../png-archives/README.md)，选定图可直接浏览。DPR 2 通过真实 CDP 设置，原生图为 2560×1440 / 1280×720，没有降低 retina 分辨率。

这个 oracle 是同 source 的 **corrected-order reference**，不是旧 `2a0` 或 `55` 的 cache-dependent 遮挡。旧 mixed/battle 失败记录和排序诊断继续保存；稳定绘序修复会有意改变旧的缓存相关遮挡，不能声称与旧 80 帧全部零差异。此相机 fixture 固定 20 种 / 100 单位，**不含新 3 个 merc 单位**；merc 的实际雇佣验证由独立证据覆盖。

## 实际资源：有利与不利数据均保留

[每步摘要](camera-memory-summary.json) 分开记录 texture owned GPU / array mip allocation / scratch、owned CPU、drawBufferBytes、drawChunks / pooledDrawChunks、draw calls 和 requested mip gate。它是正确性 probe 的资源计数，不是帧时间或硬件 FPS 实测。owned GPU 此处为程序持有的纹理分配，**不包含 draw-buffer/geometry 的 GPU 分配，也不等于驱动 VRAM 或进程内存**；buffer 字节单独报告。

| 整条 31 步序列 | 1-bank full reference | 8-bank native candidate |
| --- | ---: | ---: |
| draw 后最大 owned GPU texture MiB | 186.623 | 186.623 |
| tracked transient GPU texture peak MiB | 243.798 | 233.277 |
| ending owned GPU texture MiB | 181.290 | 162.019 |
| draw 后最大 owned CPU MiB | 55.671 | 56.218 |
| tracked transient CPU peak MiB | 59.356 | 59.356 |
| 最大 drawBufferBytes | 48,296 | 23,088 |

11 步 texture owned GPU 下降，19 步相同，**1 步仍回退**：DPR 1、640×360、zoom 0.35，reference **46.654 → candidate 61.779 MiB**，增加 **15.125 MiB**。该步 owned CPU 为 50.242 → 52.477 MiB。它发生在 warm camera 资源序列中，不能以最大值相同或 ending 值下降掩盖这项开销。

部分关键步骤（MiB，draw 完成后的实际 counters）：

| 步骤 | reference GPU texture | candidate GPU texture | reference chunks / calls | candidate chunks / calls |
| --- | ---: | ---: | ---: | ---: |
| DPR 1 full、zoom 0.35 | 62.654 | 59.861 | 31 / 65 | 2 / 7 |
| DPR 1 full、zoom 0.65 | 186.623 | 162.941 | 38 / 79 | 2 / 7 |
| DPR 1 full、zoom 0.75 | 186.623 | 183.399 | 38 / 79 | 3 / 9 |
| DPR 1 small、zoom 0.35 | 46.654 | **61.779** | 31 / 65 | 1 / 5 |
| DPR 2 full、zoom 0.75 | 186.623 | 186.623 | 32 / 67 | 1 / 5 |
| camera-battlefield | 186.623 | 182.842 | 40 / 83 | 1 / 5 |
| camera-returned-first | 186.623 | 175.837 | 39 / 81 | 2 / 7 |
| promotion-low | 186.623 | 184.732 | 39 / 81 | 2 / 7 |
| promotion-high-first / repeat | 181.290 | 162.019 | 30 / 58 | 1 / 4 |

requested N0/N1 gate 不是 actual resident histogram：候选可继续使用更精细的已有链，高 DPR 和小窗口 shadow 需要时也必须保持 N0。因此不从 gate 数量直接计算“省显存比例”。本轮同时改变 bank 与 mip 配置，不能把联合差值拆称为某一个组件的独立贡献。chunk/call 减少也不能直接推导 FPS 或帧时间；正式时序由独立窗口完成。

[reference 全景](camera-before/dpr-1-1280x720-zoom-0p75-composite.png) 与 [candidate 全景](camera-after/dpr-1-1280x720-zoom-0p75-composite.png) 严格逐通道相同。完整 31 步原图、raw GL / alpha 和 picking 均有对应比较记录，未以低分辨率拼图代替。
