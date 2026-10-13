# 可逐字节恢复的证据存储

此目录的归档只改变仓库内证据的存储方式，不代表游戏内存、VRAM、上传量或帧时间优化。原 `raw.json`、`proof.json`、语料 manifest、已记录 SHA 的 helper 与候选源码快照保持原字节；失败和被拒绝的候选同样保留。

首批 trace、36 张原 RGBA 与原先 peak/mask/rle 三组共 12 个正式 run 已完成归档、临时目录全量恢复、逐字节 SHA 核验及展开副本清理。[执行日志](validation.log)和[完整验证记录](storage-validation.json)保存精确命令、工具 SHA、109 个原路径的恢复结果、恢复续跑和拒绝覆盖错误文件的负控。所有原 proof/raw/helper/源码快照 SHA 在操作前后通过。新 twohit/upload 证据不在此次处理范围。

首批原展开 payload 共 **185,739,840 B**；加上本来已有的 trace gzip 为 **192,596,990 B**。该批三份唯一容器与一张直接展示 PNG 合计 **10,775,152 B**，比上述原 payload 存储减少 **181,821,838 B**。这组比较对共享容器只算一次，排除文档、envelope 与日志字节，不包含下述后续批次。另移除了工具自己首次生成的 12 份逐 run 临时容器 **54,966,224 B**，这项只计临时重复件清理，不再次加进上述收益。

工具为 [art-card-latency-evidence-archive.py](../../../../../../../scripts/art-card-latency-evidence-archive.py)，仅使用 Python 标准库。没有图像解码、重编码、Canvas 或 GPU 操作。归档、hash 与恢复仍消耗 CPU/I/O，必须在正式性能窗口之外运行。

## 组织和核验

- `trace-current/trace.json.gz` 是原实验已保存的完整 gzip。工具验证解压后的 86,393,736 个原字节与 `raw.json` 发布的 SHA 相同，复用原 gzip，不重写它。
- 36 张 top-down、完整 512/704 RGBA8 组成单个 tar.gz。保留每张原文件名、大小、SHA 和整个原 `corpus-manifest.json` 身份。
- PNG 使用原 encoded 字节的共享 blob 容器。各 run 的 `evidence-archive.json` 完整映射其每个原路径、大小、SHA 到 blob；同 SHA 的完整文件只存一次，不改变 PNG 编码。首批 72 个 PNG 原路径对应两种 encoded SHA。直接保留 [mask original-A 第一周期 battlefield](../mask-abba/original-A/aec09d62-hidden-0-cycle-0-battlefield.png) 供看图，其余路径可完整恢复。
- 每个目标自己的 `evidence-archive.json` 记录原证明/helper 的 SHA、完整 payload 集合与容器 SHA。恢复时先核验来源、容器与每个 member，再以原路径发布；已存在且 SHA 相同的文件可继续，不同文件拒绝覆盖。
- 清理只删除已核验的展开副本和工具自己生成、已被共享容器取代的临时逐 run 容器。原 gzip、proof、helper、源码快照、语料 manifest 与直接展示图保留。恢复到 `--out` 仅输出 payload，不复制 proof/helper。

工具白名单包括 `trace-current`、`canvas-attribution`、`peak-abba`、`mask-abba`、`rle-abba`，以及后续 `rle-twohit-abba` 和 `upload-abba` 的四个指定 arm。不存在的目标跳过，未完成的 run 拒绝归档。不得为了存储整理触碰正在写入或分析的 run。

| 唯一容器 | 存储字节 | 原内容 |
| --- | ---: | --- |
| [原 trace gzip](../trace-current/trace.json.gz) | 6,857,150 | 86,393,736 B 完整原 JSON |
| [RGBA tar.gz](rgba-canvas-attribution-8ae3bcd5c7abdf1e.tar.gz) | 1,627,214 | 36 个原 `.rgba.bin`，44,285,952 B |
| [encoded PNG blob tar.gz](png-blobs-7aea75122bc4c1a1.tar.gz) | 1,279,339 | 两种完整 encoded PNG，映射 12 run / 72 原路径 |

每个容器完整 SHA 见[验证记录](storage-validation.json)，原路径集合与原 bytes/SHA 见各 run 的 `evidence-archive.json`。保留的直接展示图为 1,011,449 B；不是独立像素基线替代物。

## 后续两个独立归档批次

`current-correctness/{camera,merc}` 共 **111 个原 PNG** 已通过归档、verify 与临时目录全量恢复：camera 62 张、merc 49 张。复用既有两份完整文件集容器，无新容器；清理 88 个展开副本 **82,986,086 B**，保留 8 张代表相机 composite、9 张小 portrait/ordinary/body 图和 6 张代表 gameplay frame，共 23 张直接展示图。[receipt](current-correctness-archive-receipt.json)、[日志](current-correctness-archive.log)及[独立 summary](../../../png-archives/current-correctness-archive-report.json)保存完整范围；每个目录的 `png-archive.json` 映射所有原文件。[独立工具](../../../../../../../scripts/art-card-current-correctness-archive.py)沿用旧 PNG 工具的 byte-exact 逻辑，只限定这两个目标、展示图策略与自己的输出名，未改旧工具或旧 summary。

`rle-budget-{pilot,abba,canonical-abba}` 三组共 **10 个 run / 78 个原 PNG** 同样完成归档、verify 和临时目录全量恢复，清理展开副本 **45,286,370 B**；新增唯一容器 **1,390,483 B**，相同原 encoded payload 复用旧 blob，不同 payload 单独保存。[预算 receipt](budget-archive-receipt.json)和[日志](budget-archive.log)独立于首批 v1 记录。对应[预算工具](../../../../../../../scripts/art-card-latency-budget-evidence-archive.py)只在 v1 的白名单追加这三个 family；首批工具、validation 和 report 字节不变。这三组记录的是联合 two-hit/16 MiB 实验，归档不改变其性能回退或不采纳结论。

两批合计核对 **337 份既有受保护 artifact**，其原 proof/raw/helper/comparison、工具和 v1 envelope/receipt SHA 保持不变；归档不改生产源码，也不把历史源码身份改写成当前版本。新生成的 envelope、归档说明、独立日志/receipt/summary 是存储元数据，不替换原实验输入或结果。此核验证明原 encoded bytes 可恢复，不是新增画面、性能或模拟验收。

## 仓库根目录命令

只读计划不压缩、不读取 payload 进行 hash：

```sh
python3 scripts/art-card-latency-evidence-archive.py --plan
```

恢复完整 trace 和实际 RGBA 到原路径后，原分析脚本无需修改：

```sh
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder trace-current
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder canvas-attribution
node docs/art/refactor/followup/card-streaming/latency-investigation/trace-analysis/analyze.mjs
node scripts/art-card-canvas-attribution-analyze.mjs
```

恢复一个正式 run 的全部原 PNG，或独立恢复到临时目录：

```sh
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder mask-abba/original-A
python3 scripts/art-card-latency-evidence-archive.py --materialize --folder mask-abba/original-A --out /tmp/card-evidence-restore
python3 scripts/art-card-latency-evidence-archive.py --verify --folder mask-abba/original-A
```

恢复最新 camera/merc 的全部原 PNG 后，原比较器无需改路径；也可加 `--out /tmp/new-directory` 独立恢复：

```sh
python3 scripts/art-card-current-correctness-archive.py --materialize --folder card-streaming/latency-investigation/current-correctness/camera
python3 scripts/art-card-current-correctness-archive.py --materialize --folder card-streaming/latency-investigation/current-correctness/merc
python3 scripts/art-card-current-correctness-archive.py --verify
```

重跑三个预算组的旧 analyzer 前，先恢复各 arm 的原路径；这里只运行存储工具，不改或执行 analyzer：

```sh
for arm in original-A candidate-B; do
  python3 scripts/art-card-latency-budget-evidence-archive.py --materialize --folder "rle-budget-pilot/$arm"
done
for family in rle-budget-abba rle-budget-canonical-abba; do
  for arm in original-A candidate-B candidate-B2 original-A2; do
    python3 scripts/art-card-latency-budget-evidence-archive.py --materialize --folder "$family/$arm"
  done
done
python3 scripts/art-card-latency-budget-evidence-archive.py --verify --folder rle-budget-canonical-abba/original-A
```

预算工具的 `--out` 恢复遵循首批 payload-only 约定；current-correctness 工具的 `--out` 要求新目录。所有恢复/hash 操作都应避开正式计时窗口。

获得独占存储窗口并确认所有已存在白名单目标均完成后，归档和清理：

```sh
python3 scripts/art-card-latency-evidence-archive.py --archive
python3 scripts/art-card-latency-evidence-archive.py --verify
python3 scripts/art-card-latency-evidence-archive.py --archive --prune
python3 scripts/art-card-latency-evidence-archive.py --verify
```

执行日志记录逐原文件恢复核验，而容量统计会对共享容器去重；不能把各 run 对同一 blob 的引用重复算成实际存储。

如果后续 run 正在生成或分析，始终用 `--folder` 选择已经冻结的单个目标，避免默认扫描整个白名单。新的 twohit/upload arms 需完成它们的分析并另获存储窗口后再处理；当前验证记录不对这些未来归档作完成声明。
