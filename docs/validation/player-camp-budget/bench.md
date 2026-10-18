# Room AI：240 个配对测试

每个版本 240 局，总共 480 局；v8 与 v9 各 120 局、分别运行。总胜场 **164 → 157 / 240**；共有 87 局胜者变化，其中赢输直接互换 49 局，涉及超时/无胜者 38 局。

对 v8 合计 **93 → 93 / 120**；对 v9 **71 → 64 / 120**，下降七场（弓兵三场、召唤四场）。六组本方 clear 平均都提前，bases@8 的变化较小；这组结果不能标为“胜率无回退”。

基线是开工时的 origin/main `b42249cb030664cd6af4b0f531d4fb5eafe123ae`。A100 实际被测实现为 `667e8015`；后续 `f646a587` 增强“本家配额不能借邻居营地满足”的约束。对本 bench 全部 120 种布局/席位/种族输入（对 v8、v9 相同）分别完整生成并做 SHA-256：末版与被测实现 **120/120 完全一致、0 张变化**，见 [bench-layout-hashes.json](bench-layout-hashes.json)。AI 与模拟器代码未修改，因此这些对局也验证末版使用的同一输入。

种子 `v5-final-1`，20 个 ladder 槽、两种族、三个房间 AI；默认 48000 tick 上限、默认 think/controller，24 workers。均在 A100 的 `/codegeex/jeffry/sketch-rts-camps/player-budget` 下运行，先 source 指定 env.sh，再把临时目录与缓存重定向到本任务目录。

两次命令对 base/ref 各跑一遍：

```sh
npx tsx scripts/ai-room-gauntlet-benchmark.ts --subjects v9_archer,v9_summoner,v9_knight --rivals v8 --seeds v5-final-1 --map-count 20 --workers 24 --metrics clear,bases@8 --out-dir ../results/BUILD-v8 --label BUILD
npx tsx scripts/ai-room-gauntlet-benchmark.ts --subjects v9_archer,v9_summoner,v9_knight --rivals v9 --seeds v5-final-1 --map-count 20 --workers 24 --metrics clear,bases@8 --out-dir ../results/BUILD-v9 --label BUILD
```

## 胜场

| AI | 对手 | main | 修改后 | 直接赢→输 | 直接输→赢 | 超时相关变化 |
|---|---|---:|---:|---:|---:|---:|
| v9_archer | v8 | 29/40 | 31/40 | 4 | 5 | 5 |
| v9_summoner | v8 | 29/40 | 27/40 | 7 | 5 | 1 |
| v9_knight | v8 | 35/40 | 35/40 | 3 | 3 | 0 |
| v9_archer | v9 | 29/40 | 26/40 | 3 | 1 | 12 |
| v9_summoner | v9 | 22/40 | 18/40 | 7 | 5 | 6 |
| v9_knight | v9 | 20/40 | 20/40 | 3 | 3 | 14 |

## 直接指标

每格为“本方 / 对手”；clear 是首次清掉营地的分钟数（越小越早），bases@8 是第八分钟已完成的主堡数。缺失值不按 0 参与均值：clear 缺失表示全局未清营，bases@8 缺失表示对局未到第八分钟。括号列出本方的缺失场数；逐局双方原值和胜者均在 [bench.json](bench.json)，可交叉查验。

| AI | 对手 | 指标 | main 本方/对手（本方缺失） | 修改后 本方/对手（本方缺失） |
|---|---|---|---|---|
| v9_archer | v8 | clear | 3.936 / 2.745 (0) | 3.864 / 2.755 (0) |
| v9_archer | v8 | bases@8 | 2.450 / 2.100 (0) | 2.450 / 2.125 (0) |
| v9_summoner | v8 | clear | 2.941 / 2.467 (0) | 2.804 / 2.436 (0) |
| v9_summoner | v8 | bases@8 | 2.225 / 2.150 (0) | 2.200 / 2.200 (0) |
| v9_knight | v8 | clear | 2.995 / 2.499 (1) | 2.900 / 2.465 (1) |
| v9_knight | v8 | bases@8 | 2.359 / 2.231 (1) | 2.410 / 2.256 (1) |
| v9_archer | v9 | clear | 3.890 / 3.799 (0) | 3.700 / 3.934 (0) |
| v9_archer | v9 | bases@8 | 2.550 / 2.400 (0) | 2.475 / 2.450 (0) |
| v9_summoner | v9 | clear | 2.900 / 2.464 (0) | 2.785 / 2.442 (0) |
| v9_summoner | v9 | bases@8 | 2.150 / 2.700 (0) | 2.175 / 2.625 (0) |
| v9_knight | v9 | clear | 2.983 / 2.490 (1) | 2.890 / 2.460 (1) |
| v9_knight | v9 | bases@8 | 2.300 / 2.700 (0) | 2.300 / 2.600 (0) |

## 赢输直接互换：逐局列出

| AI | 对手 | 槽位 | 种族 | main 胜者 | 修改后胜者 |
|---|---|---|---|---|---|
| v9_archer | v8 | ladder-02 | ember | v8 | v9_archer |
| v9_archer | v8 | ladder-12 | ember | v8 | v9_archer |
| v9_archer | v8 | ladder-49 | grove | v8 | v9_archer |
| v9_archer | v8 | ladder-25 | grove | v8 | v9_archer |
| v9_archer | v8 | ladder-25 | ember | v9_archer | v8 |
| v9_archer | v8 | ladder-14 | grove | v9_archer | v8 |
| v9_archer | v8 | ladder-43 | grove | v9_archer | v8 |
| v9_archer | v8 | ladder-43 | ember | v9_archer | v8 |
| v9_archer | v8 | ladder-44 | grove | v8 | v9_archer |
| v9_summoner | v8 | ladder-12 | grove | v9_summoner | v8 |
| v9_summoner | v8 | ladder-12 | ember | v8 | v9_summoner |
| v9_summoner | v8 | ladder-18 | ember | v8 | v9_summoner |
| v9_summoner | v8 | ladder-20 | ember | v8 | v9_summoner |
| v9_summoner | v8 | ladder-06 | grove | v8 | v9_summoner |
| v9_summoner | v8 | ladder-06 | ember | v9_summoner | v8 |
| v9_summoner | v8 | ladder-04 | grove | v9_summoner | v8 |
| v9_summoner | v8 | ladder-49 | ember | v9_summoner | v8 |
| v9_summoner | v8 | ladder-44 | ember | v9_summoner | v8 |
| v9_summoner | v8 | ladder-21 | ember | v8 | v9_summoner |
| v9_summoner | v8 | ladder-55 | grove | v9_summoner | v8 |
| v9_summoner | v8 | ladder-55 | ember | v9_summoner | v8 |
| v9_knight | v8 | ladder-12 | ember | v9_knight | v8 |
| v9_knight | v8 | ladder-20 | ember | v9_knight | v8 |
| v9_knight | v8 | ladder-06 | grove | v8 | v9_knight |
| v9_knight | v8 | ladder-25 | grove | v9_knight | v8 |
| v9_knight | v8 | ladder-25 | ember | v8 | v9_knight |
| v9_knight | v8 | ladder-59 | ember | v8 | v9_knight |
| v9_archer | v9 | ladder-02 | ember | v9_archer | v9 |
| v9_archer | v9 | ladder-01 | grove | v9 | v9_archer |
| v9_archer | v9 | ladder-43 | ember | v9_archer | v9 |
| v9_archer | v9 | ladder-16 | grove | v9_archer | v9 |
| v9_summoner | v9 | ladder-02 | grove | v9_summoner | v9 |
| v9_summoner | v9 | ladder-12 | grove | v9_summoner | v9 |
| v9_summoner | v9 | ladder-20 | grove | v9_summoner | v9 |
| v9_summoner | v9 | ladder-63 | grove | v9 | v9_summoner |
| v9_summoner | v9 | ladder-06 | grove | v9 | v9_summoner |
| v9_summoner | v9 | ladder-49 | grove | v9 | v9_summoner |
| v9_summoner | v9 | ladder-49 | ember | v9_summoner | v9 |
| v9_summoner | v9 | ladder-14 | grove | v9_summoner | v9 |
| v9_summoner | v9 | ladder-14 | ember | v9_summoner | v9 |
| v9_summoner | v9 | ladder-16 | grove | v9 | v9_summoner |
| v9_summoner | v9 | ladder-16 | ember | v9 | v9_summoner |
| v9_summoner | v9 | ladder-44 | ember | v9_summoner | v9 |
| v9_knight | v9 | ladder-12 | grove | v9_knight | v9 |
| v9_knight | v9 | ladder-18 | grove | v9_knight | v9 |
| v9_knight | v9 | ladder-52 | ember | v9 | v9_knight |
| v9_knight | v9 | ladder-43 | ember | v9_knight | v9 |
| v9_knight | v9 | ladder-59 | ember | v9 | v9_knight |
| v9_knight | v9 | ladder-34 | grove | v9 | v9_knight |

## 涉及超时/无胜者的翻转：逐局列出

| AI | 对手 | 槽位 | 种族 | main 胜者 | 修改后胜者 |
|---|---|---|---|---|---|
| v9_archer | v8 | ladder-02 | grove | v9_archer | 超时/无胜者 |
| v9_archer | v8 | ladder-20 | grove | v9_archer | 超时/无胜者 |
| v9_archer | v8 | ladder-01 | ember | 超时/无胜者 | v9_archer |
| v9_archer | v8 | ladder-04 | grove | 超时/无胜者 | v9_archer |
| v9_archer | v8 | ladder-21 | grove | 超时/无胜者 | v9_archer |
| v9_summoner | v8 | ladder-04 | ember | 超时/无胜者 | v8 |
| v9_archer | v9 | ladder-18 | grove | 超时/无胜者 | v9 |
| v9_archer | v9 | ladder-18 | ember | 超时/无胜者 | v9 |
| v9_archer | v9 | ladder-20 | grove | v9_archer | 超时/无胜者 |
| v9_archer | v9 | ladder-52 | grove | v9 | 超时/无胜者 |
| v9_archer | v9 | ladder-52 | ember | v9_archer | 超时/无胜者 |
| v9_archer | v9 | ladder-04 | ember | 超时/无胜者 | v9_archer |
| v9_archer | v9 | ladder-25 | ember | 超时/无胜者 | v9_archer |
| v9_archer | v9 | ladder-14 | ember | 超时/无胜者 | v9_archer |
| v9_archer | v9 | ladder-21 | grove | v9_archer | 超时/无胜者 |
| v9_archer | v9 | ladder-21 | ember | v9_archer | 超时/无胜者 |
| v9_archer | v9 | ladder-59 | ember | v9_archer | 超时/无胜者 |
| v9_archer | v9 | ladder-55 | ember | 超时/无胜者 | v9_archer |
| v9_summoner | v9 | ladder-02 | ember | 超时/无胜者 | v9 |
| v9_summoner | v9 | ladder-63 | ember | v9_summoner | 超时/无胜者 |
| v9_summoner | v9 | ladder-04 | grove | v9_summoner | 超时/无胜者 |
| v9_summoner | v9 | ladder-04 | ember | 超时/无胜者 | v9 |
| v9_summoner | v9 | ladder-21 | grove | v9 | 超时/无胜者 |
| v9_summoner | v9 | ladder-21 | ember | 超时/无胜者 | v9 |
| v9_knight | v9 | ladder-02 | ember | v9_knight | 超时/无胜者 |
| v9_knight | v9 | ladder-01 | ember | v9 | 超时/无胜者 |
| v9_knight | v9 | ladder-06 | ember | 超时/无胜者 | v9 |
| v9_knight | v9 | ladder-52 | grove | 超时/无胜者 | v9_knight |
| v9_knight | v9 | ladder-04 | grove | 超时/无胜者 | v9_knight |
| v9_knight | v9 | ladder-04 | ember | v9_knight | 超时/无胜者 |
| v9_knight | v9 | ladder-49 | grove | v9_knight | 超时/无胜者 |
| v9_knight | v9 | ladder-49 | ember | v9 | 超时/无胜者 |
| v9_knight | v9 | ladder-25 | grove | 超时/无胜者 | v9_knight |
| v9_knight | v9 | ladder-14 | grove | v9_knight | 超时/无胜者 |
| v9_knight | v9 | ladder-43 | grove | v9 | 超时/无胜者 |
| v9_knight | v9 | ladder-16 | ember | 超时/无胜者 | v9 |
| v9_knight | v9 | ladder-44 | ember | 超时/无胜者 | v9 |
| v9_knight | v9 | ladder-59 | grove | 超时/无胜者 | v9_knight |

命名地图统计是本次主要证据。这个 bench 的 ladder 布局覆盖 1v1 开局变化，并不覆盖命名八方河湾的八人经济或长期平衡；也不把单个种子的胜率波动视为统计显著提升。原始 12 份日志和命令输出在 A100 本任务 results 目录保留，并另存不可变证据归档。

## 原始证据

[raw.evidence.json](raw.evidence.json) 指向 12 份原始结果日志、四次命令的输出、实际 Node 版本 v22.23.3 和源文件 SHA-256 校验，以及 main 失败测试、末版通过测试、构建和 mac1 场景日志。归档在 A100 本任务允许范围内：

`/codegeex/jeffry/sketch-rts-camps/player-budget/evidence/sha256/1f469e01c26b47225cc50cfca80fa9a96185a5e27368f4ed11b020d825a62b30`

使用 `sketch evidence get` 时，将自己的 machines 配置中 a100.evidence 指向上面的 `.../player-budget/evidence`；本次没有写公共 evidence 目录。原始解包后的 results 也保留在该任务目录。
