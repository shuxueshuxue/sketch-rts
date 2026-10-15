# 真正最大值下一步：削掉计算域，而非再加缓存

以冻结281a75d0 / 38989112为准。原源码8轮正式对照未实现整局最大值10×，组合已淘汰并回退；以下是有具体源码、输入规模和反例的下一架构边界，不是已实现收益。terrain.ts由主车道所有，本车道没有修改它，也没有把两个车道数字相加。

## 先给出最大值的证据边界

计时边界对照候选4轮最大值全在tick0：92.85、91.30、87.68、119.57ms。计时边界基线另有两个漂移max：13439为147.36ms、3135为128.16ms；其余两轮为tick0。没有原轮GC记录，不能事后把147.36ms指定为GC。

追加完整CPU采样和GC诊断（不作为正式A/B）：A tick0=95.34ms、thread CPU=92.25ms、GC重叠0；P tick0=113.58ms、thread CPU=112.74ms、GC重叠0。即使后期暂停和分配需要处理，冷峰主体确实是同步计算，不是日志、绘制或外部调度。CPU采样为计数，不能当函数调用数；thread CPU也存在数毫秒的内核记账误差，不把相减负数解释为负开销。

后期A tick14072为84.97ms，其中GC时间轴重叠29.07ms；P tick14370为67.81ms，重叠24.78ms。说明“确定性昂贵构建”和“分配导致的漂移暂停”两条原因都必须处理。诊断中的重叠不是独占CPU分解，也没有复现原147.36ms事件。

## 1. nearestWalkable：环搜索在每一圈重新遍历内部

`src/shared/terrain.ts:1492`：外层ring递增；每ring内仍对(2r+1)²整个方框做双重循环，再用Math.max过滤，仅保留8r个周边点。扫描到R累计循环体次数为(4R³+12R²+11R)/3，真实周边仅4R(R+1)。这是明确的多做工作，不能视为物理瓶颈。

本次A冷tick0有20个nearestWalkable self样本，超过wholesOf17、shoreSpot11、createRuntime9；这些不是20次调用。下一步应记录实际cache miss的R和mover，再量化本tick无效循环次数。最小候选只改变枚举器：顶/底行步长1，中间行步长2r，保留原r-major/c-major、精确距离、最低index tie、停止ring。理论上R=64时循环体约少22.0倍，R=128时约少43.3倍；不等于整tick改善这些倍数。

未应用patch和边界见NEAREST-PERIMETER.zh.md。合法整数grid下可以机械证明枚举顺序相同；非整数/非安全整数输入的浮点累加轨迹不能未经核对宣称等价。主车道协调后可先单独验证这一小hunk，无需新缓存或第二搜索算法。

## 2. 陆地距离场：每张表为全图留位，但98.1%无结果

完整诊断在结束后只读清点了活着的原runtime（`census-source.ts.txt`仅追加到诊断bundle，未在tick内执行）。A/P均有：

- 地图320²，padded数组103684格；land可走21448格。
- land fields=128，dist+next共106172416字节=101.25MiB。
- 全部land dist共13271552元素，有限可达仅251860；**98.102%槽位保持UNREACHED**。
- 每field可达1090–3315格，中位1968；全图为103684格。
- sea fields=75，可达85767/103684=82.72%；不能把陆地的稀疏比套给海域。
- 两类Field数组共160.58MiB；还另有buckets、tile/goal字段、navigation workspace及对象。

取消某船job不会释放这些runtime所属数组；它们不是job的私有graph泄漏。缩小LRU只会改变重建次数，不消除“一个小岛查询分配整图”的根因。

候选设计由主车道拥有：同一个现存精确距离kernel，Field存储域改为来源的可达component或其紧包围盒；查询通过该域映射读取，域外保持原UNREACHED。不增加第二导航实现，不改变权重、relax顺序、缓存时钟或公开结果。理想的仅payload账本：陆地2张数组按实际可达总数存储约1.92MiB，相比101.25MiB小约52.7倍；实际还要计组件映射/边界数组和lookup成本，**这只是存储上界机会，未测时延**。海面近全连通必须另做批量/按需数据流，而非硬套component方案。

将已有grow与BoxField的存储访问统一，才有机会净删除平行kernel和满图初始化；不要在原Field外额外叠一套压缩副本。必须先核对walkRoute/fieldNext所有直接dist/next访问，以及old snapshots的terrain runtime绑定。当前主车道的按需frontier已有失败全局结果，不能拿其名字替代这个工作集问题，也不能复用旧联合正确性结论。

## 3. 岸位查询：只请求需要的精确答案

首次shoreSpots会建whole、三张积分图和10430个Point；单owner仅约620–719个岸位在其可达陆地，93%以上最终无用。tick0的40325次exactField仅6次grow；tick15的80650次全部命中。因此不能声称几万次Dijkstra，但仍存在几万次重复runtime/field/pad查询和临时hall投影。

最小协调接口是QUERY-CONTRACT.zh.md的只读pruning bound：用**实际runtime.width和原padAt**，不猜当前terrain.cols，不新建图/field，不修改既存可变对象语义。已知旧width50、当前cols52的反例，正确图内界288，错误世界坐标界1312；必须保留它。

按该接口临时分桶仍O(H*S)，只可能减少昂贵查询，不能声称免全图岸位遍历。更大胆的单次query应把“原候选顺序/Point、己方最近hall距离、敌方最近hall距离、海域与动态可建性”放在同一个受控输入生命周期，由原距离kernel按需要消费；不把准备结果交给公开延迟回调、不缓存整个AI命令。

跨query永久索引需要坐标不可变的所有权；现有readonly Point[]并不禁止修改Point.x/y。不能用类型注释假装已经有此约束。小型当次bound不需要先迁移版本；真正免O(S)扫描的设计则应明确这个API边界，展示语义代价后再决定。

## 当前可独立推进与需协调的边界

私有规划生命周期、空traffic重试、lazy graph和港口bound-first已经在本车道完成测试/测量；它们解决了重复和不需要的工作，但全局冷峰仍在。港口统一Berth容器的净删3行提案只是维护成本改进，不是下一轮全局目标；不为它重启一轮大工程。

下一轮最有判别力的实施是：主terrain所有者先核对nearest perimeter的小hunk和component Field存储域，或明确授权独立hunk所有权；本车道继续掌握naval消费端/港口/私有job，避免第二个terrain实现。所有新增实验继续完整14400tick、原输入/规则/思考频率/预算、每yield及旧快照差分，计入守卫、分配、恢复和GC。当前没有merge/deploy或10×承诺。
