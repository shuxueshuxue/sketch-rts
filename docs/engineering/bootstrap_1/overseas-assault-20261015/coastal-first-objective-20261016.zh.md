本目录记录独立 coastal 目标/航路候选，当前自然比赛工作仍未完成，不能作为 bootstrap_1 最终验收。

固定生产源为 `/workspace/sketch-rts-coastal-objectives-ade-control` 的 af010be642b8e2dc5c1054d0cc17131957764e05，基于生产 ade412414d9232206f39e20f0182f0086605433c，只有三个 policy 生产文件及相应测试/实档 fixture 的 delta。root 生产未自动合入。本候选不包含旧078026宏观目标/功能维修候选。原容器未提交修改的不可恢复缺口仍保留。

输入 `input-production-ade-225600.json.gz` 为 root 生产 ade 的真实 223200→225600 三方续局终态（完整 world/nextId/三方全部记忆），SHA3f62483393e83a4dd4a7e910b713bf87bef4bea37d70a7e72bfd8702848dfcd4。本候选自225600换码；不是普通0、未见种子分数或旧e47宏观策略成绩。p0 v9_summoner 对正常冻结v5+v7，规则2及冻结184项保持不变。

修正内容：coastal-voyage 两个克隆 units 数组绑定真实 building/obstacle collision frame；具有实际有效已装舰炮且满足既有伤势/任务门槛的船才可选择新远岸目标；静态炮位以实际海路及原100k预算查询筛选，完成查询和有限 prefix 明确区分。保留原敌建筑优先；无可行敌任务时，才可选择既有资本条件下可回本、无己厅/盟矿占用且可建厅矿点的存活守卫。清营并不等于购买/殖民成功。

昂贵新目标查询发生在原撤退、招募/等待登船、当前海上威胁/真实本地交战之后；首次 immediateCoast 风险也用原 outmatchingCoast 提前门控并在原分支复用。每个 planner call 按船缓存选择及失败供 muster/发布使用。已发布 move 的非空路线仍须安全；缺路线时仅同目标且符合原生鲜活 job/FIFO 字段才保任务身份，绝不把排队称路线证明。目标已死/移除则不续租。没有新增TTL、owner、降低100k预算或放宽战力/购买规则。

测试归属：75729f4c 的7文件53项/tsc exit0属于 live-target gate 前固定字节；最终 af010be6 仅增加2行存活目标检查及3项生命周期边界，增量2文件23项/tsc exit0。未冒称最终56项全部重跑。两个版本的实际225600冷恢复 fullp0 都 world/id/三记忆严格恢复，查询不改变世界/id/对手记忆；11计划命令和完整p0记忆逐值相等。查询是 intent，不是执行。

开发阶段必须分开：`target-query.json` 是早期 mixed-guard stage，fullp0 24.1767s且选择guard；其单独 component forge 查询只给 prefix。`pre-lazy-production.patch` 对应敌建筑优先 eager stage，真实 fullp0 测试67.629s/后续60.005s。最终前版本75729 fullp0 pure54.8477s，最终af fullp0 pure60.0641s，时序/机器负载不同，不可凭单次数值声称整体提速。原失败日志和类型/fixture修正保留，未改旧断言造绿。

`native-225600-coastal` 是唯一固定af正常三方原生短窗，保每15tick pre-p0完整档、公开命令尝试/只读disposition、原生命中和native ledger。首p0是正常循环唯一调用并严格匹配固定fullp0查询。raw commands是SDK归一化后返回的issue尝试，包含transient/no-live no-op，不能当全部效果；disposition用SDK actual before snapshot回溯检查，不伪称现场beforeIssue hook。命中/订单/完整世界决定实际作用。native step成本包含同步hit observer IO，不包括边界ledger/capture和AI；p0成本另记。

实际已观察：225934 warship34722、225947 warship33582分别对真实cinderSpire1597造成20伤害；225900客户端原生drawWorld两图对应完整实存档，无示意几何或输入修改。此后结果以原raw/report为准。炮船50739真实离开原泊位，不等于已达forge/已有赏金/殖民或获胜。

一次外部 instrument 仅恢复实际225615 pre-p0输入，在独立1470payload胶囊副本上wrap查询函数，不改活动源/游戏。计划命令、完整p0记忆与实际225615/下一225630记录逐值全等，世界/id/对手记忆不变。唯一失败 planCoastalVoyage 为4058→cinderSpire炮位，占instrument21.312s；其他三条已发布航程没有重问voyage。实际原同think16.304s，不以instrument开销替代生产计时。af的原 HURT=.4，4058 HP172.674/320满足原门；不是.55。100k无结果只表示该预算未给结果，不是连续几何不可达证明，也不能凭hold/combat记忆永久锁船。

后续 `native-natural.ts`（未启动时只准备）从上述真实终态完整恢复同af三方比赛，首击杀不是全局胜利。周期1200完整档和重要事件档永久保留；recent16个pre-p0输入是滚动诊断槽，并非全部逐15永久保存。raw/cost在线流、统计不累计全程数组。正常可支持 observer-stop 文件在循环边界结束诊断；before-step触发仍完成一正常step，不能称通用瞬时停止。完整结果/新增阻塞仍须继续验证，三路线、单对手及六配对、官方地图和未见种子最终要求没有缩减。
