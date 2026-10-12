# 脏层 GPU scratch mip 实验（准备阶段）

初版只完成语法检查；随后在 root 协调的独占窗口运行了冒烟及完整矩阵。实际成功/失败证据和限制见 [scratch-mip-results.md](scratch-mip-results.md)。以下保留实验设计。

## 范围与路径

独立 Vite 临时页面 + Chromium SwiftShader，直接使用当前官方 Three 0.186.1；无游戏/生产源码 import，无 node_modules 修改，无 renderer properties/私有纹理句柄访问。原型及runner均仅位于本目录：`scratch-mip-fixture.js`、`scratch-mip-proof.mjs`。

- 原路径：16层 DataArrayTexture，dirty level0 通过 addLayerUpdate + initTexture 上传，正常 generateMipmaps=true 生成整个数组链。
- 候选：数组 generateMipmaps=false；公共 mipmaps 级数描述触发完整 texStorage 分配；initTexture 初始上传完整level0，再逐层生成/复制全部mip，填满之前不呈现。scratch 是复用的单层 DataTexture，配置完全相同 sRGB、RGBA/UnsignedByte、min/mag filter、anisotropy、flipY=false、premultiplyAlpha=false。
- 每脏层把CPU基图复制进scratch，needsUpdate + renderer.initTexture 正常生成其GPU mip。随后 renderer.copyTextureToTexture 以明确 srcLevel/dstLevel、完整该级Box3、目标Vector3(0,0,layer)逐级复制。不执行自写CPU颜色平均。
- 目标数组始终保留完整CPU基图，仍可直接用同一数据作picking；本原型不改游戏拾取逻辑。CPU基图内存两条路径分别记录，不将CPU永久mip缓存引入生产。
- 上下文恢复后不能依赖GPU-copy结果自动恢复；保留CPU基图、重新init数组并重建所有层/所有级别，完成后才能发布。原型含forceContextLoss/Restore、CPU基图保持及重建后全LOD校验。

## 质量对照

默认尺寸512、640、320、256，均16层。640/320覆盖非二次幂链。固定源包含sRGB颜色梯度、饱和/暗色、透明彩色边、渐变alpha、细小不透明线；各层有不同颜色。两条路径内容完全相同。

初次全层完成、dirty=1/4/16各更新后，逐一比较所有整数LOD及0.5/2.5分数LOD、全部16层的真实textureLod采样RGBA：raw shader显式把采样后的linear RGB再编码为sRGB，写RGBA8 render target读回。不把这称为原始GPU存储字节读取。另有独立mask pass在采样alpha上执行step(.4,alpha)，检查真实阈值覆盖，避免先量化alpha再推算阈值。

记录max/mean channel difference、不同像素数、每层差异及alpha阈值覆盖差。准备阶段采用严格零差门限；失败将保留报告，不擅自改阈值或忽略颜色/坐标问题。该微实验不替代游戏相机斜视、深度/阴影、动作及全战场图像验收。

## 完成时间

每尺寸、1/4/16脏层，双方各预热1次，默认配对3轮，轮次交替先后顺序。每次测量之前独立fence drain；范围内包含initTexture（候选也包含scratch staging memcpy）与所有copy提交，再通过真实 fenceSync + flush + clientWaitSync轮询到完成。分别记录CPU submission、fence tail、完整墙钟及poll次数；不在计时窗口做render/readback。CPU生成样图/更新两套CPU基图在计时范围外，明确不能把此数值当游戏整帧。

异步轮询有浏览器定时器量化/调度误差，这不是GPU timer query纯执行时间；结果需原始分布配对评估，不能从亚毫秒差作结论。最大数组640的CPU基图单份约25MiB，实验同时保留对照/候选两份；尺寸按序销毁，另加单层scratch及临时质量读回。

## 授权窗口内运行

先最小冒烟，遇到GL错误或像素差先定位，不直接跑大样本掩盖问题：

```sh
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --query 'sizes=256&repeats=1' --out docs/art/refactor/followup/performance/scratch-mip-smoke.json
```

通过后四尺寸默认矩阵：

```sh
node docs/art/refactor/followup/performance/scratch-mip-proof.mjs --out docs/art/refactor/followup/performance/scratch-mip-result.json
```

输出包括commit、fixture hash、浏览器/GPU、配置、逐LOD/层质量与每轮原始fence数据。异常也写failed报告；finally关闭Chromium/Vite并删除临时profile。此文档记录方法；实际运行结论以独立结果文档和原始JSON为准。
