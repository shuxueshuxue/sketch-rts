# 首页首个按钮音效

首页资源准备原先只等待音频包清单，直到第一次点击才创建音频上下文、下载和解码提示音。下载超时或异步恢复上下文时，第一次提示音会被丢掉。另外，仓库的 CC0 包只有 `click`，而首页按钮使用 `menu` 事件，原实现没有回退。

本次修复在首页准备时只解码当前包的 `click` / `menu` 提示音；不调用 `resume`，不自动播放，不预载战斗或单位语音。真实鼠标 / 键盘手势恢复上下文后，首个提示音等待恢复完成。延迟提示音仍在 350 ms 后过期，过期计算使用真实时间，避免暂停的音频时钟把旧提示音留下。没有 `menu` 的旧包使用已有 `click` 音频；有专属 `menu` 的包优先使用它。默认音频包、音量和静音设置保持原有策略。

验证包含 26 个相关单元测试，其中新增 6 个测试覆盖首页预备、首次恢复与解码并发、过期、静音及包切换、旧包回退和浏览器音频不可用。

[原始浏览器记录](proof.json)使用 Chromium 151.0.7922.173、全新用户目录和 `document-user-activation-required` 自动播放策略，打开实际首页并通过可信鼠标事件点击实际按钮。测试配置选择仓库 CC0 包：

- 第一次点击之前，已解码一个 0.147 s 的非空音频；上下文为 `suspended`，恢复次数和播放次数均为 0。
- 第一次按钮点击将原生上下文恢复为 `running`，恢复约 59 ms 后启动一个原生音频源。
- 开启静音后再点击实际按钮，音频源总数仍为 1。
- 音频字节请求只有 `click.ogg`；Vite 的 `?import&url` 地址模块明确记录为 `Script`，没有下载战斗音频字节。
- 无浏览器运行异常。

Headless 环境没有物理扬声器。本验证覆盖真实音频解码、自动播放限制、上下文恢复和播放生命周期，不等同于人耳监听。原始记录包含输入代码和脚本的 SHA-256，证明采样时尚未提交的音频代码版本；没有修改或发布线上音频包。

复现：

```bash
npx vitest --run src/client/sound-loading.test.ts src/client/sound.test.ts src/client/sound-packs.test.ts src/client/sound-cues.test.ts --maxWorkers=1 --minWorkers=1
node --import tsx scripts/homepage-audio-proof.mjs --source "$PWD" --out work/homepage-audio/proof.json
```

[首页截图](homepage.png)来自同一次浏览器验证。类型检查和完整构建由主工程车道统一运行。
