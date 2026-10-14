# 规则3：阶段3循环展开阴性结果、tick0诊断与Map379上线

**整局目标仍未达成，八方向循环展开候选未采用。** 固定原生五轮对照的whole均值 **3.553288→3.577104 ms**（回退约0.67025%），p99 **26.135→26.336 ms**，max **81.244→140.361 ms**。两个均值配对分别回退约2.75846% / 改善约1.36606%，方向不稳定；全部五次未达到 **p99≤16 ms、max≤50 ms**。

本目录独立新增。[规则3三处优化](../whole-game-rules3/README.zh.md)、[旧生产与凸包阴性记录](../rules3-followup/README.zh.md)、[阶段2及Map正式证据](../rules3-stage2-map/README.zh.md)保持原样。Map由[PR #379](https://github.com/shuxueshuxue/sketch-rts/pull/379)合并上线；本页的循环展开从未合并、部署，不给历史Map收益换标签。

## 场景及源码归属

固定 `sapphireArchipelago` 六人局，一名空闲Grove人类、五个AI。每臂12分钟 / **14,400原生tick**，结束 `winner=null`，不是最终胜利结局或全地图/浏览器FPS验收。whole为原生complete tick，计入模拟、AI及命令；observer、渲染快照与落盘另计。仍为 **rulesVersion3 / checksumVersion18**，未改AI思考相位、船只规则、校验频率、已有断言或平衡。

| 用途 | 固定源码 |
|---|---|
| PR378生产、阶段2旧基线 | `49e07caa1657687247e6b58180c7b641911f6512` |
| 本阶段原生A及v10诊断、已验证Map候选 | `31e4e8ba44c48efbbbf7ec3594c93e7537b6dba8` |
| 未采用：private unweighted grow展开 | `ec164a6e3ec89abb3a36ea6288bd23e310685287` |
| PR379实际生产main | `618f9f5170164aa33d1e21443e86e64fb14d38f8` |

ec只改private grow函数体，原生输入差异仅 `src/shared/terrain.ts`。49→31的Map改动仅`ship-navigation.ts`/`ship-planning-job.ts`；将31与生产618的同一241原生运行输入逐份全字节比较，明确旧31测量归属，不冒充在618上重跑了原生性能。

## 正式五轮阴性对照

原顺序 **A1→B1→B2→A2→Bplain**，A=Map31，B=ec。A/B池各28,800tick，Bplain仅核验普通钩子透明性，**不合入性能池**。无profiler/详细捕获、forcedGC、冷tick删除、尾部过滤或降低断言。分位为最近秩 `ceil(n×p)−1`。原所有样本、命令、源码、起止与稀疏memory完整保留；RSS观测不等于持续峰值、分配率、GC因果或泄漏结论。

局部函数改善不能代替整局验收。首次局部A/A178cases及943,436事件，A/B691cases及11,321,286逐事件比较通过；24个oracle bin **104,515,008B**完整保留并独立全文件字节读回。现有六文件 **47项**、真实TypeScript/生产bundle/client bootstrap均通过，不改旧测试断言。

局部每12字段grow序列均值 **25.118793→22.124223 ms**，约改善11.9216%；24配对22更快、2更慢，18块严格分离，最差块回退24.0209%。单grow的p99 **4.184540→4.264938 ms**、max **7.346419→13.154006 ms**更差；末端验证均值 **1.200578→1.361973 ms**更慢，单列于计时外。原Runtime缓存图、JIT/GC未恢复，不称完整调用重放。

原`executed:false`、UNRUN、局部记录中的“尚待原生”是各自当时的准备状态，原字节保持。后续检查和正式五轮另行保存，不覆盖第一次记录。

## v10诊断及扰动限制

v10另做完整14,400tick，使用原v5 probe全字节，仅在新focused模块为tick0新增 **21个hook occurrences / 20个label**。稀疏cold/body scope避免v9约80,000个热路径terrain events，不改变原生产语句与命令。v10是诊断，**不混入正式性能池**。

原unroll统计脚本约0.675s，实际 **21:33:33.589→21:33:34.264 UTC**，与v10 **21:33:32.703→21:34:30.157**相交，不能宣称整次诊断严格独占。原sourceclosure **21:33:24.504→21:33:25.501**结束在前。v10 profile无负delta、单窗时钟覆盖有效，可以按新独立分析在限定范围归因；旧v9负delta窗口仍整窗拒绝，不能用v10改写旧失败。

有效tick0采样裁剪覆盖98.477306ms、0负delta/0未代表尾段；139.215ms最大raw interval在tick之外，未当游戏时间。首敌59.510318ms scoped wall中naval.run31.466757ms；shoreSpot scan25.991007ms分为shoreSpots cold-build16.993739、六次grow3.603821及scan remainder5.393447ms。cold-build分为sea wholes7.227040、三张prefix构建4.617569、候选scan5.080188及remainder0.068942ms。

wall scopes包含GC、调度及探针开销，inclusive父子不可相加，exclusive按有效嵌套计算；采样并非精确函数耗时。详细分析的原始报告与修正各自封存，未恢复的opaque callback/运行缓存/JIT不冒充重放。

## PR379生产收据与画面

PR379合并后生产CD **38640281860**成功；main/tag/release归于同一618源码。官方tar **2,471,661B**，SHA **`b3bb3439ed14e414f3451c3a8844bdeb2fb933ca12f3e165a23fdcd8e4889f74`**，安全解包91文件。真实connector部署日志与收据独立保存，gh日志403负例也原样保留。重启前PR/CI/merge记录与重启后下载/浏览器验证各存独立组，未覆盖原回执。

三场景普通TLS浏览器启动验收已完成，**严格exit1、56/59**。三个失败均是`audio-packs/served.json`：官方包16B占位JSON与服务器41B war3配置不同，两个哈希与PR377/378旧生产证据完全相同。原断言、失败、退出码、NSS、执行工具、命令及stdout/stderr均封存；NSS信任前后完全一致。根代理实际查看三张画面，确认巨舰、王城和军队对野怪群正常显示。可下载原图：[海盗巨舰](media/fleet.png)、[王城街景](media/capital.png)、[军队对野怪](media/woods.png)。画面验收不代表整局帧率、全部动画阶段、声音可闻或性能目标已达。

## 无损复核

本包逐文件保留原路径Base64、原bytes/SHA与外层gzip bytes/SHA；原gzip保留原压缩层，所有24bin直接stream压缩/读回，不复制104MB原件，也不为验证额外全件解包。未执行未来hoist候选不属于本包。

从归档直接比较五份正式命令及v10与原Map B1参考，共七份完整日志：各 **618,189B / 14,400frames / 612非空frames**，SHA **`771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`**，checksum **`7d94a5e8`**。每份241原source inputs与各自Git blobs逐字节核对；`esbuildBytes`是编译变换后长度，不能当原source bytes。

在仓库根目录：

```sh
python3 docs/performance/rules3-stage3-loop/verify.py --out docs/performance/rules3-stage3-loop --verify
python3 docs/performance/rules3-stage3-loop/analyze-native.py --repo .
python3 docs/performance/rules3-stage3-loop/verify.py --out docs/performance/rules3-stage3-loop --verify --compare-originals
```

解码器`--extract /tmp/new-stage3-evidence`先完整验证，只写不存在的新目录，拒绝覆盖及路径穿越；本次采用stream读回及小范围安全路径反例，没有重新展开所有raw数据。最终实际封存、源码闭环与完整SDK14状态见 `verified-closure.json`，不以空日志或准备稿冒充通过。

本包新analyzer第一次因本地缺618 Git对象失败，fetch后第二次因准备中的planning路径literal写错而失败；两份完整工具、stderr及退出码保留。只修expected path为实际`src/shared/ship-planning-job.ts`，不改raw/候选或相等断言；第三次7份commands/7×241source及31→618全字节闭环通过。

最终完整docs已落盘后，SDK首次因wrapper cwd在tools目录而0测试/exit1，原日志保留；改正确仓库cwd后同四文件14项全部通过（30.810806s wrapper）。只改记录工具、不改测试。此检查在完整证据分支553d的既有49代码与新stage3文档上运行，不冒充618的新构建或性能测试。
