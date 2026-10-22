# 搜索格式第 1 步：选择器、重放接口与迁移

依据 [搜索实现约定](goal-search-implementation.zh.md)，本步固定格式边界，不替换 DFS 或接入未来船栈。
基线为 main `a03ddfdf` 合并冻结 `dee4d4b4`，合并提交 `a54da92a`；生产内容相同，未取 v9。

## 稳定选择器与判法

`GoalStepSelector = {provider, kind, grounding}`。grounding 是扁平具名原子表，值为有限数、字符串、布尔或 null。
字段名是 provider 的域语义，例如 `buildingKind`、`mineId`、`site.landId`、`site.x`；不塞完整事实、动作或报价。
同一计划中两个独立批次必须有不同的域选择器，不能用遍历下标碰巧区分。

全局步骤键为：

```text
goal-step:1: + canonicalJSON([goalId, provider, kind, [[field, value], ...]])
```

字段按 Unicode 码元顺序排列，保留完整内容，不用截断 hash，不分配编号。
`goalGlobalStepKey` 生成，`readGoalGlobalStepKey` 校验；本地步骤标签不进入这个键。
局部输出 `{kind:'step-output', step, output}` 在边界改成 `{kind:'output', actionId:全局步骤键, output}`。
这只是引用改写，不是把未来船或厂绑定成真实实体，不产生 lease 或 SDK 权限。

`goalSemanticPlan` 比较选择器、bindings 和依赖拓扑，忽略局部标签、数组排列、报价与绝对/相对时刻。
`goalSemanticReady` 单独比较 ready 前沿；正常步骤推进不算换计划。
`goalSemanticDecision` 组合两者并区分 `no-plan`、`valid`、`invalid`。
首次因果完整、首次非空 ready 和每分钟切换率由判法工具记录，不把时点代理变回硬断言。

## wire 与纯重放接口

`GoalSearchMemory.version=1`，每个目标只有 `incumbent`、`cursor`。
incumbent 保存步骤、局部依赖、bindings、数值/basis、相对时刻及其 `scheduledAtTick`；invalid 保留首个失效步骤与原因。
cursor 只有栈的下一候选位置、前缀、依赖版本、是否穷尽及唯一正在精化的 challenger。
`goalSearchWire` 验证实际 JSON 数据，拒绝隐藏 getter/toJSON、完整声明附加字段、旧表版本引用及非有限值。

`GoalRegenerate` 的输入显式包含当前快照、选择器、bindings、已重放前缀和已发布事实读取口。
返回 `known/pending/invalid/requote`；没有 allocator、付款、SDK、发布 mutation 口。
真正的因果排程、资源重放和硬失效修复在实施第 2 步接入；本步只固定接口，不宣称这些功能已替换。

## authority 格式迁移

`migrateGoalSearchMemory(memory, select)` 是一次性、纯的格式入口。
`select` 是 provider 提供的语义映射，接收原定义的 namespace、已解码内容及 goal 作用域，返回稳定选择器键。
它不能靠分配新版本代替解释原含义；不认识的定义应报错，不能丢表后再猜。

入口先准备完整映射，覆盖所有 authority JSON 值与键，包括 declaration 的 `priorId`、方法/执行/孤立事件、回退 spend、output 关联。
有明确格式的复合 action/budget 键按格式处理；不替换物理实体名中的子串。
已共用的参数定义若在两个 goal 中需要不同 output 归属，迁移保留原输入并报错，不能悄悄选一方或新建引用。
所有映射完成后才返回新 memory，移除旧 planner/定义表，保留已有 `goal-ref` 键和计数器。
generation、lease、原命令、已付款额、nativePayments、真实 building binding 不由搜索重建。

旧 `goalPlanning` 也含原生 world、geometry、voyage risk 等服务数据，不能随搜索一起丢弃。
本步把它们保存在显式 `goalPublications.memory`，仅保留这些数据真正可达的旧定义于 `goalPublications.references`，不保留旧搜索缓存或报价。
它们继续计入原来的常驻口径；第 4 步改 source-key 与缓存引用根时移除这份过渡定义，不用搬字段逃过字节门槛。

旧生产入口当前仍运行旧搜索。为分步替换，本步把旧 `priorDeclarations` 别名一次写回 authority 的原 declaration 记录并清除别名；
`readGoalIntent` 已只读取 authority，不再依赖进程中的 planner scope。
完整的新格式迁移入口由第 2 步的新重建入口调用，本步不把新 wire 交给旧搜索继续执行。
旧定义表仍为尚未删除的搜索服务；本步不宣称否决表、8-pass、压缩和旧搜索门槛已移除或通过。

本步合同核跨 JSON 的原付款/绑定、原 generation/命令与引用计数不变，重复观察不二付，未来引用不获得真实权限。
它们不替代题 1/3、13 输入语义收敛和真实对局门槛，也不改写 dee4/v9 的原失败。
