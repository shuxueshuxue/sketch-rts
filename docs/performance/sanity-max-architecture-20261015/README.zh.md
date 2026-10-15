# 独立 sanity：真正最大值与按需计算架构实验

**整局最大值降低10倍尚未实现；本轮组合候选淘汰，生产源码回退至281a75d0。** 未改写运行源码的8轮正式对照：whole mean +0.16%、CPU +1.22%、每轮max均值+14.84%，不值得保留净增42行和额外港口容器。稳定tick9659从52.76–69.71ms降到4.61–6.05ms，但这不能代替全局目标。实验源码38989112、全部差分、负结果和重构提案保留供复核。没有物理瓶颈结论。

最值得下一轮协调的结构问题有两处：nearestWalkable的环搜索反复扫描内部方框；陆地距离场为每个小岛目标保留整图数组，其中98.1%距离槽位不可达。具体源码、计数、最小未实施提案和语义边界见[下一架构边界](ARCHITECTURE-NEXT.zh.md)、[只读查询接口提案](QUERY-CONTRACT.zh.md)。terrain.ts与hullPassageClear继续由主车道拥有，本阶段没有再修改。

## 冻结对象与边界

- A：`281a75d0862246de8943cbf2b5aa31d8a82c08a5`，此前PR381的空traffic重试/私有job结果。
- P（已淘汰的实验源码）：`3898911213a3dbe9220e3da7a036cd61d84ce552`，仅四个运行模块变化，237个其他输入字节相同。完整diff在candidate.diff；最终PR不保留这组实现。
- 上游main再次核对为`4804631c22f7be3f83dc6374e71ce03d86068dd8`。主车道69e7786、bccc987c为未采用实验；本轮没有集成它们、没有合并两个车道收益。
- rulesVersion **3**，checksumVersion **18**；同机、同房间、同地图、同原始输入，5个既有AI和14400tick，模拟50ms/tick，AI间隔15tick。没有改规则、对手、预算、搜索频率、yield或完成tick。没有改独立rulesVersion2的AI分支。
- [上一阶段](../sanity-sync-retry-20261015/README.zh.md)的321重试tick已在其独立冻结对照中验收。本轮以281a为起点，不把其收益重复计入。

## 已淘汰候选实际改了什么

| 改动 | 为什么原工作不必做 | 净生产行数 |
|---|---|---:|
| 无外部traffic callback时，直接/arrival连接完成后才构建搜索grid和代价列表 | 简单连接根本不需要图；公开任意callback仍在原位置捕获图输入 | +7 |
| 港口按可证明的travel下界检查候选；仅可能胜出的静态合法候选才精确寻路/碰撞 | 原来对所有候选做静态sweep、steer和排名，最后只用一个 | +27 |
| 私有同步economy路径复用刚算出的shore；公开延迟issue仍重新查询 | 同一受控同步世界内readiness与issue原来重复完整岸位查询 | +8 |
| 合计 | 没有第二搜索算法或每job全图数组 | **+42** |

另加56行、9项港口测试。港口多出的clear/rank容器有维护与内存代价；统一Berth记录、删除两张Map及重复排名数组的提案净删3行，**未应用、未执行、未拿它的源码冒充本轮计时版本**。它只涉及维护成本，不是下一轮全局目标。

## 预先固定的原源码正式对照

`plain-plan.json`在该组运行前冻结。8次官方六人生产路径probe，顺序**APPAPAAP**，每次独立进程、14400tick；`--plain`完全禁止对运行模块插入任何scope/计时边界，不开inspector或强制GC，只在外层计whole并保留原命令frame捕获。原准入、AI、stepGame、route赋值、实时碰撞和全部复制/缓存miss照常执行。所有14400样本及全部max保留，CPU/RSS覆盖进程编译、预热、运行与输出。

| 指标（4轮均值） | A | P | P/A变化 |
|---|---:|---:|---:|
| whole mean ms | 3.67615 | 3.68186 | **+0.16%** |
| whole p99 ms | 28.94350 | 28.78353 | −0.55% |
| 进程user+system CPU s | 81.476 | 82.472 | **+1.22%** |
| 每轮max均值 ms | 95.845 | 110.065 | **+14.84%** |
| 每轮max范围 ms | 88.89–102.44 | 101.12–123.24 | 未改善 |
| whole >16ms tick数 | 697.50 | 699.75 | +0.32% |
| whole >50ms tick数 | 10.25 | 8.50 | −17.07% |
| 冷tick0 mean ms | 95.845 | 106.234 | **+10.84%** |
| tick1859 mean ms | 60.101 | 46.710 | −22.28% |
| tick9659 mean ms | 63.574 | 5.047 | −92.06% |

tick9659平均比约12.60倍；保守的min(A)/max(P)=8.72倍。不能挑某次最大A与最小P声称稳定20倍。P四轮max位置为0、0、9600、0；tick9600的111.27ms没有该轮GC/CPU诊断，仍未归属。全局max没有改善，p99≤16ms/max≤50ms也未达成，P平均仍1136个tick超过10ms。因此**不采用该组合**，不继续给它叠缓存或容器补丁。

另有先执行的8轮官方4个计时边界对照，独立保存为`formal-*`/`analysis.json`：mean −3.13%、p99 −5.11%、CPU −3.07%，冷tick0反而+2.54%。两组不混算。前一组的小幅收益没有在原源码对照中成立；组间还包含JIT/GC及运行时段变化，不能仅凭两组数字断言全部差异都由4个边界造成。

这是Node生产模拟路径whole计时，不是浏览器绘制/GPU帧卡顿验收。render currentSnapshot、命令序列化与文件输出单独记录；它们的分配可能影响后续GC，不能因此忽略。额外CPU/GC诊断与正式原源码计时严格分开。

## 最大值到底由什么构成

1. **冷tick0确有大量同步CPU工作。** 追加完整CPU/GC诊断A=95.34ms、主线程CPU≈92.25ms、GC重叠0；P=113.58ms、CPU≈112.74ms、GC重叠0。wholes/shore/最近可走点/runtime/距离场是实际成本。nearestWalkable在A有20个self样本、P仅4个，不能把某轮sample数当稳定函数时延或调用次数。
2. **nearestWalkable存在算法级无效迭代。** 只读原循环计数：tick0有45次真正ring miss，R为21/21/21/20及41个1；方框内部循环55276次，直接周边只需7552次，少7.32倍。真实输入不支持把本局该枚举器声称100倍，更不支持整局100倍。未修改主车道函数。
3. **稳定tick9659原峰不是GC。** 独立scope/CPU调用链为updateTraining→shipLaunchPose→steerPoint→tilesOf→linkSector→growBoxInto，诊断无GC重叠。bound-first删除了不必发出的全图请求，而非把该工作移到未计时任务。早期naive版本确把冷tiles成本搬到1859并恶化，已淘汰，原始失败screen仍归档。
4. **后期部分漂移峰确有GC。** 追加A tick14072=84.97ms，GC时间轴重叠29.07ms；P tick14370=67.81ms，重叠24.78ms。计时边界A的147.36ms@13439及128.16ms@3135未在追加诊断中重现，原轮未记录GC，原因仍未归属，不能事后编造GC解释。
5. **大块工作集不是船job容器。** 回收后只读清点原runtime：land128+sea75张Field数组160.58MiB。陆地每field仅1090–3315格可达，中位1968，却都存103684格；128张land dist中98.102%为UNREACHED。该字段数组活着，取消船job不释放；海域可达比例82.72%，不能套用陆地稀疏比。理想陆地payload按component存储可小约52.7倍，尚未包含映射成本，**不是已测CPU收益**。

## 正确性、别名与恢复

- 原源码8次及计时边界8次整局均为checksum `7d94a5e8`、完整命令SHA `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`。
- 新A/P两个完整状态诊断：14400个逐tick完整snapshot SHA和checksum全同，完整命令字节相同。
- 港口独立差分：冻结其余运行模块为281a，64场景×7种同对象变化×首次/暖调用/JSON冷克隆，**1344调用/版本全等**，包含无解、动态阻挡、换rally、cells、scale及dock位置变化。
- 新shadow完整重跑721次同步调用，321个hit事件严格等于预先固定集合；每次值、内部别名及input/result外部别名图相同，shadow逐tick完整状态也与P相同。
- 原有17项公开/私有搜索差分、callback/嵌套/异常/每yield/身份与别名测试通过；聚焦95项通过。任意traffic callback仍走原行为，没有共享回调返回对象。
- 旧stage2 snapshot在9660恢复，10010与11010再JSON冷恢复；新A/P完整14400tick状态与命令全同。冷/热原始JSON在最后434tick存在同样的键顺序差异，值等价另用排序后完整snapshot SHA复核；没有为其修改模拟。细节见verification.json及归档脚本。
- 实验P全量：**6910通过、5失败**；5个失败测试和断言与前阶段/基线相同。生产构建通过；没有把基线失败称为全绿。回退后241个运行输入及整个src与281a逐字节相同。

## 内存、复杂度和淘汰结果

原源码4轮进程max RSS均值A=974.0MiB、P=877.3MiB，end heapUsed均值A=180.2、P=186.3MiB；垃圾回收时点不同，不能据此称为可达内存改善。追加单轮诊断在结束后强制GC：heapUsed A≈84.0、P≈80.5MiB，ArrayBuffers A≈272.8、P≈269.0MiB；这不是8轮正式时延样本。

独立8地图/8码头heap fixture显示，P相对A多约0.8MiB活跃堆，100次换rally后约1.1MiB，ArrayBuffers相同；释放所有权后差异回落至约0.1MiB测量/全局常驻残差。首次fixture的顶层loop可能保留一个临时值，已保留原记录并用函数作用域重做。这个额外容器成本是候选代价，不会被RSS数字掩盖。

已淘汰：local shore perimeter虽在固定场景减少约22%冷tick，214例中有6个同对象内容/尺寸反例；旧列表index分桶215例也有实际图距离288却错误下界1312的反例。没有给它叠shadow尺寸缓存或第二套导航。材料含全部反例及原Point身份结果。

[原始RTS代码研究](RTS-RESEARCH.zh.md)核对了固定commit的0 A.D.区域候选与Detour图绑定/引用失效处理。[AI数据流审查](AI-DATAFLOW.zh.md)列明物品过滤制造新world/query、重复组合与空间布局；这些只是有定位的待测设计，没有混入本轮收益。[分配审计](ALLOCATION-AUDIT.zh.md)区分job、港口和terrain所有权。

## 复核与交接

PR381保持草案，不合并、不部署。归档549个原始文件逐字节校验通过，新增文档后的SDK边界7项测试通过。实验源码提交38989112可单独审查；ea24955c随后显式回退该提交。本阶段最终生产净代码为0，证据提交增加文档/数据。接下来需主terrain车道协调nearest环枚举及Field存储域；本车道继续拥有私有job/arrival/港口及已批准的空traffic同步重试，不越界修改terrain或hullPassageClear。

归档按内容SHA去重保存全部原始字节，含失败试验、冻结bundle/运行源码、环境、room、逐tick样本/命令/状态hash、CPU profile/GC/主线程CPU、内存和脚本。核验与提取：

```sh
python docs/performance/sanity-max-architecture-20261015/evidence.py verify
python docs/performance/sanity-max-architecture-20261015/evidence.py extract /tmp/sanity-max-evidence
```

manifest.json给出每个原始文件的映射。核心逻辑路径为`workspace/sanity-max-architecture-20261015/`与`workspace/sanity-cold-peak-audit/`；原绝对路径保留为记录，不是额外依赖。

重跑正式对照：检出281a75d0与38989112两个独立worktree，使用同一node_modules，Node v24.19.0/esbuild0.28.0；从本repo执行归档plain.py中的8次官方命令，替换source/out目录即可。`plain-plan.json`冻结原源码序列和targets，`formal-plan.json`记录计时边界组；`source-boundaries.json`验证241个运行输入中的4个差异。所有原始JSON与全14400ticks都保留，不能只复核报告表或selected peaks。
