# 稳定绘序的同源 bank / mip 对照方法

最终冻结生产源为 **`0de509cc01e47b91a3012d33d2e75a7106d3e4a5`**，默认 **single-bank、原隐式纹理采样**。最终参考与候选都使用这一源树、单银行默认和按剩余唯一需求分配的新页策略，只改变 mip residency：**1-bank full → 1-bank native**。已完成的时序、容量及不利指标见[最终性能报告](final/performance.md)；实际命令由[当前正式运行脚本](../../../../../../scripts/art-card-bank-final-performance.sh)固定。

较早 `e02b24e` 的 **1-bank full → 8-bank native** 是同时改变 bank 与 mip 的联合实验。相机与战斗正确性通过，但完成时间严重回退，8-bank 默认被拒绝，2/4-bank 诊断也未恢复。历史方法保留在下文，不能标成当前配置或拆称单一组件的性能收益。

两阶段均以 corrected stable ordering 为 oracle，不将旧版依赖 cache lifetime 的遮挡当成正确性要求。旧 `55d6b3b` 的 mixed 三像素、战斗 frame 8 回退及失败的 min-page ablation 原样保留；稳定绘序修复会有意改变旧 cache-dependent overlap，不能声称与旧 80 帧全部零差异。

## 参数与初始化

采集与比较工具：

- `scripts/art-card-bank-camera-proof.mjs`：原生物理尺寸 actors、composite、raw WebGL RGBA、picking、固定 facts/clock 的 31 步相机 proof；fixture 覆盖二十类代表资产。
- `scripts/art-card-bank-viewport-proof.mjs --scene canonical|mixed`：相同 canonical / mixed fact program，保留原 warmup、CPU / real 分支及相机返回时刻；mixed 为二十类资产共 100 visible。
- `scripts/art-card-bank-battle-proof.mjs`：独立 guard/blood 场景的原始命令与 160 真实 ticks、80 帧及相机 probe；此场景不是二十类资产覆盖。
- `scripts/art-card-bank-compare.mjs --kind viewport|battle`：同 source 配置比较，校验 helper/harness/fact program、实际 PNG SHA 和严格 RGBA、snapshot facts。

三个采集 runner 支持 `--source ROOT --max-banks 1..8 --mips native|full --variant NAME --out JSON`。camera 比较使用该 runner 自身的 `--compare BEFORE --with AFTER --out JSON`；compare 工具使用独立的 before/after 比较参数。采集 runner 仍默认 8 bank，当前复现必须两侧都显式传 **`--max-banks 1`**。多银行仅用于同一有序系统的显式可选能力验证，不改变最终生产默认。

`art-card-bank-variant.js` 在 `World3DLayer.create` 返回后、prepare / first draw 前，直接设置 `layer.cards.maxTextureBanks` 和 remains 的 cached 字段；只改 `policy.maxTextureBanks` 无效，因此不使用该方式。setup 校验 pages/chunks 仍为空，并记录实际 cached 字段。

full reference 仅覆盖该 layer 的 `residentMip` 返回 0，保留 telemetry 的 N0 请求计数，同时跳过 gate 的 SVD 成本，是有利于参考的控制。两侧保留同一 paint、full source RGBA、原 geometry、mask、原密度策略和 2048px 阴影。配置没有进入任何 GPU-private API，也不添加 per-frame pose/key 遍历、排序或观察器；setup 和 provenance 读取均在测量外。

metadata 显式记录 `variant`、bank 数、mip 模式、reference override、helper SHA、entry / underlying fact fixture SHA、client 文件 SHA 和 source commit。before/after 必须使用相同冻结 source；不能把先前 main/AI tree 当成本阶段 before。新 main 同步只要最终两侧 source 相同、模拟输入事实相同，不会被误报成旧 AI tree 不同。

## e02 历史组件隔离方法

以下是被拒绝的多银行实验方法，`SOURCE` 必须对应历史 `e02b24e`，不能使用当前 0de 后把结果称为该历史运行。固定同一 source、harness 和 fact fixture，先比较 1-bank native 与 8-bank native，检测 bank batching 本身的颜色、alpha、shadow、picking 和绘序。历史命令示例如下；重跑时改用新的输出目录，不覆盖证据：

```sh
node --experimental-strip-types scripts/art-card-bank-camera-proof.mjs \
  --source "$SOURCE" --max-banks 1 --mips native \
  --variant ordered-bank-one-native-oracle \
  --out docs/art/refactor/followup/card-streaming/bank-order/camera-one-native/proof.json

node --experimental-strip-types scripts/art-card-bank-camera-proof.mjs \
  --source "$SOURCE" --max-banks 8 --mips native \
  --variant ordered-bank-eight-native \
  --out docs/art/refactor/followup/card-streaming/bank-order/camera-eight-native/proof.json

node --experimental-strip-types scripts/art-card-bank-camera-proof.mjs \
  --compare docs/art/refactor/followup/card-streaming/bank-order/camera-one-native/proof.json \
  --with docs/art/refactor/followup/card-streaming/bank-order/camera-eight-native/proof.json \
  --out docs/art/refactor/followup/card-streaming/bank-order/camera-bank-comparison.json
```

然后可用同 source 的 8-bank full 对照 8-bank native，单独检查 residency 的画质；或明确标注同时改变 bank + mip 的联合配置，不能把联合收益拆称为单一组件收益。

## e02 历史联合时序方案（已拒绝）

历史正式窗口使用 **1 bank + full chain** 参考与 **8 banks + native gate** 候选，两侧同一冻结 `e02b24e`、同一事实。该配置已因性能回退被拒绝，不是当前复现方法。历史 canonical 命令：

```sh
node --experimental-strip-types scripts/art-card-bank-viewport-proof.mjs \
  --source "$SOURCE" --scene canonical --max-banks 1 --mips full \
  --variant ordered-one-bank-full-reference \
  --out docs/art/refactor/followup/card-streaming/bank-order/canonical-reference/raw.json \
  --hidden 0,9900 --repeats 2 --cpu-frames 360 --real-frames 18 --paced --skip-simulation

node --experimental-strip-types scripts/art-card-bank-viewport-proof.mjs \
  --source "$SOURCE" --scene canonical --max-banks 8 --mips native \
  --variant ordered-eight-bank-native-candidate \
  --out docs/art/refactor/followup/card-streaming/bank-order/canonical-candidate/raw.json \
  --hidden 0,9900 --repeats 2 --cpu-frames 360 --real-frames 18 --paced --skip-simulation
```

mixed 使用 `--scene mixed --hidden 0 --repeats 2 --cpu-frames 60 --real-frames 12`；battle 使用 `art-card-bank-battle-proof.mjs`，保留原 80 帧，不用减少 ticks/frames 冒充相同场景。比较：

```sh
node --experimental-strip-types scripts/art-card-bank-compare.mjs \
  --kind viewport --before BEFORE_RAW --after AFTER_RAW --out COMPARISON_JSON

node --experimental-strip-types scripts/art-card-bank-compare.mjs \
  --kind battle --before BEFORE_PROOF --after AFTER_PROOF --out COMPARISON_JSON
```

正反配置之间 harness / entry fixture / fact program / helper SHA 均须一致。正式 GPU 时序与浏览器 proof 不并发；所有 shadow、ground、overlay、geometry、simulation facts 均保留。软件 GPU fence 完成时间仍不是硬件 FPS。原 Phase A 相对于旧实现的成本记录作为历史证据保留，不混称为本轮联合配置差值。

实际冻结源 `e02b24e` 的联合配置已完成[历史 31 步相机](camera-qa.zh.md)与[历史 80 帧真实战斗](battle-qa.zh.md)严格对照，图像、picking / alpha（相机）和模拟事实均通过，但正式时序失败。全部原样本和不利指标见[e02 性能报告](e02-performance.md)，采样路径归因见[单银行梯度诊断](grad-diagnostic/README.md)。正确性通过和少 draw calls 都不能替代速度测量；不把联合差值拆称组件独立贡献。

## 最终 0de：单银行 full / native 正式方法

准备冻结 `0de509c` checkout 及依赖，只在协调者分配的独占性能窗口运行。使用新的输出目录，脚本拒绝覆盖已有 raw：

```sh
bash scripts/art-card-bank-final-performance.sh \
  /path/to/frozen-0de-source /tmp/reproduced-card-bank-final
```

当前脚本串行运行 canonical 与 mixed 的 reference/candidate，全部 **`--max-banks 1`**；reference 为 `--mips full`，candidate 为 `--mips native`。Canonical 保留 `--hidden 0,9900 --repeats 2 --cpu-frames 360 --real-frames 18`，mixed 保留 `--hidden 0 --repeats 2 --cpu-frames 60 --real-frames 12`，均使用 `--paced --skip-simulation`。模拟与 snapshot 构造在 presentation 计时外，没有改变规则或删去这些工作。浏览器全部退出后才执行 comparison 与 `--profile final` 汇总。最终两侧小页策略相同，差值不能单独归因于页容量策略；旧 e02 与当前 0de 的绝对容量观察也不是同源净性能比值。

31 步相机及 guard/blood 的 160 ticks / 80 帧是独立正确性运行：使用同一 `SOURCE`，两侧同样分别为 **1-full / 1-native**，保留完整原 sample grid，DPR 2 使用真实 CDP 设置。采集入口使用 `node --import tsx scripts/art-card-bank-camera-proof.mjs` 或 `art-card-bank-battle-proof.mjs`；两侧显式传 `--source "$SOURCE" --max-banks 1 --mips full|native --variant NAME --out NEW_PATH`，camera 用自身 compare 参数，battle 用 compare 工具的 `--kind battle`。

当前[最终 QA](final/qa.zh.md)、[camera comparison](final/camera-comparison.json)、[battle comparison](final/battle-comparison.json)均通过。相机二十类与 guard/blood 两种场景均不包含三个新雇佣单位，其[实际玩法证明](../../mercenary-models/gameplay-final/comparison.json)单列。正确性捕获、编码及 probe fence walltime 不混入正式性能样本。[最终性能报告](final/performance.md)与[汇总](final/performance-summary.json)记录当前配置的容量收益及 CPU/wall/尾部回退，不宣称全面加速。

## 原始 PNG 与证据边界

完整原始 PNG 以 **byte-exact tar.gz** 保留，选定 PNG 仍可直接查看。归档未解码、缩放或重新编码，原 PNG 字节 SHA 与通过/失败结果不变；proof/source 文件保持原样。运行旧 PNG-based comparison 前，按[归档与恢复说明](../../png-archives/README.md) materialize 对应原目录。只保留选图供直接查看不等于只验证了 keyframes，MP4 仅为观看副本。

正式 GPU 时序与其他 browser、Canvas、tests、build 或编码不并发。CPU presentation 包含 Canvas、上传和 driver backpressure，禁 `renderer.render` 不等于纯 JavaScript；SwiftShader fence 完成 wall 包含等待与事件循环，不是 GPU timer query 或硬件 FPS。程序 owned card texture 容量不等于 VRAM/RSS，draw typed buffers 单列。当前 canonical 每人口 36 个 real 样本、mixed 24 个，不据此建立普适无卡顿结论。所有旧阶段的失败、资源回退和源树边界继续保留，不混称为当前差值。
