# 房间 AI 对打与冻结基线

`room-baseline-646c` 的封存和逐命令对拍见 [冻结说明](room-baseline-646c.zh.md)。本工具让冻结策略与当前
策略通过同一套当前 sim、命令准入、15 tick 思考分相和 3 tick 交付延迟对打，不改变线上默认 AI。

## 运行

先按冻结说明准备经过 SHA 校验的缓存，再运行：

```sh
node --import tsx scripts/ai-room-ab.ts \
  --a room-baseline-646c --b room-current \
  --seeds ab-0,ab-1,ab-2 --minutes 20 --workers 8 \
  --cache /path/to/cache --out /path/to/new-evidence-directory
```

`room-current` 使用各席位原来的 archer/summoner/knight 流派；也可指定 `v9_archer` 等已有具名 policy 版本。
冻结版本始终使用原三个流派的轮换阵容。每个种子保留同一份阵容，种族按座位交替，三个种子覆盖三流派 × 两种族。
`--maps` 接逗号分隔的既有地图 ID，默认固定的 11 图；`--modes ffa` 只跑主口径。
时限只接受 15–25 个模拟分钟；每局可以因原生胜负条件提早结束。worker 是独立 Node 进程，不共享 memory 或地图。

主口径是 **地图原生满席 FFA**，用房间的 `createRoom/roomToGameSetup` 生成。每席都是独立阵营；A/B 仅为报表
中的策略组，组内照样互相攻击。每种子两局，A/B 交替占席、再轮换一个出生位；地图 seed、流派、种族、owner ID
保持不变。ID 不带 baseline/current/A/B，避免策略按标签改变行为。

辅助口径是两席对局。原生两席图复用主口径结果；其他图重新生成两席布局，明确记为 `duel`，不能冒充满席房间。
默认三种子共 102 局：66 局原生满席、36 局额外两席。11 图的两席辅助统计合计 66 局，其中 30 局复用原生两席结果。

当前胜负规则以建筑存续为准。时限到达时所有有建筑的席位并列，其余按最后一次清空建筑的时间排位，同时清空并列。
允许清空后重建；不把首次清空永久判负。报告给出组内席位平均名次、归一化名次、最终存活比例、建筑存续秒数和原生胜局。
平局单列；全平不会写成“胜率五五开”。不同地图的原生席数不同，因此同时保留逐图结果。

## 可复核输出

`matrix.json` 固定配置、每局阵容、Git 提交、工作树 diff 哈希、驱动/测量器逐文件哈希、Node/主机和冻结产物哈希。
子进程启动前核对同一来源；已有输出拒绝覆盖。`--case NAME` 可运行矩阵中的单项。

每局保存初始 snapshot/nextId、压缩的计划/实际交付命令、归一化保留任务事实、全部死亡账本行，以及 `summary.json`。
汇总 `summary.json` 有主/辅助/逐图分组；`seats.csv` 每席一行。摘要包含完整命令流、最终 snapshot、canonical state、
checksum 和 memory 哈希。生成物只放缓存或 evidence store；仓库只留小型摘要和证据指针。

## 行为指标的定义与限制

本版测量器 `version: 1`，任务归因明确标为 inferred，读取正常规划后保留的任务事实，不再次运行选择器或裁剪 claim。
冻结 memory 使用固定 646c 的输出 schema 和只读 decoder，不让未来的 live selector 重新解释基线意图。

| 指标 | 定义 |
| --- | --- |
| 空闲兵力秒数 | 每 tick 累加存活战斗/施法单位；没有保留任务、没有 general 战斗组任务、没有实际攻击/登船/治疗等作业且不在船/塔内，计入空闲。普通无任务移动仍为空闲。不是“没有发新命令”的时间。 |
| A-B-A | 按单位保留的首要目标稳定 ID 变更，连续不同目标历史出现 A→B→A 计一次；普通 claim→明确 membership 的同 ID 精化不算切换。 |
| 据点响应 | 据点指 townHall。实际原生伤害开始一轮，300 tick 无后续伤害结束；本方存活陆地兵力到 650 范围内记录首次到场，原已在场为 0。未到场的毁灭/静默/结束样本保留为删失，不填 0。 |
| 兵在别处据点被拆 | 原生 townHall kill 边界，存在本方兵力，但其周围 650 内没有可用的本方陆地兵；没有兵时不算“兵在别处”。 |
| 首次扩张 | 新 townHall 真正完工，且离所有原始本方 townHall 大于 300；与 #570 一致。 |
| 首次岛屿清营开始/完成 | 保留的 island 清营任务关联怪物，实际原生 attack order（包括自动索敌）开始计时；原始整营怪物全部消失/死亡才完成。无本方参与的他人清营不记本方完成；共同参与在原始记录列出。 |
| 首次敌方出击 | 正常下达的非 gather general attack、直接攻敌建筑，或载兵的 assault:sailing 运输命令；清营命令排除。不用距离敌建筑 650 的代理指标。 |
| 完成目标数 | 分列本陆扩张、异陆完工、岛屿清营和原生击杀敌方 townHall；分别统计全局和前 15 分钟。同营成员在死亡时不会拆成几个目标。 |
| 进攻/压制比例 | 至少一名存活兵承担非清营、非 gather/暂停的 attack/raid/naval-combat，或 general attack 组任务的 tick 比例；这是保留任务状态归因，不冒称真实接敌时长。 |
| 抢占 | 当前模块没有正式分配器抢占事件；`preemptions` 和理由为 null，不能把目标切换伪造为抢占。 |
| 死亡分类 | 使用现有原生死亡账本的 normal/suspicious/abnormal/unattributed/lifecycle、主分类及目录金币损失，按每席汇总；全部原始行保留。原生 unitsLost 必须与账本 nativeLosses 对账一致。 |

建筑伤害与击杀原本已到达 sim 的观测入口，本次只补充独立只读订阅，提供真正的建筑/来源边界；不增加 Game、快照
或 checksum 字段。建筑击杀不会混进单位伤亡账本。

## 隔离与观测透明性

```sh
node --import tsx scripts/verify-room-ab-isolation.ts \
  --cache /path/to/cache --out /path/to/new-isolation-directory
```

在陆地两席和海岛满席两种真实混合局中各跑 6000 tick：

1. 每次实际 baseline 规划前后对 snapshot 和 map 分别做完整 JSON SHA-256；另外把现役 planner 刚用过的**同一个对象**
   交给独立 frozen probe，前后同样深哈希。
2. 保存混合局现役 AI 的精确快照流、逐命令字节和 memory 哈希。在两个全新进程里重放：仅现役 AI；在现役调用前/后
   交替穿插 baseline 调用。每一步的现役命令字节及 memory 都必须等于原混合局。这控制了对手造成的世界差异，检验私有
   terrain/overlay 缓存不会互相污染，而不是比较两场不同对局的总命令数。
3. 另一新进程关闭所有行为/死亡观测器，按相同混合阵容完整重跑。计划、交付命令、memory、最终 snapshot、canonical state
   和 checksum 全部相等才通过。此项也覆盖观测器使用地形查询不会改变策略输出。

冻结产物本身已经由 #577 证明没有外部 runtime import；本检查补的是同进程、同输入的行为隔离。检查没有覆盖所有未来快照
协议变动；协议变动时仍须显式处理兼容和重跑。

## 基线自对打报告

验收摘要及原始证据在完成运行后附于本节。压倒性胜出的门槛由 owner 另行确定，工具不擅设门槛。
