# Stage15：海路距离前沿的原始验证与保留决定

候选 `bccc987c8aac31889c2cf1b70bfbbe50f941a24a` 保持 **HELD_PENDING_FOCUSED_TAIL_ATTRIBUTION_NOT_ADOPTED**。整局目标 **FAILED**，尚未采用、没有产品 PR、合并或部署。本归档涵盖两轮原始 ABBA + plain、24 个独立冷启动样本及其对应验证、诊断输入、失败记录、源码和空间操作收据。随后新增的 focused profile/counter 属于后续阶段，未纳入本库存。

8 个性能臂的 whole mean 为 A `3.59128501038` → B `3.56568143205` ms（−0.7129364%），两块分别 +0.2071801% / −1.6165427%，四对分别 −1.1819873 / +1.6768934 / −2.2711124 / −0.9659023%。p99 为 26.478099 → 26.253179 ms，max 为 94.295550 → 261.854956 ms；>50 ms 为 19 → 29，其中 planning 12 → 19、nonplanning 7 → 10。B tick11970 whole 261.854956 ms、AI258.847063 ms、enemy2 planner244.251591 ms；B tick6893 whole78.113881 ms、sim78.085529 ms。Bplain 单列，所有冷点、慢点和原始内存记录保留；这些观察未归因到 GC、JIT 或操作系统。

24 个冷样本按原顺序组成6个ABBA块，A/B各12。inclusive mean385.46891025 →386.768463167 ms，median374.885974 →386.934059 ms；firstTick mean90.98987375 →88.26293775 ms，但 median83.372934 →86.839734 ms。firstTick仅3/6块改善、inclusive仅2/6。每臂12样本的p95/p99等于max，操作系统页缓存未受控，不能作为SLA结论。

正确性原证据包括57个唯一测试文件、704tests（700pass与4个在原基线上同名同received重现的失败）、10个实际模块证明组849queries、产品SDK7、tsc和Vite。原V8表示断言失败、严格输入图修正、缺失测试输入与54tests修复过程均保留，不回写断言。PR381联合夹具只提供正确性边界（1392comparisons、13892assertions），PR381仍为draft，未归为本候选原生结果。冻结API证明main仍为4804631c22f7be3f83dc6374e71ce03d86068dd8，与0ea运行时epoch一致。

完整Vite输出83文件/7,542,307B逐字节归档，包括公共资源正文；与旧scope相同内容在Git对象层复用，完整路径映射仍保留。800f与222仅保存其证明和未执行计划，不能读成有原生性能结果。800f/222/bccc的本地提交、树和blob差集以原路径 `portable-local-heads.json.gz` 完整保存在manifest对应Git gzip payload（先按manifest解码一次得到该包），包含bccc原父提交历史；`rehydrate-local-heads.py` 要求先获取0ea，再校验每个原始Git对象OID后写入独立证据ref。

## 存储与复现

这是 schema3 **Git logical** 归档。从首次捕获起，`payloads/*.bin.gz` 只经RAM/stdin写入Git blob并进入索引，工作目录中保持 absent + skip-worktree。metadata/README/脚本实际物化。gzip固定level6、mtime0、空filename；所有原路径以base64保留，包含原权限、全文SHA、显式alias及全文字节比较收据。旧固定提交63e274af2e243fd5aad3c8d1522c0805bda4c010的18,946条mode/blob、全部index flags、18,852个原缺席路径（其中4263个已闭合gzip payload）及94个原物化文件全文/模式均受保护。

运行 `python verify-git.py --repo /path/to/evidence-repo --scope /path/to/evidence-repo/docs/performance/rules3-stage15-sea-distance-frontiers` 可通过Git对象完整读取所有gzip正文、OID、压缩与解压SHA及alias。只有原始绝对路径仍存在时才加 `--originals` 做全文/原权限比较。该命令不执行游戏。Git逻辑完整校验不能替代依赖物化payload的旧校验器或SDK。

旧SDK14最后一次真实完整运行属于Stage13：13/14，唯一失败为原Stage5冻结文档的8196B命名断言，原blob和完整断言未修改。本阶段未恢复旧payload、没有重跑SDK14、没有声称其通过。产品SDK7为本候选原验证中的独立证据。

需要物化本scope时，先保证可用空间至少为manifest全部canonical `storedBytes`按文件系统块上取整之和，加4MiB索引/临时开销及32MiB余量，再用以下方式仅恢复本scope（这会改变工作副本稀疏状态）：

```sh
git -c gc.auto=0 -c maintenance.auto=false sparse-checkout add --no-cone '/docs/performance/rules3-stage15-sea-distance-frontiers/payloads/'
git -c gc.auto=0 -c maintenance.auto=false checkout --ignore-skip-worktree-bits HEAD -- docs/performance/rules3-stage15-sea-distance-frontiers/payloads
```

恢复后可用同一脚本加 `--hydrated` 核对物化gzip全文与Git/blob/SHA及完整scope，再执行依赖物化文件的工具。提取原路径时应写入新的隔离目录，勿覆盖原/tmp证据。旧候选工作源码的可逆稀疏仅作用于工作副本；再次运行其资格/测试须按各收据精确restore原cone模式和patterns。

归档SOURCE准备首次超过1MiB目标：portable捕获将base全637棵树及完整命令stdout保留，实测T为2,192,384B logical /2,248,704B allocated；原输出与异常保留，并计入获准ALLNEW40MiB总额及32MiB保留空间门。原测量t0与新增库存delta分别保存，未用后出的文件改写历史测量。

辅助归档收据 `payloads/archive-receipts.bin.gz` 在完整staging后也保持Git-only；manifest的gitOnlySupportingFiles单列其压缩/解压全文与OID。2160个原路径的canonical payload从首次捕获即未物化，辅助receipt bundle曾是本轮生成工作副本后转为Git-only。该bundle按Git读取解压JSON即可恢复全部选定命令/source收据；两个较大原生成收据由decode-storage-receipts.py逐字节重建并校验原SHA。
