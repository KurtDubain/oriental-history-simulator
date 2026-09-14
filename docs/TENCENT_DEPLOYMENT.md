# 腾讯云双版本部署

2026-09-14 22:23 已更新上线。版本 **1.29.32**，来源 `main` / `0572410715da59f5b592ede5dfb4cda517a92866`；两版均为 `OHS_TENCENT_ICP=1` 专用构建，首页备案页脚已上线。
仓库：`git@github-kurt:KurtDubain/oriental-history-simulator.git`（本机 SSH 别名）；GitHub 仓库为 `KurtDubain/oriental-history-simulator`。
本次发布没有修改产品源码、提交或推送；本地仅更新部署记录。此前 v1.29.31 首次部署记录见本文后部及旧报告。

| 版本 | 正式地址 | 服务器目录 | 内容 |
| --- | --- | --- | --- |
| 个人版 | https://canghai.dyp02.vip/ | `/www/wwwroot/apps/canghai-personal` | 心中山河、云海八荒 |
| 竞赛版 | https://canghai-contest.dyp02.vip/ | `/www/wwwroot/apps/canghai-contest` | 仅云海八荒 |

两条 DNS A 记录均为 `82.156.137.232`，默认线路，TTL 600。原 www、football、cup 记录没有修改。

## 托管方式与位置

- 本地串行构建，上传静态产物，由宿主机 Nginx 共用 80/443 按域名分流；无新增内部端口、Node 服务或 Docker 容器。
- Nginx 配置：`/www/server/panel/vhost/nginx/canghai-personal.conf`、`canghai-contest.conf`。
- 当前 release：`v1.29.32-0572410-20260914-icp`。每版 `current` 指向该版本目录，`previous` 指向完整保留的 `v1.29.31-733c0f4-20260914`。此前同产物回滚演练副本也未删除。
- `releases/` 不覆盖历史版本；`shared/assets/` 保留各版历次哈希资源，两版不共用资源池。不要清空或直接编辑这些文件。
- root 私有运维目录：`/www/server/canghai-deploy`，含 `bin/`、`incoming/`、`validated/`、`logs/` 和 README；不在网站根目录内。
- 备份及服务资源快照：`/www/backups/canghai-deploy/`。首次备份在 `20260914-initial/`，后续操作分别留独立时间戳目录。
- 日志：`/www/wwwlogs/canghai-{personal,contest}.{access,error}.log`；轮转配置 `/etc/logrotate.d/canghai-static`。

本次没有修改博客目录、数据库、容器、足球配置或 Nginx 主配置；这四份原配置前后 SHA256 一致。既有 Vercel 站点与 Git 集成保持不变。

## 以后更新

腾讯云目前为**手动发布**，没有 Git 自动部署。Git 推送不会更新这里。

2026-09-14本地另已补好v1.29.33“衡印”favicon（SVG/ICO/180PNG），四组构建与浏览器验证通过，但**未提交或部署，线上仍为本文开头的v1.29.32**。下次源码提交后重新构建发布，三个根图标随产物一起上传；现有Nginx/管理器支持其类型，无需手改服务器文件。图标为所有构建共用，备案标记仍仅腾讯云开启。

从 v1.29.32 起，首页备案页脚已实际部署到腾讯云两站；页脚仅展示已有域名备案记录，不表示游戏内容审批。以下保留后续发布模板。

1. 在本机确认当前源码、版本与 Git 状态，依次运行 `npm run check:editions`、`OHS_TENCENT_ICP=1 npm run build:personal`、`OHS_TENCENT_ICP=1 npm run build:contest`。失败就停止，不跳过任何门禁。默认/Vercel 构建命令与原 dist / dist-contest 不变，不启用该页脚。
2. 核对两版 version.json 的 edition、完整 commitId、buildId、profiles，以及 `icpFooter: true`。有未提交产品改动时，不得将旧 HEAD 冒充构建来源。预览使用相同标记和对应 preview 命令，详见 [BUILD_EDITIONS.md](./BUILD_EDITIONS.md)。
3. 使用全新的 RELEASE 名；仅打包 dist-tencent / dist-contest-tencent 内的公共静态文件，不能上传仓库、环境文件、密钥或 node_modules，不要误用无页脚的默认产物。上线后实际检查首次首页与“续读旧史”首页的完整备案链接。

以下是命令模板，大写参数必须替换为本次实际值，不能原样执行：

```sh
COPYFILE_DISABLE=1 tar -czf PERSONAL_PACKAGE.tar.gz -C dist-tencent .
COPYFILE_DISABLE=1 tar -czf CONTEST_PACKAGE.tar.gz -C dist-contest-tencent .
shasum -a 256 PERSONAL_PACKAGE.tar.gz CONTEST_PACKAGE.tar.gz
ssh -i /Users/mutu/.ssh/personal_space_deploy_ed25519 root@82.156.137.232 'mkdir -m 700 /www/server/canghai-deploy/incoming/NEW_RELEASE'
scp -i /Users/mutu/.ssh/personal_space_deploy_ed25519 PERSONAL_PACKAGE.tar.gz CONTEST_PACKAGE.tar.gz root@82.156.137.232:/www/server/canghai-deploy/incoming/NEW_RELEASE/
```

服务器上逐版执行，每版发布后立即检查网页与版别：

```sh
python3 /www/server/canghai-deploy/bin/manage-static.py publish personal NEW_RELEASE /www/server/canghai-deploy/incoming/NEW_RELEASE/PERSONAL_PACKAGE.tar.gz PERSONAL_SHA256 FULL_COMMIT_SHA
curl --fail https://canghai.dyp02.vip/version.json
python3 /www/server/canghai-deploy/bin/manage-static.py publish contest NEW_RELEASE /www/server/canghai-deploy/incoming/NEW_RELEASE/CONTEST_PACKAGE.tar.gz CONTEST_SHA256 FULL_COMMIT_SHA
curl --fail https://canghai-contest.dyp02.vip/version.json
```

脚本拒绝覆盖旧 release，检查归档摘要、路径穿越、链接、版别、地图清单及共享资源冲突，然后原子切换 current。普通更新不需要 reload Nginx；发布后的 HTTP 健康失败不会自动回滚，须检查后主动回滚。

v1.29.32 发布时，运维脚本 `identity_at` 仅增加严格布尔 `icpFooter` 与对应 `edition-tencent-SHA` 校验；缺失/false 仍接受旧版标识以便回滚。部署新腾讯产物前须另行明确核对 `icpFooter: true`，不要将旧格式兼容误当成腾讯版强制门。当前 manager SHA256 为 `265d0a4f4c1f6be2c44101daaf48f5ea4cc788745705f45b8fec536685eca500`。

旧脚本和六份 Nginx 配置备份在 `/www/backups/canghai-deploy/v1.29.32-0572410-20260914-icp/`；本次没有修改或 reload Nginx。不要在 current 仍为新版时直接还原旧 manager，否则旧脚本无法识别新版身份；正常回滚保留当前兼容脚本即可。

## 回滚到上一版

在服务器执行：

```sh
python3 /www/server/canghai-deploy/bin/manage-static.py rollback personal v1.29.31-733c0f4-20260914
python3 /www/server/canghai-deploy/bin/manage-static.py rollback contest v1.29.31-733c0f4-20260914
curl --fail https://canghai.dyp02.vip/version.json
curl --fail https://canghai-contest.dyp02.vip/version.json
```

回滚只接受已验证且内容完整的版本，不删除浏览器存档。v1.29.31 首次部署的同产物副本发布→回滚演练曾通过；v1.29.32 本轮做了新旧身份及回滚本地测试、服务器旧产物完整性只读校验，没有来回切换线上或做跨游戏版本存档降级测试。

需要切回当前 v1.29.32 时，将上述两条 rollback 命令的版本参数替换为 `v1.29.32-0572410-20260914-icp`，再核对两站 version.json。

## HTTPS 与恢复

| 域名 | 证书到期时间（北京时间） |
| --- | --- |
| canghai.dyp02.vip | 2026-12-13 19:53:32 |
| canghai-contest.dyp02.vip | 2026-12-13 19:53:56 |

每站独立 Let's Encrypt 证书，位于 `/www/server/panel/vhost/cert/对应域名/`。复用已安装的宝塔 ACME 客户端，HTTP-01 验证目录 `/www/wwwroot/apps/_acme/.well-known/acme-challenge/`，80 端口该路径不被 HTTPS 跳转吞掉。

`/etc/cron.d/canghai-cert-renew` 每日 04:29 检查，剩余不足 30 天时尝试续签，使用独立 flock；与足球任务分开。日志 `/www/server/canghai-deploy/logs/cert-renew.log`。任务核对磁盘与实际 SNI 证书指纹，需加载新证书时先记录资源、nginx -t，再平滑 reload 并复验。本次到期检查及指纹一致性检查已通过，未来真实续期仍需观察日志。

```sh
/usr/bin/flock -n /www/server/canghai-deploy/renew.lock /www/server/canghai-deploy/bin/renew-game-certs.sh
openssl s_client -connect canghai.dyp02.vip:443 -servername canghai.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
openssl s_client -connect canghai-contest.dyp02.vip:443 -servername canghai-contest.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

Nginx/crond 已启用开机启动，平滑重载、发布与回滚后站点正常。本轮没有停止共享 Nginx 或重启整机，**未做断电/完整服务重启恢复演练**，避免中断博客和足球。

## v1.29.32 更新验收

- 腾讯云两版从干净已提交源码重新串行构建；定向版别5/5、首页5/5、原两版全部构建门通过。JS gzip 423241 / 423244B，CSS39827B；原预算通过，额外5KiB余量仍未达。
- 两份上传包 SHA 与本机构建一致。56项严格TLS网络检查再次全过，含31个公共文件逐个SHA/MIME/缓存、HTTP跳转、SPA、缺失资源、跨版隔离、博客与足球健康。
- 真实浏览器1440×900与390×844检查首次/有档首页完整备案链接、保存恢复及继续推进；截图与详细结果见本轮报告。存在旧版即有的 favicon.ico 404，不冒称所有console为空。
- 主、博客、足球两版、历史游戏两版共六份Nginx配置SHA前后一致；服务、端口、DNS、证书及续签配置未改，无Nginx重载或服务器重启。
- 本轮只部署腾讯云，没有操作Vercel；腾讯云仍为手动发布。未重跑全量Vitest、完整release、长期模拟或实体手机验收，既有性能待办不清零。
- 本轮证据：`output/tencent-icp-deploy-20260914/REPORT.md`；截图：`output/playwright/tencent-icp-deploy-20260914/`。

## v1.29.31 首次部署验收记录

56 项严格 TLS 网络检查通过：31 个公开文件 SHA、MIME、缓存，HTTP 跳 HTTPS、普通 SPA 深链、缺失静态/JSON/隐藏路径 404、竞赛个人专属资源隔离；博客及足球两站仍健康。

真实 Chrome 完成两版 1440×900 / 390×844 视口检查、新建→推进→人物→经历证据→返回、保存→刷新→续读→继续推进，恢复签名一致，捕获 error/warn 日志为空，所查页面无文档横向溢出。截图在本次对话中实际查看，未另存图片文件；不是实体手机、全国网络或百年机制验收。

详细证据位于本地 `output/tencent-deploy-20260914/REPORT.md`。新域名是独立浏览器存储空间，旧 Vercel 存档不会自动迁移，需游戏导出/导入并遵守地图版别限制。
