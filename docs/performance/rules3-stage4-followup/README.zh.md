# 规则3：循环提取与连通域候选的未采用结果

**两项候选均未采用，整局目标仍失败。** 本包保留局部证明与全部原生五轮对照，不能用池化均值或有利局部组替代稳定收益。没有合并、部署这两项候选，也没有改变AI相位、船只规则、平衡、checksum频率或测试断言。

既有[阶段3证据](https://github.com/shuxueshuxue/sketch-rts/blob/19959685782109622b0c89a5b2d9f1ed7f3bcef4/docs/performance/rules3-stage3-loop/README.zh.md)、阶段2及旧证据保持原字节。当前生产仍为[PR #379](https://github.com/shuxueshuxue/sketch-rts/pull/379)的`618f9f5170164aa33d1e21443e86e64fb14d38f8`；可下载既有真实首屏：[巨舰](https://raw.githubusercontent.com/shuxueshuxue/sketch-rts/19959685782109622b0c89a5b2d9f1ed7f3bcef4/docs/performance/rules3-stage3-loop/media/fleet.png)、[王城](https://raw.githubusercontent.com/shuxueshuxue/sketch-rts/19959685782109622b0c89a5b2d9f1ed7f3bcef4/docs/performance/rules3-stage3-loop/media/capital.png)、[军队对野怪](https://raw.githubusercontent.com/shuxueshuxue/sketch-rts/19959685782109622b0c89a5b2d9f1ed7f3bcef4/docs/performance/rules3-stage3-loop/media/woods.png)。这三张图不代表本轮性能或动画验收。

## 固定范围与源码

仍为 `rulesVersion3 / checksumVersion18`。固定`sapphireArchipelago`六人局，一名空闲Grove人类、五个AI；每臂12分钟、14,400原生tick，结束`winner=null`。这是完整预定tick对照，未验证最终胜利、全地图、硬件渲染FPS或完整产品内存。

| 用途 | 固定源码 |
|---|---|
| 两组原生A基线、局部基线 | `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8` |
| 未采用：private grow循环不变量提取 | `9407d0d72510b09589e3a867b73fc9710073f469` |
| 未采用：四邻连通域标记 | `519fe66648d43bc6a73dcf6bfa6f870cc8aa339b` |
| 已部署Map生产源码 | `618f9f5170164aa33d1e21443e86e64fb14d38f8` |

9407只改`terrain.ts`；519fe完整Git diff含`terrain.ts`及一项真实集成测试，241原生运行输入的差异也仅`terrain.ts`。两候选分别从Map31建立，不含彼此或旧unroll。生产618的同一241输入与Map31全字节相同；本包没有在618上新跑原生性能。

## 两组原生五轮

每组串行 **A1→B1→B2→A2→Bplain**。每池A/B各28,800tick，whole包括原生complete tick内模拟、AI和命令；observer、渲染快照与落盘单列。最近秩分位为`ceil(n×p)−1`，无forcedGC、离群点删除、冷tick剔除、phase错开或采样内容减少。Bplain仅验证普通钩子的命令透明性，**不进入任何性能池或分钟对照**。

| 候选 | whole mean ms（A→B） | p99 ms（A→B） | max ms（A→B） | >50 ms次数（A→B） | 两配对均值变化 |
|---|---:|---:|---:|---:|---|
| grow循环提取 |3.628172→3.592164|27.312973→26.657259|127.768453→90.776705|13→20|回退0.14146% / 改善2.11211%|
| 四邻连通域 |3.662201→3.590334|27.771772→26.641707|142.978929→85.361870|22→11|回退1.01308% / 改善4.75942%|

全部十次均未达到 **whole p99≤16 ms、max≤50 ms**。grow池均值改善0.99246%，>16ms次数1438→1363，但>50ms反增；component池均值改善1.96240%，>16ms1466→1406，两个配对方向仍相反。原完整分布、规划/非规划、分钟块、关键tick、owner与memory原记录均保留；[统一重算](analysis.json)不改旧派生输出。

component的A2坏对照完整计入：sim均值A1 **2.710793→A2 2.905902 ms**，sim p99 **19.180449→21.890650 ms**，tick9149 sim **142.921304 ms** / whole **142.978929 ms**。A2 whole>50ms为19次，A1为3次。没有本次GC/JIT证据，不给坏对照编造原因，也不删它来挑出胜负；它使稳定收益不能从池均值直接认定。

component tick0两配对均退化：**77.022→85.362 ms、76.503→82.358 ms**。tick5280两对更快 **64.592→51.870、52.675→48.988 ms**，但没有labels-only scopes，不能把全部差值归给三个标记循环。tick6990、1859与10960仍方向不稳定；没有消除这些尖峰的结论。

## 循环提取的局部证据及整局反例

原八方向grow和queue事件顺序保持，只在每cost中提取普通桶数组引用。A/A178cases、一个重建字段943,436事件；A/B691cases、12字段11,321,286事件通过。private普通数组域支持等值，未主张人为Proxy/getter或原native缓存/JIT历史重建。

两项micro固定4预热+24测量ABBA/BAAB块。direct grow均值 **24.029787→23.755590 ms**，仅改善1.141%；15/24块更快、12/24严格分离，9负块保留，p99/max **27.389924→32.692581 ms**更差。public 36请求batch含12miss/24重建hit及lazy runtime，均值 **29.782318→24.079974 ms**，改善19.147%，24块都更快；setup+batch **29.793002→24.179894 ms**，B setup max2.895869ms也保留。

public的`from`为合成可走点，原runtime全图、辅助缓存、workspace、JIT/GC历史未恢复，不是完整调用重放。实际6990 player-6 A **36.796/39.166→B39.327/39.574 ms**，没有复现约19%的局部改善；不归因于内联或GC。24个完整中间oracle decoded **104,515,008B**，原lossless gzip共1,029,210B，外层压缩仍保留原压缩字节；本包不长期重复存raw bins。原冻结80payload及另目录封存执行收据全部收录，适用47项测试及生产build通过。

## 四邻连通域的适用性与限制

实际cardinal `stepAllowed`恒真，允许对角边可由同矩形sector内两条cardinal边替代，所以组件、row-major首seed、完整labels/count/deep与island/region相同。私有临时BFS顺序有意不同，未声称逐queue事件相同；移动与距离场仍八方向。SECTOR10最大50独立组件，原MAX_REGIONS64保持；新增集成测试确认开放对角距离仍 **44.8**。

完整proof **595cases、1,176直接组件比较、11,948完整私有图、44,568公共调用、48建筑/快照操作**，比较651,653,649底层buffer bytes，未规范化全局缓存/版本。micro原1,008 trials（144预热/864测量），9contexts×24块全部保留；完整land tiles有9负块、sea tiles有3负块、public cached有9负块。

micro跨trial仅比较该map持久图，省略全局lastTerrain/lastRuntimes与全局revision；overlay绝对revision因trial位置不同移除，但overlay/tiles对象及redo精确+1检查保留。原完整proof不省略这些字段，不把micro的选择范围冒充完整证明。验证harness每trial约159ms–1.689s，单列，不当游戏模拟成本；micro实际553.554s，原静态3–7分钟估计偏低也保留。

原10文件86项和实际TypeScript/生产bundle/bootstrap通过；62冻结payload的SHA保持，后续9payload复核独立追加。后续parser首次 **exit1**，错误要求Bplain有逐owner计时；v2只对真实timed四臂保留五owner/15tick相位断言，plain要求owner为空、不可用计时记null。原代码、stderr/退出码全部保留，没有降低游戏或原测试断言。

## 启动边界与Bplain补证

grow对照开始时root发STARTPAUSE后未等component代理ACK就启动。最后两次已知文件mtime分别 **21:58:50.049184 /21:58:51.117162 UTC**，早于A1命令开始 **21:58:52.198 UTC**；但原apply_patch工具3.2s完整起止UTC未记录，mtime不能证明整个工具无尾段重叠。代理确认工具返回后才收到消息、随即ACK，ACK后至22:03:38.523完成无tools/children。未知启动边界保留，**不认证全部代理工具完全停止的严格独占启动**。

grow旧statistics中的Bplain分钟`nonplanning`标签来自禁用owner计时后的空数组，只作原元数据，不是真实非规划相位。原输出不改，独立addendum解释；两个性能池、配对及分钟对照一直排除Bplain。component新输出的Bplain分钟只含all。raw sim/AI零值不代表AI免费或没规划。

稀疏RSS/heap观测完整保留，不能当持续峰值、分配率、泄漏或单尖峰GC因果。未来整数/WASM可行性与任何未测内核另属新阶段，本包不扩入它们。

## 无损封存与复核

原路径Base64、原bytes/SHA及外层gzip bytes/SHA逐份封存；所有准备false、旧“尚待”状态、失败、异常、完整trial及原生源码/命令均不改。只流式压缩/读回，不拷贝整个raw树，不重新解包104MBoracle。[封存清单](manifest.json)、[最终闭环](verified-closure.json)、[执行身份](preparation-notes.json)给出实际数量、退出码与检查范围。

十臂及Map31旧B1参考共十一完整命令日志，各 **618,189B /14,400frames /612非空frames**，SHA **`771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`**，checksum **`7d94a5e8`**；11×241份原运行输入与各自固定Git blobs逐字节比较。`esbuildBytes`是变换后长度，不能当原source bytes。

仓库根目录运行：

```sh
python3 docs/performance/rules3-stage4-followup/verify.py --out docs/performance/rules3-stage4-followup --verify
python3 docs/performance/rules3-stage4-followup/analyze-native.py --repo .
python3 docs/performance/rules3-stage4-followup/verify.py --out docs/performance/rules3-stage4-followup --verify --compare-originals
```

普通stream校验仅需本包，source闭环需固定Git对象，compare-originals另需原工作目录。`--extract /tmp/new-stage4-evidence`先完整验证，只写不存在的新目录，拒绝路径穿越和覆盖；本次只小件安全解包反例，不新增大raw复制。完整docs SDK14的实际检查身份另记，不给旧源码或旧构建换标签。

本包完整载荷和支持脚本已落盘后，SDK四文件14项首次全部通过（wrapper31.847572s、exit0）。检查在完整证据分支199596的既有49代码及新stage4文档上进行，不冒充618的新构建或原生性能。之后仅追加本次退出码/日志及封存metadata，候选源码和旧证据不变。
