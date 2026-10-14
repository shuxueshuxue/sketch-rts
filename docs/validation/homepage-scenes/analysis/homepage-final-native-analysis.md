# 首页最终原生窗口分析

仅重算闭合捕获的原始 gzip 数据，没有运行浏览器、测试或改变源码/HEAD。数字为毫秒，nearest-rank 分位数；pooled 分布拼接原始样本后重算，未平均 p99。完整精度、来源 SHA、原始样本位置和准备/内存检查点见同名 JSON。

环境：Headless Chromium 151.0.7922.173、SwiftShader、1440×900、deviceScaleFactor=1。draw/render 是 CPU 墙钟通过提交，render 包含在 draw 中，不可相加；rAF 为原生调度间隔。未测 GPU 计时器，未强制 GC，不将这些数字泛化为硬件 FPS。

## 有效对照及排除

船队与王城 A/B 使用同一演出内容，各两 A、两 B，原生自然等待约 7 秒后观测 15 秒；小幅起点与采样抖动逐窗保留。森林原四窗起点不匹配，全部排除收益比较；新森林自然等待第 20 秒的四窗 phaseWindowMatched 均为 true。

| 分组/窗口 | 实际 before age | submitted age | after age | submitted after | 比较用途 |
| --- | ---: | ---: | ---: | ---: | --- |
| same_art_age7/fleet-1-baseline | 7.067 | 7.023 | 22.082 | 21.950 | 有效 A/B |
| same_art_age7/fleet-2-candidate | 7.387 | 7.365 | 22.427 | 22.041 | 有效 A/B |
| same_art_age7/fleet-3-candidate | 7.209 | 7.178 | 22.227 | 21.949 | 有效 A/B |
| same_art_age7/fleet-4-baseline | 7.109 | 7.081 | 22.124 | 21.713 | 有效 A/B |
| same_art_age7/capital-1-baseline | 7.397 | 7.333 | 22.420 | 22.074 | 有效 A/B |
| same_art_age7/capital-2-candidate | 7.290 | 7.230 | 22.299 | 22.178 | 有效 A/B |
| same_art_age7/capital-3-candidate | 7.411 | 7.354 | 22.434 | 22.069 | 有效 A/B |
| same_art_age7/capital-4-baseline | 7.117 | 7.073 | 22.145 | 21.879 | 有效 A/B |
| same_art_age7/woods-1-baseline | 15.316 | 15.180 | 30.343 | 30.003 | 排除：相位误配 |
| same_art_age7/woods-2-candidate | 11.255 | 11.154 | 26.286 | 26.217 | 排除：相位误配 |
| same_art_age7/woods-3-candidate | 13.498 | 13.299 | 28.527 | 28.322 | 排除：相位误配 |
| same_art_age7/woods-4-baseline | 15.243 | 15.077 | 30.291 | 29.985 | 排除：相位误配 |
| fleet_cycle/fleet-1-source | 7.109 | 7.100 | 6.576 | 6.369 | 完整周期观察 |
| woods_phase20/woods-1-baseline | 20.119 | 20.072 | 35.132 | 34.745 | 有效 A/B |
| woods_phase20/woods-2-candidate | 20.465 | 20.427 | 35.484 | 35.235 | 有效 A/B |
| woods_phase20/woods-3-candidate | 20.065 | 20.050 | 35.080 | 35.051 | 有效 A/B |
| woods_phase20/woods-4-baseline | 20.073 | 20.041 | 35.093 | 34.740 | 有效 A/B |

## 逐窗口绘制 CPU 提交

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 32 | 47.788 | 8.100 | 468.900 | 744.600 | 744.600 | 2 |
| same_art_age7/fleet-2-candidate | 33 | 11.682 | 7.300 | 33.800 | 115.800 | 115.800 | 1 |
| same_art_age7/fleet-3-candidate | 30 | 13.547 | 6.800 | 22.100 | 165.900 | 165.900 | 1 |
| same_art_age7/fleet-4-baseline | 31 | 47.216 | 6.900 | 462.400 | 773.900 | 773.900 | 2 |
| same_art_age7/capital-1-baseline | 36 | 27.344 | 24.700 | 49.700 | 61.200 | 61.200 | 1 |
| same_art_age7/capital-2-candidate | 39 | 24.605 | 22.700 | 44.800 | 46.000 | 46.000 | 0 |
| same_art_age7/capital-3-candidate | 37 | 26.103 | 22.400 | 56.300 | 66.400 | 66.400 | 2 |
| same_art_age7/capital-4-baseline | 36 | 30.300 | 25.200 | 70.100 | 79.000 | 79.000 | 2 |
| same_art_age7/woods-1-baseline | 28 | 83.450 | 42.100 | 487.000 | 588.700 | 588.700 | 10 |
| same_art_age7/woods-2-candidate | 29 | 87.079 | 54.000 | 470.000 | 512.200 | 512.200 | 20 |
| same_art_age7/woods-3-candidate | 28 | 92.275 | 45.700 | 655.600 | 662.300 | 662.300 | 12 |
| same_art_age7/woods-4-baseline | 29 | 84.155 | 49.100 | 530.200 | 567.400 | 567.400 | 14 |
| fleet_cycle/fleet-1-source | 119 | 17.615 | 7.400 | 41.900 | 150.800 | 582.200 | 3 |
| woods_phase20/woods-1-baseline | 30 | 35.850 | 33.700 | 56.800 | 70.800 | 70.800 | 6 |
| woods_phase20/woods-2-candidate | 31 | 36.948 | 35.800 | 53.900 | 59.300 | 59.300 | 4 |
| woods_phase20/woods-3-candidate | 31 | 34.319 | 33.600 | 53.400 | 55.200 | 55.200 | 3 |
| woods_phase20/woods-4-baseline | 29 | 37.031 | 36.400 | 56.500 | 57.800 | 57.800 | 3 |

## 逐窗口 WorldPresentation CPU 提交

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 32 | 47.222 | 7.700 | 468.500 | 743.800 | 743.800 | 2 |
| same_art_age7/fleet-2-candidate | 33 | 11.158 | 6.800 | 33.400 | 115.400 | 115.400 | 1 |
| same_art_age7/fleet-3-candidate | 30 | 13.030 | 6.100 | 21.400 | 165.500 | 165.500 | 1 |
| same_art_age7/fleet-4-baseline | 31 | 46.748 | 6.600 | 461.900 | 773.000 | 773.000 | 2 |
| same_art_age7/capital-1-baseline | 36 | 26.844 | 24.400 | 49.300 | 60.800 | 60.800 | 1 |
| same_art_age7/capital-2-candidate | 39 | 24.364 | 22.500 | 44.500 | 45.700 | 45.700 | 0 |
| same_art_age7/capital-3-candidate | 37 | 25.814 | 22.100 | 56.100 | 65.400 | 65.400 | 2 |
| same_art_age7/capital-4-baseline | 36 | 29.764 | 24.600 | 69.900 | 78.700 | 78.700 | 2 |
| same_art_age7/woods-1-baseline | 28 | 83.029 | 41.500 | 486.600 | 588.200 | 588.200 | 10 |
| same_art_age7/woods-2-candidate | 29 | 86.617 | 53.700 | 469.500 | 511.800 | 511.800 | 20 |
| same_art_age7/woods-3-candidate | 28 | 91.836 | 45.300 | 655.100 | 662.000 | 662.000 | 12 |
| same_art_age7/woods-4-baseline | 29 | 83.634 | 48.800 | 529.700 | 566.700 | 566.700 | 14 |
| fleet_cycle/fleet-1-source | 119 | 16.870 | 6.700 | 41.000 | 131.700 | 578.700 | 3 |
| woods_phase20/woods-1-baseline | 30 | 35.523 | 33.400 | 56.600 | 70.200 | 70.200 | 6 |
| woods_phase20/woods-2-candidate | 31 | 36.526 | 35.400 | 53.500 | 58.700 | 58.700 | 3 |
| woods_phase20/woods-3-candidate | 31 | 33.916 | 33.300 | 53.200 | 54.400 | 54.400 | 3 |
| woods_phase20/woods-4-baseline | 29 | 36.641 | 36.000 | 56.100 | 57.400 | 57.400 | 2 |

## 逐窗口原生 rAF 间隔

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 52 | 278.513 | 400.000 | 516.700 | 733.300 | 733.300 | 31 |
| same_art_age7/fleet-2-candidate | 44 | 323.470 | 400.100 | 483.200 | 650.000 | 650.000 | 32 |
| same_art_age7/fleet-3-candidate | 49 | 292.163 | 416.600 | 533.400 | 749.900 | 749.900 | 29 |
| same_art_age7/fleet-4-baseline | 48 | 295.127 | 416.700 | 516.600 | 766.500 | 766.500 | 30 |
| same_art_age7/capital-1-baseline | 43 | 333.321 | 416.600 | 466.700 | 550.000 | 550.000 | 34 |
| same_art_age7/capital-2-candidate | 60 | 242.490 | 349.900 | 433.300 | 450.000 | 450.000 | 38 |
| same_art_age7/capital-3-candidate | 56 | 256.537 | 366.600 | 433.300 | 500.100 | 500.100 | 36 |
| same_art_age7/capital-4-baseline | 44 | 327.639 | 399.900 | 450.000 | 466.700 | 466.700 | 35 |
| same_art_age7/woods-1-baseline | 29 | 503.428 | 516.700 | 666.700 | 700.000 | 700.000 | 27 |
| same_art_age7/woods-2-candidate | 28 | 529.739 | 516.700 | 633.400 | 700.000 | 700.000 | 28 |
| same_art_age7/woods-3-candidate | 29 | 509.748 | 533.300 | 650.000 | 666.700 | 666.700 | 27 |
| same_art_age7/woods-4-baseline | 29 | 506.303 | 516.600 | 616.600 | 633.300 | 633.300 | 28 |
| fleet_cycle/fleet-1-source | 185 | 320.888 | 450.000 | 566.600 | 700.000 | 766.600 | 118 |
| woods_phase20/woods-1-baseline | 32 | 444.253 | 500.000 | 633.300 | 716.600 | 716.600 | 28 |
| woods_phase20/woods-2-candidate | 32 | 445.813 | 483.400 | 583.300 | 649.900 | 649.900 | 29 |
| woods_phase20/woods-3-candidate | 30 | 480.533 | 499.900 | 566.700 | 700.000 | 700.000 | 30 |
| woods_phase20/woods-4-baseline | 34 | 414.694 | 483.300 | 583.300 | 600.000 | 600.000 | 28 |

## 逐窗口有限演出脚本成本

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 32 | 0.072 | 0.100 | 0.100 | 0.400 | 0.400 | 0 |
| same_art_age7/fleet-2-candidate | 33 | 0.100 | 0.100 | 0.200 | 0.200 | 0.200 | 0 |
| same_art_age7/fleet-3-candidate | 30 | 0.103 | 0.100 | 0.200 | 0.200 | 0.200 | 0 |
| same_art_age7/fleet-4-baseline | 31 | 0.077 | 0.100 | 0.200 | 0.300 | 0.300 | 0 |
| same_art_age7/capital-1-baseline | 36 | 0.036 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| same_art_age7/capital-2-candidate | 39 | 0.046 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| same_art_age7/capital-3-candidate | 37 | 0.038 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| same_art_age7/capital-4-baseline | 36 | 0.039 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| same_art_age7/woods-1-baseline | 28 | 0.082 | 0.100 | 0.200 | 0.200 | 0.200 | 0 |
| same_art_age7/woods-2-candidate | 29 | 0.117 | 0.100 | 0.200 | 0.700 | 0.700 | 0 |
| same_art_age7/woods-3-candidate | 28 | 0.100 | 0.100 | 0.200 | 0.700 | 0.700 | 0 |
| same_art_age7/woods-4-baseline | 29 | 0.097 | 0.100 | 0.300 | 0.700 | 0.700 | 0 |
| fleet_cycle/fleet-1-source | 118 | 0.121 | 0.100 | 0.200 | 0.400 | 0.600 | 0 |
| woods_phase20/woods-1-baseline | 30 | 0.040 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| woods_phase20/woods-2-candidate | 31 | 0.071 | 0.000 | 0.300 | 0.400 | 0.400 | 0 |
| woods_phase20/woods-3-candidate | 31 | 0.084 | 0.100 | 0.200 | 0.700 | 0.700 | 0 |
| woods_phase20/woods-4-baseline | 29 | 0.069 | 0.100 | 0.200 | 0.200 | 0.200 | 0 |

## 两 A / 两 B 原始样本 pooled

各项 n 独立计数。森林仅拼接 phase20 的四窗；原误配四窗没有进入 pooled。


**paintDrawSubmitMs**

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet/baseline | 63 | 47.506 | 7.700 | 462.400 | 773.900 | 773.900 | 4 |
| same_art_age7/fleet/candidate | 63 | 12.570 | 6.900 | 22.300 | 165.900 | 165.900 | 2 |
| same_art_age7/capital/baseline | 72 | 28.822 | 25.200 | 49.700 | 79.000 | 79.000 | 3 |
| same_art_age7/capital/candidate | 76 | 25.334 | 22.400 | 44.800 | 66.400 | 66.400 | 2 |
| woods_phase20/woods/baseline | 59 | 36.431 | 36.000 | 56.800 | 70.800 | 70.800 | 9 |
| woods_phase20/woods/candidate | 62 | 35.634 | 33.800 | 53.400 | 59.300 | 59.300 | 7 |

**renderSubmitMs**

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet/baseline | 63 | 46.989 | 7.400 | 461.900 | 773.000 | 773.000 | 4 |
| same_art_age7/fleet/candidate | 63 | 12.049 | 6.400 | 21.500 | 165.500 | 165.500 | 2 |
| same_art_age7/capital/baseline | 72 | 28.304 | 24.600 | 49.300 | 78.700 | 78.700 | 3 |
| same_art_age7/capital/candidate | 76 | 25.070 | 22.100 | 44.500 | 65.400 | 65.400 | 2 |
| woods_phase20/woods/baseline | 59 | 36.073 | 35.700 | 56.600 | 70.200 | 70.200 | 8 |
| woods_phase20/woods/candidate | 62 | 35.221 | 33.400 | 53.200 | 58.700 | 58.700 | 6 |

**rafIntervalMs**

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet/baseline | 100 | 286.488 | 416.600 | 516.600 | 733.300 | 766.500 | 61 |
| same_art_age7/fleet/candidate | 93 | 306.975 | 416.600 | 533.400 | 749.900 | 749.900 | 61 |
| same_art_age7/capital/baseline | 87 | 330.447 | 400.000 | 466.700 | 550.000 | 550.000 | 69 |
| same_art_age7/capital/candidate | 116 | 249.272 | 350.000 | 433.300 | 450.000 | 500.100 | 74 |
| woods_phase20/woods/baseline | 66 | 429.026 | 499.900 | 600.000 | 716.600 | 716.600 | 56 |
| woods_phase20/woods/candidate | 62 | 462.613 | 499.900 | 583.300 | 700.000 | 700.000 | 59 |

**scriptMs**

| 窗口 | n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet/baseline | 63 | 0.075 | 0.100 | 0.200 | 0.400 | 0.400 | 0 |
| same_art_age7/fleet/candidate | 63 | 0.102 | 0.100 | 0.200 | 0.200 | 0.200 | 0 |
| same_art_age7/capital/baseline | 72 | 0.038 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| same_art_age7/capital/candidate | 76 | 0.042 | 0.000 | 0.100 | 0.200 | 0.200 | 0 |
| woods_phase20/woods/baseline | 59 | 0.054 | 0.000 | 0.200 | 0.200 | 0.200 | 0 |
| woods_phase20/woods/candidate | 62 | 0.077 | 0.100 | 0.300 | 0.700 | 0.700 | 0 |

## 准备墙钟和准备后初次可见绘制分列

prepare 是 WorldPresentation.prepare 的等待墙钟，包含当前场景的模型/资源与任何预热，不是单独预热函数的自耗时。下表初可见统计按记录的 draw-start 演出年龄 [0,7) 取样，一次绘制本身可能结束在 7 秒之后。旧捕获未直接保存 pageNow/resourceHidden；“可见”依据 main.draw 在 prepareHome/resourcePanel 完成后才开放的 visualsReady 门禁推断。phase20 新记录有直接 resourceHidden=true 标记。初可见的大尖峰不能藏进纯加载成本。

| 窗口 | prepare wall ms | 初可见 draw n | mean | p50 | p95 | p99 | max | >50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 1769.700 | 9 | 261.811 | 8.800 | 1171.200 | 1171.200 | 1171.200 | 3 |
| same_art_age7/fleet-2-candidate | 2016.500 | 15 | 167.847 | 10.200 | 952.000 | 952.000 | 952.000 | 4 |
| same_art_age7/fleet-3-candidate | 2030.300 | 14 | 184.129 | 7.900 | 1057.000 | 1057.000 | 1057.000 | 4 |
| same_art_age7/fleet-4-baseline | 1865.500 | 9 | 259.067 | 10.000 | 1281.100 | 1281.100 | 1281.100 | 3 |
| same_art_age7/capital-1-baseline | 1605.800 | 4 | 1279.950 | 94.500 | 4399.300 | 4399.300 | 4399.300 | 4 |
| same_art_age7/capital-2-candidate | 1821.400 | 6 | 944.983 | 90.900 | 4753.100 | 4753.100 | 4753.100 | 4 |
| same_art_age7/capital-3-candidate | 1854.900 | 8 | 644.400 | 50.400 | 4163.000 | 4163.000 | 4163.000 | 5 |
| same_art_age7/capital-4-baseline | 1646.700 | 3 | 1715.900 | 550.600 | 4525.800 | 4525.800 | 4525.800 | 3 |
| same_art_age7/woods-1-baseline | 1712.900 | 2 | 6709.750 | 631.100 | 12788.400 | 12788.400 | 12788.400 | 2 |
| same_art_age7/woods-2-candidate | 2033.400 | 2 | 5565.100 | 669.100 | 10461.100 | 10461.100 | 10461.100 | 2 |
| same_art_age7/woods-3-candidate | 929.300 | 2 | 6639.100 | 906.500 | 12371.700 | 12371.700 | 12371.700 | 2 |
| same_art_age7/woods-4-baseline | 1743.600 | 2 | 6635.450 | 654.700 | 12616.200 | 12616.200 | 12616.200 | 2 |
| fleet_cycle/fleet-1-source | 1710.400 | 14 | 190.500 | 9.600 | 1133.400 | 1133.400 | 1133.400 | 4 |
| woods_phase20/woods-1-baseline | 1495.400 | 2 | 7209.150 | 753.700 | 13664.600 | 13664.600 | 13664.600 | 2 |
| woods_phase20/woods-2-candidate | 1687.100 | 2 | 6840.850 | 809.100 | 12872.600 | 12872.600 | 12872.600 | 2 |
| woods_phase20/woods-3-candidate | 1554.500 | 2 | 6647.550 | 779.700 | 12515.400 | 12515.400 | 12515.400 | 2 |
| woods_phase20/woods-4-baseline | 1567.600 | 2 | 5292.750 | 587.200 | 9998.300 | 9998.300 | 9998.300 | 2 |

## 尸体卡片存储：优化前后与检查点

下表为 A/B 源在 prepare 结束、正式窗口开始时的 remains 子系统计数，不是窗口结束值。原数据没有保存窗口结束 remains 统计。compressed 已包含在 ownedCPU，不能重复相加；CanvasBacking 是画布字节计数，ownedGPU 是本卡片子系统存储估计，不代表 RSS/总 GPU 内存。

| 窗口/检查点 | prepared/cache entries | compressed bytes | ownedCPU bytes | CanvasBacking bytes | ownedGPU bytes | 可见卡片 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline/prepare-end | 0 | 0 | 0 | 0 | 0 | 0 |
| same_art_age7/fleet-1-baseline/window-start | 2 | 25792 | 321728 | 262144 | 1048572 | 2 |
| same_art_age7/fleet-2-candidate/prepare-end | 12 | 304640 | 437760 | 1310720 | 0 | 0 |
| same_art_age7/fleet-2-candidate/window-start | 12 | 304640 | 699904 | 1310720 | 1048572 | 2 |
| same_art_age7/fleet-3-candidate/prepare-end | 12 | 304640 | 437760 | 1310720 | 0 | 0 |
| same_art_age7/fleet-3-candidate/window-start | 12 | 304640 | 699904 | 1310720 | 1048572 | 2 |
| same_art_age7/fleet-4-baseline/prepare-end | 0 | 0 | 0 | 0 | 0 | 0 |
| same_art_age7/fleet-4-baseline/window-start | 2 | 25792 | 321728 | 262144 | 1048572 | 2 |
| fleet_cycle/fleet-1-source/prepare-end | 12 | 304640 | 437760 | 1310720 | 0 | 0 |
| fleet_cycle/fleet-1-source/window-start | 12 | 304640 | 699904 | 1310720 | 1048572 | 2 |

海战候选准备七具已知未来尸体配方，去重后 12 个密度卡片缓存项；prepare 结束压缩缓存 304,640 bytes、ownedCPU 437,760 bytes、CanvasBacking 1,310,720 bytes，尸体可见卡片/GPU 为零。王城和森林的 prepare-end remains cache entries 均为零，没有预热其他场景的未来尸体。候选海战窗口前约 7 秒，ownedCPU 699,904 / CanvasBacking 1,310,720 / ownedGPU 1,048,572 bytes；A 同检查点为 321,728 / 262,144 / 1,048,572 bytes，不能只报告移走后的帧成本而略去新增存储。

## 浏览器 JS heap 原始变化

heap before/after 不是累计分配量，不作为泄漏证据，也不含原生/GPU 全部存储。

| 窗口 | before used bytes | after used bytes | delta bytes |
| --- | ---: | ---: | ---: |
| same_art_age7/fleet-1-baseline | 47680888 | 58876195 | 11195307 |
| same_art_age7/fleet-2-candidate | 48717581 | 55711396 | 6993815 |
| same_art_age7/fleet-3-candidate | 46999124 | 105948344 | 58949220 |
| same_art_age7/fleet-4-baseline | 48655052 | 59497971 | 10842919 |
| same_art_age7/capital-1-baseline | 66044147 | 72774318 | 6730171 |
| same_art_age7/capital-2-candidate | 86400002 | 64089917 | -22310085 |
| same_art_age7/capital-3-candidate | 100556100 | 105856598 | 5300498 |
| same_art_age7/capital-4-baseline | 63346768 | 95738530 | 32391762 |
| same_art_age7/woods-1-baseline | 62511342 | 76340301 | 13828959 |
| same_art_age7/woods-2-candidate | 63616221 | 96218193 | 32601972 |
| same_art_age7/woods-3-candidate | 67373479 | 85857506 | 18484027 |
| same_art_age7/woods-4-baseline | 65362116 | 127924096 | 62561980 |
| fleet_cycle/fleet-1-source | 46906256 | 78232965 | 31326709 |
| woods_phase20/woods-1-baseline | 72230079 | 69742225 | -2487854 |
| woods_phase20/woods-2-candidate | 62552249 | 78903348 | 16351099 |
| woods_phase20/woods-3-candidate | 133626222 | 91604591 | -42021631 |
| woods_phase20/woods-4-baseline | 135470490 | 124309542 | -11160948 |

## 未解决的可见尖峰与结论边界

森林 phase20 基线首轮在演出年龄 2.289 秒有 **13,664.600 ms** 的绘制提交，resourceHidden=true；它发生在 prepare 完成、画面可见后。对应 prepare wall 为 1,495.400 ms。其他初可见样本与每窗完整列表在 JSON 中保留；原因没有逐层闭合，不能归因为 GC、shader 或调度。

海战候选完整 60 秒原生观察仍含 **age24.2475 / tick484 / 582.200 ms**（与接舷桥开始出现的时点对齐），以及下一循环 **age0 / tick0 / 150.800 ms**。这是时间对应，不是桥 shader/GC 原因证明。该周期脚本计数 118、绘制计数 119，重建循环的首帧脚本没有单独计入，未补造样本。

船队 pooled 两 A 与两 B 都有 63 次绘制，CPU 提交分布改善，但候选仍有 115.800 / 165.900 ms 尖峰，且 pooled 原生 rAF 并未改善。王城只报告该组观察趋势，不把差异归因为海战尸体预热。公平的森林 phase20 平均差异小且两对方向混合，不足以支持通用提速。未给置信/显著性或全程流畅结论。

## 可复现来源

- 分析工具：`/workspace/analyze-homepage-final-native.py`；运行 `python3 /workspace/analyze-homepage-final-native.py` 只重算外部文件。
- 原数据：`/workspace/homepage-pirate-prewarm-abba/`、`/workspace/homepage-pirate-prewarm-fleet-cycle/`、`/workspace/homepage-forest-prewarm-phase20-abba/`。所有 proof/raw 压缩及解压 SHA 已在 JSON 记录。
- 原 ABBA/周期 harness：`verify-startup.mjs`，SHA256 `a1b249c91921b21d18ec21ff16a33754698c9ae4ff8475f740c21e38e9ceb741`。
- 公平森林 harness：`verify-startup-phase-v2.mjs`，SHA256 `838852a01886e8e25a3c7ca168cf0dca8d03a161dc2461b595ed518297d78205`。
- 工具 bootstrap、执行过的源码变换、A/B 全体逐文件 source SHA 和采集前后清单均来自各 proof，完整保存在 JSON；sourceUnchanged 为 true。A/B HEAD 都是 `a13878465d7de94311476c7c591b18fc3a39bcc4`，候选以未提交字节区别，不能只凭 HEAD 判为同源。
- 本分析没有改写任何 raw、生产源码或 HEAD；不运行新增测试/浏览器，不归档全目录。最终 manifest 与 PR 由 root 闭合。
