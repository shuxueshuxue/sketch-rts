# 夺岛的持久兵力集结

`strategy.conquest-methods` 在实际清营组不足时，具体化同一个 `staged-beachhead` 方法的 `stage: assembly`。这个阶段只有稳定的 `<methodId>/assemble-force` 协调动作：只绑定本次获配的真实永久战兵，不预留工程兵、船或矿厅本金，也不把预测 job 变成单位。框架按这些实际成员重报价，集结兵仍可被更高边际收益的防守抢占；下一次 think 可重新加入实际新生或恢复归队的成员。

每个陆块有一个稳定 post。目标岛复用现有清营 staging；来源岛优先使用已发布装船陆点的陆侧安全集结点，未发布时可留在当前己方基地附近。选点复用原生可走点、营地接触和现有威胁范围判定，不能放在实际船体甲板范围内。上一个仍合法安全的 post 优先保留。各 post 只接收本陆块实际成员；已在船但尚无此集结方法原点契约的成员保留 `assembly-aboard-origin-unquoted`，不捏造一个陆块让它跨水步行。

受控规划通过 `withConquestAssemblyPlanning` 使用同一事务的 `AllocationLandRouteReader`。营地 approach 的退路、到 staging 的道路和距离都只读该端口；未知保持 pending，并在没有其他安全 post 时保留具体路线缺项。近敌候选保守拒绝，不调用原生 `canReach` 偷算路线。同步 scope 支持嵌套和异常恢复；不在 scope 内的原执行仍走既有原生几何。此端口测试只证明没有绕过共享入口，完整 6144 工作上限仍需共同入口的统一诊断闸验证。

协调动作和框架共用 `assessForceAssemblyPosts`：全部 posts 的实际到岗、未中断成员并集只评一次整组 camp-force。预测供给不参与这个实际出发门槛。真实到岗足额后，同一方法 ID 扩成原来的运输、清营、建厅和驻防图；此时才恢复工程兵、航次和真实支出前置。已经执行的运输链不因离开旧 post 而重新进入集结。

中断名单由当次正式 assignment 注入。即使治疗中的兵还在 post 范围内，也不能计入当前够兵、提前切换 execution，或在报价中伪装成正常到岗；真实恢复回归由共享供给 reader 另行报价。情景上限只使该项预测 unknown，报价保留 scenario 计数和原始缺失叶，不中止整个 think。

集结报价只消费同一 think 的 `assemblyFacts`。共享 reader 给出确定供给和条件供给的 `P_fill`、首次凑齐时间及已按该等待时间平移、裁窗的条件征岛货币结算。provider 不再折现整个 score，也不把无条件平均产兵率和失败概率再次相乘。条件续行收益、成本和目录价元数据按凑齐概率积分，`successProbability` 为 1；真实集结组与生产通道的机会成本在同一窗口只请求一次。结构化 continuation 假设随报价保留。

`combineAssemblyContinuations` 合并逐成功情景的 gross 货币结算。各路径先按自己的实际凑齐时间通过 `valueConquestContinuation` 结算，再用该路径概率除以已证成功概率作为条件权重。收益先积分路径自身的航行/战斗成功率；失败仍会发生的成本和持久收益按条件权重合并，合成结果的物理 P 为 1。provider 在外层只乘一次 `P_fill`。路径 ID、原概率、条件权重、凑齐 tick、窗口、原分项及输出分项索引全部保留；它不接管物理评估、导航、校准或机会报价。

支持尾部未解但已有正的成功概率下界时，合成器可按已证路径给出 `lower-bound` 结算，原上下界和未解质量作为结构化假设保留；这不表示剩余情景的真实概率为零。下界为零继续 unknown 或已知 blocked。已确认能凑齐的正概率路径若缺少货币结算、时间或同窗证据，仍明确拒收，不能把该路径的钱当作零；收益下界也不能直接当作被抢占时的损失上界。

正式集结被抢占时，`valueAssemblyCohortLoss` 对同一联合情景的抢占前、抢占后真实成员组分别调用 `valueConquestContinuation`。双方各自使用原现金流、各自 readyTick 和同一个比较窗口，重新计算首战概率、伤亡、运输和收入。凑齐时间相同不代表续行价值相同：原 6→5 个 ravager 的固定输入，readyTick 均为 0，续行价值由 282.337917 降到 277.035574，损失为 5.302343 金。每条路径保留前后 score、有符号差值、加权差值和现金分项；按联合概率合成后才取非负损失，再封顶于独立证明的同窗续行价值 cap。不会先平均成员组或凑齐时间，也不再次折现已积分 score。来回行走的切换成本由框架另计。

已知 `not-filled` 表示比较窗内没有该续行，按零续行价值处理；真正未知的正概率路径才按该路径概率使用整 cap，记录 `fallbackPaths` 和 `fallbackProbability`。没有有限价值 cap 时保持 unknown。已知部分矿工曲线可按原共享结算比较，不因无关的额外补员选项未求值就整 cap；实际路线、战斗或收入仍未知时不能补零。纯货币 helper 不计算新的物理事实，不改成员、租用或进度，也不调用导航、风险 batch 或机会 oracle。旧 `valueAssemblyDelayLoss` 只供已证明同一续行现金计划的延期分析，不能代替改变成员组后的正式反事实。

`adaptAssemblyDelayLoss` 将该数值证明绑定到正式 `AssemblyDisplacementQuote`。`bound` 只保留目标、同窗损失、续行价值 cap、模式和严格合计为损失的分项；完整路径证明独立放在返回的 `sidecar`，调用方不得将其并入决策 memory。前后成员组续行差标为 `scenario-continuation`，原同计划延期分析为 `scenario-delay`；正概率路径使用整 cap、发生截断或详细证明无法核对时标为 `whole-value-cap`。有符号路径合成后，正式分项输出合计损失，原路径及现金差仍留在 sidecar。浮点加总只向保守方向调和；缺少有限 cap 统一返回 `assembly-continuation-value-unknown`，供框架单独计数。

`prepareAssemblyConquestContinuation` 为每条成功供给路径准备独立续行计划。现存兵只在评估副本移到本陆块 post，已付 job 和条件样本仅有评估身份；工程兵及路线点名的船来自本次显式 response 池，并服从排除、救命中断及生产通道边界。副本时钟推进到该路径 readyTick，敌方数值 ETA 只减一次等待时间，己方已付队列扣除已消耗工作；未观测的新生单位、升级、战斗和世界变化不被模拟成事实。未来评估组的额外人口计入收入税率，但不产生真实出生或 lease。各路径现金流再平移回原比较窗口，不能用平均 ready 或折现过的 score 代替。

准备结果包含具体方法和 `materializedInput` 评估旁表，供框架唯一一次当前帧风险 batch 点名真实船/船厂。风险未发布时 `settlement=null`；`settlePreparedAssemblyConquestContinuation` 只消费同批 map 并重读已有事实，不再具体化、请求 Arrival、采样风险或调用机会 oracle。评估方法使用短哈希身份并显式区分真实船，避免不同船或正式执行计划共用风险键。完整评估输入、回调和样本 ID 都不进入 authority memory。续行现金流覆盖标为 `known-effects`；改变成员后必须重新准备并结算同一模型，不能只用原现金流的延期代替。正式有限 cap 的来源由框架另行证明。

评估身份覆盖本次实际选定的全部成员和支持资产（包括工程兵）、其位置/属性、逐段路线与时钟，以及原动作图的目标和依赖。长情景 ID 只进入摘要，不拼入原生请求；解释文案不参与身份。即使战兵、船和 readyTick 相同，目标侧已到岗工程兵与仍需渡海的另一名工程兵也必须形成不同计划，风险 batch 的 method 去重不能丢掉送工航次。回归同时核两种报价顺序、同成员路线变化和 JSON 恢复后的身份稳定。

`preparationAssumptions` 单独保留静态准备限制。每次纯结算只由该基线和本次矿工曲线缺口重建展示假设，不能把上一轮展示结果反过来作为事实输入；同样，`preparationMissing` 与本次动态风险缺项分开。这个边界不表示发布风险必然改变矿工 forecast，静态世界限制也不会随旧动态展示一起删除。

零或有限供给在窗口内确实凑不齐时，保留已知的 `needs-production`；没有必要再要求一个不存在的凑齐时间或续行价值，从而把已知不足变成 unknown。真正缺少同次供给、路线、当前恢复服务、续行结算或机会报价时，仍明确列出缺失事实。没有共享 reader 时不能借只读目标 score 或迁移旧任务的上界填价。

当前端口回归覆盖同窗 gross/net 重报、一次概率积分和机会扣费、已知零供给、稳定 ID 的够兵交接，以及真实 N(e) 多陆块安全 post 和子集绑定。这些结果不代表条件供给已完成全局校准，也不代表自然 grant、18000 tick 行为或不晚于 baseline 建厅的验收通过；正式连续运行必须使用联合冻结源。
