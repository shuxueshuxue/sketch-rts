# Animation observation storage equivalence

本次仅改变 `UnitAnimationTracker.update()` 的观察记录存储：两套 Map 交替使用，每个稳定存活的 ID 复用两套 Track，并复用各自的 ability cooldown、deck、mining 小缓冲。真实 Action、direction、carry 及已创建的姿势缓存继续保留原引用。`frame()` 和 `observeDirections()` 的输出规则不变。

基线为阶段 1 的 `5eb401d9bbb6db43d4a1bc3b1029b82ed2cd397b`，它已经包含屏外 direction observer；不是主线 `b50cc87` 的整个渲染基线。阶段 1 没有改变动画帧的选择逻辑。此处只验证阶段 1 到本次记录复用的等价性，完整画面与渲染性能仍以父目录的场景对照为准。

可从仓库根目录复现：

```sh
node --import tsx docs/art/refactor/followup/viewport-performance/animation-equivalence/compare.mjs \
  --baseline 5eb401d \
  --current src/client/unit-animation.ts \
  --output docs/art/refactor/followup/viewport-performance/animation-equivalence/result.json
```

脚本从 Git 提取指定基线文件到临时目录，以当前相同的 catalog/art 依赖加载两个 tracker；退出后删除临时副本。它是独立证据脚本，CI 测试不依赖历史 Git 对象或临时源副本。

300 步固定轨迹覆盖当前全部 **55 个 kind，包含船只**。每步检查 0/17/50/10000ms 的帧与方向观察，包含走动和换向、可变输入 cooldown/deck 对象、施法优先、攻击方向与高差、同 tick 追加释放和 Stage cue、工作/采矿/晕眩/推挤/死亡、单位移除重入、长间隔/回退和 reduced motion。每个公开帧和 observer 的访问数、ID/方向序列均做严格值比较。

结果：**71,448 次公开输出比较全部相等**。轨迹 SHA-256 为 `9c5a598af687bcad7cb451754dc3eb8952855a356250129cd9f2ef09f41196e1`；基线和当前源文件 SHA-256 记录在 [result.json](result.json)。

新增固定事实回归验证：跨快照姿势缓存 identity 不变；可变输入不污染上一快照观察；下船/回退会清除旧可选记录；稳定船员/矿工仅使用两份 Track、abilities、deck 和 mining 观察缓冲。验证命令：

```sh
npx vitest run src/client/unit-animation.test.ts src/client/unit-facing.test.ts
npx tsc --noEmit
```

本次记录为 42 项 animation、20 项 facing 测试全部通过，类型检查通过。该证据不包含绘制、GPU 时间或物理内存测量，也不据此宣称整帧性能提升。
