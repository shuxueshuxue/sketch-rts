# dee4d4b4 候选：题1冷启动与完整执行回归

**冷K20结构0/2；新版工人安全＋步骤归属执行0/2。** 两局各560次原生think、8400 tick，原生进程退出码分别为far 1、near 1。dee4仍为候选，未提升为验收头。

固定候选`dee4d4b4e048064ba07d9546e0536a0ad5315f81`，实际运行源码`26ad3fd30e9a1490a0aba85d1a831a8e717e5503`。与候选的AI/shared/SDK生产差异为0；两原初始世界逐字相同，K20、8400 tick、6144服务额度、结构稳定与正式步骤归属判法均未改。[d888原轮](ship-d88878eb.zh.md)保持原结果：冷2/2，新执行1/2。

## 冷K20：收敛到空图仍然失败

| 变体 | 结构通过 | 末三结构稳定 | 首可执行think | 末图动作数 | search work / expansions / depth / limitReason |
| --- | --- | --- | --- | ---: | --- |
| far | 失败 | True | None | 0 | 0 / 2048 / 0 / expansion-limit |
| near | 失败 | True | None | 0 | 0 / 481 / 0 / coarse-proposal-needs-alternative |

两变体均满K20，原checker报“army transport before camp: predecessor”。13个输入的revision收敛只证明不再改写，不能替代题目结构成功或方案保留。32后笔定位的同tick因果排序、未完成挑战覆盖原图属于后续修复诊断，不回写本轮。[完整冷记录](ship-dee4d4b4.cold.json)。

## 原8400执行与SDK归属

| 变体 | 新执行判法 | 原生think | 首goal命令tick | 实际正式命令总数 | 执行器累计 |
| --- | --- | ---: | ---: | ---: | --- |
| far | 失败 | 560 | 135 | 11 | {'goal.assemble': 9, 'goal.position-transport': 2} |
| near | 失败 | 560 | 105 | 7 | {'goal.assemble': 7} |

| 变体 | 所需步骤 | 归属结论 | goal准入 | 独立SDK应用 | 首效果观察tick |
| --- | --- | --- | ---: | ---: | --- |
| far | position-transport | goal-confirmed | 2 | 2 | 2115 |
| far | transport-force | unconfirmed | 0 | 0 | None |
| far | clear-camp | unconfirmed | 0 | 0 | None |
| far | transport-worker | unconfirmed | 0 | 0 | None |
| far | build | unconfirmed | 0 | 0 | None |
| near | position-transport | unconfirmed | 0 | 0 | None |
| near | transport-force | unconfirmed | 0 | 0 | None |
| near | clear-camp | unconfirmed | 0 | 0 | None |
| near | transport-worker | unconfirmed | 0 | 0 | None |
| near | build | unconfirmed | 0 | 0 | None |

每个实际SDK原事件都与原运行保存的receipt相等；准入、实际应用和世界效果分别记录。wait-income没有物理命令，不充完成步骤。未发建厅时，中央400 ACK和原购建绑定记为未进入购建，不把N/A凑成付款失败分母；也不把未来资本预留当已付款。没有正式hold时不以闲兵位置代持续留守。[完整归属](ship-dee4d4b4.native-ownership.json)、[链与末图](ship-dee4d4b4.chain.json)、[资本](ship-dee4d4b4.capital-ack.json)、[留守](ship-dee4d4b4.garrison.json)。

## 实际容量失败与观察阶段

原t1500完整member中，两局已出现`refinement-denial`容量压力。这与d888远船末尾的search缓存284352B超限是两条独立反例。原上限262144B未扩大，未删除有效否决记录来掩盖压力。

| 变体 | 原denial pressure / 上限B | 实际provider memoryBefore三根B | seal前展开observer memoryAfter三根B |
| --- | ---: | ---: | ---: |
| far | 2568698 / 262144 | 2575420 | 5620617 |
| near | 1937261 / 262144 | 1921857 | 4935818 |

三根为goalPlanning、共享goalPlanningReferences、strategyAllocation，shared表在对象内只序列化一次。数值为原生JS JSON.stringify的UTF-8字节，不是进程堆/RAM。memoryBefore是原think开始时实际provider已保存wire；memoryAfter是observer在seal前取的展开深拷贝，不能称末尾wire常驻。原after测量文件和原gzip未改，阶段更正另附；真实before仍严重超限，容量反例不撤销。原始before缺项按available=false保留，不当0字节或由after/相邻帧回填；初版读取器对此退出的原日志另存，修正仅呈现实际可用性。[t1500更正](ship-dee4d4b4.memory-phase-scope-addendum.json)、[全部1120帧分阶段计量](ship-dee4d4b4.memory-phases.json)。

完整轨迹的首次压力与末期峰值如下；每局仅原think1/t15的before缺项，559份before和560份after分别计量。

| 变体 | 首denial think/tick | 首search压力 think/tick | provider before三根峰B | 展开after三根峰B |
| --- | --- | --- | ---: | ---: |
| far | 36/540 | 267/4005 | 13715247 | 32351593 |
| near | 33/495 | 326/4890 | 12254886 | 31922502 |

两局末帧原理由与压力（仅将具名fact ID数组投影为计数，完整ID保留在执行JSON/原片）：

```json
[
  {
    "puzzle": "ship-away/far",
    "finalGoals": [
      {
        "goalId": "ConquerIsland:planner:resource-1",
        "status": "search-pending",
        "actions": [],
        "reasons": [
          {
            "code": "goal-cache-pinned-capacity",
            "values": {
              "bytes": 13641461,
              "limitBytes": 262144
            },
            "factIdCount": 1036
          },
          {
            "code": "goal-search-pinned-capacity",
            "values": {
              "bytes": 517516,
              "limitBytes": 262144
            },
            "factIdCount": 1
          }
        ],
        "capacityPressure": [
          {
            "kind": "refinement-denial",
            "thinkSequence": 560,
            "bytes": 13641461,
            "limitBytes": 262144,
            "entries": 1036,
            "limitEntries": 9007199254740991,
            "planIds": [
              "ConquerIsland:planner:resource-1"
            ],
            "overflowCount": 2,
            "requestCount": 1036
          },
          {
            "kind": "search",
            "thinkSequence": 560,
            "bytes": 517516,
            "limitBytes": 262144,
            "entries": 1,
            "limitEntries": 9007199254740991,
            "planIds": [
              "ConquerIsland:planner:resource-1"
            ],
            "overflowCount": 72,
            "requestCount": 1
          }
        ]
      }
    ]
  },
  {
    "puzzle": "ship-away/near",
    "finalGoals": [
      {
        "goalId": "ConquerIsland:planner:resource-1",
        "status": "search-pending",
        "actions": [],
        "reasons": [
          {
            "code": "goal-cache-pinned-capacity",
            "values": {
              "bytes": 12230564,
              "limitBytes": 262144
            },
            "factIdCount": 1012
          },
          {
            "code": "goal-search-pinned-capacity",
            "values": {
              "bytes": 467761,
              "limitBytes": 262144
            },
            "factIdCount": 1
          }
        ],
        "capacityPressure": [
          {
            "kind": "refinement-denial",
            "thinkSequence": 560,
            "bytes": 12230564,
            "limitBytes": 262144,
            "entries": 1012,
            "limitEntries": 9007199254740991,
            "planIds": [
              "ConquerIsland:planner:resource-1"
            ],
            "overflowCount": 2,
            "requestCount": 1012
          },
          {
            "kind": "search",
            "thinkSequence": 560,
            "bytes": 467761,
            "limitBytes": 262144,
            "entries": 1,
            "limitEntries": 9007199254740991,
            "planIds": [
              "ConquerIsland:planner:resource-1"
            ],
            "overflowCount": 103,
            "requestCount": 1
          }
        ]
      }
    ]
  }
]
```

## 工人安全与服务账本

| 变体 | 原快照相同数 | 最终世界相同 | 原SDK重放数 | pre/post样本 | 暴露样本 | 营地伤害事件 | 工人死亡 | 安全通过 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| far | 560 | True | 39 | 16800 | 0 | 0 | 0 | True |
| near | 560 | True | 35 | 16800 | 0 | 0 | 0 | True |

安全另用同一原SDK轨迹重放，调用真实SDK/sim但不调用AI/FactReader，不产生第二场AI游戏。全部560个原owner快照和最终世界逐字相同才接受派生检查。原运行直接observer判法、原硬顺序检查和原退出码照存；安全通过也不能补齐缺失步骤。

| 模式/变体 | think数 | 总服务work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 16385 | 4186 | 5860 | 6339 |
| cold/near | 20 | 16481 | 1501 | 5860 | 9120 |
| runtime/far | 560 | 2121850 | 34712 | 20819 | 2066319 |
| runtime/near | 560 | 120247 | 35662 | 7089 | 77496 |

40冷think＋1120真实think的services完整保留、逐项相和且每次≤6144。search的work/expansions/depth/limitReason单列，累计expansions不重复记作本think工作，几何工作不记作搜索。camp模型使用计数是报价观察而非战斗次数。[指标](ship-dee4d4b4.metrics.json)。

根/tools-ai/tools-cli、SDK边界、结构、步骤归属及worker安全共7个预检任务均exit0，原世界逐字检查通过。原near1800旧合同未作为本轮闸；它与实际K20失败分开记录。23按18404:16暂停候选资金独审，本报告的资本与领域数据是26纯读原记录，未冒称23/37独立审计。旧留守/精化读取器因短fact引用与recipe元数据格式报错，原失败日志/局部输出保留；兼容版只读同一原memory定义表，不调provider/FactReader，不重建完整配方或补事实，三项重读结果与源码见[兼容收据](ship-dee4d4b4.reader-corrections.json)。

## 原片与复现

canonical证据`ed0f86e3d0849aab03a1d274c6400861c633f610d3909be61b0e697447862a9c`（902318890B）。[指针](ship-dee4d4b4.evidence.json)包含两份未过滤原Vitest报告、原生退出码、冷原片、1120个完整原member及可用before/after memory、完整SDK、560快照一致的安全重放、所有reader源码、t1500反例及阶段更正、末8400原member、逐文件SHA清单。[过程](ship-dee4d4b4.processes.json)、[验证](ship-dee4d4b4.validation.json)。

两个原native进程各单worker并行，汇总仅收各6条原断言；其他变体被pattern过滤的skip完整留在原报告，不重复计数。没有重启、热换候选、改变世界/判法或额外跑题3。
