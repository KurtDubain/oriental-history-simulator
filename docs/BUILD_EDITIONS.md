# 双版本构建与部署交接

同仓库、同 `main`、同代码根目录，两套内容产物；**不需要竞赛分支**。
`personal / contest` 是内容版别，Vercel 的 `Production / Preview` 是部署环境，两者独立。

| 版别 | 内容 | 构建 | 本地生产预览 | 输出 |
| --- | --- | --- | --- | --- |
| personal（个人版） | 心中山河、云海八荒 | `npm run build:personal`（或原 `npm run build`） | `npm run preview:personal`，默认 4173 | `dist` |
| contest（竞赛版） | 仅云海八荒 | `npm run build:contest` | `npm run preview:contest`，默认 4174 | `dist-contest` |

先 `npm ci`。`npm run preview` 仍为个人版；预览支持 `-- --port 4311`、`--host 127.0.0.1`、`--open`，只读对应产物，不重新构建。
缺少产物、版别不符或 package 版本不符时失败，请先重建。构建不接受额外 mode/root/outDir 参数；预览也不能借这些参数指向另一目录。

## 构建边界与环境变量

- 单一构建目标定义：`scripts/build-target.mjs`。正式命令锁定版别，Vite 对应 mode 选定现有 catalog/changelog；默认 development/production/test 仍为个人版。不是通过 URL、域名或运行时按钮切版。
- **必需环境变量：无**。个人站继续使用 `npm run build` / `dist` 即可。竞赛项目使用上表命令与目录，不需要秘密配置或站点域名。
- 可选 `OHS_EDITION=personal|contest`：用于校验命令，冲突、空值或未知值失败。不是让个人构建偷偷变成竞赛构建。
- 既有 `OHS_MAP_PROFILE_ALLOWLIST` 不再是必需设置；如仍设置，只接受竞赛命令下的 `contest-v01`。建议删除遗留手工设置，由构建命令选定公开 catalog。
- 可选 `VERCEL_GIT_COMMIT_SHA`（Vercel 提供）、`GITHUB_SHA`（CI 提供）：依次作为提交标识；本地回退 `git rev-parse HEAD`。元数据生成器对无 Git 源码只能记录 `commitId: null` 与 local buildId，不编造提交；正式构建仍需 Git 历史通过下述版本门。
- `VERCEL_ENV` 不改变内容。两版使用相同模拟代码和规则，版别信息不进入 WorldState、Fact、存档或世界 hash。

版本门在 main/正式发布条件下默认核对 `HEAD^..HEAD`：仅文档变化可以不升版，但仍检查 package/lockfile/两版 changelog 一致。可选 `OHS_RELEASE_BASE` 用于一次发布或 PR 的跨提交范围；文件差异和版本都比较该 ref 与 HEAD 的共同祖先，不能固定旧值规避检查。本地未提交生产修改独立比较 HEAD。无父提交、浅克隆缺历史、无效/自身基线或 Git 查询失败会明确阻断，应补齐历史或提供正确基线，不会猜成文档变更。`npm run check:release-tests` 在独立临时 Git 仓库验证这些边界。

Vercel Git 托管构建只有同时具备系统来源信息（`VERCEL`、`VERCEL_ENV`、`VERCEL_DEPLOYMENT_ID`、`VERCEL_GIT_PROVIDER`、仓库 owner/slug、commit ref/SHA），且来源完整、环境为 production/preview、SHA 与实际 Git HEAD 完全一致时，才容忍已确认的 `.npmrc`、`vercel.json` 未暂存普通文件内容修改（Git模式100644保持不变、状态M、该路径无暂存变化）。系统变量语义见[Vercel官方说明](https://vercel.com/docs/environment-variables/system-environment-variables)。这不是仅凭CI标志跳过工作区，也不是对配置字段内容或来源签名的鉴定；两个路径仍属于生产文件。新增、删除、暂存、模式/类型变化及其他生产路径不获例外，本地修改仍须升版；已核验的托管构建（含preview）仍检查正常已提交范围。来源缺失/SHA不符时回到严格校验，不设置手工伪造变量补齐。报错仅输出分类、Git基线和路径，不输出配置正文或环境值。云端实际字段变换仍未核验，由部署session重新构建确认，不据一般平台文档编造具体原因。

每次构建保留原版本、类型、地图、全部同步/异步 JS、CSS、媒体预算检查。
竞赛版同时检查 Rollup 模块图、HTML 地图 payload 与从私人地图派生的敏感数据令牌；不是只隐藏一个选图按钮。旧 `contest-profile.json` 继续存在，其范围与 `version.json` 由同一组已选 profile 派生。详情见 [CONTEST_BUILD.md](./CONTEST_BUILD.md)。

## 两个 Vercel 项目（由下一 session 配置）

两个项目均连接本仓库 `main`，Root Directory 相同（本仓库根），Framework 为 Vite，安装 `npm ci`。
个人项目 Build Command=`npm run build:personal`，Output Directory=`dist`；竞赛项目分别为 `npm run build:contest` / `dist-contest`。
Production Branch 均设 `main`，保留正常 Git 自动更新；Preview 仍构建该项目自身版别，不改为“竞赛仅 Preview”。不需要冻结其中一个项目。

待用户提供：

- Vercel 所属账号/Team、已有个人项目名称或 ID。
- 竞赛项目是新建还是已有、期望项目名（待填）。
- 个人正式域名（待填）、竞赛独立正式域名（待填），以及 DNS 管理权限归属。
- 确认同仓库授权可用于两个项目；当前个人项目是否有构建/输出/环境变量覆盖。

**本轮不连接、创建、修改或部署任何 Vercel 项目。** 正常 Git 推送可能触发现有个人站集成；默认个人构建/输出未改变。仓库不存项目 ID、账号、密钥或猜测的正式链接。

## 共享路由与缓存

`vercel.json` 保留 Vite 框架、安装命令、SPA 回退与共享缓存，只移除覆盖项目设置的 `buildCommand` / `outputDirectory`。
这符合 [Vercel 配置覆盖规则](https://vercel.com/docs/project-configuration/vercel-json)。

- `/assets/*`：内容哈希文件名，保留一年 immutable。
- `/media/*`：现有固定文件名，`max-age=0, must-revalidate`，不设一年 immutable。
- `/version.json`、`/contest-profile.json`：no-cache/no-store；均不被 SPA 回退改写。
- 普通页面路径回退 `/index.html`，页面重新验证；静态 assets/media 路径不进入该回退。
- 没有增加 PWA、预缓存、资源流水线或媒体。

本地生产预览验证静态文件正文与 MIME；CDN 缓存响应头、DNS、项目覆盖和线上路由须由实际部署 session 再验，不能把本地 Vite 预览当作已部署 Vercel。

## 部署后核对

1. 请求 `/version.json`，核对 `version`、`commitId`、`edition`、`buildId`、`profiles`。
2. 两版同一提交的 `commitId` 相同，`buildId` 带不同版别前缀；个人 profiles 为两张图，竞赛仅 `contest-v01@1` / `contest-v01-68`。
3. 开篇及“观史台 → 版本与更新”显示版别；竞赛开篇只有云海八荒。URL 参数不能加入另一地图。
4. 竞赛 `/contest-profile.json` 与上述范围一致，抽取 HTML/JS 运行私人内容门禁。
5. 更新检查遇到另一版元数据明确提示“更新版别不符”，不提供正常重载更新；缺少版别或非法数据为检查失败，不猜测。
6. 竞赛私人地图导入/自动恢复/收藏读取明确拒绝；合法赛图保存、导出重导与续演正常。缺图原存档留存，开始新世界前沿用现有留底逻辑。没有新增存档格式或禁用手动导入。
7. 两域名天然隔离浏览器存储；本地预览默认不同端口。同源残留存档已由现有地图校验和缺图留底保护，没有另建版别数据库或迁移系统。

## 可复验检查与状态

`npm run check:editions` 验证目标/冲突/元数据/预览拒绝/共享路由；`npm run test:e2e:editions` 用当前代码生成带真实历史的赛图世界，比较源码与两版生产桌面/手机的完整正文和检查点，验证音画、阅读返回、跨版更新拒绝、保存恢复及私人图导入拒绝。输入不依赖旧 output。

原 `test:e2e:contest` 继续覆盖私人 autosave、收藏不兼容和新建前留底。`test:update`、`test:e2e:media` 及原发布检查保留；新两项已加入 `test:release`。最终实际通过/失败/未执行状态见本轮 `output/build-editions-v1.29.28/REPORT.md` 与 `progress.md`，不得把文档中的命令列表当作通过证明。

未执行：实际双站 Vercel 配置、CDN/正式域名验收、物理移动设备与主观音色确认。额外预留 5KiB JS 目标继续单列，不提高原门禁预算。
