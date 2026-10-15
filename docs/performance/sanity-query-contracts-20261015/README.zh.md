# 从消费者重建查询协议：数量级优化继续验证

**整局最大 tick 降低十倍尚未实现。** 这一轮纠正此前沿热点加速旧结构的做法，直接检查哪些结果没有消费者。发现并实际验证了三类浪费：只需存在性却求最佳岸位、没有前排却计算集结路线、按威胁已落败的矿点仍构建海路。没有把局部加速或内存比例当成全局达标，也没有将未经完整验收的原型留在生产。

冻结源码为 `ad85c71bae879e0bfdfe29487caa8f61ac9cf9ca`，运行源码与 `281a75d0862246de8943cbf2b5aa31d8a82c08a5` 完全相同；rulesVersion=3、checksumVersion=18。重新只读核验 upstream main 仍为 `4804631c22f7be3f83dc6374e71ce03d86068dd8`，PR #381 仍是草案。本阶段最终 **生产代码净变化为0**，未改生产 terrain.ts、hullPassageClear、规则或 AI 行为，也未合并部署。分支/提交查询由本车道完成，不要求用户提供技术线索。

## 真正的最大值与删除方向

此前[完整因果证据](../sanity-max-architecture-20261015/README.zh.md)已经区分：原始源码冷 tick0 是稳定的最大值来源之一，诊断 whole=95.34ms、thread CPU=92.25ms、GC重叠0；tick9659 则是另一个稳定的首次导航构建峰值；后期还有部分GC相关漂移峰。它们不能统一归成一个热点或用一次异常最大值代表。

本轮从冷 tick0 的消费者倒查，主支路是 `planBootstrapNaval → assaultPlan → shoreSpot`，并非当 tick 没有执行的 v6Economy。最初仅有矿工和主城，没有舰船与陆军，但 assault 计划记忆仍须按原时刻写入，不能直接跳过整个海军规划。

三个调用点只读取 shoreSpot 的 truthiness。它们不需要最佳岸位，而原函数先生成全部10430岸位，再查询己/敌主城距离、检验候选、保留最佳点。真正需要坐标的建造、炮塔和岛矿选择必须保持原最优规则。详细依赖及不能提前省略的记忆/goal aging，见 [冷峰数据流](COLD-DATAFLOW.zh.md) 和 [决策最少信息](NAVAL-DECISION-NEEDS.zh.md)。

## 已运行的最小证伪实验

原始数据、逐运行源码、完整命令/状态哈希、运行脚本均封存于 [manifest](manifest.json)，可用 [evidence.py](evidence.py) 校验及提取。所有改写仅发生在独立研究 bundle；原仓库源码不变。

| 实验 | 实际删去什么 | 结果与判定 |
|---|---|---|
| E：同一函数增加 Boolean 需求，原序首个合法见证即停 | 找到合法岸位后的最优化；仍先建全岸位列表 | 六次冷启动 A mean102.001→E93.158ms，约−8.7%；214例差分无值差异。不能作为十倍主方案，未采纳。naval 净行数0。 |
| R：Boolean 查询在原列表上旋转起点、完整wrap | 尝试更早找到见证，不建索引、不改列表 | 六次 mean93.980ms、max114.603ms，未显示稳定的大收益，未采纳。 |
| F：用原图连通性和保守距离界先证明存在，未知再走原精确函数 | 对已证明候选不求精确field；保留原完整列表 | 新的六次交替冷启动 A106.572→F95.252ms；仍不是数量级，未采纳。 |
| M：局部候选直接复用 isShoreFootprint，加同样存在性证明和精确回退 | 不再先物化全岸位列表及3张全图积分表；不先精确评分未知候选 | 同一新序列六次 A106.572→M74.474ms，约−30.1%；M范围64.661–85.783ms。仅研究原型，公开可变对象反例阻止直接替换。naval净+35行，另2行只是研究用只读导出。 |
| G：bootstrap 已无任何候选 front 且非 gather，保留 doctrine 和前后处理，跳过无人消费的通用规划 | 扩张护卫/集结路线及其矿点评分 | 净+4行，无新缓存/API；32 tick 状态与命令相同。只有一次 screen，不给性能结论；[diff](G-research.diff) 及[证明/剩余验收](BOOTSTRAP-NO-FRONT.zh.md)，未采纳。 |

两组冷序列分别预先固定，不能跨组拼数。每次32 tick，独立进程，交替运行；没有 profiler、计时边界钩子或强制GC。计时覆盖 `updateToRenderTime + currentSnapshot`，包括守卫、原型分配、miss和回退；逐 tick JSON/校验在计时外，会影响后续分配/GC，所以这些只是冷启动筛选，**不是整局正式时延或CPU验收**。完整 raw 在 `cold-*`、`proof-cold-*` 和计划文件中。

active arrayBuffers 在第二组32 tick后 A平均32,593,508B、M33,413,992B；回收时机不同，不能据此声称减少内存。未做回收后内存和整局交替时延验收，因此没有将 M/G 作为正式生产优化。此前失败的全局方向转置与本轮实验分开，未重复采纳或混算。

### 正确性与反例

较早局部查询原型 L（与 M 同一方向，但未知候选立即精确评分）已经跑满14400 tick：与冻结基线的每 tick 完整 **GameSnapshot** 哈希、checksum、完整 command frame 字节均相同；命令 SHA256 为 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`。证明见 [full-value-verification.json](full-value-verification.json)。这是一次状态校验，不是正式性能比较；GameSnapshot 不含独立 AI runtime memory，不冒称已逐次核验全部 AI memory。M只做了32 tick筛选，未把L的整局校验移用给M。

214例岸位差分覆盖冷/暖、多个主城、同距、无岸、无解、枪塔、盟友、非有限/越界主城、同对象 cells/levels/cell/cols/rows 改动。E、C（原列表上直接证实候选）均无值差异，返回坐标的原模式及其内部重复身份也保持；L/Q局部枚举有3个真实 Boolean 反例：`levels-2-then-delete`、`levels-2-then-zero`、`cell-32-to-64`。原 shores 缓存历史与新鲜局部 footprint 不是同一协议。没有绕过这些反例，也没有加影子版本缓存或第二套兼容算法；L/M不得直接进入现有任意公开入口。

L 整局校验中观察到的最慢事件仍是0、9659、1859、6990等；一次运行的74.43/69.88ms等值受校验器影响，不能与此前正式 A/B 最大值作比值。但它具体指出：删掉海军列表后，首次导航构建和其余调用链还在，工作没有完成。

## 两个进一步根因

局部查询 M 的冷 CPU 采样显示，剩余 grow 的主要路径是 `planBootstrapGeneral → planV6Army → expansionEscortPoint → chooseMine → chooseV9ExpansionMine`。当不存在 front 且非gather时，原函数随后直接返回，escort/rally没有消费者。G只在bootstrap的确定调用处处理这件事，保留原v6Doctrine抽签/记忆与整个后处理；公共 planV6Army 原字节不变，任意 chooseMine 回调和throw不受影响。尚需完整 AI memory、旧快照、mineLanes first-read历史及整局成本验证。

另一次完整14400 tick诊断捕获57次 chooseNavalMine：每次12候选，全部先求海路，但最终 `threat || road` 只有最低threat组的6个候选可能胜出。合计684个候选中342个road没有选择结果消费者。tick6990的两组threat分别为5.02831668385801与2.6127479111061525，各6个。不是12→1，也不是十倍结果；详见[审计与异常边界](MINE-LEXICOGRAPHIC-DEMAND.zh.md)。没有为了半数局部收益又叠一个生产补丁。

## 真正要重构的协议

优先设计是让同一个 grow/Dial 内核直接回答“最近可行点/是否存在/这一批目标的最小距离”，而不是先交付全岸位列表、H张完整Field和全体候选分值，再由调用者丢弃大部分。详见[查询架构](QUERY-ARCHITECTURE.zh.md)与[最小settled原型设计](SETTLED-PROTOTYPE.zh.md)，引用官方算法文档和固定SHA原始实现，明确区分来源结论与本项目推导。

- settled时产生候选，用同一个既有footprint判定；存在性遇完整见证就停，最优性处理完原浮点gap同分层及原row ordinal再停。
- 敌方路长只需与当前己方gap比较的阈值证据；不必为每座主城造完整输出场。已有精确内核抽成cursor，完整field消费者仍使用同一实现跑到底，不维护第二套寻路。
- 舰队矿点选择只消费最小road，nearest origin身份被丢弃；批查询需一并解决暖字段复用和查询生命周期。不能重演全局transpose导致grow240→256、全局变慢的已失败实验。
- 不完整搜索暂存区不得冒充完整缓存；own/enemy并行cursor必须有独立scratch，原grow共用tops/buckets，回调里重入walkingDistance会破坏搜索。峰值数组、复制与GC都须计入。
- 海域连通和64深水证明是真实剩余需求：没有证实就不能接受；无解时必须穷尽或给完整否定证明。保留全局whole的第一版不能冒称已经删除这项成本。

该设计从 `O(N + HN + SH)` 的整图中间产物转向实际探索/证明的 `O(K + E + W + kP)`；如保留dense初始化仍须加O(N)。这是数量级机会的来源，**不是已测十倍承诺**。旧公开可变Terrain、Point身份与快照/COW继续保留；新的私有图视图/查询协议由主terrain所有者协调，不能在AI补一层猜测版本的缓存解决。

其他可以删除的中间产品包括：fallback只读终点却重建整条ShipPose路径；布尔碰撞只需是否命中却构造详细最近Contact和支持点。见[消费者审计](CONSUMPTION.zh.md)。它们不是当前冷AI最大值的完整解释，尚未实施，不用它们填充收益结论。

## 独立连通性架构研究：交terrain所有者

未接入或替换游戏runtime。原8邻接CCL的对角边必须两侧正交格开放，所以其组件严格等于4邻接。独立研究内核按水平runs和相邻行区间重叠union，保留原最小seed编号和原deep循环；不再逐可走格做8邻居扩展或分配整图BFS queue。真实地图land/sea只有777/838个runs，而可走格为21448/85767。

808个地图/mover差分和12个旧width/当前cols等变动差分全部通过，严格比较labels/deep字节、count及deep额外自有属性；没有把组件同构当精确标号相同。冷进程交替每臂4次，海域原BFS mean14.304ms→含完整守卫研究实现3.406ms（4.20×）；裸kernel2.181ms。land7.779→3.894ms。热后每臂60次，海域2.691→含守卫1.854ms，land1.813→1.874ms，后者反而变慢。**这些是独立kernel数，绝不能叠到M或当整tick收益。**

研究模块95行，含保守验证，与完整队列换成普通number run数组的分配成本；棋盘图可能更差。主车道若采用，需自行决定如何从既有runtime构造契约保证合法padding，不能把每次O(N)守卫成本藏在计时外。源码与边界见[研究模块文本](run-components.mjs.txt)及[说明](RUN-COMPONENTS.zh.md)，原始计时/正确性在archive的 `components/`。

## 复核与下一检查点

```sh
python3 docs/performance/sanity-query-contracts-20261015/evidence.py verify
python3 docs/performance/sanity-query-contracts-20261015/evidence.py extract /tmp/query-contract-evidence
node /workspace/sanity-reset-20261015/existence-screen.mjs A /tmp/query-cold-A
node /workspace/sanity-reset-20261015/existence-screen.mjs M /tmp/query-cold-M
```

提取时保留完整 `/workspace/...` 相对树；脚本中的源码与fixture绝对路径记录了本机环境，跨机器重跑须指向同一冻结源码和封存fixture。运行脚本拒绝覆盖已有输出。每次原始source-inputs、variant源码、结果和runner均可独立核验；不靠当前branch名推断测量源码。

下一项实质协调是由terrain所有者接受“单一内核、按查询目的输出”的小接口边界，再验证探索量K/E/W是否真的比全图小；本车道负责策略消费者和私有生命周期，继续避开terrain生产实现与hullPassageClear。若需要新的不可变图内部契约，先展示迁移与公开兼容边界，不把它当已有授权。十倍最大值仍是主动追求且需证据检验的目标。
