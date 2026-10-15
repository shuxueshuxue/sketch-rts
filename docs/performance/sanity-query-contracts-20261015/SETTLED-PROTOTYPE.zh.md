# settled predicate 最小外部原型设计与水平run CCL

只读设计，2026-10-15。已精读当前 terrain.ts 的 shoreSpots、walkingDistance、exactField/cached、grow、padAt、stepAllowed、wholesOf。未编辑生产源码，未编译/运行基准。本文是可被小型差分否定的设计，不是已证明可合并的实现。

## 先约束原型，不伪造生产契约

当前Terrain类型没有“从首次runtime创建起不再原地变更”的品牌或版本；仅检查现在的cols/cell无法证明它与旧runtime一致。不能从现有公开参数推导该契约。

外部原型可以表达明确边界：从fixture完整值新建A/B两份普通map，在两边**首次任何terrain API调用之前**冻结terrain及map几何；两边保持同一坐标、cells、levels与尺寸。候选仅接受这个外部测试拥有的handle。这能验证算法对合法静态图是否正确，却不证明任意已有暖可变对象兼容。生产迁移需terrain所有者建立等价的生命周期保证；否则停在原型，不添加影子旧尺寸缓存/兼容分支。已有levels/cols/cell变动反例仍检验旧公共接口，不删除。

## 第一轮最小diff：只在既有grow加一个settled回调

以下是文本设计，**不写入生产**：

```diff
- function grow(state: TerrainRuntime, sources: number[]): Field {
+ function grow(state: TerrainRuntime, sources: number[],
+   stop?: (at:number, cost:number) => boolean): Field {
    ... 原初始化/入队不变 ...
      const at = bucket[--tops[slot]!]!;
      pending -= 1;
      if (dist[at] !== cost) continue;
+     if (stop?.(at, cost)) return field;
      ... 原四向/对角松弛代码完全不变 ...
```

回调位于旧记录剔除之后、松弛之前，这时cost是最终最短距离。原exactField仍不传回调、仍跑到队列空，返回的完整场与原行为不变。新提前停止结果是**不完整暂存区**，只能丢弃，绝不能放回state.fields当成完整场或暴露给walkRoute。第一轮保留原dist/next分配和fill，避免同时改变两个维度；这仍O(N)初始化，不能宣称已达到纯O(K)。

### 必须隔离的共享工作区

grow复用 `state.tops`、`state.buckets`、`state.spare`。若回调里直接调用同state的walkingDistance，敌方exactField/grow会覆盖正在运行的own桶。不能忽略这一重入问题。

最小外部测试可给own搜索建立一个**查询专有工作区外壳**，共享只读walk/offsets/terrain，但独有tops、buckets、spare；原exactField保留其原工作区。旧松弛内核不复制。第一轮敌方判定可直接调用原gapOf的walkingDistance，sea谓词也使用原逻辑——目的先证伪“settled候选顺序与早停能保持答案”，不是把它包装成全面加速方案。它仍保留敌方全场和sea cold成本。

若该最小原型正确且显示own扫描减少，第二轮才把**同一段**grow抽成可暂停cursor：`start(sources, scratch)`与`advanceUntil(boundary, onSettled)`；grow成为“advance到空”的旧完整场包装。own/enemy各自scratch，状态包括cost、pending、tops与桶；不能另抄一套四向/对角循环。预计增加一个cursor记录和约数十行控制封装，而非新导航系统。所有数组大小和额外工作集须单列；目前8个N长Int32桶很大，不能把删除Field数误写为总内存同比减少。

## 候选函数必须逐项对齐原语义

1. **源坐标**：所有hall先使用原padAt(state,hall.x,hall.y)，只有 `state.walk[id]===1` 才入源集合。不得取最近可走格、夹到边界、四舍五入或把越界hall变有效。重复id可在私有距离query去重，否则重复hall能让seed桶溢出；此query不以seed出队顺序决定最终rowtie。无有效己方源即undefined；无敌方源相当于Infinity。
2. **候选坐标**：own settled格只有unpadded合法land格才有候选中心；用原 `(col+.5)*cell` / `(row+.5)*cell`，ordinal=`row*cols+col`。原shore中心若不是land，walkingDistance(undefined)永不胜出，所以不必从海格生成候选。外部water/hall坐标保留原值，不改成格中心参与其余计算。
3. **静态footprint**：严格复用shoreSpots的half、first、last与左右上下边界公式。逐格累积：dry来自land.walk；blocked来自两mover均不可走或levels为2；wet来自sea.walk且对应sea component的deep≥64。不得把“有海格”当wet，或按另一种footprint rounding。局部k格验证替代三张全图积分图，只在immutable fixture边界可宣称匹配。
4. **64深水与目的海域**：第一轮直接借用原wholesOf海标签/deep（测试导出），不改算法；保留最后原 `sameGround(map,walkableGoal(map,spot.x,spot.y,'sea'),water,'sea')`。不以spot本身当sea入口；footprint的大海和最终入口所在海域可能不同。若没有任何64深水component，可直接undefined，但取得这个事实仍有原全图成本。后续局部证明必须单独做，不能隐藏在prototype的收益里。
5. **距离单位**：回调对每个cost使用 `(cost*terrain.cell)/STRAIGHT`。先应用HALL_BERTH，再比较敌方/其他原谓词。旧图本身是5/7固定整数边权，不是groundTravelCost里的泥地权重；不能使用看起来更物理的权重。
6. **动态谓词**：火力覆盖、despiteGuns、敌塔、isBuildPlacementClear与目标海域仍用原函数及相同冻结snapshot。可改变纯谓词评估次序以少做无效工作，但不能把动态障碍加入地面距离图；原walkingDistance明确忽略建筑绕路。

### 回调的最小决策逻辑

```text
best = undefined; bestGap = Infinity; bestOrdinal = Infinity
onSettled(at,cost):
  gap = 原换算(cost)
  if best exists and gap > bestGap: stop
  if gap < HALL_BERTH: continue
  if exactFootprint(at) and allOriginalPredicates(at,gap):
    ordinal = 原row-major索引
    if gap < bestGap or (gap === bestGap and ordinal < bestOrdinal):
      保存候选
    if mode === exists: stop
  continue
```

最优模式必须处理所有原浮点gap等于bestGap的格，不能只处理同一整数cost层；极小cell会让不同cost舍入同值。停止依据必须是严格大于。原查询不存在可胜出Infinity候选；支持图范围保持cost小于原UNREACHED/Int32可用范围。若想支持负cell/非有限尺寸，必须按旧公开API处理，不拓展到新有效私有图域。

bool模式只在原调用点确实只消费真值时使用。返回点模式改变内部Point身份：外部原型先报告身份差异，不能以坐标相同冒称严格引用等价。生产新接口可返回ordinal、在明确值消费边界创建坐标；这需要消费者身份不外泄的审查，旧shoreSpots身份契约保持不变。

## 第一轮可以删什么、仍留下什么

**本次query不再需要**：完整shore点数组、三张全图shore积分图、己方每hall的完整距离场、每候选遍历己方hall、land sameGround的重复可达证明。**暂时仍有**：own scratch的dense分配/fill和next、敌方完整场、海域全局labels、局部footprint k次访问。第二轮统一cursor才可删除敌方完整场，第三轮海域证明才可能删除sea全局冷成本。任何阶段不得跨tick分摊或改变AI/搜索预算/完成tick。

最小可证伪集：四向同距岸位、两个主城同距、越界/blocked/重复hall、无有效源、不可达候选、仅远处合法候选、无合法候选、63/64/65深水、footprint跨两个海域、center是浅滩/海、levels2、极小/巨大正cell浮点同分、既有cols变动反例旧接口。对完整原模块做坐标/指令/快照差分，同时单列身份；不只写候选代码对应的单元测试。

## CCL：4邻接水平run可精确保留组件与seed编号

这里有一条独立、较短的数学事实：当前wholesOf虽遍历8邻居，但对角边仅当两侧cardinal格都可走才允许。每条允许的对角边都能由两个cardinal边代替，因此**连通组件恰好等于4邻接组件**。这只适用于连通性，绝不能把5/7最短路改为四向路程。

可选run CCL过程：

1. 按旧state.width的padded行扫描walk===1的最大水平run；保存每run的left/right/row与union父节点。
2. 仅与前一行区间有**非空列交集**的run合并；端点错开一列仅对角接触不合并。双指针枚举有序区间交集，不对所有run两两比较。
3. union内部代表编号不直接作为labels。全部合并后，再按全图row-major run顺序扫描：首次遇到一个root才赋 `++count`，随后填该run的labels。于是组件编号顺序严格等于旧BFS外层首次seed顺序，即每组件最小padded index升序。
4. 保留原deep统计循环逐字不变，继续以当前terrain.cells/cols和旧width映射labels。这样不顺便“修复”公开可变对象的混合时态行为；对deep溢出/非正常元数据也不另创语义。

复杂度：N格扫描与labels写入不可避免；union额外O(R·α(R))，R为水平run数，替代旧每walk格约8次邻居判定及N长BFS queue。整片海R约rows、棋盘图R≈N/2；后者union容器可能比旧queue更贵。若用对象run与Map过多，GC可能抵消循环减少，必须把新增结构限制为少量数值数组；不先假设更快。

**为何它能保留label但不是十倍保证**：BFS内部访问顺序不影响最终labels/deep；最终按最小seed重新编号即可。它仍扫描N并输出N个labels，解决的是连通性算法常数与queue工作集，而不是最优查询架构的按需信息量。对很少组件的大海有希望，对高度碎片图要有反例。未运行run-count或计时；不能把R/N比例直接当tick比。

优先级建议：先以最小settled hook证明查询停止和tie协议，再让两个cursor共享唯一内核；CCL可作为独立可逆实验，但不应取代“为什么根本需要整个标签图”的问题。两者都由terrain主所有者决定实现，不另开同文件实施者。
