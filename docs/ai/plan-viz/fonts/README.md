# 样稿离线字体

Noto CJK 的 Sans / Serif 仅裁出本样稿使用的文字，WOFF2 内保留原版权及许可元数据。Cinzel 复制自项目已有字体。字体许可分别见 `OFL-Noto.txt`、`OFL-Cinzel.txt`。

来源（2026-10-20 获取）：

- [NotoSansCJKsc-Regular.otf](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf)
  - © 2014-2021 Adobe (http://www.adobe.com/).
  - Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603
  - 源文件 SHA256：`2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`
- [NotoSerifCJKsc-Regular.otf](https://github.com/notofonts/noto-cjk/blob/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf)
  - © 2017-2024 Adobe (http://www.adobe.com/).
  - Version 2.003;hotconv 1.1.1;makeotfexe 2.6.0
  - 源文件 SHA256：`2a2eae2628df83556c54018c41e20fa532c1b862c5256ae8b3f23feb918d12ca`

子集生成使用 fontTools：

```sh
pyftsubset <源 OTF> --text-file=<三个 HTML、viewer.js、sample-data.js 的文字并集> \
  --output-file=<plan-sans.woff2 或 plan-serif.woff2> --flavor=woff2 \
  --name-IDs='*' --name-languages='*' --name-legacy --no-hinting
```

这些字体文件只属于离线样稿，没有加入游戏构建。
