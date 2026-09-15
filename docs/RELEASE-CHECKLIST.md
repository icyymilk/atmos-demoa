# 交付验收矩阵

本轮目标是达到题目要求的“可运行、可体验、可扩展”，不是复刻 Atoms 的全部商业能力。

| 要求 | 当前结果 | 验证方式 / 剩余动作 |
| --- | --- | --- |
| 可运行网页应用 | 已实现 | 本地开发和编译后服务；容器构建/启动检查 |
| Agent 驱动生成 | 真实接口、循环与工具执行已实现 | 有效 Key 下完成首次生成和多轮修改仍待人工验收 |
| 可视化展示生成应用 | 已实现 | 实时文件、草稿、检查后预览、最终 iframe；桌面与手机检查 |
| 真实交互 | 已实现 | 在模板中新增任务，API 确认保存，刷新后读取 |
| 数据持久化 | 已实现 | SQLite/D1、账户稳定 owner、文件持久卷；重启验证 |
| 初始化/注册/核心流程 | 已实现 | 访客、注册继承、跨浏览器登录、退出恢复、改密与隔离测试 |
| 至少一个延展能力 | 已超出基本要求 | 记忆中心与图谱、MCP/插件/Skill、外部只读连接、分级审批 |
| 完整源码导出 | 已实现 | 全部工作区文件 ZIP、目录结构、独立预览入口；独立解压器校验 |
| UI 与可用性 | 已打磨 | 系统字体、图标、侧栏、分段按钮、焦点、Esc、快捷键、360–1440px |
| 可测试在线链接 | 已完成 | Railway HTTPS；健康、首页、模板写入与重启持久化已从外部请求验证 |
| GitHub public 链接 | 已完成 | `icyymilk/atmos-demoa`，未登录访问 200，本地与远端提交一致 |
| 实现思路与取舍文档 | 已更新 | README、SUBMISSION、HARNESS、DEPLOYMENT |

本轮实际结果：68 项单元测试、类型检查、Lint、构建、3 组桌面/手机浏览器测试、账户/记忆/控制/API 回归、独立审批执行测试均通过。Linux Docker 干净构建与启动通过；账户、项目数据与 Markdown 记忆在容器重启后保留。正式 Railway 域名已完成 TLS、首页、健康检查和重启持久化验证。

## 可复现检查

```sh
npm run check           # 类型、Lint、单元测试、构建
npm run test:guard      # 独立 Harness + MCP + 审批，模型决策使用夹具
npm run test:deployment # 先构建；干净数据库、编译后服务、HTTPS origin、注册及重启持久化
npm run test:ui         # 自动启动本地服务（或复用已有服务）
```

首次运行浏览器测试：`npx playwright install chromium`。已安装 Chrome 时可使用 `ATMOS_BROWSER_CHANNEL=chrome npm run test:ui`。测试产物位于被忽略的 `test-results/`，截图和源码 ZIP 仅包含测试数据。GitHub Actions 已配置检查与浏览器回归。

保持本地开发服务运行时，另外执行 `npm run test:auth`、`npm run test:memory`、`npm run test:controls`、`npm run test:integration`。测试使用新建的隔离空间，不读取体验者 Key。真实模型、真实第三方授权资源和正式公网质量不由夹具测试证明。

## 最后 10 分钟

1. 两个正式链接从未登录浏览器均可打开；Demo `/api/health` 全部为 true。
2. 体验者填写 Key 后完成生成与修改，各次都验证实际预览。
3. 注册继承、刷新保存、ZIP 下载、一次审批拒绝与一次批准均正常。
4. `SUBMISSION.md` 填入最终链接；附明确信息：哪些已实现、哪些未做。
5. 提交说明复制到题目回收处，由本人将文档链接发送给 HR。

未验收的项目必须如实保留，不能用“已构建”代替“公网已可用”。
