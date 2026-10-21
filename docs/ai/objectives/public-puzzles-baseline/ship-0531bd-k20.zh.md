# 0531题1：ready为0时补满K20

**原图/资源判法far通过、near失败；两变体可执行计划仍为0，ready始终0。** 两帧各完成20次原生think，position-transport与transport-worker均未有known精化、exact声明或ready。正式执行使用原源码独立运行，本报告只记冷帧，不冒充岛厅完成。

生产固定`0531bd3c9d847a7606535d14d0c136af22e20b36`。原完整运行源码`2f82c4ec6e316bb61f55a963d671f392ec6e59ca`的far图在第1次已通过，图稳定后第4次提前结束，但ready仍0。
补录源码`fcfc0bb5ab449a3f12dfca5aeda6d6c7602c3fc3`只收紧测试生命周期的早退条件：须图稳定且连续两次原判法通过并有ready动作，才能提前结束；ready=0须满K。32已确认该改动。
世界、原计划/物理断言、6144、策略输入均未改。A100独立owned checkout运行补录，原完整执行目录保持2f82源码。

## 两步精化、发布与ready

| 变体/动作 | 首次选中think | memory/node known | exact选中 | ready | 发布后ready变化 |
| --- | ---: | --- | --- | --- | --- |
| far position-transport | 1 | 20次内未出现 | 未出现 | 未出现 | 无发布时点可比较 |
| far transport-worker | 1 | 20次内未出现 | 未出现 | 未出现 | 同上 |
| near position-transport | 1 | 20次内未出现 | 未出现 | 未出现 | 同上 |
| near transport-worker | 1 | 20次内未出现 | 未出现 | 未出现 | 同上 |

position-transport中有两个被选节点，分别保留。transport-worker已进入选中图，但不是当前最前两层的精化任务，因此尚无该动作的精化内存entry；没有把“未开始精化”写成已经发布。
逐think原值见[far精化](ship-0531bd-k20.far-refinement.md)、[near精化](ship-0531bd-k20.near-refinement.md)。完整原ID、节点及前置、内存报价sourceRevision、原始coarse/exact声明与ready关联都在独立证据的JSONL与原frames中。

另一动作loading assemble的内存精化从**think2已known**，但到20节点仍是`coarse / waiting-facts / pending / selected-exact-source-changed`。
同一个物理snapshot/tick未变，原内存sourceRevision中的`world-geometry:vN`却逐think为v1…v20。known entry与节点pending分开保留，未将它计作ready。
这与32另行定位的失效版本依赖可回收句柄一致；本轮没有换入其后续修复。

far的`(176,816)`point搜索在think13记录memory-budget（native work52872）；near在20次内没有该failure记录，仍未完成目标精化。point缓存限额保持32KiB。
两帧的独立goal geometry容量均无pressure/overflow，末次及峰值pinnedBytes45、pinnedEntries0，默认33776B/38项未改。point容量失败与geometry容量分开记录。

## 资源和顺序

两帧共40次按原初始余额、原选中声明与计划时刻，调用正式`projectGoalResources`纯重放，**全部met，deficits=[]**。该收据只证明本轮资源前缀，未补余额、事实或发令。
abfab的“post支取战力4但available0”在本轮原输入下不再出现；选中图已包含pool→loading-post assemble，清营→运工人的原顺序也通过。

far原判法从think1到20都通过，稳定图成立。near原判法从1到20都失败：首次transport-force前有**2个position-transport前驱**，违反“近船已就位，不需要初始调船”的既有断言。
没有改断言放过这条过度行动回归。两个根计划状态都为waiting-facts；图判法通过与可执行分别统计，首次可执行均null。

[逐think图/前驱/精化/负债诊断](ship-0531bd-k20.diagnostics.json)保留这40次原值，完整资源重放在证据`resource-replay.json`。

## search四字段与6144服务账本

每次、每个实际计划的search均为`work407 / expansions407 / depth6 / limitReason=null`。未累加累计expansions代替工作量。

| 变体 | 20次实际queue总work | 搜索服务work | background-field | 峰值单次queue |
| --- | ---: | ---: | ---: | ---: |
| far | 65943 | 8140 | 57803 | 5307 |
| near | 85290 | 8140 | 77150 | 5314 |

每次都逐条核对services之和等于receipt.used且≤6144。原有有序service key/tier/work全保留；搜索与几何不重复相加。
[far逐think搜索](ship-0531bd-k20.far-search.md)、[near逐think搜索](ship-0531bd-k20.near-search.md)、[首末/服务key汇总与精化首次观察](ship-0531bd-k20.metrics.json)、[全部40次原收据](ship-0531bd-k20.cold.json)。

## 校验、分轮与证据

补录根tsc、tools/ai tsc、SDK边界均exit0。仅筛选原两条frozen-world检查：**1通过、1失败、10项按筛选跳过，exit1**。本段没有重跑真实模拟或全量src。
两快照与原a0帧逐JSON字节相同；始终同一snapshot对象/tick1，memory延续，thinkSequence1…20。far快照SHA`4f1552e780c76a2d1966646470b744de73436eeb452368df74e1ae4ee28e8a78`；near为`e457c849ed51985dcfc184fc02101edc09fd274788b782f26a563fe455a39cea`。

补录far的前4次与原2f82早停片的observed（含output/cache）、memoryAfter、work、planHash、ready及原判法结果逐值相同；[对照](ship-0531bd-k20.prefix.json)标明原near当时尚未写完，没有伪造它的对照。
原完整运行的近船冷帧与真实执行应在其完成后按原source另封存，不能拿本段补录重标该轮。

[K20独立证据](ship-0531bd-k20.evidence.json)：SHA`2a9a33ff7e65c75bb974615adcd17990825ce02fd8a9d7bed4363162d0011b46`，4609556B，存储端SHA已复核。
含40次原输入/输出/cache/memory/精化/6144收据、完整首末图、纯资源重放、源码文件哈希、精确生命周期diff、复跑与只读分析脚本。
A100原目录`/codegeex/jeffry/sketch-public-puzzles/evidence/ship-fcfc0bb5`；独立封存`public-planner-puzzles-ship-0531bd-k20-20261021`。
源码归档`archive/public-puzzles-ship-0531bd-k20-source-20261021`。

本报告只确认冷帧原判法1/2与可执行0/2。正式执行仍由原0531/2f82进程按原时限推进，完成后单独报告；不混入后续sourceRevision/路线修复。
