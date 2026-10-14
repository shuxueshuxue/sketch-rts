# 实际原像素的 Canvas 读取归因

结果支持：这些实际姿态的完整读取主要承接 deferred Canvas 绘制/flush。先读一个内点或透明角点，会把约2.3ms工作移到1px读取，随后完整读取约0.4ms；总成本与原完整读取接近。小读取没有提供优化。此实验在 GPU 世界已销毁后执行，因此这批姿态的常规读取不需要活跃 GPU 队列即可出现；它没有复现或排除原游戏100–500ms长尾的 GC、同步等待或资源竞争。

输入冻结为 `d48fb3d95d248db91b9237f0dcb290e736f6a75b`，[原始结果](proof.json)和[实际像素 manifest](corpus-manifest.json)不修改。[analysis.json](analysis.json)保存逐case/asset/domain配对及完整核验，[离线分析器](../../../../../../../scripts/art-card-canvas-attribution-analyze.mjs)可重新生成本报告。此次核验通过：36个唯一实际 Canvas miss，n116/135/158=8/20/8，612模式记录；每个case每arm四轮、位置各一次、case顺序每轮正反交替。295份client source SHA在proof/manifest一致，原run声明无client修改；7份实际使用并归档的helper按保存SHA重新核验，36张完整原.bin与callback source SHA逐个通过。可选当前源校验未执行；历史核验不依赖后来修改的源代码。

语料仅做可复原存储整理：[恢复 manifest](evidence-archive.json)记录每张原 `.rgba.bin` 的路径、长度与 SHA，原 proof/helpers/语料 manifest 不改。若展开文件不存在，在仓库根执行 `python3 scripts/art-card-latency-evidence-archive.py --materialize --folder canvas-attribution` 后再运行原分析器或微诊断；详见[存储说明](../evidence-archives/README.md)。解压与核验不能和正式性能测量并发。这不是 Canvas、mask 或整局内存优化。

## 平衡轮：毫秒/一次真实姿态绘制

每arm144个样本，以下均包含慢样本。full2无新增绘制，是实际测得的暖完整读取成本参考，不是理论或跨硬件下限。

| 模式 | paint | 1px | full1 | full2 | 所有读取 | paint+所有读取 | 总p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 0.294 | 0.000 | 2.703 | 0.000 | 2.703 | 2.997 | 4.500 |
| B | 0.286 | 2.326 | 0.394 | 0.000 | 2.720 | 3.006 | 4.300 |
| C | 0.336 | 2.312 | 0.395 | 0.000 | 2.708 | 3.044 | 4.200 |
| D | 0.319 | 0.000 | 2.697 | 0.444 | 3.140 | 3.460 | 5.300 |

B/C的full下降没有减少工作：配对所有读取相对A均值分别0.017/0.005ms，总绘制+读取差0.010/0.047ms。D两次读取相加比A增加0.438ms，不能将full2单独当生产成本。一次透明角1px同样承接大部分工作；只能说明当前实现与这些样本的行为，不能保证所有Canvas都整图flush。

| 完整源域 | case数 | A full | B 1px+full | C 1px+full | D full2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512 | 29 | 2.633 | 2.317 + 0.333 | 2.301 + 0.341 | 0.376 |
| 704 | 7 | 2.993 | 2.361 + 0.650 | 2.361 + 0.618 | 0.725 |

## 冷首样本与完整性

初始复画36条单列，未混入上述平衡统计；均值paint+read=3.286ms。每个尺寸新建Canvas的首条分别为case0（512px，paint 3.300ms、read 2.600ms、total 5.900ms、canvasAcquire 0.000ms）；case19（704px，paint 0.900ms、read 4.000ms、total 4.900ms、canvasAcquire 0.100ms）。仅此首条是新Canvas域，不可把之后的initial case或平衡轮称为冷游戏测量。

所有完整读取逐字节与实际游戏原getImageData的SHA相符，D的两个输出各核验；1px与实际原基线对应像素相符。基线取自生产翻行之前，top-down、density4、原512/704域，适用于Canvas miss的mask flipY=true。n/now/tick、unit id/kind/key及proof/manifest中的来源事实一致，回放RGBA未发生闭包漂移。16个key是该生命周期首次实际Canvas paint，20个已经画过。原数据中alpha0且非零RGB像素数0；比较仍覆盖全部RGBA分量，不能据这批Canvas输出声称额外覆盖了合成的透明彩色像素。

完整corpus 44285952bytes（42.234MiB），实际捕获阶段持有这些原buffer，所以其world时间不是正式结果；实验前全部导出并释放，回放每次最多一张1982464bytes基线。D额外持有full1至full2返回，返回数组分配没有隐藏。独立allocate+copy/touch控制144次，均值allocate=0.038ms、copy/touch=0.292ms、总0.329ms；这些在所有Canvas轮之后，未扣减getImageData成本。惰性零页、颜色转换和浏览器内部存储使该控制不能成为纯readback时间公式。

## 资产覆盖和下一步

本次实际采到15/20种，缺少stonebackBrute、siegeRam、ballista、catapult、organGun。各case各arm数量、位置完全相同，所以这批样本内可公平配对；它不代表所有游戏美术或按战场人口加权。以下资产均值按其实际case等权，完整原始case统计见analysis。

| 资产 | case数 | A总 | B总 | C总 | D总 |
| --- | ---: | ---: | ---: | ---: | ---: |
| footman | 4 | 2.431 | 2.550 | 2.950 | 3.225 |
| lancer | 4 | 1.862 | 2.006 | 1.894 | 2.337 |
| priest | 4 | 2.169 | 2.150 | 2.200 | 2.637 |
| knight | 4 | 3.594 | 3.637 | 3.681 | 4.287 |
| golem | 4 | 3.500 | 3.488 | 3.562 | 3.888 |
| rubbleGolem | 3 | 3.150 | 3.142 | 3.217 | 3.575 |
| graniteGolem | 3 | 4.092 | 3.958 | 3.842 | 4.142 |
| ogreWarrior | 3 | 2.875 | 2.933 | 2.817 | 3.242 |
| ogreMage | 1 | 3.125 | 2.600 | 2.650 | 3.000 |
| ogreLord | 1 | 3.200 | 3.450 | 3.250 | 3.525 |
| deepSnapper | 1 | 2.625 | 2.600 | 2.600 | 2.950 |
| spiderQueen | 1 | 4.250 | 4.200 | 4.275 | 4.925 |
| redDragon | 1 | 5.075 | 4.975 | 5.075 | 5.750 |
| ancientStag | 1 | 2.475 | 2.500 | 2.500 | 3.225 |
| tidePriest | 1 | 2.550 | 2.475 | 2.450 | 2.800 |

下一步优先寻找可证明的重绘/光栅化重复：原尺寸、颜色、pose与完整RGBA不变的复用才可能省掉这里的主要工作。仅插入1px flush不会提速。原大长尾另用现有trace对齐Canvas长call的主线程GC、Skia工作和通道等待；本工具已经移除GPU提交，没有队列对照，不足以替代该判断。mask微基准可以消费这份真实.bin，须验证两种flip与所有样本，不把Node时间等同浏览器或游戏帧收益。

独立[同源trace摘要](../trace-analysis/compact.json)与常规Canvas归因方向一致：400个大于1ms的CPU get spans合计1407.197ms，已标记主线程Skia overlap 938.241ms；这些overlap不是额外可相加阶段，也不能将所有GPU进程活动判为Canvas等待。该trace最大get仅10.599ms，未复现旧100ms以上read。另一个n135公开copy耗时241.000ms，其中主线程WaitForToken overlap 240.631ms；这是需要分别调查的通道等待，不能用本工具约2.3ms平均flush归因覆盖。trace和本微实验的样本、observer与运行阶段不同，不直接合并百分比。
