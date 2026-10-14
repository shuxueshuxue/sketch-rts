# 0de mixed长尾的只读定位

现有raw可以把退化定位到World3D工作尖峰和真实GPU完成等待，**不能直接把它归因为SVD、小页、draw chunks或某个上传调用**。两边实际工作量一致，但native发生更多array初始化和compaction，值得新诊断验证；没有用已有累计计时伪造逐帧profile。

本次只读取最终0de的两份mixed raw、performance-summary及已通过的comparison，未启动browser/Canvas/benchmark/test/build，未改生产源码或历史raw。[analyze.mjs](analyze.mjs)生成[analysis.json](analysis.json)和[120个匹配CPU样本CSV](matched-cpu-samples.csv)。记录输入SHA256并在写结果前再次校验，原始文件全部不变。所读四个相关生产文件SHA均与测量时0de一致，用于解释计时语义；不是运行新代码。

## 逐样本拆解

两侧每个lifetime均60 CPU样本，原样本tick38..57，每tick三个连续now帧，合并两个lifetime共120。完整CPU总差308.4ms，对应mean42.12→44.69ms。World3D增加304.2ms，Canvas/协调残差仅4.2ms，World3D占总差98.64%。配对是同事实/时钟的描述性定位；原测量顺序执行，不能把它当随机化因果实验。

| CPU分组 | 样本数 | reference mean | native mean | 差值总量 | 占总差 |
| --- | ---: | ---: | ---: | ---: | ---: |
| phase0，新snapshot tick | 40 | 72.66ms | 76.10ms | +137.7ms | 44.65% |
| phase1，同tick第二帧 | 40 | 22.37ms | 23.02ms | +26.0ms | 8.43% |
| phase2，同tick第三帧 | 40 | 31.32ms | 34.94ms | +144.7ms | 46.92% |
| phase1+2合计 | 80 | 26.85ms | 28.98ms | +170.7ms | 55.35% |
| 双侧都≤16.67ms的样本 | 62 | 2.46ms | 2.60ms | +8.2ms | 2.66% |
| 任一侧>50ms的样本 | 45 | 99.51ms | 105.01ms | +247.2ms | 80.16% |

后两行是按实际耗时选择的描述性切片，不能用它们估计独立SVD成本上界。phase2是真实存在的CPU重复tick第三帧，并非新的simulation工作；其now仍推进16.67ms，动画/paint keys和资源准备可能变化。0de的residentMip也在每次draw的可见单位路径执行，并非只在fresh tick执行。因此，重复tick的大峰值不能当作“没有绘画/上传/SVD”的对照。

Tick53贡献+91.0ms、tick50 +59.5ms、tick46 +38.9ms、tick38 +35.9ms、tick40 +35.2ms；这些是两life×三帧的事实匹配差值。Tick45的大峰值两侧都有，整体反而−26.9ms；不能把最高峰单独当作candidate新增问题。完整20tick和所有正负配对见analysis.json。

代表性正差：

| life /index /tick /phase | reference CPU | native CPU | 差值 |
| --- | ---: | ---: | ---: |
| 1 /45 /53 /0 | 41.7ms | 82.9ms | +41.2ms |
| 0 /47 /53 /2 | 97.3ms | 132.9ms | +35.6ms |
| 0 /8 /40 /2 | 106.7ms | 140.3ms | +33.6ms |
| 1 /38 /50 /2 | 99.1ms | 127.4ms | +28.3ms |

Native p95=132.9ms来自这些重复帧尖峰附近；reference p95=115.3ms。源事实相同不代表每帧同步方法耗时已经知道。原始测量没有逐样本rasterStages/uploader/chunk快照，无法给表中某行指派具体方法。

## 已有raster与上传计数

以下合并两个lifetime的累计计时，覆盖**18 real准备+60 CPU warmup+60 measured CPU+12 real**，与120个measured CPU样本范围不同。不能把累计总量除120当measured per-frame，不能从它们相减求SVD“剩余成本”。

| 累计计时 | reference | native | 差值 |
| --- | ---: | ---: | ---: |
| rasterWorkWallMs | 13,517.2ms | 13,753.8ms | +236.6ms |
| paintMs | 866.4ms | 902.5ms | +36.1ms |
| readbackMs | 8,741.7ms | 8,836.4ms | +94.7ms |
| cacheMs | 1,760.1ms | 1,736.8ms | −23.3ms |
| pickMaskMs | 1,412.1ms | 1,421.2ms | +9.1ms |
| rowFlipMs | 279.5ms | 285.1ms | +5.6ms |
| slotMs | 184.9ms | 238.0ms | +53.1ms |
| gpuTransferSubmissionWallMs | 2,591.6ms | 2,631.8ms | +40.2ms |

0de代码中rasterWork计时结束于slot之后、uploadLayer之前；uploader提交成本另计，不能混为readback。readback占rasterWork约64%，远大于paint。它是getImageData同步调用耗时，包含Canvas deferred执行/flush及像素复制；不能直接称为PCIe GPU下载。已有结果只能说明同步像素取得是重要路径。

两侧合并计数完全相同：3452 rasterizations、3146 CPU raster misses、306 hits；scratch总上传1,305,434,320B，初始full6,062,080B，partial1,299,372,240B，partial uploads3448，unchanged0、full fallback0。因此不能声称退化来自更多源绘画、更多dirty上传字节、更多fallback或不同CPU cache命中量。

RLE行为也相同：每life backoff1、bypass3778、evictions832，末帧entries0/bytes0。它揭示mixed cache在此lifetime已有背压/清空，但不是native独有因素，也无法从末帧计数确定backoff恰好发生在哪个CPU样本。

Native差异：mipInitializedPages28→58，gpuCompactionLayers8→14、compaction copy calls80→134；提交mip copy calls34,520→34,146、bytes7,187,034,224→6,624,899,184，传输字节减少却发生更多array初始化/compaction。末帧pages10→14、chunks61→70、真实render calls124→142。**页周转/host布局是可信待查疑点，尚不是已测出的首要原因。**计数是全lifetime，未分配到尾帧；slot累计增加53.1ms也不能直接认领measured CPU的308.4ms差值。

## 真实帧中的等待

24个real samples对应n480..491、tick160..163；与CPU phase2(n116..173中的第三帧)完全分开。这一组保留原n173→480的cold-stream跳变。

Real wall总差+313.9ms，其中submit +3.8ms、fence wait +310.1ms，剩余数值误差近0；约98.8%的差表现为draw提交之后等待完成。clientWaitSync自身累计调用成本反而−0.8ms，不能靠减少轮询调用开销解释GPU等待。等待同时包含GPU工作与event-loop scheduling，没有GPU timer query，因此不能进一步把310.1ms精确归给fragment shading、array初始化或driver。

| real分组 | wall差总量 | submit差总量 | fence wait差总量 |
| --- | ---: | ---: | ---: |
| 全24帧 | +313.9ms | +3.8ms | +310.1ms |
| 两life各首cold-stream帧 | +69.0ms | −21.1ms | +90.0ms |
| 其余22帧 | +244.9ms | +24.9ms | +220.1ms |
| real phase0（新snapshot） | +235.5ms | −1.0ms | +236.4ms |
| real phase1 | −17.7ms | +1.8ms | −19.4ms |
| real phase2 | +96.1ms | +3.0ms | +93.1ms |

不能把首cold-stream当全部退化：其余22帧也增加等待。CPU路径的renderer.render明确是空实现，所以**实际GPU draw calls增多不能直接解释被关闭的CPU rendering成本**；但CPU侧chunks/buffers/material准备仍在执行，并且源raster、GPU copy/mip命令仍提交，可能被driver backpressure阻塞。已有数据没有测到这些方法的逐帧exclusive time。

## 可检验的因果边界

1. 已确定：主要新增CPU时间在World3D，集中工作尖峰；Canvas/协调残差很小；没有新增源绘画量/dirty字节/cache miss量。真实额外wall主要出现在提交后的完成等待。
2. 尚未确定：residentMip/SVD每帧成本、slot与draw chunk组装exclusive成本、uploadLayer阻塞位置、readback究竟是自身Canvas执行还是跨任务/driver延迟。更多array初始化/compaction给出排查方向，但不证明主因。
3. 后续诊断需保留原60CPU/12real时钟和首cold-stream，记录测量边界前后计数、逐样本实际cache/slot/array-init/chunk与方法耗时。各方法计时可能嵌套，不能盲目相加；观察器成本必须明确，新profile只能作诊断，不能拿其比值替代已完成的0de正式结果。

本报告没有提前选择或修改优化，也没有执行下一性能窗口。
