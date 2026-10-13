# 命名门：新增证据影响分类与收敛

本轮在生产源 `77a2c307` 不变、证据 HEAD `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` 的工作树上，只运行 `src/sdk/package-boundaries.test.ts`。不改测试、SDK、共享源码或旧基线的 22 个匹配项。下面的计数是命名检查匹配文件数，不是测试失败数量、FPS 或全仓验收结论。

| 冻结观察时点 | 人写说明 | 执行 helper 快照 | 原始/历史 JSON | 第三方预打包快照 | 原 Chrome trace | 合计 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 8345 基线 | 2 | 5 | 15 | 0 | 0 | **22** |
| 较早 d7 全仓执行时 | 2 | 9 | 17 | 4 | 2 | **34** |
| 本轮处理前 42bd 工作树 | 2 | 9 | 19 | 8 | 2 | **40** |
| 本轮精确归档/清理后 | 2 | 5 | 15 | 0 | 0 | **22** |
| Queue inputs/完整源码归档后实际重跑 | 2 | 5 | 15 | 0 | 0 | **22** |

上表前四行和原单测日志记录此前固定 18 项归档的观察时点。最后一行来自 queue bracket 输入与完整源码包装后的新一次真实单测，原 22 项名单仍全部保留。

基线 22 项始终全部保留。d7 新增 12 项，最新再新增 6 项，因此之前不能把整个命名失败描述为“完全没有本轮影响”。本轮新增 18 项中没有人写 prose 或 `src`/SDK 实现；它们是四份执行 camera/parent helper、四份原 proof/analysis JSON、八份相同 GLTFLoader 预打包输入与两个本地裸 trace。精确名单、各字节大小/SHA、有限匹配片段及来源分类保留在 [完整分类 JSON](classification.json.gz)；[归档身份](new-report-archives.json)记录该报告和原单测日志的原字节/压缩 SHA。

## 实测与失败边界

处理前 [实际单测日志](current-single-test.log.gz)为 **6 项通过 / 1 项失败**，命名列表 40 项，耗时 21.77 秒。处理后 [实际单测日志](after-single-test.log.gz)仍是 **6 项通过 / 1 项失败**，命名列表严格等于原基线的 22 项，耗时 20.10 秒；新增项为零。[逐项对照](after-validation.json)记录完整剩余基线名单、命令、日志 SHA、原测试源 SHA 和恢复结果。

Queue 输入与完整源码全部包装/清理后，[新的原单测日志](after-queue-single-test.log.gz)真实结果为 **6 项通过 / 1 项失败**，耗时 **23.21 秒**。[新的逐项验证](after-queue-validation.json)确认匹配路径严格等于原基线 22 项，新 queue 项为零；这仍是失败结果，不能称为单测全绿，也不解决旧 22 项。

该次单测失败仍存在，不能称为单测或全仓全绿。前后耗时不能据此归因为某种优化：检查仍递归读取全部 `src/docs`，本轮没有做它的 CPU 归因或正式性能测量。较早全仓 6466 pass/5 fail 的原记录、船舶导航失败和原 22 基线文件均未改写。

## 证据职责与完整字节保存

命名门原断言仍检查所有维护源码及规格，没有新增路径白名单、文件扩展过滤、跳过规则或断言例外。SDK 的其余六项边界检查继续通过。第三方 loader 的诊断字符串、Chrome 尾部统计字段和已执行 helper/method 文本属于冻结证据输入；它们不应通过改写字词冒充新的 SDK 源码，也不能因扫描命中而删掉失败或来源事实。

本轮为这 18 份不可编辑输入采用仓库已有的精确压缩证据方式：16 份原 tracked helper/proof/analysis/vendor 文件新增同原路径 `.gz`；两个 trace 使用既有 `.gz`，原压缩字节完全不改。所有原 filename、method、来源 SHA、第三方输入和失败语义保存在原解压字节中。压缩前后逐完整文件 SHA 与 size 验证通过后，16 份 tracked 裸副本从 Git 原路径移除，两个 ignored 的本地 trace 裸副本删除。[固定 manifest](artifact-archives.json)保留完整原路径、角色、原/压缩 size/SHA 与 tracked 属性；[创建报告](artifact-archive-create-report.json)保持创建时的真实状态。

这不是删除测试所要保护的维护代码。普通 `src/docs` 文本和旧基线照常被同一测试扫描；证据容器在提交中保留完整输入及恢复能力，正常工作树不长期携带临时解压的 vendor/trace/helper 镜像。只归档原输入，不重编码或修补历史内容。独立恢复到 `/tmp/art-naming-input-restore-42bd61c7` 后，**全部 18 份文件的完整 repo-relative 路径、size 与原 SHA 均相同**，不是仅验证压缩文件 SHA。

[新工具](../../../../../scripts/art-naming-evidence-archive.py)只接受冻结的 18 路径，拒绝路径穿越、symlink、重复 manifest 和覆盖变化文件。它核原分类记录、原测试源、每份 sidecar、每个独立解压文件；显式 prune 前再次核原字节。原 [分类工具](../../../../../scripts/art-naming-gate-classify.py)只处理三个实际日志列出的文件；大 trace 身份来自此前已完成的完整压缩/原字节验证，分类阶段没有冒充新 trace 归因。

## 恢复顺序与复现

从仓库根目录执行：

```sh
python3 scripts/art-naming-evidence-archive.py --verify
python3 scripts/art-naming-evidence-archive.py --materialize --out /tmp/new-naming-evidence-tree
```

第二个命令要求全新目录，并恢复完整 repo-relative 路径。原分析器、source archive 的 `sources` 校验与 helper 校验使用原 filename；验证这些历史证据前应先恢复输入，然后再恢复所需完整源码快照：

```sh
python3 scripts/art-naming-evidence-archive.py --materialize
python3 scripts/art-card-stall-source-archive.py --materialize --folder current-trace
```

若分析 row-band/ring512，则第二步使用 `art-card-stall-source-archive-v2.py` 与对应 `--folder`，恢复 `complete-source-snapshot`。该命名输入工具会一起还原两个原 `trace.json`；原 analyzer 无需改变 hardcoded filename。已有文件必须完全相同，变化文件从不覆盖。原 raw 内部 filename/SHA 未修改；人写索引链接指向 `.gz` 并解释恢复步骤。

原路径 materialize 是临时证据重审状态，会再次暴露这些历史/第三方字符串。完成重审后，使用 [v2 工具](../../../../../scripts/art-naming-evidence-archive-v2.py)的 `--verify --prune` 回到正常归档状态，再跑原命名门；prune 前再次逐原 SHA 验证。v1 已执行工具原字节保留：第一次清理时原 16 文件是 tracked，可 `git rm`；以后复原的临时镜像通常已不在 index，v2 根据当前 index 选择 `git rm` 或删除已逐原 SHA 验证的本地镜像，保留 manifest 的历史 tracked 属性。v2 已在 GPU 计时窗口释放后完成原位复原/清理 roundtrip，两步实际 exit 0；后续 queue 包装完成后的新单测也已按上面的独立日志实测。归档工具不自行运行或过滤测试，不改变其意图。

此次 v2 原位 roundtrip 的 [恢复日志](../card-streaming/stall-followup/queue-archives/old-naming-v2-roundtrip-restore.log.gz)与 [清理日志](../card-streaming/stall-followup/queue-archives/old-naming-v2-roundtrip-prune.log.gz)保存两步原执行结果，[独立执行记录](../card-streaming/stall-followup/queue-archives/execution.json)保存日志原/压缩 SHA。

本轮实际执行 `--archive`、独立 `--verify`、`--verify --prune`、`--materialize --out /tmp/art-naming-input-restore-42bd61c7` **全部 exit 0**。原 [创建日志](create.log.gz)、[验证日志](verify.log.gz)、[清理日志](prune.log.gz)和 [恢复日志](restore-proof.log.gz)完整 gzip 保留；各日志原字节 SHA 和执行工具 SHA 见 [最终验证](after-validation.json)。没有宣称旧 22 项已经解决，没有改旧 human 说明以缩小基线。

## Queue bracket 后续输入

五个冻结 queue run 的 raw/profile/trace、helper/vendor 与原 analyzer/log 输入由 [独立输入工具](../../../../../scripts/art-queue-input-archive.py)精确压缩；两份失败捕获与三个完成捕获的原文件名、SHA 和结论保留。PNG、人写 Markdown、维护脚本不压缩。[输入 manifest](../card-streaming/stall-followup/queue-archives/input-archives.json)固定完整 143 项清单，[创建报告](../card-streaming/stall-followup/queue-archives/input-archive-create-report.json)保留创建时点，[执行记录](../card-streaming/stall-followup/queue-archives/execution.json)保存后续验证。输入创建、独立 verify、prune、全量 `/tmp` 恢复四步实际全部 exit 0；143 份原输入恢复的完整 size/SHA 通过，143 份裸输入已清理，24 张原 PNG 未变。各 run 的两套完整源码由 [queue source 工具](../../../../../scripts/art-queue-source-archive.py)独立保存；[清理报告](../source-archives/queue-source-archive-prune-report.json)记录 11,250 裸源码文件清理，[恢复证明](../source-archives/queue-source-archive-restore-fullsha-proof.json)核验 v3 control 两套目录 2250 文件逐完整原 SHA 通过。所有清理结束后才运行上面的新单测，避免源码恢复/清理与测试读取相互竞争。

重审 queue 证据的顺序为旧 naming 输入原位恢复 → queue inputs 原位恢复 → 对应完整源码原位恢复 → 原 analyzer/helper。例如：

```sh
python3 scripts/art-naming-evidence-archive.py --materialize
python3 scripts/art-queue-input-archive.py --materialize
python3 scripts/art-queue-source-archive.py --materialize --folder queue-bracket-v3/control
```

v3 analyzer 还需要 `pre`、`pre-post` 两臂的源码；恢复它们后，用全新输出目录运行原 analyzer。独立 `--out` 的布局因工具而异，不能代替原位恢复，[Queue 归档说明](../card-streaming/stall-followup/queue-archives/README.md)列出准确路径。完成重审后再逐 SHA 清理临时裸输入/源码，source 清理指定实际恢复的 `--folder`，保留 `.gz` 与 manifest，然后运行未改写的原命名门。旧 22 项不是本次 queue 归档的删除目标。
