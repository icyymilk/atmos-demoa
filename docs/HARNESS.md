# Atmos Agent Harness

本地工作台现在运行一个可调用工具的 Agent。执行路径由模型在每轮决定；服务端不再安排「规划 → 生成 → 检查 → 一次修复」的固定流程。

## 核心协议

```text
用户任务 + 上下文 + 已发现的工具
                  ↓
              调用模型
                  ↓
       assistant 内容 / tool_calls
                  ↓
     校验工具名与参数 → 执行 MCP 工具
                  ↓
          工具结果写回 messages
                  ↓
       未完成则继续下一轮模型调用
                  ↓
     complete_task 检查通过 → 最终回复
```

模型可以搜索资料、加载 Skill、读取或编辑文件、检查结果、反复修复，或直接完成简单任务。`complete_task` 是应用任务的交付边界：必须存在 `index.html` 并通过文档和 JavaScript 语法检查；若建立了任务清单，清单也必须全部完成。检查失败以工具错误回到模型，继续循环。这条规则约束最终产物，不规定工具调用顺序。

循环还在用户取消、运行超时、调用预算耗尽、连续相同调用无进展或模型服务失败时停止。这些结束状态不会伪装成成功。默认预算：24 轮模型调用、80 次工具调用、600 秒；可在配置文件调整。

## 工具与传输

- **内置 MCP / in-memory transport**：list_files、read_file、write_file、edit_file、delete_file、search_files、read_webpage、update_tasks、read_memory、write_memory、load_skill、validate_app、complete_task。
- **Exa HTTP MCP**：启动时调用真实 `tools/list` 发现工具，默认开放 web_search_exa / web_fetch_exa（以实际服务返回为准）。使用免费服务通道，可能限流；可通过私有配置增加服务方凭据。
- **Utilities stdio MCP**：current_time、calculate，仓库内有完整示例服务器。
- 支持用户在插件清单中声明 **stdio、Streamable HTTP、SSE** MCP 服务。使用官方 TypeScript SDK 处理握手、工具发现和调用。连接失败会明确展示，其他已连接工具仍可运行。

网页阅读提取 HTML 正文、标题和链接；不是运行页面 JavaScript 的自动化浏览器。文件工具限制在当前 run 工作区中。没有向模型暴露宿主的 shell 或任意路径。

## 插件

`atmos.config.json` 中注册可信插件目录。`atmos.local.json` 可覆盖该列表及预算，该文件被 Git 忽略。Agent 无权修改这两个配置文件或自动安装任意插件。

```json
{
  "plugins": ["./plugins/developer", "./plugins/research", "./plugins/utilities", "/path/to/my-plugin"],
  "limits": {"maxIterations": 24, "maxToolCalls": 80, "timeoutSeconds": 600}
}
```

插件目录包含 `plugin.json`：

```json
{
  "id": "my-tools",
  "name": "我的工具",
  "version": "1.0.0",
  "description": "自定义项目工具",
  "skills": ["skills/review/SKILL.md"],
  "mcp": {
    "transport": "stdio",
    "command": "${NODE}",
    "args": ["${PLUGIN_DIR}/server.mjs"],
    "env": {"SERVICE_KEY": "${env:MY_SERVICE_KEY}"},
    "tools": ["my_allowed_tool"]
  }
}
```

HTTP 示例：`{"transport":"http","url":"https://your-server.example/mcp","headers":{"Authorization":"Bearer ${env:MY_MCP_TOKEN}"}}`。凭据仅在运行层解析，不发送到模型或浏览器。只有用户在本机配置的可信插件可以启动进程；第三方插件进程拥有本机用户权限，并不等同于工作区文件工具的沙箱。添加前应检查插件来源与权限。

插件可在界面「工具与扩展」中启停。刷新会重新发现工具。每个新任务重新加载配置；正在运行的任务保持已选定的工具集合。添加插件无需改 Agent 循环。

## Skill

```markdown
---
name: review
description: 用户请求代码审查或调试时使用。
---
# 检查方法
先理解任务，按需读取文件和真实工具结果。验证用户要求是否满足。
```

启动时只把 Skill 的名称与说明交给模型；完整正文由模型调用 `core__load_skill` 按需读取。Skill 文件必须位于其所属插件目录内。Skill 是可复用方法，不是任务阶段列表。

## 文件、记忆与轨迹

每个 run 有独立目录 `.atmos/runs/<会话摘要>/<runId>/workspace`，以当前项目上一版本的文件初始化。失败或取消的尝试保留在本机，便于诊断，不覆盖已交付版本。

成功时，入口代码、完整工作区文件和压缩后的执行事件在 D1 同一批事务中保存为新版本。`.agent/MEMORY.md` 和 `.agent/tasks.json` 随版本持久化。界面可查看文件与过去的调用轨迹；恢复版本也恢复对应工作区文件，应用业务数据保持独立。

上下文按完整的 assistant/tool 消息组裁剪，保留近期调用及最近五次用户需求和回复，不留下无对应调用的 tool 消息。被裁剪的信息可以重新从工作区与项目记忆读取。

## 本地运行

```sh
npm ci
npm run dev
```

`predev` 自动迁移 SQLite。启动器拉起绑定于 loopback 随机端口的 Node Harness，再启动 Vite/Worker。`npm run build` 后的 `npm start` 也会启动同一 Harness，并在本机运行构建产物。两者使用每次启动生成的随机令牌通信；页面仍需有效访客会话。模型 Key 只随当前请求进入运行层，不保存到文件、D1 或事件。

修改 `harness/` 中的运行代码后重新启动 `npm run dev`。修改插件清单、Skill 后可直接刷新扩展列表或开始下一次任务。

## 验证与边界

自动测试覆盖多轮工具反馈、检查失败后编辑修复、错误工具、取消、预算退出、上下文裁剪、文件路径隔离、工具参数流式拼接及真实 stdio MCP 调用。另有网络验收通过 Exa MCP 查询 TypeScript 官方文档，并通过网页工具读取正文。

测试中仅在模型决策层注入脚本响应以检验循环语义，实际工具执行走 MCP、真实文件和验证器。产品 API 没有 mock 模式。有效 Key 下的多轮模型决策仍需实际验收。

当前限制：应用交付仍是单页 HTML，尚不执行任意 npm 工程；验证器不替代真实浏览器功能测试；停止的 run 尚无界面一键恢复；外部 MCP OAuth 登录尚未实现（支持已配置的 Header 凭据）；没有插件市场和自动安装器。

## ADR：为什么分离本地 Node 运行层

现有 Worker/D1 保留会话、项目与版本事务，Node 运行层提供 stdio 子进程、本机插件目录与文件工作区。相比把进程执行硬塞进 Worker，这个边界能使用标准 MCP SDK，并避免重写已验证的数据接口。代价是本地需要两个进程，部署到云端时必须为 Harness 单独提供受保护的 Node 服务；当前旧 Sites 公网版本不会自动具备这套能力。

代码模块：`harness/loop.ts` 是执行引擎，`model.ts` 处理工具调用协议，`core-tools.ts` 提供内置 MCP，`extensions.ts` 管理插件与 Skill，`server.ts` 管理本机服务生命周期，`app/api/generate/route.ts` 负责鉴权、转发和原子提交。

参考：[MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)、[Exa MCP 文档](https://exa.ai/docs/reference/exa-mcp)。
