# nearestWalkable 直接枚举周边：未实施协调提案

**给主terrain车道审阅；没有应用patch，没有修改生产，没有编译或运行新CPU测试。** `NEAREST-PERIMETER.patch`仅把`src/shared/terrain.ts:1506`的c步长改为：首/末行1，中间行2*ring，并删除紧随的Math.max筛选；生产净减1行，无新容器/缓存/算法。terrain.ts仍归主车道，不能由本车道直接落地。

## 当前输入下的严格同序理由

`nearestWalkable:1492`的缓存命中与可走格提前返回不变。每个整数ring≥1，原循环按r-major/c-major扫完整square，但只有周边格能通过Math.max筛选：首/末行从col-ring逐1到col+ring，中间每行只保留左右两个端点。新步长恰好直接生成同一坐标序列；bounds、pad、walk读取、gap、原index tie、停止条件和nearest缓存写入全部保留。包括落在地图外的周边坐标，其bounds拒绝顺序也相同。

因此当前trace的正常安全整数网格不改变任何实际查询index/选择顺序：宽322、cols/rows均320，at为有限整数，最大实际R=21。原ring²>bestDistance停止条件继续使用，不提前停止、不改变搜索预算或规则，也不重建其它导航数据。

## 真实输入的精确迭代数

纯解析已有`nearest-A/summary.json`的nearestFacts，以闭式公式计数，未执行原循环或新循环。可复核汇总在`nearest-perimeter-counts.json`。

| tick 0 miss组 | 次数 | 原内层c迭代/次 | perimeter迭代/次 | 合计原→新 |
|---|---:|---:|---:|---:|
| R=21 | 3 | 14189 | 1848 | 42567→5544 |
| R=20 | 1 | 12340 | 1680 | 12340→1680 |
| R=1 | 41 | 9 | 8 | 369→328 |
| tick 0总计 | 45 | | | **55276→7552（7.319×）** |

移除47724次只为Math.max筛选服务的无效内层迭代，约86.34%；原实际周边候选没有减少。tick15无真正ring miss；tick30两次R1，为18→16。32tick共47次miss，总55294→7568。缓存命中与walkable提前返回不应混入这些次数。

一般扫到R，原sum(2r+1)²=(4R³+12R²+11R)/3，直接周边sum8r=4R(R+1)，移除(4R³−R)/3。最坏无解由三次量级内层工作降为平方量级，外层r循环仍不变。**本局实际R最高只有21，不能拿更大假设R的比例冒充这局收益。**

## 采样证据的限定

clean causal-A tick0 whole=95.33684ms、线程CPU=92.249ms、GC overlap=0。nearestWalkable是20个self samples，支持它是值得核对的真实CPU路径；不是精确调用计时。causal-P中该函数源码未改却只有4个self samples，说明不能把A的20当固定耗时，更不能把A/P差异归给这个尚未实施的patch。当前证明的是循环工作数机会7.32×，不是nearest CPU或全局max已缩小7.32×/10×；主车道采用后仍需未插钩子的交替整局对照。

## 异常数字边界及主车道待确认项

同序证明使用col/row、ring及各端点在安全整数范围的前提。正常padAt与旧整数runtime.width满足；当前cols/rows被改动但旧width仍整数、实际at和端点仍是安全整数时，也仍满足，不能把全部同对象尺寸变化都误判为不适用。

- 原始非整数cols形成非整数runtime.width、越出安全整数范围的at/端点、异常width/offset布局，不在本次严格坐标轨迹证明范围；浮点逐1累加和一次跨2r、以及删除严格Math.max===ring判断，不能仅凭TypeScript number类型声称任意异常raw输入都同轨迹。需主车道决定其现有支持边界并做相应差分；本提案没有悄悄加入修复或fallback分支。
- NaN at会令col/row为NaN，原/新内部row条件均不成立；NaN limit使两者都不进ring，缓存返回路径不变。负零/负at的现有归一化和Map key行为均没有改。
- 无限或过大维度/坐标可能让原循环不终止或整数递增停滞；此patch不承担修复它们，也不以缩小limit代替原验收。未在当前trace出现，不能把理论异常当成已经验证通过。

协调后验收应比较逐miss的候选index序列、原结果及tie、缓存命中/写入、同对象cell/cols/rows改动、NaN/非有限输入，以及正常整局状态/命令和峰值。先保留现有20→4采样变化的负面证据，避免把两行结构简化当作全局数量级目标完成。
