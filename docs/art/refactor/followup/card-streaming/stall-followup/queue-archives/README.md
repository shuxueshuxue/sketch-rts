# Queue bracket 精确输入与源码归档

固定范围为五个冻结 run：`queue-bracket/control`（v1 失败）、`queue-bracket-v2/control`（v2 失败）、`queue-bracket-v3/control`、`queue-bracket-v3/pre`、`queue-bracket-v3/pre-post`（三个完成 run）。v1/v2 负结果独立保存，不参与 v3 成功分析。压缩保存原字节、原文件名和 SHA，不改变测量数字、实验失败或诊断结论。

[输入 manifest](input-archives.json)记录 143 份 raw/profile/trace、导出 header、cycle result、helper/vendor、原 analyzer 副本和日志的原路径、size/SHA 与同路径 `.gz` 身份。[创建报告](input-archive-create-report.json)的实际创建时点为 **3,124,763,195 原 bytes → 134,973,423 gzip bytes**；最大 gzip 为 **15,407,956 bytes**，逐解压 size/SHA 验证通过，`deletedOriginals=0`。创建报告保持该时点，不因后续清理改写。随后输入工具的独立验证、显式清理、全量 `/tmp` 恢复均实际 exit 0，连同创建共四步成功；143 份裸输入已清理，143 份独立恢复文件逐完整原 size/SHA 通过，24 张原 PNG 未变。[执行记录](execution.json)与 [创建](create.log.gz)、[验证](verify.log.gz)、[清理](prune.log.gz)、[恢复](restore-proof.log.gz)日志保留完整证明。

PNG、人写 Markdown 和维护脚本保持原布局。`source-snapshot/` 与 `complete-source-snapshot/` 另交 [source 工具](../../../../../../../scripts/art-queue-source-archive.py)：五个 run 共 10 份完整集合，每份 **1125 文件 / 9,687,156 bytes**，完整 name 词法排序的 canonical file-set SHA 均为 `99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0`。原 Path 层级排序预检 `6e336347…` 不作为规范集合身份。各 run 的 `queue-source-archive.json` 映射两套原目录；[共享容器](../../../source-archives/99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0.tar.gz)仅在完整集合相同后复用，实际 **2,221,603 bytes**、SHA `4367770df4b0e80693571cd930574bda73701e91a04bb8e9b779863637e26ec2`。[source 创建报告](../../../source-archives/queue-source-archive-report.json)保持创建时 `deletedFiles=0`，[清理报告](../../../source-archives/queue-source-archive-prune-report.json)另记录 **11,250 裸源码文件 / 96,871,560 bytes**逐完整原 SHA/Git blob 验证后清理。v3 control 两套目录恢复到全新 `/tmp` 后，[恢复证明](../../../source-archives/queue-source-archive-restore-fullsha-proof.json)核验 **2250 文件 / 19,374,312 bytes**全部原 SHA 相同；[执行证据](../../../source-archives/queue-source-archive-execution-evidence.json)记录最终完整验证 exit 0 与五个 run 无剩余裸源码。source 校验只需容器与不可变 Git blob，不依赖已压缩的 raw/helper；原 analyzer/helper 读取仍须恢复输入。

| 固定 run | 完整原输入 | 失败/完成边界 | Source manifest |
| --- | --- | --- | --- |
| v1 control | [raw gzip](../queue-bracket/control/raw.json.gz)、[log gzip](../queue-bracket/control.log.gz) | [失败 gzip](../queue-bracket/control/capture-failure.json.gz) | [manifest](../queue-bracket/control/queue-source-archive.json) |
| v2 control | [raw gzip](../queue-bracket-v2/control/raw.json.gz)、[log gzip](../queue-bracket-v2/control.log.gz) | [失败 gzip](../queue-bracket-v2/control/capture-failure.json.gz) | [manifest](../queue-bracket-v2/control/queue-source-archive.json) |
| v3 control | [raw gzip](../queue-bracket-v3/control/raw.json.gz)、[log gzip](../queue-bracket-v3/control.log.gz) | 完成，进入 v3 严格分析 | [manifest](../queue-bracket-v3/control/queue-source-archive.json) |
| v3 pre | [raw gzip](../queue-bracket-v3/pre/raw.json.gz)、[log gzip](../queue-bracket-v3/pre.log.gz) | 完成，进入 v3 严格分析 | [manifest](../queue-bracket-v3/pre/queue-source-archive.json) |
| v3 pre-post | [raw gzip](../queue-bracket-v3/pre-post/raw.json.gz)、[log gzip](../queue-bracket-v3/pre-post.log.gz) | 完成，进入 v3 严格分析 | [manifest](../queue-bracket-v3/pre-post/queue-source-archive.json) |

## 原位重审顺序

从仓库根目录，先恢复旧 naming 输入，再恢复新 queue inputs，随后恢复 analyzer 所需 run 的两套完整源码，最后执行原工具。恢复命令不带 `--out`，保留原 hardcoded filename 与 SHA 校验：

```sh
python3 scripts/art-naming-evidence-archive.py --materialize
python3 scripts/art-queue-input-archive.py --materialize
python3 scripts/art-queue-source-archive.py --materialize --folder queue-bracket-v3/control
python3 scripts/art-queue-source-archive.py --materialize --folder queue-bracket-v3/pre
python3 scripts/art-queue-source-archive.py --materialize --folder queue-bracket-v3/pre-post
python3 scripts/art-card-queue-bracket-analyze-v3.py --out /tmp/queue-v3-recheck
```

分析输出必须为全新目录；恢复原目录不授权覆盖旧捕获。重审 v1/v2 失败时，source 命令改为其各自 `--folder queue-bracket/control` 或 `--folder queue-bracket-v2/control`，保留原失败状态。完整结论仍见 [v3 报告](../queue-bracket-v3/analysis-strict-v3/REPORT.md)、[严格分析 gzip](../queue-bracket-v3/analysis-strict-v3/analysis.json.gz)、[工作量摘要 gzip](../queue-bracket-v3/analysis-strict-v3/work-summary.json.gz)、[原 analyzer gzip](../queue-bracket-v3/analysis-strict-v3/analyzer.py.gz)与 [原执行日志 gzip](../queue-bracket-v3/analysis-strict-v3/run.log.gz)。

## 独立恢复目录与清理

三种 `--out` 路径布局不同，目标都必须为全新目录：

| 工具 | 独立恢复布局 |
| --- | --- |
| `art-naming-evidence-archive.py --materialize --out /tmp/new-naming-tree` | `/tmp/new-naming-tree/docs/art/refactor/followup/card-streaming/stall-followup/...`，完整 repo-relative 路径 |
| `art-queue-input-archive.py --materialize --out /tmp/new-queue-inputs` | 如 `/tmp/new-queue-inputs/queue-bracket-v3/control/raw.json`，实际路径从 `queue-bracket/`、`queue-bracket-v2/` 或 `queue-bracket-v3/` 开始，无 repo 前缀 |
| `art-queue-source-archive.py --materialize --folder queue-bracket-v3/control --out /tmp/new-queue-source` | `/tmp/new-queue-source/source-snapshot/` 与 `/tmp/new-queue-source/complete-source-snapshot/`，不保留 run 前缀 |

独立目录用于检查恢复字节，不能替代原 analyzer 的仓库原位输入。输入工具逐解压文件核原 size/SHA，已存在的原位文件必须完全相同；source 工具逐原 SHA/Git blob 核验，变化文件拒绝覆盖或清理。原 filename、来源记录与 archived analyzer 均不改写。

原位重审完成后，以显式验证/清理回到正常归档布局，再运行原命名门；这些命令仅清理逐 SHA 相同的临时裸副本，保留 `.gz`、manifest、PNG 与人写说明：

```sh
python3 scripts/art-naming-evidence-archive-v2.py --verify --prune
python3 scripts/art-queue-input-archive.py --verify --prune
python3 scripts/art-queue-source-archive.py --verify --prune --folder queue-bracket-v3/control
python3 scripts/art-queue-source-archive.py --verify --prune --folder queue-bracket-v3/pre
python3 scripts/art-queue-source-archive.py --verify --prune --folder queue-bracket-v3/pre-post
```

source 清理必须只指定实际恢复的 run；不带 `--folder` 的 prune 要求五个 run 的十套裸源码均已恢复，不能用于仅恢复 v3 三臂的状态。

维护源码、SDK 断言与旧 22 项基线不因证据包装而改变。全部输入与源码清理后，[新单测日志](../../../naming-gate/after-queue-single-test.log.gz)真实结果为 **6 pass / 1 fail / 23.21 秒**，[逐项验证](../../../naming-gate/after-queue-validation.json)确认匹配路径严格等于原基线 **22 项**，新增 queue 项为零。归档工具不自行运行、过滤或替代测试；[原命名门说明](../../../naming-gate/README.md)保留历史与当前失败边界。[完整归档索引](../EVIDENCE-INDEX.md)汇总本批与旧证据的恢复依赖。
