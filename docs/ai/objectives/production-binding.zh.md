# 正式生产动作绑定

`ExecutableMethod.actions[].production` 与 `ExecutionAction.production` 使用同一 `ProductionBinding`。生产者是已存在的真实 buildingId，或同方法内建厅动作的 actionId；后者只在该动作有已观测地基/完工结果时解引用，不能把 `planned-hall:<mineId>` 当作实体或租用键。解析后还须检查同generation的执行记录和建筑归属、存活、完工与训练通道。

新下单 `request.kind=submit` 必须引用同方法的 semantic spendId，按真实支付证据记账。已支付队列 `adopt-paid` 保留原生 jobId（可为null）、观测tick、队列下标及剩余ticks；它是待验证的原生基线，不是伪造job身份。执行器要验证连续性及实际完成/出生，缺少唯一身份或连续性时受阻；不得再次发train、扣75金、抢其他队列的出生，或把未付款计划认成paid。真实createdUnitId随后回到原父方法资源组，单纯预测的未来工人没有单位租用。

这个字段只给本切片已在实现的train-worker/train-transport使用。训练和研究是两个原生通道，现金仍共用。框架将具体化绑定原样交给执行器，不从reason文案猜生产者。
