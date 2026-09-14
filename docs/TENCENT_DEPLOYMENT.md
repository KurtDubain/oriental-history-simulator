# 腾讯云双版本部署

2026-09-14 已上线。版本 **1.29.31**，来源 `main` / `733c0f48bc28e165a8ace0f91794fe28c4f0df4b`。
仓库：`git@github-kurt:KurtDubain/oriental-history-simulator.git`（本机 SSH 别名）；GitHub 仓库为 `KurtDubain/oriental-history-simulator`。
本轮没有修改产品源码、提交或推送；保留了已有 progress.md 修改。

| 版本 | 正式地址 | 服务器目录 | 内容 |
| --- | --- | --- | --- |
| 个人版 | https://canghai.dyp02.vip/ | `/www/wwwroot/apps/canghai-personal` | 心中山河、云海八荒 |
| 竞赛版 | https://canghai-contest.dyp02.vip/ | `/www/wwwroot/apps/canghai-contest` | 仅云海八荒 |

两条 DNS A 记录均为 `82.156.137.232`，默认线路，TTL 600。原 www、football、cup 记录没有修改。

## 托管方式与位置

- 本地串行构建，上传静态产物，由宿主机 Nginx 共用 80/443 按域名分流；无新增内部端口、Node 服务或 Docker 容器。
- Nginx 配置：`/www/server/panel/vhost/nginx/canghai-personal.conf`、`canghai-contest.conf`。
- 当前 release：`v1.29.31-733c0f4-20260914`。每版 `current` 指向该版本目录，`previous` 指向同产物的回滚演练副本 `v1.29.31-733c0f4-20260914-recovery-check`，并非旧游戏版本。
- `releases/` 不覆盖历史版本；`shared/assets/` 保留各版历次哈希资源，两版不共用资源池。不要清空或直接编辑这些文件。
- root 私有运维目录：`/www/server/canghai-deploy`，含 `bin/`、`incoming/`、`validated/`、`logs/` 和 README；不在网站根目录内。
- 备份及服务资源快照：`/www/backups/canghai-deploy/`。首次备份在 `20260914-initial/`，后续操作分别留独立时间戳目录。
- 日志：`/www/wwwlogs/canghai-{personal,contest}.{access,error}.log`；轮转配置 `/etc/logrotate.d/canghai-static`。

本次没有修改博客目录、数据库、容器、足球配置或 Nginx 主配置；这四份原配置前后 SHA256 一致。既有 Vercel 站点与 Git 集成保持不变。

## 以后更新

腾讯云目前为**手动发布**，没有 Git 自动部署。Git 推送不会更新这里。

1. 在本机确认当前源码、版本与 Git 状态，依次运行 `npm run check:editions`、`npm run build:personal`、`npm run build:contest`。失败就停止，不跳过任何门禁。
2. 核对两版 version.json 的 edition、完整 commitId、buildId、profiles。有未提交产品改动时，不得将旧 HEAD 冒充构建来源。
3. 使用全新的 RELEASE 名；仅打包 dist / dist-contest 内的公共静态文件，不能上传仓库、环境文件、密钥或 node_modules。

以下是命令模板，大写参数必须替换为本次实际值，不能原样执行：

```sh
COPYFILE_DISABLE=1 tar -czf PERSONAL_PACKAGE.tar.gz -C dist .
COPYFILE_DISABLE=1 tar -czf CONTEST_PACKAGE.tar.gz -C dist-contest .
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

## 回滚到本次验收版本

在服务器执行：

```sh
python3 /www/server/canghai-deploy/bin/manage-static.py rollback personal v1.29.31-733c0f4-20260914
python3 /www/server/canghai-deploy/bin/manage-static.py rollback contest v1.29.31-733c0f4-20260914
curl --fail https://canghai.dyp02.vip/version.json
curl --fail https://canghai-contest.dyp02.vip/version.json
```

回滚只接受已验证且内容完整的版本，不删除浏览器存档。本次同产物副本发布→回滚演练通过，不代表跨游戏版本的存档降级测试。

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

## 验收范围

56 项严格 TLS 网络检查通过：31 个公开文件 SHA、MIME、缓存，HTTP 跳 HTTPS、普通 SPA 深链、缺失静态/JSON/隐藏路径 404、竞赛个人专属资源隔离；博客及足球两站仍健康。

真实 Chrome 完成两版 1440×900 / 390×844 视口检查、新建→推进→人物→经历证据→返回、保存→刷新→续读→继续推进，恢复签名一致，捕获 error/warn 日志为空，所查页面无文档横向溢出。截图在本次对话中实际查看，未另存图片文件；不是实体手机、全国网络或百年机制验收。

详细证据位于本地 `output/tencent-deploy-20260914/REPORT.md`。新域名是独立浏览器存储空间，旧 Vercel 存档不会自动迁移，需游戏导出/导入并遵守地图版别限制。
