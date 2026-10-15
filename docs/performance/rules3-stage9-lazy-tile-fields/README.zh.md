# rules3 stage9：lazy tile fields 整局改善与 cold 回退

候选 `558550bd1e530df1be246cdf299d87f9f0457ec7` 当前 **HOLD_NOT_ADOPTED**：没有候选代码push、PR或合并。两轮正式整局的平均值及四个配对均改善，但独立24个fresh Node cold样本显示首tick回退；不能写成没有收益，也不能宣称已采用或全面提速。整局目标 **p99 ≤16 ms / max ≤50 ms 仍 FAILED**。

24个cold adverse是**未插桩观测**。随后A/B各一次标量诊断显示，本次两进程从import到close均未执行修改的tiles路径；原因仍未归因，不能读成lazy算法做了更多cold工作，也不能用插桩A96/B83ms主张修复或收益。

## 正式整局与所有不利观测

base `0ea5beaee063c8443d66f7654333032b070d51ad`，与生产merge `4804631c22f7be3f83dc6374e71ce03d86068dd8` 同完整tree。每轮 A1→B1→B2→A2，另加Bplain，共10次完整14,400 ticks；外层01:49:25.826–01:58:43.021 UTC、557.194526秒、exit0。收益池4A/4B，每侧57,600样本；plain、focused诊断、历史4A和cold均独立，不混池。

|whole|A pooled|B pooled|
|---|---:|---:|
|mean|3.561125179392352|3.4840292892534666|
|p99|26.476269999999204|25.59284099999786|
|max|90.66191299999991|104.75976999999989|
|over16|2787|2644|
|over50|21|14|

mean变化 **-2.164931%**；四对依次 **-2.262503% / -1.096516% / -1.551598% / -3.735936%**。两轮块均值均改善。tick9659四个B均低于四个A：A48.208–54.656ms、B20.186–25.326ms；两份Bplain该tick约20.290/20.188ms，保留完整plain分布。

正式池内cold tick0：A 78.161905, 79.838835, 80.266278, 77.422379 ms；B 84.543299, 96.554549, 79.565284, 104.759770 ms。B max104.759770ms高于A90.661913ms，sim >50ms次数5→6。这些首tick、全部慢样本、每分钟与不利分项完整保留，未删离群点；不归因JIT、GC或OS。

r1-Bplain 独立whole：mean3.530826469、p9926.247040、max93.291818ms，>50ms 5次。

r2-Bplain 独立whole：mean3.523971359、p9926.294971、max81.220432ms，>50ms 2次。

## 24个独立 cold 样本

六个ABBA块，A/B各12个fresh Node进程。全部24份原sample、工具原版及适配diff、预声明、两个source图、initial/frame/tick1完整原件和各次argv/cwd/UTC/exit随档。没有重试或删除样本。

首native tick mean **84.290703333→90.778436000ms，+7.696854%**，max **95.121437→115.236087ms**。从模块import到首tick的连续窗口mean **387.867415667→392.844875583ms，+1.283289%**。这些是指定冷路径边界，不构成浏览器启动、硬件FPS或整局分布。记录不能单独归因JIT/GC。

全部initial、first-native-frame与tick1 snapshot逐字节闭合；首tick checksum `21709a99` 与整局最终checksum不同，不能互换。原独立checker首次误用两中心平均median而失败；首次完整argv/cwd/UTC/stdout/stderr/exit保留，但首次review.py首稿未在执行前另行冻结，随后同路径被修正；不能宣称首次checker源码全文或hash留存。最终review.py与报告全文保留，可对同24样本复现通过。该source历史限制不影响24份原样本、不可变cold runner或正式native源码。修正外部checker按原不可变runner的nearest-rank `ceil(n*p)-1` 对同24个样本重读通过，没有重跑或修改样本。

## 源码、正确性与失败边界

production仅terrain.ts 16增/3删，另新增100行永久测试。完整topology、node顺序、walk labels仍建立；仅按需materialize node fields/edges，dirty已linked者重建、未linked者继续延迟。便携原始commit/tree/两份changed blobs/patch随档，所有runtime原始输入按Git object header认证；不靠未推送候选对象库。

原实际base差分proof：42 public queries、35,231 private queries、208 state comparisons、7,476 materialized-node comparisons、4,136 deferred-node comparisons。cold node retained field由62份/41,216B→0；不是node数归零。强制完整实际消费后fields/buffers全文收敛。这些数字只计当前保留的不同非空Int32 ArrayBuffer，排除goals/scratch，不是peak、分配率或泄漏证明。

原验收23files/185tests、永久新增3tests、ship-launch13tests、原SDK单文件7tests、typecheck/build通过。广测56files共769tests为765pass/4fail；四项在clean 0ea上按原name/received定向复现，相同stderr完整保留。baseline仅复现这四项（另82 skipped），没有重跑全部769项。不能说测试本身错误或全部通过；未改ship rules或断言。补充9files/63tests通过，范围分别保留，避免重复相加。

## v14诊断与选择来源

v14唯一原V5 native、四CPU窗0/6990/9375/9659，nested仅后三；原probe/helper SHA和241份原Git/source inputs、完整commands闭合。tick0有一个−1µs delta，**整个CPU时间窗拒绝归因**，raw和未对齐hit counts保留，不clamp/remove；其whole诊断时间也不进入正式收益池。其余三个窗有效。

9659观察到shipLaunchPose→sea steerPoint→tilesOf，instrumented tilesOf10次、inclusive45.128875ms，sim53.234736ms。CPU sampled leaf1080µs/inclusive45722µs是另一种近似度量，不能互换或相加。定位为生成bundle的0-based1803行/16列；原source路径来自bundle注释，不是精确TS行。

LIGHT选择报告携带4份此前A的完整raw、commands/source及22条命令ledger；这些不是本次新增性能样本。其子工具一次纯资料写入1.6秒超过LIGHT1秒准备限制，发生在诊断barrier之前，如实保留。诊断、正式native、cold及本归档独立，不能以某个有利tick代替全部分布。

## cold 标量诊断的限制

独立A/B各一次，2026-10-15 02:22:40.060038–02:22:42.712370 UTC，2.652337554秒、exit0，无重跑。保留全部原工具/适配diff/barrier/执行日志/源码pins和两份原sample。25槽×9phase完整保存，共同可用计数逐项相同；`ensureSector`在A不存在记null、B为0，不能将null改成测得的0。

本次两臂从import到close的tilesOf/tilesCold/linkSector/redoTiles/growBox计数均为0。tick0实际createRuntime4、fillClearance1、cold wholes2、shoreCold1、grow18、owner planning5。此结果只说明指定插桩两进程没有执行修改路径，不能直接解释未插桩24样本的cold adverse，不能从A96/B83ms插桩时间推断收益或修复。558继续HOLD_NOT_ADOPTED。

两臂各241份original源码均按Git认证，instrumented源码严格逆向删除插桩后逐字节恢复original/stripped，bundle和完整initial/frame/tick1 bytes及21709a99闭合。原始源码图共19：15个整局/诊断/历史图、2个cold build图、2个counter original图，共4,579份源码记录；counter的另2个instrumented图和2个stripped图分列，不能与每图241份源码混计。

新增归档reader首次错误地假定rawCounters还含内部phase指针而exit1；原JSON实际已slice掉指针，导出225槽。首次source/exit1/stdout/stderr保留，修正新reader的长度和phase索引后对同两份原样本通过；原插桩、样本与任何原断言均未改。

本诊断及上述文档在原四文件SDK之后追加；仅新增证据与说明，随后对最终新scope执行原命名规则的完整扫描及全文/hash/源码/统计读回。原14项SDK结果保持13/14，不冒称再次执行或全部通过。

## 恢复与归档验证

schema3完整lossless gzip保留全部原路径、原件bytes/SHA。相同全文逐块比较后以明确alias去重；所有stored/decoded SHA、原件全文、精确库存和支持文件pins单列验证。旧608bbb03的任何路径均不回写。

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
python3 verify.py --out . --extract /absolute/new-parent/restored
```

离线分析只读取本归档，不导入游戏或访问网络；统计复算不算新native样本。全部15份完整整局commands（10正式、1诊断、4历史）与原oracle相同：618,189B、SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`、14,400frames/612nonempty、rules3/checksum18、最终`7d94a5e8`。不能以checksum替代完整bytes对照。每运行13份稀疏memory样本不是连续峰值/分配率；renderSnapshot不是浏览器/GPU drawing或FPS，固定Sapphire结果不能推广所有地图/硬件。

归档准备首次尝试读取clone里不存在的main480 raw Git对象而失败；原失败和后续依赖输入缺失均保留。修正为携带已冻结的完整production API commit JSON认证base/main同tree，未fetch、未改旧repo。归档用原四文件14项SDK与候选原7项SDK分列，最终真实结果见闭合记录。

## 最终归档闭合

**908个完整原路径、579个gzip、329个显式alias**；原件84,450,665 B，unique gzip 22,564,284 B。所有stored/decoded SHA、原件全文和精确库存校验通过。

原四文件SDK实际 **13/14 pass、1个既有Stage5文档命名失败，exit1，32.011162秒**。唯一offender与旧9f3101闭合blob全文相同，新scope未被列为offender；未改旧文档或断言，原stdout/stderr/UTC/argv/cwd/exit保留。SDK执行期间全部五个追加scope SHA不变；之后追加cold counter诊断、文档与receipts；最终新范围另执行同规则命名扫描、源码与全文读回，原14项SDK没有重跑。

候选结论 **HOLD_NOT_ADOPTED**；整局改善与cold adverse共同保留，目标仍FAILED，无产品PR、push或merge。
