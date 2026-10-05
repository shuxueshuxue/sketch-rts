# 大规模 RTS 技术研究与迁移决定

检索日期：2026-10-04。以下是开发者公开材料，不宣称掌握商业引擎源码或当前版本全部实现。

- Creative Assembly，GDC 2016，Andre Arsenault，*Have Fun Storming the Castle!*。已读攻城 AI 讲义及架构图：Alliance → Grand Tactical Analyzer → Objective → Detachment → Tactic；近战管理独立于这套目标分配。迁移决定：战役主力按战线与目标组织，玩家小队保持单兵操作；不让每个士兵独立决定全局战争。
  https://media.gdcvault.com/gdc2016/Presentations/Arsenault_Andre_Have_Fun_Storming.pdf
- Elijah Emerson，*Crowd Pathfinding and Steering Using Flow Field Tiles*，Game AI Pro 第 23 章。已读全文：门户图上的路线共享、局部流场缓存、动态地形局部失效、按工作量分批生成，以及分离内存的积分场任务。我们的 terrain.ts 已有这一基础。本轮修复缓存清空抖动；下一步限制每帧建场工作并将独立场任务交给 Worker 池。联机应按固定工作量/提交帧处理，不让机器快慢改变规则。
  https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter23_Crowd_Pathfinding_and_Steering_Using_Flow_Field_Tiles.pdf
- Total War 官方 Optimisation Blog。已读：绘制相关工作拆线程、改进任务系统、粒子转 compute shader。迁移决定：先将模拟与页面绘制隔离；再研究独立任务并行。不能据此声称全面战争所有战斗逻辑都在 GPU 上。
  https://wiki.totalwar.com/w/Optimisation_Blog
- Joel Pritchett / Microsoft，GDC 2022，*The MAW: Safely Multithreading the Deterministic Gameplay of Age of Empires IV*。本次读到官方摘要，没有完整视频细节。公开目标是不同核心数量仍得出相同模拟结果，且配套调试与验证工具。迁移建议（自己的方案）：只读快照 → 并行产生意图 → 固定顺序提交 → 同输入状态摘要比较。
  https://www.gdcvault.com/play/1027610/The-MAW-Safely-Multithreading-the
- Tamas Rabel / Creative Assembly，GDC 2019，*Instancing and Order Independent Transparency in Total War: THREE KINGDOMS*。本次读官方摘要：实例化管线、多核合作优化和粒子无序透明。迁移建议：2D 图集批次/实例绘制可以保持现有手绘风格；先优化调用与缓存，不照搬 3D 透明管线。
  https://www.gdcvault.com/play/1026177/Instancing-and-Order-Independent-Transparency

工程判断：继续使用 TS，先实测，再做共享计算、紧凑数据、线程边界和渲染批次。WASM 只为经剖析确认的热点内核服务。单个 Worker 分离模拟不等于一场模拟已经多核并行。5000 实体的十秒无画面测量也不等于完整战役帧率。详见同目录 army-scale-architecture.zh.md。
