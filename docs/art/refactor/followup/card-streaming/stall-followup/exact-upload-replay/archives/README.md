# Original replay run-v1：精确字节保存与恢复

固定范围仅为原 `exact-upload-replay/run-v1`。整体捕获仍为 **EXIT1**：原 HTTP import-metadata 缺口保留在 [proof gzip](../run-v1/proof.json.gz)与 [HTTP metadata gzip](../run-v1/runtime-http-scripts.json.gz)中；[独立 companion audit gzip](../run-v1/runtime-http-companion-audit.json.gz)的独立结果没有回写过去的 metadata。[原运行说明](../README.md)保留测量、严格验证与软件 GPU 边界，原 1 张 PNG 不压缩。

[固定输入 manifest](input-archives.json)保存 **279 份输入 / 227,253,948 原 bytes → 10,076,386 gzip bytes**，最大 gzip **4,551,562 bytes**。53 events 与 2 prior scratch 共 55 份 binary、199 份 runtime HTTP body、原 capture/replay JSON 与执行 driver/helper snapshots 全部以原路径加 `.gz` 保存，原 filename、size/SHA 与失败状态不改写。[创建报告](input-archive-create-report.json)保持创建时 `deletedOriginals=0`；创建、独立验证、显式清理及全部 279 文件独立 `/tmp` 恢复实际四步 exit 0，恢复文件逐完整原 size/SHA 通过。[执行记录](execution.json)及 [创建](create.log.gz)、[验证](verify.log.gz)、[清理](prune.log.gz)、[恢复](restore-proof.log.gz)日志保留实际结果。

[临时恢复清理证明](temporary-restore-cleanup.json)记录全部 279 文件再次逐完整原 size/SHA 验证后，只清理本工具自己的临时恢复树；归档、原 1 张 PNG 与其他工作区内容保留。

源码归档只包含真实的 `complete-source-snapshot/` **一套 / 1125 文件 / 9,687,156 bytes**，不存在需要补造的第二套 source 目录。完整原 SHA 与 Git `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` blob 相同，canonical file-set SHA 为 `99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0`，复用既有 [2,221,603-byte 容器](../../../../source-archives/99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0.tar.gz)。[run source manifest](../run-v1/replay-source-archive.json)、[创建报告](../../../../source-archives/replay-v1-source-archive-report.json)、[清理报告](../../../../source-archives/replay-v1-source-archive-prune-report.json)、[独立恢复证明](../../../../source-archives/replay-v1-source-archive-restore-fullsha-proof.json)及 [执行证据](../../../../source-archives/replay-v1-source-archive-execution-evidence.json)记录完整来源核验、1125 份裸源码清理与全量 `/tmp` 恢复 SHA 通过；恢复证明另记录临时恢复目录已清理。input/source 归档工具没有改维护 scripts、audit code、PNG 或原 raw 内部字段。

这 1125 个成员全是 `src/...`；快照不含 `.git`、`public`、`package.json`，恢复的是原来源字节，不能作为原可运行 checkout 已重建的证明。

## 此 run 的原位恢复

从仓库根目录，先恢复 [replay inputs](../../../../../../../../scripts/art-replay-input-archive.py)，再恢复 [replay source](../../../../../../../../scripts/art-replay-source-archive.py)，最后检查或使用原 analyzer/driver：

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-source-archive.py --materialize --folder exact-upload-replay/run-v1
```

这两个命令不带 `--out`，还原原 repository 文件名。该 run 的归档独立于旧 naming/queue inputs；仅在重审那些历史捕获时，才使用它们各自的恢复顺序。

当前维护 replay scripts 已有新阶段代码，不能替代旧 run 的 [driver gzip](../run-v1/art-card-upload-replay-proof.mjs.gz)、[observer gzip](../run-v1/art-card-upload-replay-observer.mjs.gz)与其余 manifest-listed executed helpers。恢复只恢复原 snapshots，没有将维护脚本退回旧版本。新 browser 捕获仍需独占窗口与全新目录，不能覆写 run-v1；归档恢复本身不证明已重新运行旧 browser driver。

输入 manifest 包含 companion audit 的原结果，不包含 HTTP audit executable 副本。原运行说明中的 audit argv 保留历史用途；这次 materialize 不还原维护 audit 代码，重跑该审计仍需单独核对原工具身份与执行来源。

## 独立目录与清理

`--out` 必须指定全新目录，布局为：

| 命令 | 独立恢复布局 |
| --- | --- |
| `art-replay-input-archive.py --materialize --out /tmp/new-replay-inputs` | `/tmp/new-replay-inputs/exact-upload-replay/run-v1/...`，保留 stall-followup-relative 路径 |
| `art-replay-source-archive.py --materialize --folder exact-upload-replay/run-v1 --out /tmp/new-replay-source` | `/tmp/new-replay-source/complete-source-snapshot/`，只这一套目录，无 run 前缀 |

独立恢复用于核验原字节，不能代替按仓库原位置读取的 helper/analyzer 输入。已存在文件必须逐原 size/SHA 相同，变化文件拒绝覆盖或清理。完成原位重审后，以显式清理移除临时裸副本，保留 `.gz` 与 manifest：

```sh
python3 scripts/art-replay-input-archive.py --verify --prune
python3 scripts/art-replay-source-archive.py --verify --prune --folder exact-upload-replay/run-v1
```

原 22 项命名基线不是归档删除目标。全部归档/清理结束后，[新 SDK 单测日志](../../../../naming-gate/after-replay-v1-single-test.log.gz)实测 **6 pass / 1 fail / 22.60 秒**，[逐项验证](../../../../naming-gate/after-replay-v1-validation.json)确认匹配路径严格等于原基线 **22 项**，旧命名失败仍保留。完整恢复依赖见 [总归档索引](../../EVIDENCE-INDEX.md)；全游戏、战斗与硬件 GPU 结论不由该 20-kind 原生资产 probe 或单次重放扩展。
