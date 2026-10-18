import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { PublicSchema } from '@mastra/core/schema';
import type { StorageToolConfig } from '@mastra/core/storage';
import type { ToolProvider, ListToolProviderToolsOptions } from '@mastra/core/tool-provider';
import { createTool, type ToolAction } from '@mastra/core/tools';

export interface ProviderOptions {
  /** Ace application API key. Kept on the server; never put it in agent instructions. */
  apiKey?: string;
  /** Existing MCP SDK transport, for example StdioClientTransport. Replaces hosted authentication. */
  transport?: Transport;
  /** Exact MCP tool names to expose. Omit to expose this service's catalog. */
  allowedTools?: readonly string[];
  /** Timeout for discovery and each call. No automatic call retry. */
  timeoutMs?: number;
}

interface Service {
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  packageName: string;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;

/** A safe failure message; upstream content and credentials are not copied into error logs. */
export class AceToolError extends Error {
  readonly statusCode?: number;
  readonly code?: string;
  readonly requestId?: string;
  constructor(tool: string, payload?: Record<string, unknown>) {
    super(`${tool} failed. Check service access, balance, and the task status before submitting again.`);
    this.name = 'AceToolError';
    const status = payload?.status_code;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599)
      this.statusCode = status;
    if (typeof payload?.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(payload.code))
      this.code = payload.code;
    if (typeof payload?.request_id === 'string' && /^[\w-]{1,128}$/.test(payload.request_id))
      this.requestId = payload.request_id;
  }
}

function checkResult(result: unknown, tool: string): unknown {
  const root = object(result);
  const candidates: unknown[] = [root, root?.structuredContent];
  if (Array.isArray(root?.content)) {
    for (const item of root.content) {
      const part = object(item);
      if (part?.type === 'text' && typeof part.text === 'string') {
        try { candidates.push(JSON.parse(part.text)); } catch { /* Plain static guides are valid. */ }
      }
    }
  }
  for (const candidate of candidates) {
    const payload = object(candidate);
    if (!payload) continue;
    const response = object(payload.response);
    const polling = object(payload.mcp_task_polling);
    if (payload.isError === true || payload.error || payload.success === false ||
      response?.success === false || polling?.is_failed === true ||
      ['failed', 'error', 'cancelled', 'canceled'].includes(String(payload.state ?? '').toLowerCase()))
      throw new AceToolError(tool, payload);
  }
  // Preserve text/content/structuredContent and async guidance exactly as returned.
  return result;
}

/** Implements Mastra's supported legacy ToolProvider discovery/resolution interface. */
export class ServiceToolProvider implements ToolProvider {
  readonly info;
  readonly displayName;
  #service: Service;
  #client: Client;
  #transport: Transport;
  #connection?: Promise<void>;
  #catalog?: Promise<MCPTool[]>;
  #allowlist?: Set<string>;
  #timeout: number;
  #closed = false;

  constructor(service: Service, options: ProviderOptions = {}) {
    if (!options.transport && (!options.apiKey?.trim() || /[\r\n]/.test(options.apiKey)))
      throw new Error('An Ace application API key or an existing MCP transport is required.');
    if (options.apiKey && options.transport)
      throw new Error('Configure either apiKey or transport, so authentication has one owner.');
    this.#timeout = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.#timeout) || this.#timeout <= 0)
      throw new Error('timeoutMs must be positive.');
    this.#service = service;
    this.info = Object.freeze({ id: service.slug, name: service.name, description: service.description });
    this.displayName = service.name;
    this.#allowlist = options.allowedTools ? new Set(options.allowedTools) : undefined;
    this.#client = new Client({ name: service.packageName, version: '0.1.0' }, { capabilities: {} });
    this.#transport = options.transport ?? new StreamableHTTPClientTransport(new URL(service.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${options.apiKey!.trim()}` } },
    });
  }

  async #connect() {
    if (this.#closed) throw new Error('This provider is disconnected. Create a new instance.');
    this.#connection ??= this.#client.connect(this.#transport, { timeout: this.#timeout });
    try { await this.#connection; }
    catch { throw new Error(`${this.displayName} connection failed. Check the server credential and connectivity.`); }
  }

  async #tools(): Promise<MCPTool[]> {
    await this.#connect();
    this.#catalog ??= (async () => {
      const tools: MCPTool[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await this.#client.listTools({ cursor }, { timeout: this.#timeout });
        tools.push(...page.tools.filter(tool =>
          tool.name.startsWith(`${this.#service.slug}_`) &&
          (!this.#allowlist || this.#allowlist.has(tool.name))));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('MCP catalog repeated a pagination cursor.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      return tools;
    })();
    try { return await this.#catalog; }
    catch {
      this.#catalog = undefined;
      throw new Error(`${this.displayName} tool discovery failed. No partial catalog was saved.`);
    }
  }

  async listToolkits() {
    return { data: [{ slug: this.#service.slug, name: this.displayName, description: this.info.description }] };
  }

  async listTools(options: ListToolProviderToolsOptions = {}) {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Math.floor(options.perPage ?? 50)));
    if (!Number.isFinite(page) || !Number.isFinite(perPage)) throw new Error('Pagination must be finite.');
    const query = options.search?.trim().toLowerCase() ?? '';
    const tools = options.toolkit && options.toolkit !== this.#service.slug ? [] : (await this.#tools())
      .filter(tool => `${this.displayName} ${tool.name} ${tool.title ?? ''} ${tool.description ?? ''}`
        .toLowerCase().includes(query));
    return {
      data: tools.slice((page - 1) * perPage, page * perPage).map(tool => ({
        slug: tool.name, name: tool.title ?? tool.name, description: tool.description, toolkit: this.#service.slug,
      })),
      pagination: { page, perPage, total: tools.length, hasMore: page * perPage < tools.length },
    };
  }

  async getToolSchema(slug: string): Promise<Record<string, unknown> | null> {
    const tool = (await this.#tools()).find(tool => tool.name === slug);
    return tool ? structuredClone(tool.inputSchema) : null;
  }

  async resolveTools(slugs: string[], configs: Record<string, StorageToolConfig> = {}) {
    const catalog = await this.#tools();
    const selected = [...new Set(slugs)].map(slug => {
      const definition = catalog.find(tool => tool.name === slug);
      if (!definition) throw new Error(`Tool is unavailable or not allowed: ${slug}`);
      return definition;
    });
    const resolved: Record<string, ToolAction<any, any>> = {};
    for (const definition of selected) {
      resolved[definition.name] = createTool({
        id: definition.name,
        description: configs[definition.name]?.description ?? definition.description ?? definition.name,
        inputSchema: definition.inputSchema as PublicSchema,
        execute: async (input, context) => {
          await this.#connect();
          // Call exactly once. A dropped response can still represent an accepted paid task.
          let result;
          try {
            result = await this.#client.callTool({ name: definition.name, arguments: input as Record<string, unknown> },
              undefined, { timeout: this.#timeout, signal: context?.abortSignal });
          } catch (error) {
            throw new AceToolError(definition.name, error instanceof StreamableHTTPError
              ? { status_code: error.code } : undefined);
          }
          return checkResult(result, definition.name);
        },
      });
    }
    return resolved;
  }

  /** Close the owned HTTP/stdio session at application shutdown. */
  async disconnect() {
    this.#closed = true;
    try { await this.#connection; } catch { /* Close failed initialization too. */ }
    await this.#client.close();
  }
}
