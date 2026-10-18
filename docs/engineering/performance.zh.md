# 性能怎么测、怎么报

所有车道的性能 PR 都按这份说明测量和汇报。

## 门槛：每帧 CPU 时间

渲染性能的结论只看**每帧 CPU 时间**：一帧里页面渲染进程主线程（CrRendererMain）和 GPU 进程主线程（CrGpuMain）各自花掉的线程 CPU 时间（trace 里每个任务的 `tdur`），两者相加。

- 汇报中位数、p95 和最坏一帧，每一项都拆成"渲染进程 / GPU 进程"两部分。
- 改动前后要用同一局、同一段操作测，并写明提交号、地图、单位数、分辨率和 devicePixelRatio。
- fps 和帧间隔（rAF 间隔、long-animation-frame）只作参考，**不能**作为结论。

模拟和 AI 的 CPU 门槛另有规定，见 `src/shared/sim.test.ts` 的 `@@@match-cpu-budget`。

## 为什么不用 fps

2026-10-18 在 mac1 上的对照实验（1600×900，dpr 2，Metal）：

| 页面 | Playwright 无头（headless shell） | 有界面的 Chrome |
|---|---|---|
| 空白页面 | 10.4 fps | 44 fps |
| 三层全屏画布，每帧重画 | 8.5 fps | 60 fps |

无头浏览器连空白页面也只有约 10 fps，所以无头环境下量到的 fps 是测试环境的帧节奏，不是游戏的。在同一局大战里，关掉地面层、关掉 overlay、或把 dpr 降到 1，GPU 进程在 SwapBuffers 里的等待（`IOSurfaceImageBacking::WaitForCommandsToBeScheduled`，每帧约 30 ms）几乎不变，说明这段等待也不是游戏画面造成的。

有界面的浏览器也靠不住：mac1 是多条车道共用的机器（同时有其他浏览器用 SwiftShader 吃掉 700% 以上的 CPU），窗口不可见时 macOS 还可能降低它的优先级。线程 CPU 时间只计算线程真正在跑的时间，受这些干扰小得多。

## 已经量过、不值得再优化的东西

- **2D 地面层。** 2026-10-18，templeSpring 4 方大战，约 220 单位，main 3f41fb0b。把整个地面层关掉（不画、也不参与合成），每帧 CPU 只少 1–3 ms：中位数从 34.5 / 33.6 ms 降到 32.8 / 32.5 ms，p95 从 46.0 / 45.4 ms 降到 42.7 / 43.4 ms。把静态地形搬进 WebGL，最多也只能省这么多，所以这项工作已经撤掉。
- **overlay 每帧清两次。** 改成清一次以后（#488），清屏面积减半，但每帧 CPU 的变化在噪声以内。

想优化某一层之前，先做上限实验：把这一层整个关掉，按上面的门槛量一次。省下的量就是这项优化最多能带来的收益。

## 怎么测

1. 用真实 GPU 开浏览器：`--use-angle=metal --enable-gpu`（Mac）。无头或有界面都可以，CPU 时间不受帧节奏影响。不要用 SwiftShader，软件画布会把 GPU 的工作算到 CPU 上。
2. 进入要测的对局，到达要测的场面后录 trace，录 6–10 秒。录制方式二选一：
   - Chrome DevTools 的 Performance 面板录制，然后"Save profile"保存成 JSON；
   - 用 CDP 录：`Tracing.start`，categories 至少包含 `devtools.timeline`、`toplevel`、`cc`、`gpu`、`viz`，`transferMode: "ReportEvents"`，把 `Tracing.dataCollected` 收到的事件存成 `{ "traceEvents": [...] }`。
3. 运行 `node scripts/frame-cpu.mjs TRACE.json`，它输出帧数，以及中位数、p95、最坏一帧各自的 `cpuMs`（总计）、`rendererMs`、`gpuProcessMs`。`intervalMs` 只作参考。

## 汇报格式

PR 正文的 Measured 一节写成：

```
场面：templeSpring，4 方，约 220 单位，1600×900 @2，提交 abc1234 对 def5678
每帧 CPU（渲染 + GPU 进程，ms）  中位数        p95           最坏
  main                          36.8 (12.1+24.7)  58.9 (19.9+39.0)  107.8 (58.1+49.7)
  分支                          …
fps / 帧间隔（仅参考）            …
```

如果改动只影响某一个进程（比如只减少了 2D 画布的光栅化），要指出是哪一部分变了。
