# Source snapshot 精确归档索引（已验证、prune 与恢复验证）

本轮在静态盘点之后授权创建并验证精确压缩归档；主车道随后独立完整验证并 prune 了已归档裸来源快照，又完成一个 run 的精确恢复验证。没有改写 raw/provider/helper/metadata。[v1 工具](../../../../../../scripts/art-card-stall-source-archive.py)沿用现有 [art-card-current-correctness-archive.py](../../../../../../scripts/art-card-current-correctness-archive.py) 的完整 file-set 身份、确定性 tar/gzip、独立解压 SHA 验证、materialize 与最后单独 prune 的流程。源快照支持嵌套相对路径，因此使用独立新工具，没有修改旧 PNG-only 脚本。

实际归档命令 `python3 scripts/art-card-stall-source-archive.py --archive` 已 exit 0：**11 run / 12,320 文件**全部解压 SHA 与原字节、原捕获 source map、原来源文档 SHA 通过；`deletedFiles=0`。随后独立 `--verify` 也 exit 0，完整重做上述 11 run 验证。所有逐 run manifest 位于各自原 run 目录的 `source-archive.json`。共享 [归档报告](../../source-archives/stall-source-archive-report.json)和 [容器](../../source-archives/468839ab37bee10734865f09d6364d9e04d2efa0e501ce97da8b2cc21ed53736.tar.gz)的实际大小是 **2,212,438 bytes**，容器 SHA 为 `191595b48a5129e68990628f6f6aeb2575977b2ed88de31e47463568d71d32d1`。没有渲染、计时或改变失败 capture 状态。

之后主车道运行 `--verify --prune`，再次核验全部 11 run、每个解压文件和原捕获文档，然后删除 **12,320 个裸 source snapshot 文件**；[原日志](../../source-archives/stall-source-prune.log)保留实际结果。`--materialize --folder current-trace --out <全新 /tmp 目录>` 恢复 **1120 个文件 / 9,651,718 bytes** 并逐 SHA 通过，[恢复日志](../../source-archives/stall-source-restore-proof.log)保留结果。恢复到 `/tmp` 是精确可恢复性证明；尚未声明在仓库原路径 materialize 后已运行原 analyzer。原 archive report 的 `deletedFiles=0` 是创建时的真实状态，不因后续 prune 而重写历史报告。

## 完整集合与容量

已完成的 **11 个 `source-snapshot`** 逐文件读取并计算 SHA-256；每个集合都是 **1120 个文件 / 9,651,718 bytes**。完整 `{name,size,sha256}` 的排序 JSON SHA 完全相同：

```text
468839ab37bee10734865f09d6364d9e04d2efa0e501ce97da8b2cc21ed53736
```

哈希定义与现有归档脚本一致：以 snapshot 内 POSIX 相对路径为 `name`，文件 size 与完整原字节 SHA 为另外两个字段；文件按 name 排序，JSON `sort_keys=True,separators=(',',':')`，UTF-8 编码后 SHA-256。它验证了文件路径、数量、大小与每份字节，不能只凭同一 Git HEAD 或视觉相似去重。

初次静态脚本使用 Python `Path` 的 component 排序，得到 `7e0b7694…`；11 个集合仍完全相同，但这不是上述完整 name 的词法顺序。新归档工具首次运行在 member-order 自校验阶段拒绝，源文件、raw 文档未被修改，也没有任何删除。随后显式按 name 排序得到上面的规范 SHA；首次生成的孤立容器单独保留，不作为成功归档 manifest 使用。

授权候选清单为下列 run 内的 `source-snapshot`，相对本目录：

| 完成的 run | 文件数 | 原字节 |
| --- | ---: | ---: |
| `current-trace` | 1120 | 9,651,718 |
| `current-gl-trace` | 1120 | 9,651,718 |
| `mip-half-camera/reference` | 1120 | 9,651,718 |
| `mip-half-camera/candidate` | 1120 | 9,651,718 |
| `mip-half-abba/production-A` | 1120 | 9,651,718 |
| `mip-half-abba/candidate-B` | 1120 | 9,651,718 |
| `mip-half-abba/candidate-B2`（启动失败仍完整保留） | 1120 | 9,651,718 |
| `mip-half-abba-v2/production-A` | 1120 | 9,651,718 |
| `mip-half-abba-v2/candidate-B` | 1120 | 9,651,718 |
| `mip-half-abba-v2/candidate-B2` | 1120 | 9,651,718 |
| `mip-half-abba-v2/production-A2` | 1120 | 9,651,718 |

总计 **12,320 文件 / 106,168,898 bytes**。逐 run manifest 可以复用 **一个**完整集合相同的 tar.gz，避免 11 份源码目录造成 PR 文件噪音。容器不需要跨 run 混合字段或丢失失败状态；每个 run 仍保留独立来源文档和恢复路径。

原静态容量预估仅基于单套约 9.65 MB 原文件；其 tar header/block padding 合计 10,516,480 bytes。随后实测 gzip 为上面的 2,212,438 bytes。工具沿用严格 **90 MiB** 上限并验证实际容器大小，为 GitHub 100 MB 边界留余量。若将来集合变大超过限额，应先按完整成员顺序确定性拆卷，再验证所有卷；此次集合无需拆卷。

静态遍历时新出现的 `row-band-native/original/source-snapshot` 尚在写入（当时仅 6 文件），**明确不纳入以上清单**。未来 row-band/native/formal run 只能在进程结束并验证捕获完成/失败的实际状态后新增单独授权项，不能动态 `rglob` 所有正在写入的目录执行 prune。

## 新 manifest 的最低契约

每个 run 在自己的目录新增 `source-archive.json`，不覆写原捕获文件。包含：

- `version`、repo-relative `target`（完整原 `source-snapshot` 路径）、`fileSetSha256` 和固定 hash 定义。
- `files`：完整排序的 `{name,size,sha256}`，每项保留 snapshot 原相对路径。
- `archive`：共享容器 repo-relative 路径、实际 byte size、完整 SHA。
- `sources`：本 run 原 raw/header/metadata/provenance 文档的相对路径与完整 SHA，验证这些文档归档前后未被修改。以该 run 原有来源字段核对 snapshot SHA，不猜测或重写缺失字段。
- `meaning`：只证明原字节保存，不宣称实验通过或性能验收；失败 capture 仍保持失败。

共享 store 可以使用 `docs/art/refactor/followup/source-archives/<fileSetSha256>.tar.gz`，和现有 PNG store 分开。容器 `mtime=0`、regular files only、固定 mode、owner/group 与排序；gzip 不写运行时 filename/time。去重仅在完整 file-set 相等且现有容器解压校验通过后复用。

## 操作顺序与复原

v1 工具提供 `--archive`、`--verify`、`--materialize --folder`、显式 `--prune` 模式；归档默认保留源文件。归档时拒绝 symlink、路径穿越、绝对成员路径、非 regular member、tracked file 的未经授权删除、同名 manifest 或已有不匹配容器；每个 target 固定白名单且不得处于运行中。已生成 manifest 后单独 prune 的命令是 `python3 scripts/art-card-stall-source-archive.py --verify --prune`；主车道已按上述日志完成它。

1. 读取固定清单中的所有原始文件与来源文档，记录原 byte SHA，核对集合身份。每个容器用临时文件创建，再校验大小与完整 SHA。
2. 在全新 `/tmp` 目录手动逐 regular member 解压；先核 member 集合/路径/类型/大小，再核每个完整文件 SHA。不能调用不加限制的 `extractall`。所有 11 run 的原来源文档与当前仍在磁盘的文件必须再次逐项校验。
3. 保存新 manifest 与独立 archive report；确认 archive 与新来源验证成功后才允许显式 prune。删除前再次逐文件核 SHA；任一差异都拒绝删除。原 raw/helper/metadata 和失败记录始终保留。
4. `--verify` 可在没有裸 snapshot 的情况下验证容器、每个成员及原来源文档。`--materialize` 默认恢复到各 run **原 `source-snapshot` 相对路径**；已有文件必须逐项相同，绝不覆写变化文件。`--out` 则只能是全新指定目录。
5. 原 analyzer 无需改变来源判断逻辑；在运行前 materialize 所需 run 到原路径，然后使用原命令。成功恢复必须逐文件核原 SHA，而不是仅比较压缩件 SHA。

PNG 使用现有 exact PNG archive 方式独立处理。相机候选/reference 即使 RGBA 相等，仍需完整原编码 PNG `name/size/SHA` 集相同才复用容器；不能重编码、直接删图或以 RGBA 等价替代原 PNG SHA。新 half/row-band target 的白名单、keep policy 与归档报告应另作新版本，旧运行工具和 manifest 保持原字节。

## Upload pilot v2：四个已完成 run，归档、prune 与恢复均通过

[v2 新工具](../../../../../../scripts/art-card-stall-source-archive-v2.py)保留 v1 已执行工具原字节。初次静态准备仅列入两个 row-band pilot；在 ring512 timed quiet window 结束后，工具执行前固定扩充为下面四个已完成 run。之后的实际执行使用同一工具字节，不改执行版或旧 v1：

| 完成的 run | 完整源码路径 | 文件数 / 原字节 |
| --- | --- | ---: |
| `row-band-pilot-v2/original-A` | `complete-source-snapshot/` | 1120 / 9,651,718 |
| `row-band-pilot-v2/candidate-B` | `complete-source-snapshot/` | 1120 / 9,651,718 |
| `ring512-pilot-v2/original-A` | `complete-source-snapshot/` | 1120 / 9,651,718 |
| `ring512-pilot-v2/candidate-B` | `complete-source-snapshot/` | 1120 / 9,651,718 |

工具从 `uploadIsolation.sourceInventory` 核对完整 start/final `sourceSha256`、`sourceSnapshots` 相对路径与冻结状态，要求 capture `completed=true`；不接受动态扫描或尚在写入的 run。执行工具 SHA 为 `27fdbd6e2065a85c777a4bcd14989a87b174a71d0723c34a7c9aad1935c8551e`；v1 仍是 `bd17477d6795f474cfe8a701609f234598e219ea0f08fe1b2aaa2fd58ea6ca23`。

此 driver 的完整 1120 源目录名是 **`complete-source-snapshot/`**，不是 `source-snapshot/`。后者是独立的少量原版/候选/provider bytes，保留并核原 SHA，没有与完整源码目录一起 prune。v2 工具新增四份 version-2 `source-archive.json` 与 [创建报告](../../source-archives/stall-source-archive-v2-report.json)，核对四份完整 file-set SHA 均为 `468839ab…` 并精确解压通过后复用了上面的共享容器；成员默认 materialize 回各 run 原 `complete-source-snapshot` 路径，没有新增重复容器。

在主车道确认 quiet window 结束、四个 pilot 已完整结束并授权后，依次执行以下命令，**全部 exit 0**：

```sh
python3 scripts/art-card-stall-source-archive-v2.py --archive
python3 scripts/art-card-stall-source-archive-v2.py --verify
python3 scripts/art-card-stall-source-archive-v2.py --verify --prune
python3 scripts/art-card-stall-source-archive-v2.py --materialize --folder ring512-pilot-v2/candidate-B --out /tmp/art-stall-source-v2-ring512-restore
```

[创建日志](../../source-archives/stall-source-archive-v2-create.log)、[独立验证日志](../../source-archives/stall-source-archive-v2-verify.log)、[prune 日志](../../source-archives/stall-source-archive-v2-prune.log)和 [恢复日志](../../source-archives/stall-source-archive-v2-restore-proof.log)保留全部运行结果。每次都验证原捕获文档、source map、每个实际解压文件完整 SHA；prune 前再核当前原字节和 tracked guard。最终只删除 **4480 个完整 source snapshot 文件 / 38,606,872 bytes**，raw/helper/provider/metadata/负结果/分析报告保持原字节。创建报告 `deletedFiles=0` 与后续 prune 日志 `deletedFiles=4480` 分别表示各自真实时点，不改写旧报告。

[独立执行记录](../../source-archives/stall-source-archive-v2-execution.json)冻结实际 argv、四次 exit code、每份原日志 SHA、创建报告 SHA 和执行工具 SHA，便于以后核验工具与原执行证据的关系。

恢复操作在新的 `/tmp/art-stall-source-v2-ring512-restore` 中还原 ring candidate 的 **1120 个文件 / 9,651,718 bytes**，逐完整 SHA 通过；没有将此步骤称为原 analyzer 已执行。主车道 ring512 quiet window 期间没有执行这些哈希、解压或大文件 IO。native fixture、未来 formal run 和其他活动 run 不在白名单；pilot 的资源/时间结果及“不推广”决定属于自己的证据，归档成功不表示性能验收。

两份约 180 MB 裸 trace 的处理独立于 source snapshot。主车道已经用本目录 `.gitignore` 仅排除两个裸副本；`.gz` 保留完整事件，逐解压字节与裸 trace 相等。本归档工具没有修改裸 trace/gzip。原 analyzer 硬读取 `trace.json`，从仓库根目录按原路径精确恢复：

```sh
gunzip -c docs/art/refactor/followup/card-streaming/stall-followup/current-trace/trace.json.gz > docs/art/refactor/followup/card-streaming/stall-followup/current-trace/trace.json
gunzip -c docs/art/refactor/followup/card-streaming/stall-followup/current-gl-trace/trace.json.gz > docs/art/refactor/followup/card-streaming/stall-followup/current-gl-trace/trace.json
```

| Trace | 原 JSON SHA-256 | gzip SHA-256 |
| --- | --- | --- |
| current-trace | `4e79a0ea0e1617f68598e3afc585c4a5417d73bb028ce9ed3925d6a7df281b09` | `c83ebd04cc24cfdb5cb573a93ae039e992c41e40c22887601447ae408b6938b3` |
| current-gl-trace | `013a1f167d86a9218a152280630a3073874e2242f7b11890e6d62797095ffcc1` | `a1889a22b7f536f9de1278726acce04bc7d931873b66c6791e32e8d0b13d4d97` |

恢复后核对完整 JSON SHA 再运行原 analyzer。不能因为 GitHub 文件限制而裁切或采样原事件。本地原 JSON 尚未删除或修改；解压命令是从只有 gzip 的干净 checkout 恢复的步骤。
