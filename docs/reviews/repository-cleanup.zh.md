# 仓库清理审计

这轮清理以 `4df96f7633d32a3b113d199ea4afcfa5fbec692e` 为源码基线。运行资源、开发工具与验收资料先查引用和实际用途，再决定是否清理。

## 本地输出

`.gitignore` 新增根目录 `work/`、CPU profile、heap profile、heap snapshot 和临时生产发布包。现有导航、海战和重型舰验收脚本默认写入 `work/`，这些输出可以重新生成；需要保存的验收结果仍放在 `docs/reviews/`。

用 `git check-ignore --no-index` 检查了各类路径。源码、测试、船模、正式验收资料均不受这些规则影响。

## GitHub 分支

审计时有 83 个远程分支。仅清理了此前四项已完成船舶工作的分支：

|分支|已合并 PR|删除前 head SHA|
|---|---|---|
|`codex/refine-ship-models`|[#198](https://github.com/shuxueshuxue/sketch-rts/pull/198)|`66725bd3a87a6fa26d12ef1b360f2cdc912c0f31`|
|`codex/rebuild-ship-navigation`|[#203](https://github.com/shuxueshuxue/sketch-rts/pull/203)|`80ddc2a425642829e81e76f06d0ba35990f6a965`|
|`codex/fix-naval-combat-and-course`|[#205](https://github.com/shuxueshuxue/sketch-rts/pull/205)|`9b4a527c8c7e0ec5c49640ebe56ab2d7ff84d233`|
|`codex/cabin-and-heavy-broadside`|[#208](https://github.com/shuxueshuxue/sketch-rts/pull/208)|`235c228fb91916f2b2084884f97df8aca7ec3b17`|

删除前重新确认 PR 已合并到 `main`、远程分支 head 与该 PR head 完全一致、没有未合并 PR 使用该分支、没有活动 worktree 使用该分支。推送删除使用指定 head SHA 的 `--force-with-lease`，避免审计之后新增的提交被删除。其余分支、当前优化分支、`main` 和 `production` 均保留。

尝试开启 GitHub 的 `delete_branch_on_merge` 设置时，API 返回 HTTP 403 `Resource not accessible by integration`；当前凭据没有这项仓库管理权限，设置保持原状。

## 资源、制品与历史

- 基线有 1,001 个 tracked 文件，其中 102 个二进制资源。逐个计算 SHA-256 后，没有完全相同的重复二进制资源。
- `public/art/world3d/buildings/` 通过运行时模型 key 加载，文件名缺少完整的字符串引用不代表资源无用。保留这些模型。
- 较大的文档图像和交互对照页仍提供视觉验收依据。保留已有的验收资料与可重现它们的脚本。
- GitHub 有 361 个 Actions artifacts，共 30,162,502 字节，全部属于仍在进行的 [#192](https://github.com/shuxueshuxue/sketch-rts/pull/192) `bootstrap_1` 测验，保留其结果和工作流日志。
- 三个 releases 中，`production-latest` 包含当前 2,205,725 字节生产发布包，另外两个版本 release 没有二进制附件。保留所有 releases 和 tags。
- 本地执行 `git prune-packed`，只移除已经在 pack 中保存的重复 loose objects。没有重写 Git 历史。删除分支和本地重复对象不会缩小远程历史的 clone 包，不能把这类整理当作下载体积优化。

这些数量是本轮审计时的快照；后续工作流和 PR 会继续改变仓库状态。
