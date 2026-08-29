# 视觉与声音资源记录

本文件记录会随游戏发布的非代码视听资源。未经明确记录的第三方图片、音乐或音效不得进入生产构建。

## `src/assets/settings-mountains-v1.jpg`

- 用途：游戏内“设置”卷页顶部气氛题图。
- 创建日期：2026-08-29。
- 创建方式：OpenAI 内置图像生成工具，文字生成图片；未使用参考图、真实地图边界、人物肖像或第三方素材。
- 发布处理：原始生成图缩放并转为 1400×700 JPEG；无文字、标志、水印或可识别现实地理。
- 最终提示词：`Wide horizontal original low-contrast Chinese ink-wash landscape for a refined historical simulation game's settings drawer masthead. Distant layered mountains dissolving into mist, calm water, a tiny pavilion and a few small birds, warm xuan-paper texture, muted mineral blue-green and ink-gray palette with one extremely subtle cinnabar sun accent. Elegant literati painting, quiet atmospheric depth, restrained detail concentrated toward the right side while the left and center remain calm enough for overlaid interface text. No text, no calligraphy, no logo, no UI controls, no map borders, no watermark, no photorealism. 2:1 aspect ratio, seamless full-bleed header composition.`

## 程序化声音

- `src/audio/audio-manager.ts` 中的陆地、海洋、紧张声景及操作提示均由 Web Audio 节点在本地程序化合成。
- 噪声缓冲使用模块私有的固定算法生成；不读取第三方录音，不联网加载音频，也不调用世界 RNG。
- 当前生产包不包含第三方音乐、采样包或外部音效文件。
