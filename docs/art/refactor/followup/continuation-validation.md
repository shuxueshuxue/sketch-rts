# 灵体与资源消耗：本轮收敛记录

最新生产源为 `77a2c3078b1f14c02f1058dc22fd31a80f9dd314`，仍在独立 `perf/viewport-presentation` 分支和草稿 PR #346；未合并或部署。后续证据提交不改变这份生产源。本轮没有改变 shared、server、SDK、AI、战斗、经济、维护费或回放规则。

## 实际采用的改动

| 范围 | 实现与验证 |
| --- | --- |
| 灵体作者模型 | 深空兜帽、褪色披罩、连续披袖与漂浮纱尾；没有通用肘部约束。世界、头像、全身、剧情及遗骸共用新画笔，旧实现删除。[美术和视频](spirit-redraw/README.md)、[真实游戏](spirit-models/gameplay/README.md)。 |
| 灵体不流血 | 客户端根据真实 hit 的 `targetKind` 排除 spirit，不改变 nonMechanical 战斗分类。身体也不接收邻血。39 项回归与完整残留周期检查通过；[实际受击证明](spirit-no-blood/gameplay/)另存完整来源和模拟事实。 |
| Canvas 目录配置复用 | Atlas 使用已有像素等价身份；内部原装备对象有私有品牌，自定义细节和配置保留各自身份。[两阶段完整源 RGBA 对照](card-streaming/latency-investigation/canvas-route-identity/README.md)及[真实装备覆盖](card-streaming/latency-investigation/canvas-route-identity/stage2/README.md)。读取次数降低不换算 FPS。 |
| 障碍受击索引 | 障碍复用已有 first-hit 索引，避免每个屏外障碍再次扫描 effects。一行改动、26 项既有测试、六组实际 Canvas 全 RGBA 相等。[局部 renderer 证据](obstacle-hit-index/README.md)。 |
| 本地小地图标记 | 仅缓存实际本地适配器发布的稳定视图；同 tick 新发布重新构造。公共房间和未知可变来源保持实时构造。每帧仍完整绘制小地图，relations、物品、舱内乘员、风和相机保持实时。[边界、测试、CPU 与 Chromium 证据](minimap-cache/README.md)。 |

灵体真实游戏的原版/新版各包含 80 WebGL 帧、17 Canvas 帧及六张 UI 图，覆盖六次召唤、左右 × 上 60°/水平/下 60°、攻击帧和变体、24 次实际拾取及六次原损伤管线死亡。完整模拟事实相同，四张非灵体 UI 原 RGBA 相同；世界差异限定在灵体、真实阴影、对应 UI 和遗骸范围。保留首版遗漏阴影边缘的失败，不声称重叠包络中的每个邻兵像素都独立相同。

不流血的后续真实对照使用相同新造型：原敌兵六次 16 点攻击使灵体自然死亡，伤害、85 点初始生命和死亡 tick 112 均不变。候选 303 ticks（含死亡后 190 ticks）及插值、独立 Canvas 和 GPU 墨迹都为零；旧版本 max air/ground/body 为 6/18/2，成功复现漏洞。685 份完整模拟快照与 22 项检查通过；104 对原 PNG 中，只有原灵体血迹所在的 50 对发生预期变化，其余 54 对完整 RGBA 相同。普通兵、野怪、机械及真实邻血转移控制均通过。[实际视频与完整证明](spirit-no-blood/gameplay/README.md)。

## 有用的局部资源结果

| 固定输入与成本域 | 改前 | 改后 | 解释 |
| --- | ---: | ---: | --- |
| 1000 屏外障碍 + 1000 特效，实际 Napi Canvas drawWorld；40 样本/方案均值 | 9.969 ms | 0.650 ms | 该压力 fixture 的局部 CPU 成本，非浏览器/GPU/FPS。每帧约百万 predicate 访问降为零次 find。 |
| 2k 单位，120 次小地图派生读取 | 85.83 ms | 28.95 ms | 12 轮均衡次序微测；40 次实际发布，保持所有标记。 |
| 10k 单位，相同发布与读取协议 | 605.24 ms | 207.36 ms | 构造次数 120→40，mark/sourceIds 构造数 1,264,080→421,360；不是 heap bytes 或游戏帧时间。 |

小地图 Chromium 证据动态运行真实本地 runtime/adapter 与生产 main 的标记读取、断开/启动生命周期；16 张同输入 Canvas 图的 3,379,200 RGBA 字节无差异。这不是完整页面交互或世界绘制 E2E。模型图片、实际游戏视频与局部 CPU 测量不是同一性能实验。

## 未采用的上传与存储候选

全部候选冻结在原 `8345` 美术与运行源，并保存原生 GPU、输入、运行图、Three 身份、优化依赖首尾 SHA、像素与全部计时证据。不能把这些数据叠加成最新整体游戏提速。

| 独立候选 | 实测 | 决定 |
| --- | --- | --- |
| 半级 mip 余量 | 完整 v2 ABBA：owned GPU 191.72→125.40 MB；CPU mean 40.13→41.48 ms；complete real mean 426.49→426.08 ms。 | 跨硬件采样安全未证明，CPU 变差、整体帧基本不变；不改生产默认。 |
| 较短 CPU row-band view | 原生逐层像素通过；单 AB/一生命周期 complete real mean 417.36→431.93 ms。 | 无收益信号，不采用；不是完整 ABBA 结论。 |
| 仅 512² 临时纹理双槽 | 每方案 10,684 原生 mip/layer 比较零差异；单 AB complete real mean 409.80→422.58 ms；额外 CPU 1 MiB/GPU 1.33 MiB，上传字节 +0.71%。 | CPU mean 虽降低 4.33%，真实整帧变慢且多占内存；不采用。 |

[追踪与完整实验索引](card-streaming/stall-followup/README.md)保留负结果。最新诊断定位到 `texSubImage2D` 内 255/275 ms 命令缓冲等待；没有证明是哪条早前 GPU 命令造成等待，也未解释旧 696.9 ms 停顿。**该长尾仍未解决**，没有硬件 GPU 对照或通用 FPS 提升声明。

## 最终检查与剩余边界

最新客户端/剧情测试 **132 文件 / 1066 tests 全通过**：[日志](spirit-no-blood/final-client-tests.log)。`build:production` 包含全局 TypeScript、Vite 和 server bundle，exit 0：[日志](spirit-no-blood/final-production-build.log)。源码冻结后完成真实灵体和小地图证明，原始失败及来源不改写。

较早的 d7 全仓测试为 609 文件、6466 通过/5 失败：[完整日志](spirit-redraw/validation/full-tests.log)。四个船舶导航失败在冻结 8345 上完全复现，shared/SDK 树及工作区无变化；另一个文档命名门已在基线失败，但本轮证据新增匹配项（该次 22→34），不能把整个失败称为未变。[复现与精确树证据](spirit-redraw/validation/baseline-8345-comparison.json)。未修改这些规则或测试，也未宣称全仓全绿。

公共房间每次读取的快照复制与派生成本仍未优化。渲染器已在作画/提交前裁剪单位、建筑、船只、尸体、投射物和接触墨迹；地形仅保留可见 chunk。必要模拟、动作/血迹历史和完整小地图仍覆盖全世界，不能通过删去它们冒充渲染收益。

完整源快照与原 Chrome trace 精确压缩保留，并提供 materialize 工具；SHA 检查及恢复通过。[归档索引](card-streaming/stall-followup/EVIDENCE-INDEX.md)记录压缩前后字节、失败与复原路径。
