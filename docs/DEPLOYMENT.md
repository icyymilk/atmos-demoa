# 部署与交付

目前应用由两个进程组成：编译后的 Worker 网页/API 与 Node Agent Harness。只上传前端静态文件或只发布 Worker，会缺失生成、密码处理、记忆和 MCP 能力。此前 Sites 地址不作为这版的验收入口。

## 单实例部署

仓库提供 Dockerfile 和 `deploy/compose.yaml`。这是一套单机 Demo 部署：Node 22、编译后 Worker 的本地运行器、Node Harness、Caddy HTTPS 入口。本地 D1/SQLite 与 Agent 数据使用持久卷；不依赖开发者的本机文件或 API Key。运行器基于 Wrangler/Miniflare，适合受控 Demo，后续生产化应替换为独立 Node API + SQLite/Postgres 或真正的云端 Worker + 独立 Agent 服务。

1. 准备 Linux 主机、Docker Compose 和指向该主机的域名，开放 80/443 端口。构建和首次启动需要联网获取依赖。
2. 把完整源码克隆/上传到主机。在仓库根目录执行以下命令，把域名换成实际值：

```sh
export ATMOS_DOMAIN=your.actual.domain
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
curl --fail "https://$ATMOS_DOMAIN/api/health"
```

健康响应必须是 `{"ok":true,"database":true,"agent":true}`。浏览器打开相同域名，注册账户、创建模板、刷新确认数据保存，再填写自己的模型 Key 做真实生成。不要将示例域名直接提交。

容器以普通用户运行。只通过 Caddy 公开 80/443，Worker 8787 不映射到公网；Harness 使用回环地址、随机内部认证令牌。`ATMOS_PUBLIC_ORIGIN` 是明确配置的 HTTPS 地址，决定跨站检查及 Secure Cookie，不信任客户端传入的转发头。反向代理保留 SSE 的即时输出和客户端断开取消语义。

数据卷：

- `atmos-db`：账户、会话、项目、版本、应用状态。
- `atmos-data`：用户记忆、连接加密密钥及凭据、运行快照、信任设置。这个卷含私有资料，不能上传 GitHub。
- `caddy-data` / `caddy-config`：证书与代理配置。

重启或更新代码不应删除数据卷。升级前先停止写入并备份两个 Atmos 卷，恢复时必须成对恢复；不能只恢复凭据而遗漏加密密钥。不使用 `down -v`，它会删除持久化数据。当前文件事务由单个 Harness 管理，不支持多副本共享写入。

## 无 Docker 的预演

```sh
npm ci
npm run build
npm start
```

默认访问 `http://localhost:8787`。`PORT` 调整端口，`ATMOS_HOST` 默认 `127.0.0.1`，`ATMOS_LOCAL_STATE_DIR` 可指定独立数据库目录（迁移与运行使用相同值）。保持 `.atmos` 和数据库目录可写。放到 HTTPS 代理后设置 `ATMOS_PUBLIC_ORIGIN=https://实际域名`，不带路径或末尾斜杠。启动时自动应用增量迁移。

## 提交前必须亲自验证

- 用未登录/无痕浏览器从外部网络打开正式网址，健康检查通过。
- 注册或访客创建项目，修改应用数据后刷新；重启服务后再次确认数据保留。
- 填入有效模型 Key，完成首次生成和至少一次对话修改，确认代码、预览、工具记录一致。
- 拒绝一个需审批的工具操作后确认没有副作用；批准只执行一次；停止任务可生效。
- 下载 ZIP，解压并打开 `atmos-export/preview.html`。
- GitHub 仓库设为 public，从未登录浏览器访问并按 README 完成安装；不要上传 `.atmos`、`.wrangler`、`.env` 或真实密钥。

参考：[Caddy 流式反向代理](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#streaming)、[Node 官方镜像](https://hub.docker.com/_/node)。
