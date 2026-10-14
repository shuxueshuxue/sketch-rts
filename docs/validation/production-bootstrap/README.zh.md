# 生产首页启动修复

PR #373/#374/#375 已合并，正式服务端回执与发布包均对应 61f6ded5。公网页面及全部代码资源 HTTP200、字节匹配发布包，但真实 Chromium 仍停在 Loading Interface：model-manifest 的顶层 SHIP_KINDS.map 读取未初始化的 main 导出。这是生产实现失败，不能以 API 健康检查、构建或无 console error 宣称客户端正常。

新增海盗场景静态引用 world3d/projection 的纯公式，Vite manual chunk 因而形成 main → world3d → model-manifest → main。修复将同一 projectWorld 公式和 WorldView 类型移到轻量模块；GPU 投影重导同一实现，配置相机与射线逻辑没有改变。规则3、场景角色/事件、模拟与 AI 均保持原样。

生产构建末尾新增真实产物依赖审计：界面初始化不得静态提前加载 GPU chunk，动态加载允许。实际坏发布包审计 exit1，修复包 exit0，五项审计测试通过；34 项相关画面测试、最终严格类型检查和完整七项 SDK 边界检查通过。

独立本地 HTTP 服务加载原生正式 production dist，未改写 JS/时钟；catalog 为已验证公网 HTTP200 的6304字节只读镜像。三个场景均经完整 HTML 入口进入首页、显示真实 WebGL2 和菜单，静态资源逐字匹配修复包，无原启动异常/console error/context loss。41 项启动、资源归属、菜单及 GL 检查通过，九张 GPU-fenced 截图已实际审图。舰夺旗在自然48.823秒截图，王城酒馆街景与林间正规军对野怪均可见。

**综合自动验收仍为 false**，完整71项原记录没有修改：八项严格≤2秒截图相位窗口晚到，另外两场景有 canceled:true Fetch。取消原因尚未闭合，不能假定无害，也没有降低断言或扩宽容差。上述41项独立结论仅证明原生产启动阻塞被修复，不宣称完整画面相位/性能验收通过。

首次公开浏览器先遇环境 TLS 信任错误：既有受信代理根与 curl/OpenSSL 一致，Chromium NSS_InitReadWrite 被沙箱只读阻止。只给既有 NSS 目录正常访问权限，没有导入证书、改变 trust、改 HOME 或忽略 TLS；前后库存相同。该尝试与随后真实生产异常分别保存。本地最初静态 host 的 Node 直连外站失败也保存，没有将其记为应用失败。

manifest.json 对80份原始文件记录 payload/stored bytes 与 SHA256；文本原字节无损 gzip，PNG/原 tar.gz 保留原字节。包含发布回执、原坏包、TLS与生产失败、失败截图、实际修复包浏览器证据、原综合失败与独立启动结论及全部检查日志。归档不改写 PR #373 的规则2性能证据；新规则3完整基线也保留各自来源，后续优化尚无收益声明。

归档首次触发既有文件命名边界：NSS调查文件的历史称谓出现在存储文件名与原路径字段。仅修改归档存储名，原路径采用可逆base64，原payload不变；失败日志保留，原七项断言不变，修正后再次通过。
