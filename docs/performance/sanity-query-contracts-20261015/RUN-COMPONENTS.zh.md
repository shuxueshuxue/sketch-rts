> 本文保留设计阶段的论证；随后执行的实验与限制以本目录 README 和原始 archive 为准。

# Run-based components：独立研究 prototype

文件：[run-components.mjs](run-components.mjs.txt)。当前仅写入研究目录；没有修改 repository 或 terrain.ts，没有接入或替换游戏 runtime，没有执行 prototype、编译、测试或计时。父线程统一做隔离 correctness/kernel benchmark。不能据此报告全局加速。

它只重写现有 wholesOf 的**冷构建计算体**：输入现有 runtime.walk、runtime.width 和 terrain 的只读视图，返回新的 labels: Int32Array、count: number、deep: Int32Array。它不读/写 runtime.wholes，不处理缓存命中、对象身份、COW 或缓存失效；这些仍属于原实现和主 terrain 所有者。

## 接口与计时边界

- runComponents(view)：校验输入，再执行计算。作为默认导出；必须把校验、所有分配、区间标号和 deep 计数计入端到端 kernel 对照。
- validateRunComponentsView(view)：返回持有同一个 walk、固定本次 cols/rows/cells 值的轻量视图，不复制 walk，不重建可走性。
- runComponentsKernel(validatedView)：同一算法体的无重复校验入口，供父线程单独量化结构变化潜力。只有已经校验且之后未变化的视图可进入。应同时报告 guard-inclusive 版本，不能把校验偷偷移出游戏 tick 来声称性能收益。

view 形状为 walk、width、terrain: {cols,rows,cells}。若传入完整 runtime 的 offsets，会核验它是否仍是原标准八方向序列；只传三项视图时，来源方须证明 offsets 是 createRuntime 的标准值。原实现可能读取 offsets，本 prototype 不能从缺失的数据证明其未被改动。

输入对象与底层 walk 在调用期间必须稳定，不接受并发 SharedArrayBuffer。源码不写 walk、terrain、其字符串或任何输入对象。

## 为什么可用相邻行区间重叠替代八方向 BFS

原 stepAllowed 对对角边同时要求两个侧向正交格可走。每一条允许的对角连接，都可以用两条允许的正交连接替代；原 BFS 自身又包含全部四条正交边。故两者的**连通分量**完全相同，不代表距离、路径或朝向搜索也可替换。

算法先用 native Uint8Array.indexOf 找到一段连续的1，保存其 padded 半开区间 [start,end)。零 padding 保证 indexOf(0,start) 不跨行；下一次 indexOf(1,end) 可以一次跳过空行，不对每个空行反复扫描整张后缀。

每个新 run 只与紧邻上一行、列区间真正重叠的 runs union；绝不扩大一列，单纯对角接触不会误连。上一行游标单调前进，一个重叠只处理一次。中间有空行会丢掉上一行连接窗口。

runs 按 padded row-major 顺序创建。union 始终选择较小 run 序号作为 root，因此该 root 的 start 就是组件最小 padded seed。按 run id 递增扫描 roots 已经是原 seed 顺序，无需排序；为它们分配连续1..count，再使用 labels.fill(label,start,end) 给整段写入标签。不能直接把 root+1 当作标签，因为 root 序号未必连续。

这里只做路径压缩、没有 union-by-rank；不宣称经典 rank+compression 的反阿克曼复杂度保证。应实测真实地图以及合并链密集布局；若需要排名式 union，必须另外保存组件 min seed，不能丢掉原编号规则。

## 保守支持范围

safe 入口拒绝以下输入，而不自动修复或静默近似：

- walk 不是 Uint8Array，包含0/1之外的 byte，或者使用 SharedArrayBuffer；
- cols/rows/width 不是安全整数，cols/rows 为负，或当前 cols*rows 不是安全整数；
- 旧 runtime.width < 2、walk 不足两行、长度不是 width 整倍数，或超过 Int32 标签支持范围；
- terrain.cells 不是字符串；
- 顶底整行或左右边界 padding 任一非零；
- 提供了 offsets 但它与原标准八方向不同。

支持任意内部0/1布局，包括空图、零行/零列、全堵、全通、棋盘、窄桥、多孔或 disconnected patterns；不要求 walk 可以由当前 cells 推导。上述不支持输入若将来接到生产，应继续走原实现；本独立研究文件不包含第二套 BFS fallback，也不安装生产分支。

零 padding 是必要边界。非零边缘可能使原 flat offsets 发生跨行连接，而按二维行区间理解的算法不会自动复现这种行为。不能只说“边缘通常不会可走”而跳过守卫。

## deep 和旧状态语义

deep 统计逐字沿用旧 for(index < terrain.cols*terrain.rows) 循环及映射公式，只删除 TypeScript 非空断言；不同时测试 native cells.indexOf。它只读取本次 terrain.cells 中的字符“~”。walk 与 cells 可以来自不同时间：不从当前 cells 重建 walk，不把所有非零 walk 当可走，不额外读取 cell size、weight、clearance 或 GameMap.width。

按当前 cells 的“~”位置累加 deep[label] 后，仍设置 deep[0]=0，忽略被阻挡的深水格。循环范围仍由当前 cols*rows 决定，字符串更短则越界字符不是“~”，更长则尾部不读。无组件时 deep 的元素长度仍为1且第0项为0。

**旧 width / 当前 cols 改变无需算法兼容分支。** 标签连通性只由旧 walk、旧 width 和标准 offsets 决定；guard 用 walk.length/width 推导旧 padded 行数，不强制 width===当前cols+2，也不把当前 rows 当作旧 walk 高度。deep 原式故意混用当前 terrain.cols/rows/cells 与旧 width：即使映射进入旧 padding、另一行或 labels 范围外，也逐字保留，不补 clamp，不重算 walk。若 labels 越界得到 undefined，旧式 deep[undefined] += 1 可能生成名为“undefined”的 NaN 自有属性；研究版也保留这一 JavaScript 行为，差分时需补查 Reflect.ownKeys/deep 属性，不能只比 typed-array bytes。这是复制旧冷构建体，不主张这些变更是受支持的游戏编辑 API。非标准 offsets、非零 padding、非二值 walk 或不整行的旧布局仍被拒绝。

原 wholesOf 如果已经有 state.wholes，会直接返回旧对象；prototype 刻意不冒充这个缓存层。验证应对照原**冷构建体**在同一个固定 view 上的输出。若拿已缓存结果作 oracle，必须证明该结果生成后 walk/维度/cells 未变，否则比较的是旧缓存历史而非组件算法。同对象变 cells、变 cols 的现存行为不能在这里被“顺便修复”。

## 工作量与内存

原冷实现分配完整 padded labels 和同尺寸 BFS queue，逐可走 cell 检查八个方向；它还必须进行 deep 计数。prototype 仍分配同尺寸 labels，也仍按旧循环扫描当前 terrain 并生成同样 deep。变化在于删除完整 BFS queue，用 R 个 runs 的 starts/ends/parents、root 列表和 R 长度的 rootLabels，替代逐 cell 的八邻接扩展。native indexOf/fill 的扫描与写入成本必须照计。

设 padded area 为 A、run 数为 R、相邻行重叠数为 E：输出 labels 的 payload 为4A bytes，新增 rootLabels 为4R，其他研究数组是普通 JavaScript number arrays，不能按 typed-array payload 假装为4R。union 工作约由 R/E/find 成本决定，deep 扫描仍为当前 terrain.cols*terrain.rows。

真实首图已有只读统计：land R=777、sea R=838，而 padded area=103684。它们提供删掉完整 queue 和大量邻接分支的机会；尚不是测得的加速比。棋盘等碎片布局下 R 可接近可走格数，普通数组和 roots 的内存可能高于原 queue，性能也可能反转，必须保留这种负例。

## 父线程统一复核建议

先逐 byte 比较 labels/deep、严格比较 count，而不只比较组件等价类。对象身份是新构建返回值，不能拿这一 prototype 替换已有缓存对象后声称 API 不变。

同一冻结原冷构建体、同输入，覆盖：真实 land/sea runtime；空/全堵/全通；仅对角接触；一格窄桥；上一行一个长run跨接下一行多个短run；多组件最终合并；中间空行；棋盘；walk 与当前“~”分布不一致。所有拒绝 guard 也要记录为“不支持”，不能算作相等测试通过。

隔离计时分别报告验证、kernel 和 guard-inclusive 总耗时；交替重复，保留第一次和 warmed 情况；两边都包含 labels/deep 分配和统计。另记录 R/E、分配字节与回收后内存。任何 native indexOf/fill 优势只归属该 kernel；最终仍需由拥有 terrain 的主车道评估调用量、冷最大 tick、旧快照/缓存和整局开销。
