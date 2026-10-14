# Generation v4 精确输入与来源归档

固定范围仅为原 `stage-run-v4`。[原报告](../stage4-report.md)、[proof gzip](../stage-run-v4/proof.json.gz)、[generation summary gzip](../stage-run-v4/generation-summary.json.gz)和 [完整 query gzip](../stage-run-v4/replay-stage-query.json.gz)保留原 EXIT0/PASS 与独立软件 GPU 诊断范围，不改原指标、SHA、失败记录或 corpus reference。原 v1 corpus gzip 沿用，没有重导出；v2/v3 原数据与执行工具不改写。

[固定输入 manifest](input-archives.json)记录 **220 输入 / 14,099,124 原 bytes → 3,058,958 gzip bytes**，最大单件 **344,517 bytes**，每项保留原 filename、size/SHA 与同路径 `.gz` 身份。[创建报告](input-archive-create-report.json)保持创建时点；[执行记录](execution.json)和 [创建](create.log.gz)、[独立验证](verify.log.gz)、[清理](prune.log.gz)、[全部 220 文件恢复](restore-proof.log.gz)日志保存实际四步 exit 0、逐完整原 size/SHA 通过。[临时清理证明](temporary-restore-cleanup.json)记录恢复树再次逐原 SHA 验证后，只移除工具自己的临时镜像。

源码仅一套真实 `complete-source-snapshot/`，**1125 src 文件 / 9,687,156 bytes**逐 Git `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` blob 与完整 SHA 核验，canonical file-set SHA 为 `99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0`，复用 [2,221,603-byte 容器](../../../../source-archives/99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0.tar.gz)。[run source manifest](../stage-run-v4/replay-generation-source-archive.json)、[创建报告](../../../../source-archives/replay-generation-v4-source-archive-report.json)、[清理报告](../../../../source-archives/replay-generation-v4-source-archive-prune-report.json)、[1125 文件完整恢复证明](../../../../source-archives/replay-generation-v4-source-archive-restore-fullsha-proof.json)与 [执行证据](../../../../source-archives/replay-generation-v4-source-archive-execution-evidence.json)记录完整来源验证、清理、独立恢复与自有临时恢复目录清理。快照没有 `.git`、`public`、`package.json`，不是可运行 checkout 的重建。

## 恢复与清理

原工具读取 v1 corpus 时，先恢复 v1 inputs，再恢复 generation inputs 与 v4 source。从仓库根目录执行，不带 `--out`，使原 driver 按原 filename 读取：

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-generation-input-archive.py --materialize
python3 scripts/art-replay-generation-source-archive.py --materialize --folder exact-upload-replay/stage-run-v4
```

随后核对 run 内的 [原 v4 driver](../stage-run-v4/art-card-upload-replay-proof-v4.mjs.gz)与 [原 v4 observer](../stage-run-v4/art-card-upload-replay-observer-v4.mjs.gz)等执行 snapshots。当前维护脚本不能替代过去字节；恢复也不表示已重新运行 browser capture。新捕获仍需独占窗口与全新输出目录。

| 独立恢复命令 | 新目录布局 |
| --- | --- |
| `art-replay-generation-input-archive.py --materialize --out /tmp/new-generation-inputs` | `/tmp/new-generation-inputs/exact-upload-replay/stage-run-v4/...`，保留 stall-followup-relative 路径 |
| `art-replay-generation-source-archive.py --materialize --folder exact-upload-replay/stage-run-v4 --out /tmp/new-generation-source` | `/tmp/new-generation-source/complete-source-snapshot/`，仅这一套，无 run 前缀 |

独立目录必须为全新目录，不能代替仓库原位输入。已有文件必须逐原 size/SHA 完全相同，变化文件拒绝覆盖或清理。原位重审后，清理实际恢复的临时裸副本并保留 gzip/manifest：

```sh
python3 scripts/art-replay-generation-input-archive.py --verify --prune
python3 scripts/art-replay-generation-source-archive.py --verify --prune --folder exact-upload-replay/stage-run-v4
```

若还原了 v1 inputs，另运行其 `art-replay-input-archive.py --verify --prune`。当前维护 scripts、candidate、生产源与旧证据不因归档修改。全部清理后，[最终原 SDK 日志](../../../../naming-gate/final-replay-generation-single-test.log.gz)实测 **6 pass / 1 fail / 22.60 秒**，[逐项验证](../../../../naming-gate/final-replay-generation-validation.json)确认匹配路径严格等于原基线 **22 项**、新增零，[源码冻结记录](../../../../naming-gate/final-replay-generation-source-freeze.json)保存 source/public 测试前后 stat/diff 均无变化的证明。原命名失败仍在，不表示全仓全绿。原 query/CPU 钟域、完整 native/HTTP 验证与硬件限制见 [v4 报告](../stage4-report.md)；总恢复依赖见 [EVIDENCE-INDEX](../../EVIDENCE-INDEX.md)。
