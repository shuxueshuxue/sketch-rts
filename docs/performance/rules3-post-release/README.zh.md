# PR377 正式发布与未发布实验

PR #373/#374/#375/#376/#377 已合并，当前已核对的正式版本为 **`ce9cda65fca34f74586b43e07300f7cc4cc8284f`**。本目录补充发布后证据和被否决实验；没有新增生产代码或平衡修改，不重写此前关闭的归档。

## 发布与公网启动

[PR377](https://github.com/shuxueshuxue/sketch-rts/pull/377)、[CI38595402704](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38595402704)、[CD38596555683](https://github.com/shuxueshuxue/sketch-rts/actions/runs/38596555683) 均成功。main、production-latest、正式 release、服务器 deployed 回执同为 ce9。官方包 2,467,682 B，SHA256 `1f3d08c4fc71d04722637fb540ffd9c234452b922f12530eca3a2eaa581cdb66` 与 release digest 一致；普通 TLS 首页 HTML 与正式 dist/index.html 逐字一致。

三场景真实 WebGL2 启动、GPU fenced 截图，逐张审查后菜单和场景正常；无 page exception、console/network/HTTP 错误或 context loss。浏览器均关闭，原 NSS 证书与 trust inventory 未变，未绕过 TLS。

| 场景 | 可下载公网截图 |
|---|---|
| 海盗巨舰场景 | [fleet.png](media/fleet.png) |
| 王城街景 | [capital.png](media/capital.png) |
| 军队与野怪大军 | [woods.png](media/woods.png) |

原严格检查仍为 **56/59、进程退出 1**，三处失败均为 `audio-packs/served.json`：包中 16 B 占位配置、实际站点 41 B 的 war3 配置，SHA 不同。源码明确支持部署侧音频覆盖；没有读取服务器实际路由配置，没有将这些失败改判通过。实际执行 HTML/JS/CSS 与 CSS 精确 CDP 表示检查均通过。

这只验证 SwiftShader 下的公网启动，不证明硬件 GPU FPS、完整动画相位、移动端、实战或可听见的音频播放。此前全部失败与阴性样本保持原值。第一次 receipt 小脚本因时间戳分隔符解析出错而失败，是工具解析问题；后续按实际 tab 保存解析，全源回执核验通过，不能称为部署故障。

## 已发布的性能改动与边界

PR377 只在精确 terrain field grow 中复用邻接读取。真实参数微对照的 12-grow 序列 mean 29.004→24.988 ms（−13.85%）、median 28.894→23.636 ms（−18.20%）。正式 ABBA 的 618,189 命令字节及 checksum `7d94a5e8` 一致，但整局收益配对方向相反，仍不能宣称稳定全局改善。

完整方法、源/工具 SHA、字段/队列证明、邻接穷举、内存、所有尾部、原规则归属见[前一份报告](../rules3-field-expansion/README.zh.md)。**p99≤16 ms/max≤50 ms 仍未达到；没有证明内存或 FPS 改善。** 守护卷轴 280→180 仅属于独立 PR374，rules2 旧评测不改归属；价格/持续时间等未顺改，AI 260 的估计仍待处理。

## 1859 的精确下水归因

v4 在干净实测源 `fd2c535…` 完整执行 14,400 tick，仅 1858–1860 CPU/GC 窗口。原命令逐字、checksum、工具/源 SHA、时钟锚均通过。

tick1859 whole 55.924 ms、sim 55.880 ms；updateTraining 25.820 ms、updateUnits 25.596 ms。两座码头下水：

| dock / 船型 | shipLaunchPose | harborPoses | 原 poses / entries |
|---|---:|---:|---:|
| player6 shipyard1040 / transport | 17.638 ms | 13.204 ms | 240 / 240 |
| player4 shipyard1046 / transport | 6.008 ms | 5.602 ms | 117 / 117 |

player6 新船 sail 21.089 ms 内含 route 13.032、grid 3.631 ms。上述嵌套成本不可相加。GC 实际重叠约 2.736 ms，CPU 采样 GC 是另一观测，不能相加或解释整个尖峰。真实 harbor 静态参数、原全部 poses/entry Map 顺序与对应关系已保存；第二 dock 可能使用首 dock 的地图缓存，不宣称全底层冷状态。

10960 在正式 ABBA 中 22–33 ms，旧 >50 ms 未重现，未强行归因。这些归因数字不能与不同扰动工具相减当作收益。

## 被否决的严格几何实验

实验只为 private outline 产生的新不可变 ring 登记已有 support walking 数值资格；原乘加表达式、顶点顺序、numeric guard、旧 plane cache 全不改。只有两个文件 11 insertions/2 deletions。完整 module graph 697 个用例、7 个真船模型、实际 240/117 poses/entry 顺序/Object.is、懒前缀与全部平面结果通过；4 文件43现有测试通过，实际 production SAT 越过首 plane 的 fast path 已观察到。

**数学等值没有带来稳定性能收益，因此不发布。** 固定 4 个预热区块、24 个交错 ABBA/BAAB，按真实1040→1046顺序，每序列新地图与两dock，32 次预热与192 次正式调用全部保留，无 forced GC/删尾/proof observer。每次序列外完整 Object.is 核验。

| 两 dock 合计 harbor 时间 | 原实现 | 候选 |
|---|---:|---:|
| mean | 5.019 ms | 4.604 ms |
| median | 3.734 ms | 4.017 ms |

mean −8.25% 但 median **回退7.58%**；24 个区块仅11为正，paired 中位退步2.64%，仅1区块两次 B 都严格快于两次 A。1040 的 mean 回退2.86%、median 回退7.89%；1046 mean 改善20.03%但 median 回退9.01%。完整每调用/每区块和所有尾部保留。此重建仅是新地图的 cold launch geometry；原堆/JIT/GC/cache 历史未重建，不能用它替代原1859成本。

没有执行候选整局 ABBA、生产构建或发布，因此不声称该未发布实验的全场命令/checksum验证。源码精确保存为实验提交 `fd5c5c60213fafad310cfe22e3dbb65f825012dc`，其父为fd；当前生产没有这13行候选改动。原 source-pin 与 current-status 记载其准备/测量时刻，后续提交身份在 final-closure 中另记，没有改旧记录。

第一次保存实验的包装器误对 porcelain 状态 `.strip()`，破坏首行前导空格，导致文件集合断言失败。该问题由当时 agent 消息报告，原 stderr 未在现有目录中找到，归档保存报告而不补造日志。最终按明确两文件提交原字节，不缩减文件集合检查。此为工具问题，候选否决原因始终是性能不稳定。

## 剩余边界

两个码头返回 pose 都唯一；重复 entry 值不等于重复几何执行。该场景 from/to heading 相同，sweep 的 turn 分支不会再次检查端点，不能删所谓重复 endpoint hullFits。20 个 face/offset anchor 在16 heading重复，但未定位其耗时，暂不增加缓存或改遍历。后续应继续记录实际热点调用和数值门槛；当前数据不支持改变船只规则、AI 相位、校验频率或测试断言。

## 无损归档

manifest 用 group 区分官方发布、公网检查、v4诊断、原/候选证明、微对照、工具错误和最终闭合。原路径以 base64记录；每个 payload 解压后 bytes/SHA 与原文件一致，PNG 另保留原字节供下载。正式包完整保存，不重复归档解包后的 artifact tree。

```sh
python3 docs/performance/rules3-post-release/verify.py --out docs/performance/rules3-post-release --verify
python3 docs/performance/rules3-post-release/verify.py --out docs/performance/rules3-post-release --verify --extract /tmp/rules3-post-release
```

本补充记录在独立 evidence 分支保存，不触发新生产部署；全部验收生产代码已经由 PR377 正式发布。
