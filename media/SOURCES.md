# 首批音画来源 / 2026-09-13

## 原创音效

`sources/synthesize.mjs` 是全部五个声音的完整合成源代码，没有采样录音、第三方乐曲或人声。制作：本项目 Codex 会话，用户委托原创。源代码与合成输出按 CC0-1.0 提供（在法律允许范围内放弃著作权及相关权利；无担保）。不包含第三方素材许可。

44.1kHz 单声道，6ms 起音、40ms 收尾；原始峰值 -17.4 至 -11.3dBFS，不做响度竞争。最终格式为96kbps MP3；使用制作阶段的 LAME（lameenc 1.8.1，临时目录安装）离线编码，无编码器代码进入游戏、package或锁文件。脚本依次为 synthesize.mjs、encode-audio.py。首版 AAC 在测试 Chromium 中无法解码，已替换，不交付。运行脚本可重新生成：落季木音、翻卷纸声、战局短鼓、登位钟音、死亡/亡国低钟。不是考据性的历史乐器录音。

## 生成式装饰图

使用当前 Codex 提供的 OpenAI image_gen 工具，在本地会话为用户生成；无上传参考图、无外部采样、无第三方品牌/人物/文字。输出是委托生成素材，不冒称公共领域照片或历史文物，不保证独占性。用户可按适用 OpenAI 服务条款使用输出；不存在待购素材或待确认第三方授权。

- `river-margin.webp`：原输出 `exec-c864bf7b-a619-44d6-8567-15da4fb86332.png`，原图 1536×1024，缩至768×512。
- `river-seal.webp`：原输出 `exec-0b17835d-78a0-4953-9d39-5ea6e8635a08.png`，缩至160×160；抽象山河印纹，不代表某人的官职、功勋或王权。
- 原图保留于 `/Users/mutu/.codex/generated_images/01a03407-36c0-73f0-9ddf-218d4d7c83fa/`；交付资产在 public，编码脚本 `sources/encode-images.mjs`。原始生成图不进入网页加载。
- 山水提示：宽3:2，淡墨山脊与河岸芦苇，暖白纸，右下角干笔，左侧与上半大面积留白，一点淡朱砂；无文字、人物、建筑、边框、界面或水印。
- 印纹提示：方形暖白纸，朱砂石印质感，山河抽象轮廓与不规则磨损，留白，双色，无可读篆字、龙凤、王权符号、阴影或界面。

两图只做缩放与 WebP 编码（quality .8），不用于权威地图，不冒充具体地区或历史人物。

## 衡印站点图标 / 2026-09-14

沿用既有 TopBar 的“衡”字朱砂印，不重新设计游戏品牌或改变界面。色值取自 observer-ui.css：朱砂 `#9c352b`、米白 `#f4ead4`。`public/favicon.svg` 是可编辑的自包含矢量原稿：方印、细边框与已转轮廓的单字；没有外部字体、CSS、图片请求或脚本，不依赖系统汉字字体。

字形来自 [Noto Serif CJK SC Black 2.003](https://github.com/notofonts/noto-cjk/blob/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Black.otf)，字体copyright为©2017–2024 Adobe；依据上游[SIL OFL 1.1](https://github.com/notofonts/noto-cjk/blob/main/Serif/LICENSE)使用，授权副本见 `sources/NotoSerifCJK-OFL.txt`。这是排版后的字形标识，不是手写书法或真实古印，也不冒称整个字形由本项目原创。

制作时使用临时fontTools 4.60.2提取U+8861的SVGPathPen轮廓，字形bounds=(8,-95,992,856)，在64×64画布以translate(8,50.25)、scale(.048,-.048)居中；字体和临时工具仅留在被忽略的output目录，均不进入浏览器产物和项目依赖。

`sources/render-favicon.mjs` 从原稿离线生成 `public/favicon.ico`（16/32/48三帧PNG编码）与 `public/apple-touch-icon.png`（180×180）。调用既有本机sharp工具，不修改package依赖：`node media/sources/render-favicon.mjs /absolute/path/to/sharp/module`。未来修改SVG后需重生另两文件，再跑媒体/图标测试与双平台四组构建；不得只手改某一发布目录。

三格式均登记为initial image，保守地一起计入原媒体预算；实际浏览器通常只请求其中一个favicon，手机收藏可能另请求touch图。没有新增manifest、Service Worker或PWA功能。
