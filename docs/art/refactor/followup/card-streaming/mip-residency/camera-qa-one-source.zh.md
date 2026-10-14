# 中间候选 one-source：画面通过，驻留内存仍回退

此报告归档 `3205988d8cce697bd6e3b2cd493a728bb33ba728`。它加入单一 source 的 mip 晋升和逐像素相同的 idle key 共享，修复前一版同 source 多 tier 共驻问题。该版本仍因稀疏数组页的驻留开销而被列为中间候选，不是最终验收结果；allocation 修复后须重跑相同 31 步 camera QA。

[本候选原始报告](camera-after-one-source/proof.json) 与 [严格比较](camera-comparison-one-source.json) 对应的完整原 PNG 编码字节保存在[精确归档](../../png-archives/README.md)。原链 baseline 为 [camera-before/proof.json](camera-before/proof.json)，source `2a0d3a27608c9e56ca8de6949759c975ee06c1d9`。前一版 `62b2b1b` 的 [多档共驻报告](camera-qa-coexisting.zh.md)、原始 proof 和 comparison 均继续独立保留，baseline 没有改写。

31 个相机步骤再次全部通过：原生 actors 和三层 composite 的 decoded RGBA 零差异，原始 WebGL drawing-buffer RGBA/透明 alpha/阴影 alpha 全部相同，production picking、snapshot facts、固定 now 均相同。相机返回及 high → low → high 晋升的首帧、repeat 帧相同，每步 GL error 为 0。DPR 2 使用实际 CDP DPR 和原生 2560×1440 / 1280×720 backing pixels，没有缩图或容差。脚本、fixture 的 SHA 与 saved baseline 完全相同。

## 相机序列的实际资源

以下是 draw 完成后 card system 的程序 owned GPU MiB，包含仍驻留的 warm cards、数组分配和 scratch。它们不表示驱动实际 VRAM 或进程内存，也不是渲染耗时。

| 相机步骤 | 请求 gate N0 / N1 | 原链 baseline | 旧多档共驻 `62b2b1b` | one-source `3205988` |
| --- | ---: | ---: | ---: | ---: |
| DPR 1、1280×720、zoom 0.35 | 95 / 5 | 52.545 | 56.398 | 56.398 |
| DPR 1、1280×720、zoom 0.65 | 80 / 20 | 200.852 | 213.232 | 213.232 |
| DPR 1、1280×720、zoom 0.75 | 90 / 10 | 200.852 | 213.232 | 213.232 |
| DPR 1、1280×720、zoom 1 | 100 / 0 | 200.852 | 196.852 | 196.852 |
| DPR 2、1280×720、zoom 0.75 | 100 / 0 | 200.852 | 200.852 | 200.852 |
| 最后的 camera-battlefield | 90 / 10 | 210.185 | 225.602 | 220.268 |
| camera-empty | 0 / 0 | 65.520 | 65.520 | 35.270 |
| camera-returned-first | 90 / 10 | 211.519 | 222.602 | 190.477 |
| promotion-high-initial | 72 / 0 | 210.185 | 210.185 | 175.061 |
| promotion-low | 90 / 10 | 210.185 | 225.602 | **246.809** |
| promotion-high-first / repeat | 72 / 0 | 210.185 | 210.185 | 175.061 |

requested gate 不等于实际驻留 histogram。single-source 策略可继续使用已存在的更精细链；低 zoom 请求 N1 时不能直接宣称当前 card 一定只保留 N1。此冻结 fixture 没有逐 card 的 actual-base histogram，报告以真实 `allocatedMipBytes` / `ownedGpuBytes` / pages / card counts 衡量实际驻留。原有高 DPR、小窗口 shadow 的 N0 需求继续保留，不能为节约内存取消这些画面限制。

promotion-low 时 one-source cards 为 97（baseline 99、旧候选 108），而 pages 为 10（baseline 7、旧候选 9）。此时已不是简单的多 tier 重复 card；少量不同尺寸卡片和 warm fine cards 的数组页分配仍可能增加总驻留量。下一步 allocation fix 必须以本不利序列验收，不能只选择有利的 ending-high 数据。

| 整条 31 步序列 | 原链 baseline | 旧多档共驻 | one-source |
| --- | ---: | ---: | ---: |
| draw 后 owned GPU 最大 MiB | 211.519 | 225.602 | **246.809** |
| tracked transient GPU peak MiB | 264.064 | 261.542 | 261.542 |
| draw 后 owned CPU 最大 MiB | 55.725 | 57.033 | 56.484 |
| tracked transient CPU peak MiB | 59.300 | 59.446 | 59.444 |
| ending owned GPU MiB | 210.185 | 210.185 | 175.061 |
| ending owned CPU MiB | 55.725 | 55.666 | 55.400 |
| ending actual array mip allocation MiB | 206.331 | 206.331 | 171.207 |
| ending cards | 99 | 98 | 91 |
| cumulative layer transfers | 1,536 | 1,592 | 1,541 |
| cumulative mip copies | 14,964 | 15,405 | 14,923 |

最后 one-source source-RGBA CPU cache entries 458、misses 700、hits 841、evictions 242、owned bytes 50,850,072。这些改变也包含 idle 相同 key 共享，不能只归因于 mip 晋升。结束 GPU 值下降与整个序列最大值上升同时存在；本报告保留两者，不宣称整体资源问题已经解决。

[one-source 全景原图](camera-after-one-source/dpr-1-1280x720-zoom-0p75-composite.png) 已与 baseline 逐通道证明完全相同。详细方法、真实 blood/动画覆盖及限制见 [旧候选的方法说明](camera-qa-coexisting.zh.md)。当前只证明本软件 GPU 和该测试输入下的视觉、alpha、picking 与事实一致性；正式性能与真实战斗验证由独立窗口完成。
