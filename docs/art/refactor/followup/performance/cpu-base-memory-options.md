# CPU 基图存储的后续只读调查

2026-10-11；仅检查本地官方 Three 0.186.1 与当前生产代码。无生产修改、无 GL、无新增性能测试。不要将本方案并入正在验收的 dirty-mip 阶段。

## 公开 allocation-only API 确实存在

本地类名是 `TextureSource`，不是旧文档中的 Source：

- `node_modules/three/src/textures/TextureSource.js:56–64` 及对应 `@types/three/src/textures/TextureSource.d.ts:44–51` 明确公开 `dataReady: boolean`：false 时允许分配但不传数据。
- `DataArrayTexture` 构造及类型声明接受 `data=null`，image 保留 width/height/depth；不需要占满页面的 TypedArray 或类型欺骗。
- `WebGLTextures.js:949–952` 区分 allocateMemory 和 dataReady；`:1168–1204` 在 dataReady 判断之前 texStorage3D 分配，只有 dataReady=true 才读 image.data/subarray 和 texSubImage3D。
- 完整 `texture.mipmaps.length` 仍决定分配级数。`generateMipmaps=false` 必须保持，因为末尾 generateMipmap 检查与 dataReady 无关。
- allocation-only 会推进 source/texture 的已处理版本，不是“等待下一帧自动补齐”。以后若转回CPU数据上传必须显式准备数据并needsUpdate；GPU-copy-only目标则可一直dataReady=false。

因此静态可行的公开配置是：DataArrayTexture(null,W,H,D)，设置当前sRGB/过滤/anisotropy、完整mip描述、generateMipmaps=false、source.dataReady=false、needsUpdate=true、renderer.initTexture。随后用已验证scratch GPU mip路径填充所有被实例引用的层。没有 renderer properties 或私有 GL texture句柄。

这部分尚未实机验证；之前的scratch proof保留完整CPU array并有初始基图上传，不能用它直接宣称null/dataReady=false已经通过。空闲层不应被实例引用，首次上传所有已占用层完成前不得发布 draw；不可把allocation成功当作内容准备完成。

## 保留什么拾取数据

当前 `PaintedCardBatches.hit()` 精确定义为：同一UV边界处理、同一floor/min映射到源level0 texel，检查alpha>=102；不读取RGB、不进行双线性或mip采样。它没有按实例opacity调整阈值。本阶段只保留既有语义，不借优化修改拾取规则。

两种无损替代相对于**现有CPU拾取判定**：

- 每已占用card一份alpha byte：原RGBA存储的1/4，最直观，也保留未来阈值变化信息。
- 每已占用card一份bitset（alpha>=102）：原RGBA存储的1/32；保留完全相同的阈值判定，但不能用于未来可变alpha阈值、平滑采样或导出原alpha。

mask必须在原栅格化结果/相同翻转行序中提取，绑定card而不是页面layer，可随compaction移动同一个mask对象；不能复制未使用16层的整页mask。policy.pickable=false的纯表现页可不存mask。位索引、UV=0/1边界和outside语义需逐像素/边界测试。画面仍使用完整GPU RGBA+mip，不能拿mask代替渲染alpha。

若当前CPU RGBA页面为1GiB且全占用，理论alpha为256MiB，bitset为32MiB；实际按occupied texels计可能更少。**这只是CPU ArrayBuffer账目，不是进程RSS保证**：GPU完整纹理链仍约1.333GiB（近方图），SwiftShader在主机内存中持有GPU存储；还包括Canvas、驱动暂存、scratch、JS对象与未回收的旧buffers。需要同环境实测才能宣称总内存下降比例。

## 临时RGBA不能悄悄变成另一个全缓存

raster输出一次RGBA仍需要，scratch上传也需要CPU源。可以使用有界canvas/scratch池并在上传后立即释放/复用；但当前finish先栅格化全部pending，upload后执行。若移除page base却为每个pending card保存完整RGBA直至upload，一帧大量缺页仍可能接近原峰值。

可选组织是upload阶段按card栅格化→提取mask→上传scratch→复制所有mip→释放临时RGBA，保留紧凑绘制描述而不是全部图像。finish中的几何/实例准备与拾取可用性要明确顺序；所有可见card准备好后才draw，不能通过延迟漏画降低峰值。若仍先finish栅格化，则必须公开量化临时dirty像素峰值，不能把它排除出“CPU内存”。

不要长期缓存现有paint闭包：world-layer传给cards.add的回调闭包引用unit、snapshot等，可能保留整帧对象树，比mask节省抵消更多。当前Card本就没有保留paint，不能认为恢复时已有可重放闭包。

## Context restore：接受冷缓存，但不能丢可见内容

无RGBA基图就无法直接重上传原cache。合理候选是contextlost时释放旧Texture wrappers、清空所有card/page缓存（包括warm mask引用），恢复后下一完整frame按正常keys和当前确定性绘制输入重建所有可见card。旧warm缓存可放弃；不能保留命中key却没有GPU内容的“假热缓存”。

恢复行为的代价从“原CPUbuffer重上传”变为“重新绘制全部可见+生成完整mips”，可能造成更大恢复帧卡顿。需量化它，不能声称无成本。清理页面/材质/mesh映射及selection/picking引用之后再从同一当前快照生成，全部可见准备完才重新呈现；没有授权降低分辨率或分帧省略可见单位。

若产品要求保存恢复前所有warm pose，可保留紧凑纯数据paint recipe；这是额外设计，不应通过保存捕获snapshot的闭包绕过。本阶段优先清缓存路径，保持普通运行画面不变。

## Fragment compaction 必须重新设计

当前compact在finish中，通过旧page.image.data把所有active card复制到新页，然后remove旧页；在GPU upload之前运行。移除CPUbase后这条路径失效，不能只改纹理构造。

候选A：公开GPU layer copy。

1. 先确保源页的所有相关dirty card已完成scratch upload；新栅格化但尚未上传的源不能被搬迁。
2. 对目标页allocation-only分配完整mip链。
3. 每card每level：copyTextureToTexture(sourceDataArray,targetDataArray, Box3((0,0,oldLayer),(mipW,mipH,oldLayer+1)), Vector3(0,0,newLayer), level,level)。数组层数不随level缩小。
4. xy仅用完整级别、零偏移；当前Three blit坐标实现不宜直接泛化任意子矩形。源/目标是不同Texture避免反馈；两者都先公开initTexture。
5. 全部copy提交后再更新实例映射/释放旧页，恢复原render target/cube face/mip。GPU队列顺序用于copy后draw，正常运行不增加readback/fence；实际证明由独立测试做。

代价：每被搬card×完整级数copy/FBO切换；compaction期间GPU同时保留新旧页造成峰值。alpha mask可随card转移，不需RGBA复制或重算mip。需要把当前纯CPU compact拆成准备/执行/提交阶段，而不是在CPU finish内偷偷调用GL。

候选B：删除分散缓存，直接用本帧当前绘制请求在紧凑新页重栅格化。实现较简单但增加CPUpaint与GPU mip；当前warm hits不会保留请求，必须在本帧短暂保留有界recipe/回调，不能重用已变化的单位对象作历史pose。无论A/B都沿用当前“严重碎片才整理”的触发标准，不能偷偷减少存活可见内容。

仅停止compaction可能把CPU省下的内存转移为大量稀疏GPU页和更多draw，不建议作为默认逃避方案。

## 后续最小证明顺序（本次未执行）

1. 在隔离scratch proof将候选数组改为null + dataReady=false；记录首次CPU数组字节与上传字节，所有LOD/16层/1、4、16dirty/非2次幂继续零差，无GL错误，正常销毁。
2. alpha byte/bitset逐texel等同原>=102，加UV边界、上下翻转、透明边、重复layer reuse和pickable=false测试。
3. GPU compaction复制已初始化页的非零源/目标层，所有整数/分数LOD零差；添加刚生成但未上传的dirty源，证明顺序；影子/非默认render target状态恢复。
4. contextlost清缓存重绘：同确定快照前后截图/picking一致，生命周期无错误，记录冷恢复CPU/GPU完成时间、Canvas/临时RGBA峰值。
5. 真场景同工作量冷/热/动画/大量死亡碎片：CPU retained/peak ArrayBuffer、JS retained closure、GPU估算、进程RSS、scratch数量、draw与fence分布；不能用理论4倍/32倍直接称总内存改进。

结论：公开allocation-only API在源码与TypeScript均有明确支持，是合理的下一阶段CPU内存候选；真正工作量在临时RGBA生命周期、恢复、compaction的正确重组。它不应打断当前单层mip收益的独立验收。
