# 真实全域 RGBA 的拾取遮罩微诊断

在这份实际稀疏语料上，`wordSkip` 的 Chrome 遮罩 CPU 均值低于原实现，36 个逐资产均值都下降，支持继续验证最小生产候选。**这不是游戏帧时间结果，也没有证明密集输入、所有资产或所有浏览器都会加速。** Node 有两次同轮慢样本，全部保留。

[原始 result.json](result.json)、[实际运行 harness](harness.mjs)、[浏览器 fixture](fixture.mjs)、[共享计时协议](matrix.mjs)、[原型](prototype.mjs)与[原参考 source](source-card-pick-mask.ts)保持原样。本报告只读取原结果，不覆写这些已记录 SHA 的文件。[原始 corpus](../canvas-attribution/corpus-manifest.json)来自冻结 `d48fb3d95d248db91b9237f0dcb290e736f6a75b` 的真实生产 getImageData，详见[Canvas 来源报告](../canvas-attribution/report.md)。

语料展开副本可由 [逐字节恢复 manifest](../canvas-attribution/evidence-archive.json)恢复。重跑前若 `corpus/*.rgba.bin` 缺失，在仓库根执行 `python3 scripts/art-card-latency-evidence-archive.py --materialize --folder canvas-attribution`，再使用本目录原 harness；原 helper/result/manifest 字节与路径不改。恢复和 hash 也应在独占测量窗口之外执行，详见[归档说明](../evidence-archives/README.md)。

## 输入与方法

- 36 个实际 Canvas miss：n116/n135/n158 分别 8/20/8；29 个 512²、7 个 704²，完整 RGBA8 共 **44,285,952 B（42.234375 MiB）**。没有裁边、缩小、重画或抽样替换。
- 实际覆盖 15/20 种代表资产；未捕获 stonebackBrute、siegeRam、ballista、catapult、organGun，不扩大为整个美术资产覆盖。原语料的 alpha0 非零 RGB 数为 0；透明彩色像素由合成语义矩阵覆盖，不能算真实语料额外覆盖。
- Node 与前端分别核验完整 bin、manifest 和实际执行 helper 的 SHA；前端时序后重新核验全部 RGBA，原数据未改。corpus SHA 为 `517712befef761868d7e4376d78faf6788d3ea3cbef27cffe03ecc6c4567b710`，原参考 mask source SHA 为 `c591b3b25b060342296b1ff3983494f3172d52707ea4a439e7531341f927a4ee`。
- Chrome 实际版本 **151.0.7922.173 / V8 15.1.206.23**；Node **24.19.0 / V8 13.6.233.17-node.51**。浏览器禁 GPU/WebGL，Canvas/OffscreenCanvas getContext 拦截记录为空；浏览器退出确认后才串行运行 Node。没有画笔、读回、上传、GPU completion 或模拟成本。
- 每组八轮，各实现轮换起点并正反排序，每个位置两次。每资产每轮六次调用：同一完整 top-down RGBA、两种 flip 参数、重复三次；aggregate 每轮 216 次。输入、调用和输出 ring 完全相同，分配新 mask 及廉价 sink 在计时内，SHA、比较、分类和统一 task yield 在计时外。
- 每个 engine 的合成语义矩阵 **136 cases / 1,365 比较 / 2,032,650 UV 检查**通过；实际 corpus 两 flip 共 288 函数比较，其中 72 是 reference 自比、216 是三个候选对 reference，均精确一致。非 LE 是探针回退测试，非真实 BE 硬件验证。
- 全部首轮、慢样本和自然 GC 保留，无丢弃 warmup。首轮发生在语义验证之后，函数可能已 JIT 预热，不能称为真正编译器或冷游戏首帧。两 flip 参数的计时使用相同 top-down 源，并非真实翻行后的缓存恢复 buffer；恢复等价性在语义矩阵中另查。

## 总体与分组结果

下表是每轮 batch 的 ms；括号为 wordSkip / reference 比值。每个 asset 等权，不是战场人口或实际 miss 频率权重。Node 与 Chrome 各自在自己的 engine 内比较。

| Engine / group | reference mean | byteSkip mean | words mean | wordSkip mean | wordSkip 比值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chrome aggregate / 216 calls | 128.625 | 106.800 | 84.400 | **48.800** | **0.3794** |
| Chrome sparse / 216 calls | 122.338 | 103.488 | 77.000 | **50.400** | **0.4120** |
| Node aggregate / 216 calls | 118.656 | 108.135 | 77.376 | **48.181** | **0.4061** |
| Node sparse / 216 calls | 112.936 | 102.461 | 71.760 | **47.066** | **0.4168** |

Chrome aggregate 为 **0.59549 → 0.22593 ms/mask（−62.06%）**，Node 为 **0.54933 → 0.22306（−59.39%）**。这些是微循环结果，不能直接换算游戏 FPS。synthetic Node 的 byteSkip 曾慢于参考，而实际语料改善；不能把一种输入上的结论当作统一策略依据。

36 个输入的全零 alpha 八像素块比例为 **74.1241%～96.5958%**。固定 cutoff .5 下 sparse 包含全部 36 个输入，**dense 为空且明确 skipped**。aggregate 与 sparse 是相同输入的两次运行，不能视为两个独立资产覆盖或声称验证了真实密集域。zero-alpha、alpha≥102 和透明 RGB 计数分别保留在 raw；空拾取 mask 不等于存在可跳过的零 alpha 块。

| Engine / aggregate | reference first | wordSkip first | reference max | wordSkip max |
| --- | ---: | ---: | ---: | ---: |
| Chrome | 128.100 | 47.500 | 158.500 | 56.900 |
| Node | 109.259 | 47.496 | 145.227 | 56.947 |

每个组只有八个 batch 样本，经验 p95 就是 max，不能建立稳定硬件尾分位。Chrome aggregate wordSkip 八个原样本为 **47.5、56.9、52.3、48.2、46.1、46.4、46.3、46.7 ms**，没有移除首轮或较慢轮。

## 逐资产均值

单位 ms/mask，每行是该资产八轮的等权均值。实际 SHA、key、n、alpha coverage、每轮位置、首轮与全部时序在 raw，数值展示精度不代表独立硬件计时精度。

| id / 实际资产 | source | 零 alpha 块 % | Chrome reference → wordSkip | Node reference → wordSkip |
| --- | ---: | ---: | ---: | ---: |
| 0 footman n116 | 512 | 91.962 | .4771 → .1688 | .4225 → .1750 |
| 1 lancer n116 | 512 | 93.558 | .4792 → .1771 | .4365 → .1728 |
| 2 priest n116 | 512 | 91.748 | .4750 → .1833 | .4324 → .2204 |
| 3 knight n116 | 512 | 84.814 | .4938 → .1896 | .4263 → .1906 |
| 4 golem n116 | 512 | 80.768 | .4813 → .2000 | .4364 → .1893 |
| 5 rubbleGolem n116 | 512 | 87.775 | .5438 → .1854 | .4297 → .1830 |
| 6 graniteGolem n116 | 512 | 74.173 | .4875 → .2104 | .4310 → .1962 |
| 7 ogreWarrior n116 | 512 | 85.883 | .4708 → .1958 | .4232 → .1807 |
| 8 footman n135 | 512 | 92.123 | .4750 → .1750 | .4217 → .1893 |
| 9 lancer n135 | 512 | 93.591 | .4667 → .1708 | .4321 → .1710 |
| 10 priest n135 | 512 | 91.885 | .4708 → .1729 | .4206 → .1707 |
| 11 knight n135 | 512 | 84.753 | .4750 → .1938 | .4282 → .1920 |
| 12 golem n135 | 512 | 80.707 | .4625 → .1958 | .4393 → .1927 |
| 13 rubbleGolem n135 | 512 | 87.704 | .4750 → .1792 | .4236 → .1831 |
| 14 graniteGolem n135 | 512 | 74.152 | .4625 → .2063 | .4274 → .2032 |
| 15 ogreWarrior n135 | 512 | 85.825 | .5208 → .1854 | .4317 → .1865 |
| 16 ogreMage n135 | 512 | 86.069 | .4604 → .1833 | .4357 → .1918 |
| 17 ogreLord n135 | 512 | 81.192 | .4563 → .1938 | .5119 → .1983 |
| 18 deepSnapper n135 | 512 | 86.984 | .4604 → .1875 | .4281 → .1798 |
| 19 spiderQueen n135 | 704 | 91.485 | .8771 → .3188 | .8024 → .3248 |
| 20 redDragon n135 | 704 | 83.758 | .8646 → .3479 | .8867 → .4348 |
| 21 ancientStag n135 | 704 | 93.185 | 1.0688 → .3250 | .8055 → .3258 |
| 22 tidePriest n135 | 512 | 87.509 | .5417 → .2083 | .4234 → .1783 |
| 23 footman n135 | 704 | 95.973 | .9729 → .3313 | .8213 → .3216 |
| 24 lancer n135 | 704 | 96.596 | .9750 → .3083 | .8953 → .3115 |
| 25 priest n135 | 704 | 95.640 | .9104 → .3146 | .9466 → .3474 |
| 26 knight n135 | 704 | 91.837 | .9792 → .3313 | .8172 → .3933 |
| 27 golem n135 | 512 | 80.759 | .5292 → .2021 | .4512 → .1943 |
| 28 footman n158 | 512 | 92.154 | .5021 → .1854 | .4285 → .1747 |
| 29 lancer n158 | 512 | 93.622 | .5375 → .2375 | .4278 → .1706 |
| 30 priest n158 | 512 | 91.864 | .4813 → .1771 | .5142 → .1739 |
| 31 knight n158 | 512 | 84.738 | .5063 → .2063 | .4619 → .1843 |
| 32 golem n158 | 512 | 80.704 | .5271 → .1979 | .4815 → .2080 |
| 33 rubbleGolem n158 | 512 | 87.689 | .4875 → .1938 | .4550 → .1826 |
| 34 graniteGolem n158 | 512 | 74.124 | .5417 → .2188 | .4626 → .2344 |
| 35 ogreWarrior n158 | 512 | 85.806 | .4854 → .1854 | .4300 → .1860 |

Chrome 36 个逐资产 mean 比值为 **.3041～.4459**，所有 first/max 均低于该资产参考，288 个同 round 比较没有 wordSkip 更慢的样本。Node mean 比值为 **.3382～.5096**，first 均较低，但不利尾样本如下；它们仍在均值和 max 中。

| 不利记录 | reference batch ms | wordSkip batch ms | 限制或说明 |
| --- | ---: | ---: | --- |
| Node priest n116 / round2 | 2.665020 | **3.308955（+24.16%）** | 该资产 reference max 2.830323，candidate max 3.308955，max/p95 **+16.91%** |
| Node redDragon n135 / round5 | 4.763489 | **6.159488（+29.31%）** | candidate max 6.159488 仍低于 reference max 9.009760 |
| Chrome knight n158 / first | 2.900 | 2.100 | 虽低于 reference，candidate 首轮是自身 p50 1.100 的 **1.91×**，不能称首轮没有额外成本 |

Node 同 round 更慢 **2/288**，不是所有样本都快。所有 batch 都是六个 mask，不将上表误报成单次 mask 或游戏帧卡顿。

## 分配与后续候选

每次 pack 仍分配新 mask。aggregate 每轮每实现累计输出 **8,303,616 B**；word view 共享输入字节，仍有 view 对象。完整 corpus 保持驻留，最终 ring 持有 **1,048,576 B**。这些容量不是总分配次数、整个 JS 堆、GPU 内存或进程峰值。

Chrome 非 GC backingStorageSize 前后 **44,740,353 → 83,307,429 B**；Node RSS **139,317,248 → 204,443,648 B**。它们跨完整矩阵、包含输出与诊断对象，不能归因到某个实现或声称内存下降。原 result 保留两 engine 的完整 heap/process 字段，不把 GC 后较小 heapUsed 代替峰值。

生产候选只修改 [card-pick-mask.ts](../../../../../../../src/client/world3d/card-pick-mask.ts) 与语义测试：LE、完整且四字节对齐的 view、每行八像素块使用 unsigned word 阈值与零 alpha 跳过；BE、短 view、未对齐 view 保留原字节访问；非八对齐宽度保留连续跨行位数组路径。NPOT176/352/704 仍可合法按八像素分组。阈值 102、full source、flip、透明 RGB 和端点定义不变，`cardMaskHit` 不改，不增加运行时策略选择。

该候选的工程验证、实际拾取/画面证明与同源 old-mask load-provider ABBA 另行保存。本微诊断不含 getImageData、Canvas deferred work、driver backpressure、cache、draw 或模拟，不能据此宣称修复原 100–500ms 长尾或提升整局 FPS。
