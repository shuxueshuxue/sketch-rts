# 2026-10-16 已关闭证据补充

本次只把已经封存的负例、只读审查和资源中断记录纳入文档索引。原 49 项逐值不变，追加后共 59 项；索引的 `productionHead` 仍是 `0f5bf01a`，没有把未合候选或随后进行的原生 API 开发登记为生产成绩。每包逐 payload 校验 SHA-256、字节数及完整 regular-file 覆盖；原 tar 不重封、不展开到仓库。核验与来源见 [integration 记录](closed-evidence-integration-20261016.json) 和[总索引](bootstrap-complete-games-20261015-index.json)。

| 新增封包 | indexed payload / regular files | 证据范围 |
| --- | ---: | --- |
| [timeout-witness](timeout-witness-0f5bf-220800-incomplete-evidence.tar.gz) | 603 / 604 | 216000 换码纯查询与双方原生窗口，同固定候选续至 220800，仍未胜且循环 |
| [income-reserve40968](bootstrap-land-income-reserve40968-evidence.tar.gz) | 687 / 688 | 历史弓手双 v8 局在 17400 换码，31331 自然败局 |
| [historical landing metrics](historical-landing-force-metrics-evidence.tar.gz) | 17 / 18 | 旧 V2、unified36ae 的真实甲板和登陆指标，只读 |
| [land-expansion ownership](land-expansion-army-ownership-evidence.tar.gz) | 33 / 34 | 40968 殖民防守军力、道路和原有 owner 的只读闭合 |
| [care native intent](bootstrap-care-native-intent-evidence.tar.gz) | 161 / 162 | 旧护理场景的到达、索敌、追击和伤亡因果，只读 |
| [knight sole loss](bootstrap-knight-sole-loss-0f5bf-evidence.tar.gz) | 242 / 243 | 原 44441 胜局唯一永久伤亡及明确人工微操分支 |
| [evacuation owner review](bootstrap-evacuation-owner-independent-review-evidence.tar.gz) | 9 / 10 | 原普通局两名撤离登船兵死亡的独立只读审查 |
| [passenger boarding review](bootstrap-passenger-boarding-independent-review-evidence.tar.gz) | 3 / 4 | 独立候选入口、工人等价性、短窗和冷 JSON 的只读核对 |
| [postseal clarifications](bootstrap-postseal-clarifications-20261016-evidence.tar.gz) | 5 / 6 | 研究成本、原生设计建议、7905 归因勘误和旧甲板边界审查 |
| [interruption / finite diagnostics](bootstrap-interruption-and-finite-diagnostics-20261016-evidence.tar.gz) | 65 / 66 | 两次 exit137、持久尾流与完整周期档、75 tick 支持诊断和无损资源迁移 |

计数统一排除各包自己的 manifest；例如旧 income delivery 把 688 个 regular files 称为 payload，care delivery 把 162 个 regular files 称为 payload，此处按实际清单分别是 687、161，不修改原封包。

## 未合候选与历史失败

timeout-witness 仅禁止没有真实永久陆战参与者的空搜索船为 loaded assault 续等；原 40/20 秒、32px 和入侵兵力门槛保留。输入是旧 unified36ae 的 216000 全世界、nextId 与双方记忆，候选基于 plain0f5bf；这是换码组件及原生续窗，不能把不同源码的完整轨迹当作相等。到 220800 有真实取消、卸载和再登船，却没有有效新进攻、收入、伤亡或胜者，且实际兵力 15.048867 仍低于 required 19.509563。该候选未合入。

40968 是保留研究现金的单候选，承接历史 3bdb 弓手对正常冻结 v8+v8 的 17400 档。新厅实际支付并完工，随后建造工与厅被杀；31331 敌方自然获胜，己方清空。补充 JSON 记录 weaponTraining3 实际完成从 19695 延至 20835，延迟 1140 tick；这是实在成本，不能说是全部败因，也不能把“早建厅”算成净收益。

land-expansion 审查确认 19035 有真实 escort plan，不能写成从来没派防守。20370 全局军力满足原总量门槛，但现场仅一名近兵，其余道路需要数百 tick；局部 detach 与保留主军门槛、治疗者既有 claim 需分别看。历史 landing metrics 同样区分船上总军力、同岸 cohort、当前 native berth 许可与实际目标岛兵力；没有把有限点查询说成连续几何不可达证明。

## 原生护理与甲板证据

care-native-intent 没有发新命令、改 AI 或新增普通局。7905 场景的 7912 提前到达应归原生 `walkDestination` 第一分支：到达点在原目标 5 范围内，而圆形楼体接触判定为 false。7913 索敌、7914 追击、7921 死亡仍成立，必须与 postseal 勘误一起读。10425 的后来开火是新 macro attackMove，不是到达后自动追击；16245 的滑移也不能误报为追击。primitive proposal 只是当时设计建议，本补充不含随后实现或验收。

sole-loss 包属于原 0f5bf 骑士普通局的 44441 胜绩。它复原唯一永久伤亡 raider2245@35616，并保留三次单乘员人工保命和一次全组 hold 负例。原场景已有 priest 的真实治疗；单人保全仍有同伴受伤，全组 hold 则令另一舰 raider2068 死亡且两龙仍活，不能推导全舰 hold 安全。deck-boundary-v2 是对旧源和这些人工证据的只读审查，不是活动 deck-casualty-v2 实现的代码审查或比赛成绩。

## 撤离安全候选与中断边界

两份独立审查分别针对原局 board 分支死亡和新 land-passenger 候选，审查者没有运行新比赛或测试。原审查时 21885 完整输入确实缺失；后来从真实 21600 档支持重建并不倒填当时的证据。21885 与 22335 原首次招募在实际查询中仍安全；22515 是原轨迹上的反事实 query，不能当成候选真正首触发。候选自 22200 换码运行，先在 22365 释放5665、22410释放5447；两名原 ravager 最后仍死。

22200→23400 候选局部永久损失 9→3、敌永久损失 1→3，有真实反击和医疗接手，仍没有楼击杀或胜者。22500 冷 JSON 到 23400 的完整世界、nextId、三方记忆、901 tick hash、242 commands 和 73 hits 全等；56 events 只有在包含 22500 after-command 且明确将局部 recorder `commandIndex +69` 映射后才相等，原始 literal 比较为 false。旧 observer 的 `miningWorkers` 错查 `gather` 而非原生 `mine`，该派生字段无效，原报告保持原样并附勘误；不能拿这个旧字段断言真实矿工为零。

该候选是基线 HEAD 0f5bf 加固定 1430 文件清单的未提交源码，22200 换码、23400 同码续局，在最后完整 34800 档后保留至 34860 的尾流，进程 exit137。另一个真正普通 0 的召唤对冻结 v5+v7 原进程也在最后完整 79800 档后 exit137；其持久尾流为 139 commands、2 hits、10 events。两局相互独立，均不能把中断写成自然结局；本包不收入仍在运行的原普通局恢复结果。

随后仅做一次独立 Node 512MB 的 34800→34875 有限支持诊断，尾流 prefix 全闭合并保存逐 owner 完整输入，fixed1430 源码与 frozen manifest 不变。外部 bundle 只在原 `groundSteeringRoute` 出现精确重复 XY 时抛诊断，没有 cap 或截断“安全返回”；实际 34875 p0 query 正常给出 3 命令、route 调用 0，没有该输入 cycle 证据。exit137 与当时 cgroup 累计 oom 值不能指定进程 OOM 根因，更不能据此归咎 routing。

资源包还保存两份已关闭历史证据迁移：逐文件 SHA、字节、mode、symlink、mtime 完整复制复验后保留原路径 symlink，仅删除已验证的临时备份，腾出 1,235,337,686 字节 tmpfs。部分基础 daemon 的 /proc FD 不可读限制保留；授权依据包含已关闭 owner 的生命周期确认，未声称证明全部 FD 均无引用。它不是比赛结果或源码变更。

规则 2、冻结对手迁移等价性、正常资源人口、三条路线及官方地图和未见种子的完整单/双对手验收均保持。没有新增普通 0、没有借用当前生产胜绩；原故障容器未提交改动的恢复缺口仍在。
