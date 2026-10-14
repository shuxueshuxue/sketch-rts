# 规则3：PR #378 上线记录与凸包阴性实验

**PR #378 的三处改动已上线；整局性能目标仍失败。** 原正式 ABBA 的 native whole tick 均值为 **3.740452→3.638660 ms（改善2.72137%）**，p99 **28.745034→26.851076 ms**，max **92.766118→115.397179 ms**。目标为 **p99≤16 ms、max≤50 ms**。均值和 p99 改善不能抵消最大值退化，也不代表浏览器 FPS。[三处改动完整原证据](../whole-game-rules3/README.zh.md)。

固定场景为 `sapphireArchipelago` 六人局、空闲 Grove 人类席位与五个 AI，12分钟 / 每臂14,400原生tick；结束 `winner=null`。这是完整预定tick对照，不是所有地图、原附件精确房间或胜利结局验收。所有阶段仍为 **rulesVersion 3 / checksumVersion 18**，不改 AI 思考相位、船只规则、校验频率或测试断言。已上线内容只有两槽导航数组、加权小盒展开与甲板单次调用投影复用。

## 已上线版本与原始生产验证

[PR #378](https://github.com/shuxueshuxue/sketch-rts/pull/378) 合并版本 **`49e07caa1657687247e6b58180c7b641911f6512`**，CI [38622877661](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38622877661) 对 `b8456eef…` 成功，CD [38623804023](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38623804023) 对49e成功。部署 connector 原日志有实际 `deployed 49e07caa…` 回执；其中一次 localhost 连接拒绝后成功，原记录完整保留。另一份 `deploy-job.log` 原本为零字节，不把它当成功日志。[部署原日志](production/payloads/id0002.bin.gz)、[空日志原件](production/payloads/id0003.bin.gz)、[发布元数据原件](production/payloads/id0119.bin.gz)。

官方生产 tar **2,471,441 bytes**，SHA256 **`5c530e793d7e9aef4dd7188324bab627aaf0bbcc12e5438e19992d563cdf3805`**，与 release 元数据相同。tar 内91个文件与原解包目录逐字节相等，展开目录及官方 tar 均完整归档。[生产字节闭环](production/verified-closure.json)、[官方 tar 原件的外层 gzip](production/payloads/id0120.bin.gz)。

线上 `https://lexicalmathical.com/sketch-rts/` 严格检查 **56/59，exit 1，automatedPass=false**。三个失败分别属于三个场景，且都仅为 `audio-packs/served.json`：官方包16 bytes空配置，线上41 bytes、HTTP200，三场景返回 SHA相同。与此前ce9发布观察相同，但本记录没有线上41 bytes正文或主机配置的独立证据，不能只据哈希判定实际音效包或覆盖来源。检查未降断言，原失败和原工具原字节保存；不能宣称59项通过或全部线上资源与官方包相同。[严格原报告](production/payloads/id0112.bin.gz)、[原工具](production/payloads/id0103.bin.gz)、[原退出报告](production/payloads/id0118.bin.gz)。

三个场景均捕获到原生 WebGL2 合成画面，GPU fence完成，无页面异常、上下文丢失、控制台错误或网络失败；使用现存正常 TLS 信任，NSS证书与信任清单前后未变。[独立人工图审查](visual-review.json)。

| 可下载原PNG | 实际可见内容 |
|---|---|
| [海盗巨舰](media/fleet.png) | 两艘多炮位帆船、海盗旗、甲板人员和单帧炮口烟光 |
| [王城街景](media/capital.png) | 石街、摊位、民众和紫色护卫 |
| [林间军队对野怪](media/woods.png) | 青绿色盾兵、弓兵，对阵魔像、巨人、狼、蜘蛛及鹿形生物 |

根与独立证据审查车道实际查看了这三张图；原报告中当时的 `visualReview=Pending` 原字节不改。截图仅支持三个首页**启动构图**正常；不把它当完整修船、接舷夺船、慢镜头或整段循环验收。Chromium151、1440×900、SwiftShader环境，不是硬件GPU帧率或整局浏览器性能测量。`skipUi=true`，未验证移动端、交互按钮或可听音频。截图期间动画自然运行，`requestedSecond=0` 不代表精确第零秒。

## 未采用的生成点凸包实验

独立基线 **`e51e749d65b6642cb277d1a1ee83b0aefd662e00`** 与候选 **`eef9bf133a08f83898834873bbdb464ae2596b86`** 的代码、原工具、完整命令和原始样本均冻结。局部生成点序列中位耗时改善37.07%，公共接口中位却变慢2.53%；正式整局没有稳定收益，候选**未采用、未并入上线源码**。[完整实验报告](convex-sort/README.zh.md)。

| 正式ABBA合并指标 | e51基线 | eef候选 |
|---|---:|---:|
| whole mean ms |3.560379|3.569096（变慢0.2448%）|
| whole p99 ms |26.406573|26.706512|
| whole max ms |81.748129|99.819483|
| >50 ms |13|15|

两个配对均值收益方向相反，12个分钟区块只有5个whole均值改善；局部排序收益不能代替整局判断。五次运行保留tick0与全部尾部、无forcedGC或删样本，目标仍失败。完整命令 bytes与之前规则3参考逐字节相同：**618,189 bytes / 14,400 frames / 612非空帧**，SHA256 **`771222bde4c8d2c0a46a97313563ad2b5de1d52ed92fb2d3c70511ff2276c997`**，final checksum **`7d94a5e8`**。这属于固定场景透明性验证，不是所有输入的形式证明。

## 无损归档与复核

`convex-sort` 完整复制已封闭实验目录，**175载荷 / 64,846,564原始bytes / 19,817,246存储bytes**，连支持文件共182文件，每份字节与源目录相等。其清单、原准备等待状态、失败、修正、工程检查及阴性结果均不重写。[实验清单](convex-sort/manifest.json)。

`production` 保存生产验证目录**全部120原文件**，无排除；**18,165,041原始bytes / 8,334,660存储bytes**。三PNG另按原bytes直接复制到`media`便于下载。原路径以Base64保留，每份记录原bytes/SHA和外层gzip bytes/SHA；原本gzip/tar也只增加外层gzip，不替换原压缩字节。已逐项流式读回并与原目录再比较。[生产清单](production/manifest.json)。

在仓库根目录复核，无须重新运行模拟或线上浏览器：

```sh
python3 docs/performance/rules3-followup/verify-delivery.py
python3 docs/performance/rules3-followup/production/verify.py --out docs/performance/rules3-followup/production --compare-originals
python3 docs/performance/rules3-followup/convex-sort/verify.py --out docs/performance/rules3-followup/convex-sort --verify --compare-originals
python3 docs/performance/rules3-followup/convex-sort/analyze-native.py
```

`--compare-originals` 需本机原工作目录仍存在；普通复核仅依赖归档。生产解码器可加 `--extract /tmp/new-production-evidence`，先完整校验，再写不存在的新目录，拒绝覆盖和路径穿越。实验解码器同样使用 `--extract`，其旧命令中的绝对目录是原运行身份，不能直接换标签冒充新执行。

此分支只发布证据，不改变游戏源码、既有封闭归档或实验采用状态；整局目标的剩余差距继续保留。

在这批文档落盘后，根执行完整 SDK/生产打包边界检查：**4文件 / 14项通过，exit 0，29.24秒**。最后新增仅为该检查的编号压缩日志、身份记录及本段说明；不把它冒充新性能测量，也不改旧归档。[检查原日志](validation/payloads/id0001.bin.gz)、[检查身份](validation/manifest.json)。
