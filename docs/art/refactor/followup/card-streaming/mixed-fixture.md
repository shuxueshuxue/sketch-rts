# 混合单位的卡片流式资源场景

此补充场景用于检查卡片身份、缓存和上传改动是否覆盖大型生物、魔像及攻城器械。它与原四类人形单位的 viewport 场景并行保留。生产入口仍为 `WorldPresentation`，包括真实 WebGL actor、地面 Canvas 和 HUD Canvas 三个绘制通道。它是确定性的表现工作负载，不是模拟战斗；命中与模拟一致性的证据来自另一个真实战斗脚本。

## 场景与画质

脚本为 `scripts/art-viewport-streaming-fixture.js`。它使用 100 个可见单位，每种 5 个实例，共 20 种：

- 步兵、长枪兵、牧师、骑士；
- 魔像、碎石魔像、花岗岩魔像；
- 食人魔战士、食人魔法师、食人魔领主；
- 深渊巨鳌、蛛后、红龙、古鹿、石背巨兽、潮汐祭司；
- 铁甲冲车、床弩、重型投石机、连弩炮车。

五组实例分别提供 idle、walk、attack、适合施法的单位 cast（其余继续 attack）、攻击后的 idle/walk 预备持械历史。末组的非持械生物按生产动画自然回到 idle/walk；不会为制造覆盖而强行让魔像或攻城器械持械。队伍随实例组交替，因此每种单位都覆盖两队。

视口为 1280×720，DPR 1，zoom 0.75。此 zoom 在原生产代码中使用 density 4；保留完整 authored tile、完整 mip 链、原配色、原阴影和过滤设置。单位的半径、体型缩放、绘制细节及动作均来自当前选定 source worktree。移动和释放事件由固定 fact 时钟生成，构造 snapshot 的时间不计入表现计时。攻击和施法指向另一可见单位的位置，距离并不表示真实攻击范围；没有任何模拟规则被 fixture 改写。

所有生产模块都通过 `__BENCHMARK_SOURCE_ROOT__` 从 `--source` 指定的 worktree 加载。基线和候选使用同一份 fixture，不能分别运行各自版本的 fixture。

## 可复现命令

在 harness worktree 中执行。基线和候选串行运行，期间停止其他 GPU、Canvas、测试及构建负载：

```sh
node --experimental-strip-types scripts/art-viewport-benchmark.mjs \
  --source /tmp/sketch-card-streaming-baseline \
  --fixture art-viewport-streaming-fixture.js \
  --out work/card-streaming/mixed-before/result.json \
  --hidden 0 --repeats 2 --cpu-frames 60 --real-frames 12 \
  --paced --skip-simulation

node --experimental-strip-types scripts/art-viewport-benchmark.mjs \
  --source /workspace/sketch-rts-viewport \
  --fixture art-viewport-streaming-fixture.js \
  --out work/card-streaming/mixed-after/result.json \
  --hidden 0 --repeats 2 --cpu-frames 60 --real-frames 12 \
  --paced --skip-simulation
```

每个独立 lifetime 先进行 18 次真实绘制与 GPU 完成等待，然后进行 60 帧 CPU warmup 和 60 帧 CPU 样本，最后进行 12 次真实三通道绘制与 GPU 完成等待。CPU 样本仅将 `renderer.render` 临时替换为空函数，其余卡片准备、Canvas 和协调工作继续执行。每三帧收到一份新 snapshot；等待 `requestAnimationFrame` 位于计时外。

软件 GPU 完成等待包含 fence 轮询和事件循环调度，不等同于 GPU timer query 或硬件帧率。仅 24 个真实帧、120 个 CPU 帧的合并样本适合检查明显回退及大致成本，不能据此宣称稳定的 p99 或硬件 FPS。

## 应检查的证据

每个 result 保留 source commit、client 文件 SHA、fixture SHA 和原始时间数组。`before`、`empty`、`returned` 记录卡片驻留、rasterizations、上传字节、完整 mip GPU copy 次数、程序持有的 CPU/GPU 字节、renderer draw calls 及 `viewStats`。字节计数描述程序持有的纹理分配，不是驱动实际 VRAM 读数。CPU 和真实完成成本均与模拟分开；本场景不运行 `simulation()`。

`assetCoverage` 在计时外读取实际最终状态、左右朝向、carry 的单位种类、可见种类实例数，以及当前 renderer resident key 列表。它没有把终帧状态当作整个测试期间的动作覆盖证明。原 key 和候选 key 的数量可以不同；视觉与 fact 必须保持一致。

相机在相同 snapshot/时钟下离开战场，再回到原视口；三个合成 PNG 分别为 battlefield、empty、returned。逐像素比较必须解码 RGBA，不能仅以 PNG 文件 SHA 判断。`pixelProofSha256` 同时覆盖可见单位和释放事件，验证 before/after 输入事实相同。GL error 必须为 0，每个 lifetime 必须 dispose，harness 在 dispose 后以及全局资源 teardown 后分别执行 GC 并记录 heap。

原通用 harness 顶层 `method` 和保存的 `fixture.js` 仍描述 canonical 场景。混合场景应以 `entryFixtureName`、`entryFixtureSha256`、各 cycle 的 `scope` 和 `assetCoverage` 为准；归档另存实际 `art-viewport-streaming-fixture.js`，不要误把 canonical fixture 当作本次输入。测量结果和视觉审查结论应写入主实测报告，不能由本方法说明推断性能提升。
