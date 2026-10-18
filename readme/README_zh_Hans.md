# Suno by Ace Data Cloud：Mastra 接入指南

在 Mastra Agent 中使用 Suno 音乐生成、歌词、音频扩展和任务查询。此独立集成由 Ace Data Cloud 维护，复用 [Suno MCP](https://github.com/AceDataCloud/MCPs/tree/main/suno)，不代表 Suno 或 Mastra 官方。

[English](../README.md) · [获取应用 API Key](https://platform.acedata.cloud/console/applications?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_api_key) · [当前服务权限与价格](https://platform.acedata.cloud/models?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_pricing)

## 1. 安装当前候选包

2026-10-18 状态：源码候选，npm 发布待完成；Mastra 已关闭这项官方集成指南提案，当前不推进该官方入口，独立 ToolProvider 安装仍是可用接入机制。包名为 `@acedatacloud/mastra-suno`，实现正式的 ToolProvider 接口。安装包后还要注册到项目，才能在 Studio 选择工具。

需要 Node 22.13+；先按[英文版安装命令](../README.md#1-install-this-integration)克隆 `codex/native-tool-provider` 分支，运行 `npm ci`、`npm run check`、`npm pack`，再在自己的 Mastra 项目安装生成的 tgz 与 `@mastra/editor@0.16.0`。不要把尚未发布的 npm 名称当成已可一键安装。

## 2. 注册并获取应用密钥

1. 登录 [Ace Data Cloud → Applications](https://platform.acedata.cloud/console/applications?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_api_key)。新账户没有 General application 时，先点 **Initialize General Application**。
2. 打开 **General application**，复制应用 Key；也可进入 **Manage Keys → Create** 创建名为 `Mastra Suno` 的专用 Key。
3. 检查 Suno 权限、余额、有效期和当前价格。若启用 **Allowed APIs**，本教程至少需要 `/suno/audios` 与 `/suno/tasks`；其他工具按需配置其对应 API。

![复制应用 Key 或打开密钥管理](https://raw.githubusercontent.com/AceDataCloud/SunoDify/8d3d03570e73324220f111f7fe343da0792a8071/_assets/tutorial/get-api-key-en.png)

![创建专用 Key](https://raw.githubusercontent.com/AceDataCloud/SunoDify/8d3d03570e73324220f111f7fe343da0792a8071/_assets/tutorial/create-api-key-en.png)

图片来自 SunoDify 固定提交中的真实 Ace 控制台，只展示同一控制台操作；不是 Mastra 截图。2026-10-18 核对引用。只复制 token 字符串，不带 `Bearer `、引号或截图打码字符。平台管理 token 不等于生成服务应用 Key。

将 `ACEDATACLOUD_API_KEY=你的应用Key` 放在 Mastra **服务器**的未提交环境中。不要放进提示词、浏览器代码或 Agent 导出。此版本使用服务器所有者的服务账户；应用需自己控制谁可调用工具，不提供每用户 OAuth 或租户账单隔离。

## 3. 在 Mastra 注册和选择工具

```typescript
import { MastraEditor } from '@mastra/editor';
import { SunoToolProvider } from '@acedatacloud/mastra-suno';
const suno = new SunoToolProvider({
  apiKey: process.env.ACEDATACLOUD_API_KEY!,
  allowedTools: ['suno_generate_music', 'suno_get_task', 'suno_list_actions'],
});
const editor = new MastraEditor({ toolProviders: { suno } });
// 将 editor 传给现有 new Mastra({ ...existingConfig, editor })。
// 保留项目已有 Agent、身份认证和数据库 storage 配置。
```

根据 [Mastra Editor 官方设置](https://mastra.ai/docs/studio/editor)配置存储与权限。启动自己的服务，在 **Studio → Agents → 目标 Agent → Editor → Tools → Integration Tools** 中选择 **Suno by Ace Data Cloud**，勾选工具，先保存草稿测试。当前 Ace 条目仍待实际界面验收，本文不使用伪造安装截图。

代码定义的 Agent 可直接使用 `await suno.resolveTools(['suno_generate_music', 'suno_get_task'])` 返回的工具。应用退出时调用 `await suno.disconnect()`。

## 4. 提交一次，始终查询同一任务

生成会产生费用，需要用户先检查当前价格后自己执行：调用一次 `suno_generate_music`，例如 prompt 为 `A gentle instrumental piano melody for a sunrise`、`instrumental: true`；模型以当前工具 schema 为准。

保存返回的 `task_id`，按服务提示的间隔调用 `suno_get_task` 查询**同一个 ID**。pending/running 和音频预览都不等于完成；不要重跑生成来查进度。查询明确完成且 `response.success: true` 后再展示最终媒体链接，失败则停止。生成响应丢失时先检查任务记录，再决定是否重新提交。

适配器不自动重试调用，也不改模型或价格。Agent/工作流上层仍可能再次调用，需同时关闭生成重试。MCP/JSON 错误和明确任务失败会抛出 `AceToolError`，只保留实际返回的安全状态码/代码/请求 ID，不把原始诊断复制进日志。

## 5. 验证与常见问题

`npm run check` 检查编译、示例类型与真实 Mastra Editor/Agent 的本地契约；`npm run pack:check` 检查包内容。可选运行 `MASTRA_AUTO_REFRESH_PROVIDERS=false node test/released-static.mjs`：安装指定公共 Python MCP，仅调用静态指南，假密钥与 loopback API 确保 Ace API 请求数为 0。

Studio 没有条目时检查服务器是否注册 provider、Editor 存储和工具编辑权限；401/403 检查应用 Key、过期、服务权限和生成/查询 API 范围；429 遵守限流；pending 继续查原 ID；失败先检查任务记录再决定是否重发。此包提供音乐工具，Agent 使用的推理 LLM 需另行配置。

Mastra 的 npm 集成、官方目录、Connect 和 LLM provider 下拉是不同入口。当前包尚未被 Mastra 官方收录；[models.dev PR](https://github.com/anomalyco/models.dev/pull/8873)负责另一条 LLM 发现路径。

[Mastra 官方集成指南提案 #27373](https://github.com/mastra-ai/mastra/issues/27373) 已被维护者关闭；[2026-10-18（Asia/Shanghai）维护者回复](https://github.com/mastra-ai/mastra/issues/27373#issuecomment-6239261501)表示目前不推进。此状态不是待审批，不代表禁止独立 ToolProvider；本包仍未获官方目录收录。
