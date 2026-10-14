# 冻结5b mixed同步路径诊断

本次profile已能定位具体同步热点：CPU总退化主要来自 **getImageData/Canvas flush所在的readback段**，不是SVD、draw段或slot方法。大峰值有两类：n135/tick45在一次公开renderer.copyTextureToTexture内长时间阻塞；重复tick第三帧则主要在Canvas像素取得。recordPeaks/stats是可测的、适合移除的热路径开销，但约1.5–1.85ms/frame，不能宣称它独自解决100–500ms长尾。

这是冻结 `5b356c7795068bb2a532ad1d486b3c22936cf735`、同源1full/1native、相同原mixed时钟的**诊断**。包裹函数的performance.now/聚合和row采集会扰动运行，以下比值不能替代0de formal，也不能作为d48 peak优化的验收；后续不加profiler的同源ABBA负责验证。旧[0de只读报告](../bank-order/latency-investigation/report.md)保留。

## 匹配与计时层级

匹配两侧全部120 CPU-sample rows，按life/index、原n114..173、tick38..57、source snapshot SHA核对；CPU renderer.render必须是fixture空实现。不能把World.draw +cards.finish +raster +upload直接相加，因为逐层嵌套。

在冻结调用树中，World包含gate、cards.finish、remains.finish及其他姿态工作；finish包含raster/compact/draw/remove；raster/compact含uploader/recordPeaks，slot含createPage，host draw含createChunk/resizeChunk，GL init/copy在uploader中。readback、paint、cache、mask、rowFlip是现有互不重叠的raster段。`rasterStages.slotMs`还包住slot之后的recordPeaks，不能再与这两个方法相加。

[profile-analysis.mjs](profile-analysis.mjs)已运行完成，生成[profile-analysis.json](profile-analysis.json)与[matched-profile-cpu.csv](matched-profile-cpu.csv)。两侧全部120个CPU row的原n/tick和snapshot SHA一致，输入hash未变；每row不重叠叶子和严格等于World total。它不会添加原测量没有的stack事件或GC信息。

## measured CPU具体热点

以下120样本汇总，inclusive表示该方法含其子调用，不表示相加预算。完整CPU mean为41.87→46.20ms；World profile总量4981.5→5495.3ms，完整CPU总差518.8ms。虽然方向与0de相似，profile增量不同，不能移用为正式改进率。

| 同步方法/段 | full mean/frame | native mean/frame | 两侧总差 |
| --- | ---: | ---: | ---: |
| World.draw inclusive | 41.51ms | 45.79ms | +513.8ms |
| cards.finish inclusive | 40.60ms | 44.70ms | +491.5ms |
| cards.raster inclusive | 40.37ms | 44.43ms | +487.5ms |
| readback段（disjoint） | 20.71ms | 23.74ms | +363.6ms |
| paint段（disjoint） | 1.73ms | 1.98ms | +29.4ms |
| cache段（disjoint） | 3.17ms | 3.38ms | +26.2ms |
| pickMask段（disjoint） | 3.49ms | 3.69ms | +24.3ms |
| rowFlip段（disjoint） | 0.69ms | 0.70ms | +1.9ms |
| recordPeaks/stats（disjoint） | 1.51ms | 1.85ms | +39.7ms |
| uploadLayer inclusive | 8.92ms | 8.95ms | +4.1ms |
| renderer.copy inclusive（在upload内部） | 5.31ms | 5.08ms | −27.1ms |
| renderer.initTexture（在upload内部） | 0 | 0.0067ms | +0.8ms |
| slot方法inclusive | 0.040ms | 0.038ms | −0.2ms |
| host draw inclusive | 0.173ms | 0.182ms | +1.1ms |
| compact inclusive | 0.037ms | 0.058ms | +2.5ms |
| residentMip gate inclusive | 0.0167ms | 0.1175ms | +12.1ms |

readback增加363.6ms，约占完整CPU增量70.1%；recordPeaks差39.7ms约7.7%，gate差约2.3%。Draw/compact/slot非常小。Native末帧更多draw calls是实际GPU渲染/资源结构差异，**不是此CPU no-op rendering测量的主因**。

将upload+copyLayers拆开，GL init/copy总量636.7→610.4ms；uploader剩余同步CPU约433.5→464.0ms，包括dirty比较/CPU buffer工作、校验与其他transfer状态工作，不能全部叫GPU时间。没有日志记录每次copy的源/目标类别和level，因此不能把其最大阻塞精确命名为scratch mip生成或array mip copy。

## 两种峰值与重复帧

Full life0 n135/tick45：World507.0ms、raster505.7、upload308.2，renderer.copy总286.6ms，其中**单次281.8ms**；readback122.0、recordPeaks8.0、gate0、host draw0.4。Full life1同帧单次copy233.0ms。Native同帧两life World479.1/474.4ms，单次copy243.4/230.7ms。这个共同的大峰值已经定位到CPU线程进入公开copy方法之后的同步等待/工作；没有GPU timer或调用类型日志，不能进一步断言driver内部原因。

Native life0 n116/tick38/phase2：World196.9ms、readback143.2ms，upload13.8、GL copy3.9、recordPeaks5.4、gate0.1、host draw0.1。Native life1 n158/tick52/phase2：World176.0ms、readback121.3ms，upload19.0、GL copy4.6、recordPeaks7.0、gate0、host draw0.1。Full n158两life World151.7/148.1ms，也由readback103.6/101.1ms主导。

这些phase2属于CPU同snapshot第三帧，now仍推进，实际重绘/上传会继续。它们**不是real n480起始cold-stream**，也不是新增simulation。getImageData段包括Canvas绘画的deferred执行、同步flush及像素复制；`willReadFrequently:true`已经在源代码中，不能再把“加这个flag”当未实现修复，更不能声称全部是PCIe读回。

## stats/分配是否重要

Measured CPU共有recordPeaks full2988次/native2990次，累计181.7/221.4ms，占完整CPU约3.6%/4.0%。每次真实raster在pendingRGBA、slot后、upload后记录峰值，故每frame多次。冻结源recordPeaks调用完整stats，stats扫描pages/chunks、构造数组/对象并反复取得cache/uploader统计；这是为了观测而支付的生产热路径成本。

它是**已实测重要的小额持续成本**，优化其访问范围有意义。但profile没有allocation profiler或GC trace，不能量化其中“大分配”字节、认领某个GC停顿，或把n116的143ms readback/281ms copy阻塞全部算给stats。最大recordPeaks单次为3.5/4.5ms，热点帧记录总量约5–11ms；即使全部消除，也有明确收益上限。

优化应直接维护峰值所需标量/轻量storage计数，保持pendingRGBA、mask、scratch、cache以及retiringGPU页面的原计数语义；不要减少实际内容或删掉内存峰值。之后同源原算法/生产算法ABBA，除了time，还要核对全部owned/peak计数、像素、facts和样本时钟。不能通过低报峰值制造资源改善。

## 下一修复优先级

1. 先完成已授权的peak热路径精简及不带profiler的ABBA：它有可测开销、职责明确、容易保持视觉和模拟不变。预期是减少持续CPU/分配负担，不能预告解决全部长尾。
2. 接着调查真实readback峰：按逐样本raster count/源尺寸/cache hit与getImageData段对齐，再定位具体资产/pose是否重复生成相同原始RGBA。优先消除可证明的重复工作，保留源绘画尺寸、完整RGBA（含alpha0的RGB）和原GPU mip链；不靠跳帧、降画质或减少可见对象。
3. 对n135 copy阻塞，下一诊断只记录公开API的source/destination类别、dirty矩形和source/dest level及单次耗时，以区分CPU→scratch含generateMipmap与scratch→array/compaction。不要因CPU同步耗时长就擅自改mip规则；若要归因driver/GPU，需独立受控且保留冷暖时钟的验证。
4. 暂不把重点放在SVD/matrix memo或draw段重写：已测gate约0.1ms增量/帧、host draw约0.009ms增量/帧，收益不足以解释主问题；改变它们还可能干扰安全LOD许可或正确遮挡顺序。

该profile定位了主要同步位置和可检验修复路径；最终因果仍需单变量正式验证。原5b raw保持不变，0de formal及原e02失败证据仍保留。
