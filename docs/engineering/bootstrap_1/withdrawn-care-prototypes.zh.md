# 撤回的工人预警和救援持续原型

两个原型均未发布，已从活动运行时撤回；不放宽既有断言，也不把局部通过当作实战提升。

矿工预警以到掩护点的道路时间提前撤离，四个实际镜像场景通过并恢复原矿工作；但相同 12000→18000 骑士实战，原 #352 新增永久损失 11，原型在 17756 提前败北，新增永久损失 45，其中 22 工人。其范围过大，收入与守军一同失守。证据 /tmp/bootstrap_1-miner-evacuation-knight.json，源差异保存在 /tmp/bootstrap_1-miner-evacuation-withdrawn.patch。

随后仅保持既有受伤 avoidCombat 移动在眼前威胁未离开时的救援。36 项相关 SDK 检查通过，但同一 12000→18000 窗口的永久损失 11→14，原掠夺骑兵仍阵亡，期末永久军队最大生命总量 3470→2983。该单行持续原型也撤回，证据 /tmp/bootstrap_1-care-threat-continuity-knight.json 与 /tmp/bootstrap_1-care-threat-continuity-withdrawn.patch。上述临时证据保留在执行工作区，不视为公开成果。

当前公开 #352 的另一固定召唤师开局：Greystone Pass／Ember／方向 1 对冻结 v5＋v7，原生 13809 tick 败北、28 个永久损失。该失败没有完整相同父版本控制，不作跨引擎回归比较；下一步核验小部队反制采购在十人门槛之前的准入。
