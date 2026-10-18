# 线上舰炮静音：音效包导入修复

2026-10-18 实查 `lexicalmathical.com` 的 `war3/extras.json` 仍含 `spell.kinds.pyreCaller`。
该单位已改名为 `summoner`，`readSoundPack` 抛出 `Sound pack war3: spell names no unit kind pyreCaller`。
客户端静默丢弃整份 extras，仅保留 core；core 没有海军和舰载武器音效，所以连其他本来有效的声音也被丢掉了。

修复把存档原有的单位改名表提取到 `src/shared/unit-name-migration.ts`，音效包导入也使用同一张表。
`pyreCaller` 映射到 `summoner`，`emberAcolyte` 映射到 `priest`；同一事件同时写新旧名字时，新名字的配置优先。
真正未知的单位依然报错。损坏的 extras 保留 core，但 `console.error` 输出包名、`extras.json`、字段及完整错误对象；
缺少可选 extras 的 404 正常忽略，其他读取错误和错误 JSON 结构都会报告。

用生产机完整 `war3` 目录的只读副本运行新校验器，合并后的 **23 个事件全部通过**。
该副本 `extras.json` 的 SHA-256 为
`6045c9b3443c83b7d3d3e8581d05403b6586b46e034813e49e76e3b0b69cae7b`，
与线上文件及迫击炮试听前的快照一致。本次没有改动或重发默认音效包，也没有替换任何音频。
代码修复合并并正常部署后，刷新页面即可读取现有 extras。

发布新包走 [`tools/audio/publish-pack.sh`](../../tools/audio/publish-pack.sh)：上传前使用
`readSoundPack` 校验合并后的 core 和 extras，并核对所有引用文件是否在完整暂存目录中。
校验失败立即退出，任何上传均不会开始；通过后先传录音，再更新清单。
命令和生产目录见 [`tools/audio/README.md`](../../tools/audio/README.md)。

验证包含：旧名字映射、同时包含舰炮/迫击炮/葡萄弹的 extras 整体加载、保留 core 时输出完整错误、
新旧配置冲突、存档迁移，以及错误包无法修改发布目标。把新测试放在 main 的实现上运行，
4 项失败，其中直接导入测试的错误正是 `spell names no unit kind pyreCaller`。
