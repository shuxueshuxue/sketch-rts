# Replay stage 输入与来源精确归档

固定范围仅为 `stage-run-v2` 与 `stage-run-v3`。v2 的 ENOENT 发生于 browser/GPU 启动前，实际只保存 [proof gzip](../stage-run-v2/proof.json.gz) **226,003 bytes**及 [log gzip](../stage-run-v2/run.log.gz) **667 bytes**，没有 helper/source 快照；不补造来源目录。v3 的 [proof gzip](../stage-run-v3/proof.json.gz)与 [stage report](../stage-report.md)保留 EXIT0/PASS 及原阶段 query/native 检查范围，压缩不改变状态、数字或结论。

[固定 manifest](input-archives.json)保存 **222 输入 / 14,285,340 原 bytes → 3,156,783 gzip bytes**，最大单件 **343,741 bytes**；其中 v2 两份，v3 220 份。每项保留原 filename、size/SHA 与同原路径 `.gz` 身份。[创建报告](input-archive-create-report.json)保持创建时点；[执行记录](execution.json)、[创建](create.log.gz)、[独立验证](verify.log.gz)、[清理](prune.log.gz)、[222 文件恢复](restore-proof.log.gz)日志证明四步实际 exit 0，逐完整原 size/SHA 通过。[临时清理证明](temporary-restore-cleanup.json)记录恢复树再次逐原 SHA 核验后，只移除工具自己的临时镜像。原 input/record/query、corpus reference 与 PNG 不改写；v1 的 `capture.json.gz` 原样沿用，不重新 dump。

source 工具只处理 v3 的真实 `complete-source-snapshot/` **一套 / 1125 文件 / 9,687,156 bytes**，逐 Git `42bd61c74934dc76f30d42b62e1e31eb5c5974ff` blob 和完整 SHA 核验，canonical set SHA 为 `99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0`，复用 [2,221,603-byte 容器](../../../../source-archives/99aa634b5af359a3b85022df6b22f062955f5602c3d9567d723c0f3e637922a0.tar.gz)。[v3 source manifest](../stage-run-v3/replay-stage-source-archive.json)、[创建报告](../../../../source-archives/replay-stage-v3-source-archive-report.json)、[清理报告](../../../../source-archives/replay-stage-v3-source-archive-prune-report.json)、[1125 文件恢复证明](../../../../source-archives/replay-stage-v3-source-archive-restore-fullsha-proof.json)与 [执行证据](../../../../source-archives/replay-stage-v3-source-archive-execution-evidence.json)保留实际完整验证/清理/恢复及自有临时恢复目录清理。v2 不在 source 白名单中；源码集合只有 `src/...`，不是含 `.git`、`public`、`package.json` 的可运行 checkout 重建。

## 恢复原 stage 证据

原工具若读取 v1 corpus，先恢复旧 v1 inputs，再恢复 stage inputs 与 v3 source。以下命令从仓库根目录执行，不带 `--out`，供原 driver/analyzer 按原 filename 读取：

```sh
python3 scripts/art-replay-input-archive.py --materialize
python3 scripts/art-replay-stage-input-archive.py --materialize
python3 scripts/art-replay-stage-source-archive.py --materialize --folder exact-upload-replay/stage-run-v3
```

随后检查和使用 v3 内保存的 [原 v3 driver](../stage-run-v3/art-card-upload-replay-proof-v3.mjs.gz)与 [v2-version observer](../stage-run-v3/art-card-upload-replay-observer-v2.mjs.gz)等原 helper snapshots；helper 版本名不表示失败 v2 曾保存过它们。当前维护 replay scripts 已推进后续阶段，不能替代过去执行字节，也不能为 v2 补出未保存的 helper/source。新 browser run 仍须独占窗口和全新输出目录，恢复不表示已重跑捕获。

| 独立恢复命令 | 新目录布局 |
| --- | --- |
| `art-replay-stage-input-archive.py --materialize --out /tmp/new-stage-inputs` | `/tmp/new-stage-inputs/exact-upload-replay/stage-run-v2/...` 与 `/tmp/new-stage-inputs/exact-upload-replay/stage-run-v3/...`，保留 stall-followup-relative 路径 |
| `art-replay-stage-source-archive.py --materialize --folder exact-upload-replay/stage-run-v3 --out /tmp/new-stage-source` | `/tmp/new-stage-source/complete-source-snapshot/`，仅一套，无 run 前缀 |

独立 `--out` 要求全新目录，不能代替仓库原位输入。已有文件必须逐原 size/SHA 相同，变化文件拒绝覆写或清理。原位重审后，清理实际还原的临时裸输入/来源，保留 sidecar、manifest 与原人写说明：

```sh
python3 scripts/art-replay-stage-input-archive.py --verify --prune
python3 scripts/art-replay-stage-source-archive.py --verify --prune --folder exact-upload-replay/stage-run-v3
```

若同时恢复了 v1 inputs，另用 `art-replay-input-archive.py --verify --prune` 核原字节并清理其临时裸副本。该轮 SDK 单测 **deferred** 至下一阶段统一执行，不能把此前 run-v1 的 22 项历史结果当成 stage 包装后新测。原失败、native/query 与软件 GPU 边界见 [stage report](../stage-report.md)；总恢复索引见 [EVIDENCE-INDEX](../../EVIDENCE-INDEX.md)。
