# 骑射手冷却期决策：未合入负例

此包不代表普通0或获胜。基线为当前production ade412414d9232206f39e20f0182f0086605433c；v1 f9771345ecd3f930cfd43e0230cf4426bbf52488，v2 2c489528d7c0479a266e7ceab93a67d375dcedeb，均直接从ade独立建立，无a90 stop/ab0返程改动。原容器未提交修改恢复缺口仍保留。

实际输入来自ab0负例续局，不能把它当当前production普通0。已先以ade完整复现15000→15410（629 emitted命令/30 hit）及15780→15896（171/19），world/id/3memory/setup逐值全等。最终600tick基线15255→15855也与实际档828 emitted命令/71完整native hit全等。原始输入/闭合诊断在本归档的horse4294-native子树；完整ab0负例另封SHA7d98d3f4c185f13bd90bb2b97b02f36c3f6da1cb6582fe490eb291fd1b95ddee。

首分叉由更早原生证据提出：15267已真正发箭，15270武器CD27不能在随后15tick再普攻，原策略却继续attack。v1无条件在该冷却期对明确追者移位，v2仅真实horseArcher按剩余CD+原aimingProfile估时进入原safeShot，施法者/未完成reticle/无追者/越射程保持原逻辑。没有修改武器范围、CD、think、兵力、owner或对手。

结果见PAIR-COMPARISON.json与独立review.json。候选第二箭15310比基线15474早，但全窗都只命中2箭、24 vs25有效HP；双方骑手末端111/125HP，候选15814先受14而基线15844，仍被赶到北树林孤立。p0有效damage587 vs884，敌281 vs500，新p0永久死亡均0，敌新永久死亡2 vs4。3次真实治疗各自155 vs146有效HP，6次已由native effects+逐步HP账+独立位置/其他再生排除验证，不把maxHP成长或cast命令算作治疗。

原murloc-red-2同样是实证负例：ade20525全清/215命中/0伤，v1、v2到30123仍5敌/387命中/0伤。被动同脚本重现的first same-world difference6273；第一新移位保准星，并非发令直接清aim。原策略最终先隔离/击杀一只治疗怪；候选没有击杀，不能用箭数更多或0伤冒称改善。

v1相关35tests=34pass1fail；v2八新增回归绿、原murloc仍红、tsc0。八例包括真实已发箭不被移动取消、首步reticle保留、未完成瞄准、远追者仍可等待、priest仍实际autocast55、480射程塔在途箭出圈仍伤、无屏护快敌仍会追伤。保留首轮错误测试断言（ready本轮≠安全射击）和严格teams型别错误日志；后者仅测试改用真实game.teams。

v1/v2都不合入、不运行自然长局。下一方向已回到原ade field的真实主军/既有post/合格退路；该后续独立目录不在本包。负room exit优先的猜测已用静态反例否定，没有冻结或native试跑。

所有onCommand原记录保留；SDK hook可包含transient no-op。首次15270 move另有live before/after order、aim、15271真实位移、后续projectile/hit证明。第一轮累计69.3<72保准星，15286第二轮才首次清aim。并未声称每一emitted命令都执行。

源胶囊ade-runtime-source-1464.tar.gz+两个binary增量patch可重建候选；冻结184完整497源复用同SHA。具体source pre/post逐文件、世界、全部3memory、命令、命中、原生静态图均保留。RUNNER-CLASSIFICATION-ERRATA.json纠正继承runner字段措辞，原raw不改。
