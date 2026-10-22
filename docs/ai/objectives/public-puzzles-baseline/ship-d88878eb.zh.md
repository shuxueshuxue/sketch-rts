# d88878eb：原顺序判法与真实工人安全判法并列

**K20结构检查2/2；旧执行判法0/2，新工人安全＋步骤归属判法1/2。** 两局各560次真实think、8400 tick。持续留守的完整义务超过本轮时限，阶段在岗单列，不计为整段完成。

固定生产`d88878eb79ff7fcc0f2dfaf99ec1ba7452a95bff`，实际原运行源码`8bc0cd4aeb1a8c871a015bdb7c418f382c528a24`。原场景、世界、价格、资源、6144预算和原断言均未热换。新版安全检查固定`cdb702d0a3303520f48ed0e3a7ca63bf2f52d194`，仅对原轨迹另作派生检查；旧Vitest报告和退出码保留。[此前597检查点](ship-59792793.zh.md)不回写。

## 两种执行判法

23:39定案允许先把工人运到安全远滩，再与清营并行。旧“营地清掉后才上岛”是保护工人的代理条件。本轮原硬顺序检查保留；新版改查工人在未清营地的原生alert/有效追击保护范围外、没有营地伤害、全程无死亡，以及正式建厅当帧逻辑矿点和精确施工点两条site-safe均已生效。

| 变体 | 原生exit | 旧顺序执行 | 严格五步骤归属 | 新安全＋物理效果＋步骤归属 |
| --- | ---: | --- | --- | --- |
| far | 1 | False | False | False |
| near | 1 | False | True | True |

新版不是重跑AI：只应用原完整SDK流，要求全部560次原owner-view快照和最终完整世界逐字相同，然后记录每个原生tick前后及真实伤害/死亡事件。任何快照不一致都不给新版通过结论。该重放确实调用SDK和sim；独立JSON审计没有额外游戏。两种判法对应同两条轨迹，不叠加分母。

| 变体 | 原快照相同数 | 最终世界相同 | 重放SDK事件 | pre/post样本 | 暴露样本 | 营地伤害事件 | 工人死亡 | 建厅双安全证据 |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| far | 560 | True | 261 | 16800 | 0 | 0 | 0 | 未建厅 |
| near | 560 | True | 138 | 16800 | 0 | 0 | 0 | True |

安全观察使用原生idle警戒/reach、有效当前目标与leash/response、cabin和可达判定；返营/目标丢失的过渡不冒充持续追击。包络是保守保护要求，不声称原生必然改打工人。实际营地伤害保留已移除来源的残留弹丸/状态；工人死亡包括其他来源。完整逐tick记录及原建厅事实见[安全派生](ship-d88878eb.worker-safety.json)。

## 链的实际进展

| 变体 | 集结 | 调船 | 运兵 | 清营 | 运工 | 建厅 | 留守 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| far | 10/t150 | 295/t4425 | 361/t5415 | — | 34/t510 | — | — |
| near | 9/t135 | 59/t885 | 175/t2625 | 248/t3720 | 15/t225 | 261/t3915 | 313/t4695 |

表内为首次正式goal准入的think/绝对tick，不是完成时间。每一步另核独立原SDK应用和真实世界效果；board、卸载、营地死亡、建厅完成分别保留。wait-income没有物理SDK命令，单列观察。

| 变体 | 步骤 | 归属结果 | goal准入数 | 实际SDK应用数 | 首次效果观察绝对tick |
| --- | --- | --- | ---: | ---: | --- |
| far | position-transport | goal-confirmed | 3 | 3 | 4995 |
| far | transport-force | goal-confirmed | 9 | 9 | 6225 |
| far | clear-camp | unconfirmed | 0 | 0 | — |
| far | transport-worker | goal-confirmed | 213 | 2 | 4215 |
| far | build | unconfirmed | 0 | 0 | — |
| near | position-transport | goal-confirmed | 1 | 1 | 1320 |
| near | transport-force | goal-confirmed | 11 | 11 | 3270 |
| near | clear-camp | goal-confirmed | 5 | 5 | 3915 |
| near | transport-worker | goal-confirmed | 23 | 2 | 840 |
| near | build | goal-confirmed | 1 | 1 | 4695 |

末列为步骤归属器首次效果观察的snapshot.tick；低频观察不冒充精确原生发生时刻，SDK应用另按独立原事件核。[步骤及完整SDK对应](ship-d88878eb.native-ownership.json)、[链与末图](ship-d88878eb.chain.json)。

近船工人先在安全远滩真实落地，营地当时未清；逻辑矿仍unsafe。原四兵随后清营，两具名鱼人原生死亡3864/3903，3915同代camp-cleared/action-finished；四兵存活，末HP145/145/145/79。净缺HP66不当累计伤害或零成本。首建厅3915、独立SDK3918，逻辑矿resource-1(2976,896)和施工(2800,720)两条原site-safe均在当帧met/available3915、绑定真实finish4713；没有用远滩安全代替矿点。

## 实际400、中央ACK和原购建绑定

| 变体 | 中央foundation付款收据数 | 有原购建binding的观察帧 | 首原生地基观察 | 首厅完整观察 |
| --- | ---: | ---: | --- | --- |
| far | 0 | 0 | — | — |
| near | 1 | 286 | 275/t4125 | 313/t4695 |

近船原3915 v67/gen12、command3915:261:1/spend:v4经实际SDK3918建同一1090厅。3930→4125原生累计goldSpent955→1355，恰400；现金545→205另有60收入，不能把340当成本。4125原预算paid400/spent、唯一foundation nativePayment及原outputs[building]绑定1090，4695原购建complete后保持到8400；预算没有改挂wait或释放。完整138 SDK只一条townHall build，旧经济厅被拒。远船完整261条SDK没有townHall build，未进入购建，也没有中央foundation付款收据；因此实际购建的唯一400、中央ACK与原绑定为近船1/1，不把远船未购建当成ACK故障。

[全560帧资本观察](ship-d88878eb.capital-ack.json)和[23独立资金审计](ship-d88878eb.economy-audit.json)区分真实扣款、原spend核销、精确原购建绑定与后继repair。只读marker视图不冒充另外560次运行。

## 留守阶段和未到期义务

| 变体 | 首厅完整观察 | 厅后首hold命令 | 厅后首hold执行 | 含hold执行帧数 |
| --- | --- | --- | --- | ---: |
| far | — | — | — | 0 |
| near | 313/t4695 | 313/t4695 | 313/t4695 | 248 |

近船4695 v88/gen19四条正式holdPosition，4698四条独立SDK应用；4710/4725及8400同token原四兵真实native hold、无中断assignment。末帧checkedTick8400、当前安全窗10800、四租约完整到12015；兵组在post180内和矿650覆盖内。garrison-ready(12015)仍明确unmet/in-progress，另12840谓词也未满足，不能用12015租约替它证明。完整SDK后续没有命令再指向四兵，与采样原帧构成阶段续行证据；不替代逐tick保护证明或未来整段完成。

[留守观察](ship-d88878eb.garrison.json)和[37原生领域审计](ship-d88878eb.domain-audit.json)保留实际义务、时点、成员、租约和安全窗。整个题1仍须区分五步检查点、中央付款、留守交接和完整未来义务。

## 首卡点、预算与证据

远船运行中实际出现goal-search-pinned-capacity：超限的是独立search缓存，不是authority。两同矿目标比较图均被真实引用，原上限262144B不变；本轮没有丢目标、裁报价、增加上限或热换32的短事实引用后笔。末帧两图都因284352B>262144B而search-pending；ConquerIsland已有known/ready的集合节点，但顶层ready仍为空，未进入清营执行器。ExpandLand另有净值−0.9572413586657494。26纯原生陆块查验显示四原步兵都在目标land2、HP167，两鱼人仍80HP；该far末帧只读证据由26核，23/37本次交接返回not-live，不冒称其独审。[末帧原值](ship-d88878eb.causality.json)。最终图和原理由如下：

```json
[
  {
    "goalId": "ConquerIsland:planner:resource-1",
    "status": "search-pending",
    "reasons": [
      {
        "code": "goal-search-pinned-capacity",
        "values": {
          "bytes": 284352,
          "limitBytes": 262144
        }
      }
    ],
    "selected": [
      {
        "kind": "assemble",
        "state": "ready",
        "refinementState": "known",
        "unmetPreconditionCount": 0
      },
      {
        "kind": "clear-camp",
        "state": "waiting-actions",
        "refinementState": "known",
        "unmetPreconditionCount": 1
      },
      {
        "kind": "build",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 1
      },
      {
        "kind": "assemble",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 1
      },
      {
        "kind": "hold-position",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 3
      }
    ],
    "pendingFactCount": 0,
    "deferredCandidateCount": 5
  },
  {
    "goalId": "ExpandLand:planner:resource-1",
    "status": "search-pending",
    "reasons": [
      {
        "code": "goal-plan-net-nonpositive",
        "values": {
          "valueGold": -0.9572413586657494
        }
      },
      {
        "code": "goal-search-pinned-capacity",
        "values": {
          "bytes": 284352,
          "limitBytes": 262144
        }
      }
    ],
    "selected": [
      {
        "kind": "wait-income",
        "state": "ready",
        "refinementState": "known",
        "unmetPreconditionCount": 0
      },
      {
        "kind": "assemble",
        "state": "ready",
        "refinementState": "known",
        "unmetPreconditionCount": 0
      },
      {
        "kind": "clear-camp",
        "state": "waiting-actions",
        "refinementState": "known",
        "unmetPreconditionCount": 1
      },
      {
        "kind": "build",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 2
      },
      {
        "kind": "assemble",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 1
      },
      {
        "kind": "hold-position",
        "state": "waiting-actions",
        "refinementState": null,
        "unmetPreconditionCount": 3
      }
    ],
    "pendingFactCount": 0,
    "deferredCandidateCount": 5
  }
]
```

| 模式/变体 | think数 | 总work | critical-route | existing-field | background-field |
| --- | ---: | ---: | ---: | ---: | ---: |
| cold/far | 20 | 61636 | 11500 | 16366 | 33770 |
| cold/near | 20 | 67901 | 10888 | 8212 | 48801 |
| runtime/far | 560 | 2132741 | 1279521 | 79543 | 773677 |
| runtime/near | 560 | 1934034 | 1210232 | 91104 | 632698 |

40冷帧＋1120真实think的有序services均逐项相和=used≤6144。search work、expansions、depth、limitReason完整保留；最后continuation累计expansions不重复当本次节点数。几何工作不充搜索，campModelUsage是报价观察而不是战斗场数。[完整指标](ship-d88878eb.metrics.json)。

冷帧均K20结构passed/stable，首次可执行far5/near4；原快照及tick1不变。根/tools-ai tsc、SDK7、结构9、步骤7预检均exit0；两个原进程单worker独立，汇总仅各6项原断言。没有跑其他题执行或全量src测试。新安全检查另有8合同、原结构9/步骤7、SDK7/root0；其开发时读取器/类型失败日志随独立source封存，不冒充生产失败或更多游戏。

原SSH会话中断返回255时，A100原runner和两原native子进程持续运行；只恢复原console管道的读取端，未重启游戏、发信号、改source或原FD。原Vitest退出码仍以上表及commands.json为准，不能用SSH255替代。[进程报告](ship-d88878eb.processes.json)。

[完整证据指针](ship-d88878eb.evidence.json)：SHA`b15e25caaa89b3d3ef2c5dee09fed6ea3d9428826f5d9f3e2675a69f719f7a9a`，631973158B，存储端字节与SHA已核。包括两条原运行、SDK、before/after memory、原判法及新版同轨迹安全记录、checker源码/失败开发日志和23/37独立审计；重叠审计不叠加分母。实际运行源码归档`archive/public-puzzles-ship-d88878eb-source-20261021`，PR585保持draft，不合并。

Git审阅资金附件的两处旧字段标签映射为`rejectedOlderHall`，附件内保留可解码的原键映射。首次SDK命名边界检查因此失败，修正仅限Git审阅标签，原canonical与23审计SHA/值均不改；复核日志另存。
