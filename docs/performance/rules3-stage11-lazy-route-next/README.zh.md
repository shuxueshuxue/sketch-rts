# Stage11：延迟物化 whole-field next 证据归档

归档范围：`docs/performance/rules3-stage11-lazy-route-next`。候选阶段原 SDK 7 项与本轮归档 SDK 原四文件14项分别保留，实际结果见下方最终闭合记录。

候选 `591216adc44703fdf9788c24237241299dbc85cf`，基线 `0ea5beaee063c8443d66f7654333032b070d51ad`。决定为 **`HELD_UNSTABLE_NOT_ADOPTED`**：正确性证据已闭合，CPU 收益不稳定，候选未采用、未建产品 PR、未合并或部署。整局目标 p99≤16 ms、max≤50 ms 仍失败。[Stage10 固定归档提交](https://github.com/shuxueshuxue/sketch-rts/commit/d19082b1d2fe1d14e99e1303479ef187db1a1c95) 保持独立。

## 正确性与保留缓冲

生产改动仅延迟距离查询未消费的 whole-field `next` 缓冲；实际 route/weighted 消费后完整物化，保留字段、顺序和别名约束。AA/AB 实际模块证明通过；原 23 文件、185 项回归均覆盖，含新增永久回归共 32 个唯一文件、244 项通过，候选阶段原 SDK 7 项及 tsc/build 另外通过。

真实 12 个 sea field 的唯一保留 typed ArrayBuffer payload 为 **9,953,664→4,976,832 B**。这是指定 live fields 与 spare 的确定性保留缓冲节省，不能扩展为进程峰值、分配率、GC 或稳定 CPU 收益。

新增 fixture 的首次失败原样保留。实际基线校准确认原 route 会重复追加末端 goal，随后修正新 fixture 的完整预期；算法和断言强度未降低。最终验证见 `VALIDATION.json` 与验证报告。

## 两组整局结果

每组固定 `A1 B1 B2 A2 Bplain`，共 10 次完整 14,400 tick；Bplain 独立列示。性能池 A/B 各 57,600 tick，保留全部慢 tick 和最大值，无样本筛除或替换。规则版本 3、checksum 版本 18、五个 AI 的原相位均不变；完整 618,189 B 命令逐字节一致，最终 checksum 均为 `7d94a5e8`。

| whole 指标 | A | B |
|---|---:|---:|
| mean ms | 3.584659 | 3.526326 |
| p99 ms | 27.064713 | 25.883144 |
| max ms | 99.884027 | 95.300727 |
| >50 ms 次数 | 26 | 22 |

合池 whole 均值变化 **−1.6273%**，两组分别为 **+0.3957% / −3.6003%**。前 0–4 分钟的合池均值全部变差，依次为 +3.3388%、+9.0543%、+4.3933%、+1.8512%、+1.5363%。>50 ms 中，规划 tick 为 20→12，**非规划 tick 为 6→10**；总次数减少不能掩盖后者增多。上述观察不足以建立稳定加速，也不作 JIT/GC 因果归因。`renderSnapshot` 为数据提取，不能解释为 GPU 时间或 FPS。

## 冷测及后续独立核验

固定 6 块 ABBA、每 arm 12 个 fresh Node 进程，共 24 个样本；两个 build/cold worker 原字节复用。初始 snapshot、含 10 条命令的完整首帧、tick1 snapshot 全部逐字节闭合。保留全部样本和不利最大值，无 warmup、forced GC、inspector、重试或移除样本。

| 冷测边界 | mean ms A→B | mean 变化 | max ms A→B |
|---|---:|---:|---:|
| 首次 native tick | 89.792033→86.622345 | −3.5300% | 102.442058→112.877709 |
| 模块 import 至首 tick 的连续区间 | 384.746232→378.340047 | −1.6650% | 405.576571→421.449471 |

均值较好，两项最大值均变差，六块中仍有一块首 tick 均值变差。每 arm 只有 12 次，nearest-rank p95/p99 等于该组样本最大值，不能当作总体尾延迟 SLA。parent wall 与连续区间的边界分开保留；OS 缓存未控制，不据此归因 JIT/GC/OS，也不证明整局目标通过。

`decision.json` 的 `coldIndependentReview=PENDING_SEPARATE_CHECKER` 是当时的状态，原件保留。随后冷测独立报告给出 `INDEPENDENT_RAW_BYTE_SOURCE_AND_ARITHMETIC_READBACK_PASS`；这证明原始字节、源码及算术核验通过，不改变未采用决定。首次 checker 把实际 24 条 JSONL 当作单个 JSON 而 exit 1，首次源码、封存、日志和退出记录均留存；v2 对同一批原始样本逐条核对后通过，没有重跑冷测或修改样本。首次内部 Git 原流保留，但当时未单独保存每条 Git UTC；v2 留有逐条执行记录。

## 源码图、历史限制与归档状态

源码图按来源分列，不能把 24 个冷测进程重复算成 24 张 build 图：

| 来源 | 图数 | 每图生产输入 |
|---|---:|---:|
| 两组整局原件，含两次 Bplain | 10 | 241 |
| 冷测实际 A/B build | 2 | 241 |
| 合计 | 12 | 分列核对 |

整局的 Git/live/capture 全字节证据与冷测 build→native→Git 的核验分别保留；生产图无新增路径，仅 `src/shared/terrain.ts` 内容变化，Git 改动另含两个永久测试。运行时使用独立 bound pins；原 pending 配置和准备阶段记录不改写。

first seal 元数据可核对，但两个历史 payload 原字节未留存：当时的 `METHOD.md` 4,768 B、`commands.json` 62,058 B。独立报告明确 `firstSealHistoricalPayloadClosureComplete=false`；不能声称历史 payload 全部闭合。早期继承的旧 diff 摘要及 first seal 历史均原样保留，并由后续 errata 和独立命名的 bound diff 说明。

主要原始来源为：

- `/tmp/terrain-lazy-whole-next-validation-v1/{REPORT.zh.md,VALIDATION.json}`。
- `/tmp/terrain-lazy-whole-next-native-review-combined-v1/{REPORT.zh.md,review.json,decision.json}`。
- `/tmp/terrain-lazy-whole-next-cold-independent-review-v1/report.json`。

本归档说明不提升候选状态；候选阶段 SDK 7 项不能替代本轮归档 SDK 原四文件14项。

## 最终归档闭合

库存截点 **2026-10-15T03:47:34.779875+00:00**：按精确文件表捕获13个Next原目录、7个共享controller/plan文件和明确列出的历史语义/工具引用，后续v2候选材料排除。`/tmp/stage9-static-summary/next-source-review.md`是本轮新子审材料，只作为Stage11 provenance，不冒称旧Stage9原件；旧冻结文件与manifest不改写。便携Git只包含0ea/591的2个raw commit、23个所需raw tree及terrain/两永久test的changed blobs和patch。

**908个完整原路径、523个gzip、385个显式alias**；原件73,744,826 B，unique gzip 16,007,462 B。全部stored/decoded SHA、原件全文、精确库存及支持文件pins通过。离线重算10×241整局source、2×241冷测build source、10份完整commands、初始/首帧/tick1全文、全部分布/配对/分钟/慢样本与24冷测。

正式整局外层2026-10-15 03:22:00.315045–03:31:21.460311 UTC，561.145256199s；cold外层03:36:13.009959–03:36:24.586947 UTC，11.576972357s，均exit0。10份完整commands SHA256 `771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`，每份618,189B/14,400frames/612nonempty。

原四文件SDK唯一一轮实际 **13/14 pass、1个既有Stage5文档命名失败、exit1、32.726531s**。唯一offender与旧9f3101闭合blob全文相同；未改旧文档或原断言，原argv/cwd/UTC/stdout/stderr/exit完整保留。SDK执行期间全部七个追加scope SHA不变，后续只追加证据收据及文档状态，最终新scope再次执行相同命名规则扫描。

复现只读归档：

```sh
python3 verify.py --out . --verify
python3 analyze-native.py
python3 verify.py --out . --extract /absolute/new-parent/restored
```

候选保持 **HELD_UNSTABLE_NOT_ADOPTED**，没有产品PR、合并或部署；归档闭合不等于性能目标完成。13份稀疏process memory/整局臂及冷测两个process快照均不能推断连续峰值、retained heap、分配率或泄漏。
