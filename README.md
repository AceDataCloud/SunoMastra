# Suno by Ace Data Cloud for Mastra

Use **Suno music generation, lyrics, audio extension, and task queries** in Mastra agents. This independent integration is maintained by Ace Data Cloud and connects to its existing [Suno MCP server](https://github.com/AceDataCloud/MCPs/tree/main/suno). It is not affiliated with Suno or Mastra.

[简体中文](readme/README_zh_Hans.md) · [Get an application API key](https://platform.acedata.cloud/console/applications?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_api_key) · [Current access and pricing](https://platform.acedata.cloud/models?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_pricing)

## 1. Install this integration

**Status, 2026-10-18:** source candidate; npm release is pending. Mastra closed the proposed official integration-guide request for now; this is an independent ToolProvider, with no official listing. The npm name is `@acedatacloud/mastra-suno`. This package implements Mastra's documented [ToolProvider interface](https://mastra.ai/reference/editor/tool-provider); installing it does not add a global Marketplace entry or an LLM provider.

To review/install the current candidate with Node 22.13 or newer:

```bash
git clone --branch codex/native-tool-provider https://github.com/AceDataCloud/SunoMastra.git
cd SunoMastra
npm ci
npm run check
npm pack
# In your existing Mastra project:
npm install /absolute/path/to/SunoMastra/acedatacloud-mastra-suno-0.1.0.tgz @mastra/editor@0.16.0
```

Tested with `@mastra/core@1.75.0`, `@mastra/editor@0.16.0`, and MCP SDK `1.32.1`. The package uses MCP directly so a dropped response does not automatically resubmit a paid generation. Your Mastra agent/workflow can still submit another call: disable generation retries there too.

## 2. Get an API key

1. Register or sign in at [Ace Data Cloud → Applications](https://platform.acedata.cloud/console/applications?utm_source=github&utm_medium=referral&utm_campaign=evergreen&utm_content=sunomastra_readme_api_key). If needed, choose **Initialize General Application**.
2. Open **General application**. Copy its application API key, or choose **Manage Keys → Create** to make a dedicated key named `Mastra Suno`.
3. Check Suno access, current balance, expiration, and current prices before generation. If **Allowed APIs** is enabled, this guide needs `/suno/audios` and `/suno/tasks`; other optional tools require their respective API permissions.

![Copy an application key or open Manage Keys](https://raw.githubusercontent.com/AceDataCloud/SunoDify/8d3d03570e73324220f111f7fe343da0792a8071/_assets/tutorial/get-api-key-en.png)

![Create a dedicated application key](https://raw.githubusercontent.com/AceDataCloud/SunoDify/8d3d03570e73324220f111f7fe343da0792a8071/_assets/tutorial/create-api-key-en.png)

These are real Ace console screenshots from the linked SunoDify commit, reused for the same console steps; they are not Mastra screenshots. Reference checked 2026-10-18. Copy only the token string, without `Bearer ` or quotation marks. A platform management token is not the application key used here.

Store it in your **Mastra server's** uncommitted environment:

```dotenv
ACEDATACLOUD_API_KEY=your_application_api_key
```

The example gives the server owner's service access to agents that can execute these tools. Authenticate and authorize those users in your application. This adapter does not implement per-user OAuth or tenant-specific billing. Never put this key in a prompt, browser bundle, stored tool settings, or exported agent.

## 3. Register the provider and select tools in Studio

Add the provider to the entry point that already creates your Mastra instance:

```typescript
import { MastraEditor } from '@mastra/editor';
import { SunoToolProvider } from '@acedatacloud/mastra-suno';

export const suno = new SunoToolProvider({
  apiKey: process.env.ACEDATACLOUD_API_KEY!,
  allowedTools: ['suno_generate_music', 'suno_get_task', 'suno_list_actions'],
});

const editor = new MastraEditor({ toolProviders: { suno } });
// Pass editor to your existing new Mastra({ ...existingConfig, editor }).
// Keep its existing agents, authentication, and database storage configuration.
```

[Mastra's Editor setup](https://mastra.ai/docs/studio/editor) documents storage and permissions. With this server running, open **Studio → Agents → your agent → Editor → Tools**. Find **Integration Tools**, choose **Suno by Ace Data Cloud**, and select the generation, task-query, or static guide tools. Save a draft before testing; publish an agent change only when ready. If the service is absent, verify that this exact server registered `editor.toolProviders.suno` and that the agent permits tool edits.

The provider supports catalog search, pagination, an exact tool allowlist, original MCP input schemas, and stored description overrides. It exposes only `suno_` tools. No browser-side key form is required: authentication is configured in server code above. **The actual Ace entry in Studio still needs a visual check; no fabricated installation screenshot is included.**

For a code-configured agent, skip Editor selection and resolve the same tools:

```typescript
const tools = await suno.resolveTools(['suno_generate_music', 'suno_get_task']);
// Supply tools to your existing new Agent({ ...existingAgentConfig, tools }).
```

Call `await suno.disconnect()` in your application's shutdown hook.

## 4. First use: submit once, query the same task

The following generation is a **user action that can incur charges**, not an installation check:

1. After reviewing current pricing, call `suno_generate_music` once with a short prompt, such as `A gentle instrumental piano melody for a sunrise`, and `instrumental: true`. Choose a model supported by the live tool schema; this package does not substitute models or set prices.
2. Save the returned `task_id`. A submitted task or playable preview is not a completed result.
3. Call `suno_get_task` with **that same ID**, respecting the server's polling guidance. Never rerun generation to check progress. A lost generation response needs investigation before resubmission.
4. Continue only while the task is pending/running. Stop on a terminal success or failure. Present final media URLs only after the query reports completion and `response.success: true` (or equivalent explicit completion guidance).

The adapter preserves the MCP content envelope and async hints. JSON/MCP errors and explicit failed tasks reject with `AceToolError`. Safe `statusCode`, `code`, and `requestId` are retained only when actually supplied; raw upstream messages are not copied into error logs. Error metadata omitted by a server cannot be reconstructed.

## 5. Free checks and troubleshooting

```bash
npm ci
npm run check
npm run pack:check
# Optional: install the pinned public Python MCP and execute its static guide only.
# Requires uv; sends no Ace API requests and uses a loopback API base and dummy key.
MASTRA_AUTO_REFRESH_PROVIDERS=false node test/released-static.mjs
```

The normal suite uses local MCP/model fixtures and a real Mastra Editor/Agent. No secret or paid generation is required. The optional static check is separate from hosted authentication and real media completion.

| Symptom | Action |
|---|---|
| Suno missing in Studio | Confirm server registration, database-backed Editor setup, and tool editing permission; package installation alone is insufficient. |
| No matching tool | Check `allowedTools`, service prefix, toolkit filter, and the live server catalog. |
| 401/403 | Check application key, expiration, Suno access and both generation/query API permissions. |
| 429 | Respect the service limit; avoid retrying generation automatically. |
| Pending task | Query the original ID; do not submit a new generation. |
| Failed call / disconnected | Check server connectivity and task history before resubmitting. After `disconnect()`, create a new provider instance. |
| Another LLM provider needed | Configure the agent's reasoning model separately; Suno here is a tool integration. |

To use an existing local MCP installation instead of the hosted endpoint, pass an MCP SDK `StdioClientTransport` through `transport`. Set its `ACEDATACLOUD_API_TOKEN` and `ACEDATACLOUD_API_BASE_URL` in the server-owned child environment; do not also pass `apiKey`. See `test/released-static.mjs` for a free, dummy-key example.

## Official discovery and contribution

Mastra supports registered ToolProviders, user-configured MCP connections, and a separate managed Connect catalog. This candidate uses the first mechanism. It has **not** been admitted to Mastra Connect or the official integration directory. The [official integration-guide request](https://github.com/mastra-ai/mastra/issues/27373) was closed by a maintainer on 2026-10-18 (Asia/Shanghai), stating that this is not being pursued now. Independent ToolProvider installation remains the supported path; this package has no official directory admission. See the [maintainer decision](https://github.com/mastra-ai/mastra/issues/27373#issuecomment-6239261501). See the concrete proposal in [the contribution material](readme/mastra-submission.md). LLM dropdown discovery is a separate [models.dev contribution](https://github.com/anomalyco/models.dev/pull/8873), not a feature of this package.
