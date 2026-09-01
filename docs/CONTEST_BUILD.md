# 参赛地图构建说明

日常个人版默认打包两张固定地图。参赛版使用独立内容白名单，只从 `catalog.contest.ts` 引入 `contest-v01@1`“云海八荒”。

```bash
npm run build:contest
```

产物写入 `dist-contest/`。该命令会：

1. 校验产品版本与发布记录。
2. 使用 `tsconfig.contest.json` 执行严格 TypeScript 检查，生产依赖只解析公开 catalog 与公开更新记录。
3. 只校验白名单中的地图契约。
4. 通过 Vite 内容边界隔离 catalog，并在 Rollup 模块图中拒绝私人地图、完整个人 catalog 或个人版更新记录；只把参赛 profile 作为转义后的 `application/json` 数据注入 HTML，不把 profile payload 编入浏览器 JavaScript。
5. 生成 `contest-profile.json`，核对产品版本、唯一 allowlist、profile 修订和内容版本。
6. 解析 HTML 地图载荷并核对它只有 `contest-v01@1`，同时确认公开 profile 关键字未残留在 JavaScript；再从私人内容包自动派生 328 项专属名称和 ID，扫描最终 HTML/JS/CSS/JSON，任一命中都会让构建失败。

`npm run test:audit:maps` 对两张正式地图分别执行多种子 80 季确定性、存读档、守恒、战争、贸易、Situation 与海洋活动审计；`npm run test:e2e:maps` 在桌面、390×844 与 640×900 三种视口上分别跑两张图的完整开局、点选、推进、保存和恢复链，移动场景使用真实触控上下文。`npm run test:e2e:contest` 直接启动 `dist-contest/`，验证它只列出参赛地图，并用一份私人地图 autosave 检查“缺图提示 → 原载荷不变 → 开新纪前自动留底 → 参赛世界正常续写”。

## 源码提交边界

当前门禁保证的是 `dist-contest/` 二进制产物，不会改写 Git 历史，也不表示这个个人仓库可直接作为公开源码提交。产物发布前应执行：

```bash
npm run build:contest
npm run test:e2e:contest
```

若赛事要求提交完整源码或审查仓库历史，需要另建无历史的公开导出仓库，并提供不依赖私人内容包的独立扫描清单；这项工作记录为 `MAP05.5`，应在明确赛事规则后实施。完成它之前，不应只删除 `private-v03` 目录后声称源码已经可复现，也不能把“界面上看不到”当作“源码中不存在”。
