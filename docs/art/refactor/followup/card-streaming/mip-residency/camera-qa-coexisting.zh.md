# 旧候选多档共驻：相机、DPR 和窗口尺寸验证

此报告归档旧多档共驻候选的正确性通过与内存回退；该候选不作为最终实现的验收证据，最终 one-source 候选必须重新运行相同 fixture。

本轮比较完整原 mip 链基线 `2a0d3a27608c9e56ca8de6949759c975ee06c1d9` 与动态尾链候选 `62b2b1b310615776e399e75d508808e4367a846a`。候选在实际主相机与 2048px 阴影相机均允许时才保留原链的尾部；原 source RGBA、绘制密度策略、几何域和 picking 的 source alpha mask 继续保留。

## 结果

31 个相机步骤全部通过：

- 31 对原生 actors PNG、31 对地面 + actors + HUD composite PNG，解码后的每个 RGBA 通道完全相同；没有容差，也没有缩图。
- 未经 Canvas 预乘/反预乘往返的原始 WebGL `readPixels` RGBA SHA 全部相同。哈希包含透明区 RGB 和 alpha，原生 actors 中也包括实际绘制的阴影 alpha。
- production picking、snapshot 前后 SHA、固定时钟、实际 CDP DPR 全部相同；每步 GL error 为 0。
- 相机离开后返回的第一帧相同；high → low → high 后回到 high 的第一帧及下一次绘制都相同。捕获前仅执行一次生产 draw，没有用第二次 warmup draw 隐藏低清过渡。
- 两侧资源释放、dispose 后 GC、全局 teardown 后 GC 均完成。

原始报告为 [camera-before/proof.json](camera-before/proof.json)、[camera-after-coexisting/proof.json](camera-after-coexisting/proof.json)，严格比较为 [camera-comparison-coexisting.json](camera-comparison-coexisting.json)。这是一轮正确性验证，不能作为硬件 FPS 或渲染时间测试。

## 覆盖与方法

同一 100 单位、20 种 mixed 场景包含人类、骑兵、魔像、食人魔、鱼人祭司、鹿、木巨兽、巨鳌、蛛后、红龙及全部四种攻城器械。两队保留原配色。先按相同事实绘制 tick 144–163，之后固定 snapshot tick 163 和 `now = 8183.333333333333`。此后只改变相机和窗口，不再推进模拟或表现时钟。固定场景保留 idle、walk、attack、cast 和兼容单位的预备持械历史，并添加确定性的非机械目标 hit facts。

测试中每步始终观察到 9 个 airborne droplets、5 个 ground marks、2 个 body marks。当前排列未产生武器转移血迹；不能将这轮覆盖描述成武器沾血证明。真实战斗及武器接触另有相应测试。本场景是表现 facts probe，攻击目标距离和 hp 元数据不表示执行了真实战斗。

24 个组合为 zoom 0.35 / 0.65 / 0.75 / 1 / 1.5 / 2 × DPR 1 / 2 × 1280×720 / 640×360。DPR 通过 CDP `Emulation.setDeviceMetricsOverride` 调整，并校验实际 `devicePixelRatio`。1280×720 的 DPR 2 原生图为 2560×1440；640×360 的 DPR 2 原生图为 1280×720。actors、ground 和 overlay 的 backing dimensions 必须全部相同，composite 逐原生物理像素组合。

scene population 始终为 100。高 zoom 或小窗口自然只显示子集；两侧的查询、posed 数和每个像素都保持相同。没有为了维持所谓“100 可见”而压缩单位位置或改变模型缩放。production 原有 zoom < 0.65 的 density 2 规则继续生效，其余为 density 4；本候选没有降低这项画质设置。

相机 QA 脚本与实际输入 fixture 分别另存于两侧的 `camera-harness.mjs`、`camera-fixture.js`。报告保留 git commit、全部 client 文件 SHA、client dirty-diff SHA、harness/fixture SHA、原 PNG SHA、精确 PNG RGBA SHA、原始 WebGL RGBA SHA、每步 facts/clock，以及生产 renderer/card counters。

## 资源计数的实际限制

这轮动态 mip 在多个相机之间移动，出现了驻留内存回退；不能只报告某个固定视图的收益。以下为每步 draw 完成后的程序持有纹理字节，MiB = 2²⁰ 字节，包含当前仍驻留的其他姿势/旧尾链和 scratch；不是驱动 VRAM 或进程内存。

| 相机步骤 | posed | 候选 N0 / N1 请求 | 原链 owned GPU MiB | 候选 owned GPU MiB |
| --- | ---: | ---: | ---: | ---: |
| DPR 1、1280×720、zoom 0.35 | 100 | 95 / 5 | 52.545 | 56.398 |
| DPR 1、1280×720、zoom 0.65 | 100 | 80 / 20 | 200.852 | 213.232 |
| DPR 1、1280×720、zoom 0.75 | 100 | 90 / 10 | 200.852 | 213.232 |
| DPR 1、1280×720、zoom 1 | 100 | 100 / 0 | 200.852 | 196.852 |
| DPR 1、640×360、zoom 0.75 | 80 | 80 / 0 | 200.852 | 200.852 |
| DPR 2、1280×720、zoom 0.75 | 100 | 100 / 0 | 200.852 | 200.852 |
| 最后的 battlefield 返回序列起点 | 100 | 90 / 10 | 210.185 | 225.602 |

N0/N1 是请求的原 mip 起始级，不是显存节约比例。小窗口较精细的 shadow footprint 以及高 DPR 的主视图都可能要求 N0；保留这些原级数有明确的画面依据。

整条 31 步序列 draw 完成后 owned GPU 最大值为 211.519 → 225.602 MiB，tracked transient peak 为 264.064 → 261.542 MiB；owned CPU 最大值为 55.725 → 57.033 MiB，tracked transient peak 为 59.300 → 59.446 MiB。最大 maskBytes 为 4,557,312 → 5,170,304 字节。终点累计 GPU 卡片 transfers 为 1,536 → 1,592，mip copies 为 14,964 → 15,405。

source-RGBA CPU cache 的终点 entries 461、misses 728、evictions 267、owned 48.486 MiB 在两侧一致；cache hits 808 → 864。额外 GPU transfers 使用相同的可恢复 source，也伴随多个 mip 表示的驻留开销。本报告没有将卡片转移计数误当成新增绘图次数或进程内存。

这份 QA 证明候选在本次软件 GPU、这些视图和 first-frame transition 上没有视觉、alpha、picking 或事实回退；它同时保留不利的资源证据。内存策略是否值得保留，必须结合独立的同场景性能实测和迁移开销决定。

## 代表性画面

[原链全景，DPR 1 / zoom 0.75](camera-before/dpr-1-1280x720-zoom-0p75-composite.png) 与 [候选全景](camera-after-coexisting/dpr-1-1280x720-zoom-0p75-composite.png) 已逐像素证明相同。实际视觉审查确认大型生物、尾部、鹿角、攻城器械、原有配色及地面/身体血迹在正确的全景中显示，阴影形态保留。DPR 2 原生图及所有近景的零差异由严格 RGBA 比较覆盖；本报告没有用低分辨率拼图替代原图。

## 复现

```sh
node --experimental-strip-types scripts/art-card-mip-camera-proof.mjs \
  --source /tmp/sketch-mip-residency-baseline \
  --out docs/art/refactor/followup/card-streaming/mip-residency/camera-before/proof.json

node --experimental-strip-types scripts/art-card-mip-camera-proof.mjs \
  --source /tmp/sketch-mip-coexisting \
  --out docs/art/refactor/followup/card-streaming/mip-residency/camera-after-coexisting/proof.json

node --experimental-strip-types scripts/art-card-mip-camera-proof.mjs \
  --compare docs/art/refactor/followup/card-streaming/mip-residency/camera-before/proof.json \
  --with docs/art/refactor/followup/card-streaming/mip-residency/camera-after-coexisting/proof.json \
  --out docs/art/refactor/followup/card-streaming/mip-residency/camera-comparison-coexisting.json
```

旧候选 source 应另建于 `62b2b1b` 的 detached worktree，例如 `/tmp/sketch-mip-coexisting`，不能用后续已修复的工作分支覆盖此归档。顺序执行，source 必须固定于上述 commit。该 runner 只进行正确性 capture；测量工具须在其他浏览器、Canvas、构建及测试停止后另行运行。
