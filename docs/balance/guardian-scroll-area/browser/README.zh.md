# 守护卷轴真实 WebGL 前后画面补验

本次补齐前阶段仅有真实 Canvas 画面和 Three 相机投影检查的限制；此前 40 项源文件、图像、快照和原始日志逐字节保留，前一份清单原文保存为 `manifest-before-browser.json`，SHA256 为 `b65ad68aef5d09793b71a12e78091bf6f390f36576aa62ea65f09db41ec16a9e`。生产源、测试及原性能证据没有修改，也没有重跑 240 项检查、完整对局或性能评测。

[旧规则 2：真实 WebGL 画面](capture/before-1280x720.png) · [新规则 3：真实 WebGL 画面](capture/after-1280x720.png)

两个截图均为 **1280 × 720**，来自真实 Chromium 151.0.7922.173、WebGL2／ANGLE SwiftShader。外部 Vite middleware 提供一个仅用于取证的页面，实际调用游戏的 `sketchScene → createGame → issueCommand(useItem) → snapshotGame → WorldPresentation.prepare → WorldPresentation.draw`。`WorldPresentation` 原样经过 Canvas ground、WebGL 人物／原生模型、Canvas overlay 三层。没有添加生产 debug API、HTML 模拟范围圈或首页源修改。

沿用 Canvas 验证中的携带者和八名士兵坐标：四名距携带者 160，四名距 220。两版各添加同一座位于圈外的原生城镇大厅，确保真正载入 GLB 模型；其位置 1070,1500，携带者位置 1500,1500，中心距 430。建筑、地面、人物、守护外圈、人物状态与阴影都由游戏绘制。外部页面仅添加标题、距离文字和很小的单位中心十字；文字颜色依据真实 `unit.effects` 中的 guardian 标签，`capture.json` 的 `actors[].protectedByScroll` 记录实际标签，不能把文字本身当作模拟事实。

截图显示旧特效在纵向覆盖不到仍受保护的 160／220 友军；新半径 180 的圆覆盖 160 友军，220 友军不再显示守护状态。`verification.json` 确认两版完整快照除预期 guardian 受益状态和 field radius 外完全相同，绘制前后快照未变。

| 有限画面检查 | 两版结果 |
| --- | --- |
| `WorldPresentation.is3D`，三层 stack 可见 | true |
| 实际渲染调用 | 每版固定 3 次 draw，原生 renderer frame 3 |
| 最后一帧提交 | 23 calls，700 triangles |
| 原生城镇大厅 GLB | 已载入，缓存 models=1、pending=0；25,264 字节 |
| WebGL 错误、浏览器异常、console error、网络失败 | 全部 0 |
| 12 个关键源文件开始／结束 SHA256 | 全部一致 |
| 固定模拟 tick、动画时钟 | 0、0；未执行模拟 tick |
| 160／220 距离的士兵受益人数 | 旧 8，新 4（均另含携带者本人） |

这些提交数量只证明此次截图确实走过 GPU，**不是帧率或性能收益指标**；没有据此宣称完整游戏、其他设备、其他画面或性能验收。原有 AI 260 受益人数启发式差异仍保留，见上级范围报告。

## 原始命令及清理失败的归因

`commands.jsonl`、`capture.log` 和 `capture/chromium-stderr.log` 保留原始执行；`capture/capture.json` 和分版 capture／snapshot JSON 保留源哈希、资源请求、WebGL 型号、真实状态及 PNG SHA256。两张图已实际查看。

首次采集命令在两张图和全部元数据写出之后，因向 Chromium 发送 SIGTERM 后未等待退出即删除自身临时目录，触发 `ENOTEMPTY`，**最终退出码为 1**。不是游戏、范围或 WebGL 渲染失败，不能把该命令说成全程成功。原始采集工具逐字节保留为 `tools/capture-recorded.mjs`，其 SHA256 与 capture metadata 相符。

随后只读 `tools/verify.mjs` 检查两张 PNG 的真实尺寸／哈希、模型、WebGL 状态、快照差异、源哈希和原 40 项证据完整性，并完成唯一所属临时目录的清理；退出码 **0**，结果在 `verification.json`。没有重拍画面。供重现的 `tools/capture-reproduce.mjs` 补上等待所属 Chromium 退出和目录删除重试，通过 `node --check`；修正版没有再次执行画面采集，区别于此次真实使用的 recorded 工具。

```bash
node docs/balance/guardian-scroll-area/browser/tools/capture-reproduce.mjs \
  /workspace/sketch-rts-homepage-before-a052 \
  /workspace/sketch-rts-guardian-scroll \
  /workspace/guardian-scroll-webgl-reproduction
```

修正版工具与同目录的 `fixture.mjs`、`page.html` 一起使用；依赖来自目标工作树现有安装。前版源为冻结 `a0524c2c9b32d4b92084d4f9478729eb562f7d29`，后版仍是同基线之上的未提交候选；源差异／SHA 与此前闭合清单一致，不能把后版 HEAD 当成已提交候选。父线程可独立审阅提交，未合并或部署。
