# Three 0.186.1：完整 mip 链与 dirty-layer 更新的只读调查

2026-10-11；以本地 `node_modules/three` 0.186.1 与 `@types/three` 为准。未修改生产、依赖或 renderer 私有状态，未运行 GL、截图或性能试验。以下是实现可行性，不是性能收益或画质等价结论；只有后续诊断确认 mip 为主因才值得实施。

## 当前行为与源码证据

当前 `src/client/world3d/painted-card-batches.ts:48` 使用 16 层 DataArrayTexture、SRGBColorSpace、LinearMipmapLinearFilter、完整尺寸及当前 anisotropy，设置 generateMipmaps=true。新增/改写图层后传输 dirty layers 的 level 0。

本地 Three 相关位置：

- `src/renderers/webgl/WebGLTextures.js:294`：getMipLevels 优先用 generateMipmaps 推算完整链，否则采用 texture.mipmaps.length。
- 同文件 `:1168–1210`：DataArrayTexture 分支只上传 level 0；layerUpdates 能限制上传层。**显式 mipmaps 数据没有在此遍历上传**。设置 mipmaps 只影响分配，不会自动上传这些级别。
- 同文件 `:1389`：上传完成后，generateMipmaps=true 就调用 GL generateMipmap(textureType)。它没有 dirty-layer 参数，因此层级上传局部化不等于 mip 生成局部化。
- 同文件 `:1034–1108`：CompressedArrayTexture 逐级遍历 mipmaps。format≠RGBAFormat 的压缩路径支持按 layerUpdates 子集上传；**RGBAFormat 分支对每个 mip 上传整个 image.depth，忽略 layerUpdates**，最后仍会清空更新集合。
- 同文件 `:230–234`：RGBA + UnsignedByte + sRGB transfer 选择 SRGB8_ALPHA8。不能把输入字节的平均与采样空间中的平均混为一谈。
- `src/renderers/WebGLRenderer.js:3336–3568`：公开 copyTextureToTexture 支持 dstLevel、Vector3 destination、DataArrayTexture，CPU DataTexture→数组目标走 texSubImage3D。目标 level 0 仅当 generateMipmaps=true 才自动生成。

DataArrayTexture 的 addLayerUpdate 注释提到“all mipmaps”，但当前实现对 DataArray 的上传事实上只有 level 0，应以实际分支为准。

## 可选路径

| 路径 | 完整尺寸、完整 mip、原 minFilter 可保留 | 更新范围 | 主要代价与限制 |
| --- | --- | --- | --- |
| 原 DataArray + GPU generateMipmap | 是 | level 0 按 dirty layer；生成作用于整个数组 | 现有基准，不先断言生成是瓶颈 |
| CompressedArrayTexture + 未压缩 RGBA mip 链 | 是，运行时有明确支持分支 | 每个 dirty page 的每级全16层上传 | CPU生成/存储链、整页带宽；本地类型声明不接受RGBA |
| DataArray + CPU链 + public copyTextureToTexture | 是，需显式分配并填满所有级别 | 每个 dirty layer 的每一级 | CPU重采样、约层基图4/3的传输量、dirty×级数的API调用；初始化契约需GL验证 |
| 单层2D scratch GPU生成 + public GPU copy逐级至数组 | 是，潜在保持同驱动GPU mip生成 | scratch单层生成；仅复制dirty layer各级 | 额外纹理、FBO绑定、逐级copy/blit，可能抵消收益；sRGB和数组/2D结果须验证 |
| 真正压缩 CompressedArrayTexture | 理论支持每级dirty层 | 每级dirty层 | 动态压缩编码、扩展覆盖、压缩误差；不属于无损等价替代 |
| 单层/更小页的独立纹理 | 是 | mip工作粒度降低 | 更多batch、材质和draw；可能放大已观察到的draw负担，不可只看generate次数 |

### RGBA CompressedArrayTexture：真实支持，但非现成最优方案

`textures/CompressedArrayTexture.js` 构造接受 mipmaps（包含 level 0）、width、height、固定 depth、format、type；父类默认 format=RGBAFormat、type=UnsignedByteType、generateMipmaps=false、flipY=false。每级 data 必须含所有层，层维度不随 mip 缩减：

```text
level dimensions = max(1, floor(W / 2^level)), max(1, floor(H / 2^level))
level bytes = levelWidth * levelHeight * depth * 4
levels = floor(log2(max(W,H))) + 1
```

保持色彩空间、各向异性、过滤、方向和 alpha 策略；每次 dirty 改 CPU 对应层的完整链，再 needsUpdate，会把该页所有层所有级别传输。这避免 GPU generate，但不是局部上传优化。

本地 `@types/three/src/textures/CompressedArrayTexture.d.ts` 要求第五参数 CompressedPixelFormat（不可省略）；父类 CompressedTexture.format 也收窄为 CompressedPixelFormat。运行时与声明不一致，直接传 RGBAFormat 不通过类型检查。若实验采用此分支，需在单个带版本/来源说明的构造适配器中显式桥接声明，或上游修正类型；不能泛滥 any、改 node_modules 或伪造 isCompressedTexture/isDataArrayTexture 标记。此处没有为生产推荐一个尚未验证的类型断言。

此外 copyTextureToTexture 的 isDst3D 判断仅含 DataArrayTexture/Data3DTexture，**不含 CompressedArrayTexture**，尽管 earlier binding 分支支持后者。不能把其RGBA全页路径和public局部copy简单拼接而认为有效。压缩源还取 mipmaps[dstLevel]；本项目若走copy候选应避免这种源/目标混搭。

### 用公开 copy API 局部上传 CPU mip

可调查的最小路线是保留 DataArrayTexture 目标与 CPU level-0 picking 数据，generateMipmaps=false，初始化时给出完整 mipmaps 级数描述，让现有 getMipLevels/texStorage3D 分配完整链。注意：这只是分配，首次呈现前必须显式填完全部级别及可访问层，不能依赖被忽略的 mipmaps.data。

对每个 dirty layer、每个 level，准备尺寸恰为该级大小的 DataTexture（RGBA8数据，尚未作为渲染纹理初始化），调用公开：

```text
renderer.copyTextureToTexture(
  perLevelDataTexture, arrayTexture,
  Box3((0,0,0), (levelWidth,levelHeight,1)),
  Vector3(0,0,layer), 0, level
)
```

这走CPU texSubImage3D，目标 generateMipmaps=false，不额外触发整页生成。不要将源 DataTexture 先 initTexture 或用于draw，否则源码会转入 GPU-copy 分支；可以保留只作CPU上传源的少量对象/typed-array视图池。不要在每次copy后再给目标 needsUpdate，以免额外重传 level 0。初始化可用公开 initTexture，后续变化由copy负责。

这是依据当前公开 API 组合出的候选，需要专门测试分配完整性、dirty一层不污染其他层、上下文恢复、首次加载、eviction/reuse、深度/阴影 pass 与 picking 一致性。mipmaps 元数据只用于分配的语义需做版本锁定的回归测试；不能宣称Three已原生支持DataArray的自定义mip数据上传。

### 保持 GPU mip 生成，仅在 scratch 中处理脏层

另一个候选是池化与页面尺寸一致的普通 2D DataTexture，upload dirty层level0并使用正常 generateMipmaps=true。用公开 initTexture 完成该层链，再用 copyTextureToTexture 将GPU源各 srcLevel 复制至 DataArray 的指定层/对应 dstLevel（后者仍generateMipmaps=false）。源码对GPU源和DataArray目标使用framebufferTextureLayer及copy/blit，应用不需访问私有 WebGLTexture。

至少每脏层一次 scratch 上传/生成，外加完整级数的copy调用。页面256时9级，每脏层9次copy；很多脏层时未必胜过一次整页生成。当前实现blit的坐标写法要求实验先使用零xy偏移、每层全级区域，不推广为任意子矩形copy工具。scratch初始化后的反复needsUpdate/initTexture、复制次序、源与目标internalFormat/色彩空间一致、2D与array mip结果仍需真实GL验证。它是减少CPU自写色彩滤波不确定性的候选，不是质量等价证明。

## 质量验证不能省略

CPU“sRGB box mip”这个说法不足以定义算法。必须明确是对编码后的sRGB字节取均值，还是先decode至linear、滤波后encode；必须明确直通alpha还是预乘alpha滤波、透明像素RGB、边界、奇数/非方尺寸、逐级舍入与低alpha量化。现有 Canvas getImageData、垂直翻转、透明留边和 alphaTest=.4 都会影响结果。

不预设 gl.generateMipmap 与任一 CPU box 算法逐字节或逐采样等同。需要在原实现和候选之间比较：

1. 每个 mip 级别的真实采样/渲染读回（GPU时间测量时不得混入readback）。覆盖透明彩边、单像素金属细节、纯色、渐变、暗色与饱和色、裁切边界、非方页及极小级别。
2. 原相机远近、分数LOD过渡、斜视/anisotropy、所有朝向、动作、高密战场下的最终颜色/轮廓、alphaTest覆盖率、阴影及深度遮挡。保留相同分辨率、可见内容与过滤参数。
3. 浏览器/目标GPU上的结果，区分当前SwiftShader环境与实际硬件；至少报告最大/平均像素差、差异位置、覆盖率及肉眼审查，不仅“看起来差不多”。
4. dirty单层更新应与全页旧路径输出一致，未更新层保持不变；cold/warm/cache eviction及context restore均正确。

## 存储和传输账目

令 B=4*W*H 为一层基图字节，D=16，K为本帧该页脏层数，S=sum_l(4*W_l*H_l) 为一层完整链字节。

- 当前：CPU约D*B（还承担picking）；GPU约D*S；dirty上传K*B，随后整数组generate操作。GPU真正处理成本需计量，不能只按texel数换算毫秒。
- RGBA CompressedArray：CPU D*S（若保留独立基图/额外scratch则更多），GPU D*S，每次dirty page上传D*S；CPU只需重算K层但上传仍16层。
- CPU链+public copy：CPU可为D*B加复用单层链scratch，也可缓存D*S；GPU D*S，上传K*S，调用约K*levels。
- GPU scratch：CPU D*B加必要复用源，GPU D*S加一个scratch S；CPU→GPU K*B，GPU内复制K*S，并支付K次mip生成与每级copy/FBO成本。

256×256×16 RGBA：基图4MiB，完整链5,592,384字节（约5.333MiB），单层基图256KiB、完整链349,524字节（约341.33KiB）。只脏1层时RGBA全页链上传约为当前基图上传的21.33倍，不能把“避免generate”直接等同省带宽。二维近方形完整链约增加1/3存储；非常细长的页不是这个比例，应使用精确sum，不能一概按4/3预算。

建议先等待upload/generate/draw诊断结果，再选最小候选做隔离GL正确性与同环境性能AB。所有结论当前限于源码路径和精确字节账目，没有声称性能或质量提升。
