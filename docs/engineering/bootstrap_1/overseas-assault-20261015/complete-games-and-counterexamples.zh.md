# 2026-10-15 后续完整比赛与反证

生产源码仍为独立承接分支的 `3bdb3749bea4d3c415a8709d7a7f86b0ed1dcb71`。本记录保存独立比赛及未合候选，不将候选混入该源码成绩。规则2、历史冻结修订 d1ae110f、184项 manifest `0490e7d43d109e70be3b141f76d1276a778a3402f3ea19f51a8cd37fee941774` 均不变。完整包文件名、字节数和SHA256见同目录 `bootstrap-complete-games-20261015-index.json`。

## 新整合源码的真实普通0与续局分列

固定3bdb的真正普通0：v9_summoner Ember physical side1，对正常冻结v8 Grove，标准500金/3人口/8上限。已开发种子 bootstrap_1-unseen-summoner-v8-20261015-01，factory sapphire/实际生成ladder；不是新留出种子。原始0完整世界、nextId、双方null memory与旧25cce普通0起点严格相同。独立进程从0连续运行，在33688自然p0获胜；57份完整world/nextId/双方memory及33600→终局重演闭合，1555 live源与184冻结源前后不变。包 `bootstrap-root-3bdb-ordinary0-33688-evidence.tar.gz`。

该局26原生损失恰为26遗体：16临时spirit、10永久单位；旧25cce同例65739胜为74临时/17永久。更早获胜和更少永久伤亡属于组合整体在这个开发用例的观察收益，不能单归目标重定或几何护理。新终局仍有敌warship1445、210.35HP；自己只有原家1厅，没有殖民恢复。最后由2631/2937/3487三summoner及spirit进攻，2937在33688末击敌townHall8。不是首波三ravager幸存拆厅。

同生产3bdb随后独立跑v9_archer Grove side1对正常双v8，已开发pineshade生成ladder案例、种子 bootstrap_1-unseen-archer-v8-v8-20261015-01，从标准0连续至26107自然p1胜、我方全灭。44份完整world/nextId/三方memory、1555源前后不变、184冻结核验及末段25800/25815恢复均闭合。包 `bootstrap-production-root3bdb-archer-ordinary0-evidence.tar.gz` 引用已封3bdb完整源胶囊，未重复大源码包。**5f在43714胜的旧成绩不能归给3bdb**。保存采样至10200相等、10800不同；正在精确定位首命令及组合回归，不把采样相等延伸为所有帧相同，也不凭延续个别骑手存活来解释整局。

新源码首波12285公开portrait卸兵、12286 post-step三ravager和一worker确实在岸上。它们的2.8384永久兵力满足原required=1，但五名武装工人的军队强度按既有设计为0；冻结对手12375公开命令五工保卫基地。后续ravager1080/1051/1101分别12559/12706/12727死于岸工及新造lancer1699/1837，worker先12554被warship1445击杀，运输1043在12769被甲板lancer1390击毁。敌transport1385的旧四lancer整个12000..13200没有一次登陆，分别12732/13013/13054/13135在甲板死，不能算成该岛已登陆守军。原始完整命令、逐击伤害及capital/mission反证随包保留。

另一个固定3bdb实验是原40860完整存档换码续至49964自然胜，敌0单位/0楼。它与旧V2完整终态、nextId、双方记忆、7173条公开命令全等；48825 after-issue／48826 post-step实际下船的是七名永久兵，carrier2290另十一人仍在甲板。此续段有五名永久单位死亡。包 `bootstrap-root-retarget-3bdb-40860-win-evidence.tar.gz`。不能将此换码续局拼接为普通0。

## 骑士官方地图完整普通0

固定6f80a936的 v9_knight Grove side0 对正常冻结v5 Ember，官方 sapphireArchipelago 10240²，种子 bootstrap_1-knight-v5-official-sapphire-20261015-01，无 --unseen。从标准0连续运行到135692自然p0胜，114份完整checkpoint加0、870项运行/支持源及184冻结源核验。敌剩12单位、0楼；自己五厅。包 `bootstrap-knight-6f80a-ordinary-135692-evidence.tar.gz` 已含首波诊断与稀疏检出事故记录。

永久死亡43：21中立、22敌方。41遗体另加102878 carrier4699沉没时两名仍活乘员，不能只数遗体漏掉沉船乘员。首次重骑跨海进攻55200..56400无人登陆；最终攻下敌岛的是后期八名footman，首次完整样本134400已在岛上，实际下船只限界于(133200,134400]，终局七人在敌码头。路线自然胜不等于重骑首次登陆成功。

首次进攻的真实局部准入也没有把远处4699 loading乘员算作近海战力：55485直距445.5但海路480，正确等待；55500海路435.2、实际近船兵力26.091满足20.573，正确解除rally。可查询的未来落点安全并不代表执行中已可下船：55920/55935当前船体首个priest/worker仍无原生落点，55932后远程敌人开始射击甲板。55950换北岸后船需转身，56031开始死人，56160战力降到20.674不足21.038而正确取消。不能用降低门槛解释或修复。

事故边界：子代理错误在原普通树执行稀疏命令并disable，随后root在证明重复归档tracked且未改后恢复原pattern。运行/支持文件最终核验无变，实际游戏正常结束；不能据最终SHA排除运行时文件可用性影响。准确命令、cwd、时间、受影响路径与原始记录在包中，未声称原树从未改变。

## 保留但未合入的候选

- `bootstrap-knight-assault-approach-v1-negative-evidence.tar.gz`：c44442在同55200..56400双方AI窗0损失，却也0登陆/0敌楼；船反复远离岸，原89145断言仍红。立即安全停留不构成进攻修复。
- `bootstrap-knight-current-shore-v2-negative-evidence.tar.gz`：89f46304只在真实近海永久兵力满足原门槛、实际逐乘员落点允许时保留敌火覆盖的岸；同55200..56400依然0登陆/0杀敌/0拆楼，五人全死于甲板（原同窗七死且一杀）。13新旧测试/tsc及872源固定核验通过，不延此版本全局。暂时近海分散与未来船体相互占位仍需精确诊断，不据60tick样本当确定首因。
- `knight-shore-v1-negative-evidence.tar.gz`：34800两船确有原生可射站位；风险限制不是距离查询错误。短步接近后有真实炮击，但幼龙追上，warship1101到36840仅83/464HP；同36000原逻辑对照退至464HP。有限前缀安全不保证能撤离。
- `knight-shore-v2-negative-evidence.tar.gz`：释放闲置野怪目标后仍0新船令/0世界变化；既有fleetGoal位于敌岸军中，再被原风险拒绝。不能把清memory称解除了实际护航阻塞。
- `knight-colony-defense-6f80-evidence.tar.gz`：原殖民岛确有预警、造兵、塔击杀，64605三守军95/210、102/210、165/210HP，原1.4门槛确实要求撤离。不可称健康军队被无故拉走。
- `knight-evacuation-6f80-mixed-evidence.tar.gz`：固定候选64935按原门槛重评后释放八名岸上等船者；68400厅仍612HP但继续受击，三守军全亡。原生攻击中12击打空敌运输并击沉它，后又杀一弓手；未证明守住或更优完整比赛。6新测试、tsc通过；相关111/112，旧同例在未改6f80亦失败。无完整新比赛。
- `bootstrap-care-follow-v10-v12-evidence.tar.gz`：完整正负普通0必须成对保留。v11弓手同开发双v8案例38063胜、30永久死，相对5f的43714胜、56死有观察收益；但在pure457召唤同例从57109胜退化为19086败。82/93HP的小伤还不满足原生heal55/2门槛，不能要求持续follow直到满血。v12召唤与原57109完整全状态逐样本相同，弓手却19499败。旧六项红断言均保留，不合任一follow变体。骑手2503在10059已真正接受55治疗；10275野怪放弃追击才解除care，不能以未完成首次治疗为由锁定owner。
- `bootstrap-mounted-mineguard-v1-and-care-errata-evidence.tar.gz` 及 `bootstrap-mounted-mineguard-v1-first-loss-followup.tar.gz`：073f从矿防选兵池排出现役骑射任务，真实0到34864败。9915确取消一帧分队，9930已重新成立七人，用1339替骑手，不能说一直空防；16200其经济/死亡还优于旧局，17–20k失远矿与医疗群后才落后。包含原9934/10681两次逐原生tick路径纠错：前者微操被矿防过滤，后者所选直线本身进入ready rod圈；两条均非建筑投射偏差。
- `bootstrap-mounted-mineguard-v2-evidence.tar.gz`：ffa98d07保留原守矿七人及门槛/岗位，只在现役骑手ready-item风险时复用既有mountedEscape向原岗位避战。真实9600..11400骑手无伤且其余六兵岗位不变，145HP来自老兵maxHP成长，非治疗；完整普通0仍19815败，52永久死亡、0中立死亡。13800尚6死对旧9死，14400已18死对旧10死并失远矿/两fieldMedic；骑手最终16696死。22相关测试、末窗及固定源核验通过也不构成整场胜利，保持未合，不继续叠follow变体。
- `bootstrap-colony-escape-v1-candidate-evidence.tar.gz`：基于另一未合quiet-tower候选的39600换码，改善某些伤兵到达cover后原生自动索敌，55416自然胜；21永久/87临时死，相对quiet候选31永久死较好，却仍比原b0完整17永久死差。不是原b0只改escape的消融，更不是新整合版普通0；quiet与escape都未合。
- `bootstrap-workforce-114dd-complete-evidence.tar.gz`：实际132000旧档将两名去别岛的船载工人错误抵作中央矿区劳力。114dd只按真实任务目的地或当前原生可卸地点给地区credit，保留真正incoming及全局36工cap。49项相关测试与tsc通过；同132000全world/id/双方mem起点的完整续局，pure3bdb在135692胜，候选135322胜，敌都余12单位0楼。实际五次付费各75金、40次新工交矿实收177.06；按step后人口回算177.18的0.12差异单列，未冒充实收。初两工回矿38次实收168.83超过招募150，但后来另招225仅回8.23。此续段永久死7对原3、中立死7对原2，现金51.13对111.52，故未合，不将早370tick叫净收益。三工实际都被同一远船6933反复征召，沿原生board走到有幼龙的4240/5584岸等船直至死亡；mission.from仍是安全中央5232/6000。船确实持续航行到原生精确泊位，非stuck；不同源/不同历史不得拼成生产版普通0。

## 后续已闭合机制与查询边界

`bootstrap-unsafe-board-mechanism-114dd-evidence.tar.gz` 核实native boardingBerth不接受mission.from，而按2×船直线+.15×人直线选岸。两次实际新征召无旧boarder继承，重算都给危险4240/5584；真实工人地路经幼龙47.92/66.06范围，船仍沿精确路线接近。三名2HP工人的恢复、shell与矿业安全入口均排worker/board，唯naval有claim，无任何实际撤回令。134160幼龙已退至152.46、射程144之外，仍有明确target工人的17伤飞弹剩4tick；不能仅因当前射程外称安全。后续安全候选与普通0另行验证，不在此包冒认结果。

后续e7f47f32组合（114dd加现有naval owner的worker安全钩子）同132000完整输入续到135322自然胜；不是普通0。包 `bootstrap-workforce-safe-board-e7-three-way-evidence.tar.gz` 将pure3bdb、114dd、e7三个固定源和全输入/命令分开。e7只有一名footman永久损失、工人全窗无受伤，较114dd七永久死少六名；worker3与11845均70HP。仅两次75招工，38次原生新工交矿实收167.10，终金107.68、总spent1406（不是把少招225等同少花225，其他支出抵消190）。敌仍12单位0楼。

钩子沿实际native共享泊位及building-aware地路检查当前已知武器覆盖；新征召危险时仍留矿工，已有危险岸上board由naval公开stop并释放当tickcrew，不改变原3矿/6工人数门槛。实际靠船且native canBoard可立即入船者保留；真实deck乘员不干预。原安全pickup三路线六工均仍允许，相关91项与最终27项受影响检查及tsc通过。原危险4240/5584被拒后，native船航向变化产生新岸4432/5872才允许worker3，终点仍岸上board等船，未假称已登。已装船炮采取当前真实pivot/range/minRange的保守连续环形，有限探针不能证明硬瞄准扇区整段安全。没有预测未来敌追逐或新增法术，不称普遍无风险。固定e7标准0官方骑士对v5已另独立启动，最终普通0成绩待完整结局后归属。

`bootstrap-first-wave-threat-metrics-20261015-evidence.tar.gz` 保存12285/12390首波的四份精确pre-p0完整档及同源重放闭合。原生worker不会idle自动索敌或help-call反击；实际是冻结对手正常workerDefense在12375显式派五工攻击，p0最早12390可见，实际首击12473。当前15tick伤害为0不代表随后无岸防。landed微操还有两个独立过滤层：外层hostileCombatUnits不含worker，focus scope再次用enemyCombatUnits；caster screen自行取另一份hostile查询，不能只改外层就声称全链修好。

`bootstrap-worker-defense-score-only-20261015-evidence.tar.gz` 仅算术：若仅对既有armed防守者名单按原footman归一化身体×真实武器评分，五工各0.441852，required由1变3.092965；原三ravager总2.838407，全场也仅这三名永久陆兵，同体质需四名。没有加入当时尚未付费的新兵或四名敌甲板长枪，没有将海军直接加到永久陆兵契约。该评估尚未实现或跑局；采购、初派、集结、出航、换岸和rider-crossing需共享同一required，不能只改最后landing gate造成不一致。

`knight-loading-escort-v1-evidence.tar.gz` 只把loading时护航station从远敌岸改成当前运输船。真实50400..51600护航1935确跟近且无伤，但继续同源到62400仍无人登陆敌岛；原17人最终七在另一中立岛、六在甲板、四死，敌14楼/厅900。58035两船incoming21.06924低于required21.18227而正确撤回，非单纯cohesion取消。十份600tick周期档逐值可恢复，三份死亡事件57775/57911/58226因原生cached sailing.load/balance尚旧、restore重算而不逐值等同；原失败未隐藏，不用这些事件档作exact起点。57600→58200同源全世界/nextId/双方mem闭合后才归因撤回。

`bootstrap-knight-joint-geometry-api-review-evidence.tar.gz` 证明原6f80及受控岸候选均可能选出各自地形可行却相互重叠的未来hull；实际当前船体当时未碰撞，不能据此把分散归因已发生碰撞。补完整future hull+全部陆上乘员后，最初声称的全三船可行方案被否定，原记录保留。完整predicate塞入原nearest搜索会扫全图，2017k pose/69CPU秒后主动停止后续重复，非游戏崩溃或全域无解证明。

独立纯API4bc50增加可选候选中心搜索域，默认21测试/tsc与42真实默认结果和accept回调顺序等价；仍未合生产。按原450真实cohort几何域的55200二船查询，找到同岛/无guard/全body/hull不相交方案（船间海230.4），但冷搜79.7CPU秒，不能进15tick AI。stored plan在55200 warm约25–33CPU毫秒，到真实55500已被移动守军覆盖而正确拒绝，不能永久缓存“safe”。未有v3实际执行局，不能将几何可行、减少pose数或API测试写成比赛改善。

只增量加入25a3的单一底层优化：landingSpot的同点distanceToHull纯值复用，bounds/open-ground/同岛/上下限/遍历与平局顺序不变。没有合入4bc搜索域API、AABB或联合登陆草稿。独立69实际姿态（35成功/34失败）返回完整落点/Unit均相同，5轮交替CPU合计2048.456→1787.909ms（12.72%）；该数字仅属这批查询，不外推整局或79.7秒冷搜索达标。原测量/原始profile及AABB数值反例归 `bootstrap-landing-gap-query-evidence.tar.gz`。

root再验证69姿态全等且输入未变；四文件38项原生回归、tsc/vite构建通过。原3bdb真实33600完整world/nextId/双方memory运行到33688，末世界、nextId、双方全部记忆和九条公开命令逐值一致，归 `bootstrap-landing-gap-root-integration-evidence.tar.gz`。外部TS harness最初因缺package type被按CJS加载，在还原/step前失败；原log保留，补harness-local type module后实际重跑成功，未改生产源码。原38项已完成后误启动的两例子集补跑已立即中断，不计为第二次通过。此为等价查询优化，不是bootstrap里程碑或新的比赛成绩。

`knight-unmedicated-preplan-evidence.tar.gz` 区分护理提前释放与到达后自动攻击：65205/65280本naval owner显式attackMove覆盖尚距原cover114.86/81.80/180.90的move，并非先idle。实际原care门槛是V7_WOUNDED_SHARE=.35；.36来自focus，不可混用。后续typed waypoint候选只续已有未完成原撤退腿，不锁到满血、不发hold；其局部/完整比赛结果仍独立归属，不在本只读证据包冒认。

上述失败与混合结果用于下一轮实战因果，不作为里程碑完成。三条风格路线、全部v5/v7/v8单敌及六种配对、官方图与未见生成种子的最终完整对局及泛化要求仍未满足。不改main，不回灌另行合并的新规则船只平衡或规则3/4性能工作。原故障容器未提交修改的恢复缺口继续保留。

为保留后续完整对局的磁盘空间，另用支持的sparse-checkout排除已确认tracked且未改的重复材料：root中已成功推远端的109个归档副本，以及已结束b0/25cce控制树的art/review文档副本。Git对象、远端及独立原始包均保留；所有1408／1390／1391项运行源/数据与冻结manifest前后无变化，没有修改任何活动比赛树。原tracking-ref缺失检查在变更前即停止，改用成功的ls-remote精确确认后才排除。命令模式、准确路径/HEAD/释放量在两个 `*-sparse-recovery-20261015.json` 记录，不与先前发生的误操作事故混为一谈。
