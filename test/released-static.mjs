// Explicit opt-in: installs the real public Python MCP package, then calls only its static guide.
// The API base is a loopback trap and the child receives a dummy token.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SunoToolProvider } from '../dist/index.js';

let requests = 0;
const trap = createServer((_req, res) => { requests++; res.writeHead(500).end('No API calls allowed.'); });
await new Promise(resolve => trap.listen(0, '127.0.0.1', resolve));
const provider = new SunoToolProvider({ transport: new StdioClientTransport({
  command: process.env.UV_COMMAND ?? 'uv',
  args: ['tool', 'run', '--from', 'mcp-suno==2026.10.12.1', 'mcp-suno'],
  env: { PATH: process.env.PATH ?? '', ACEDATACLOUD_API_TOKEN: 'offline-placeholder-not-a-key',
    ACEDATACLOUD_API_BASE_URL: `http://127.0.0.1:${trap.address().port}`, MCP_TRANSPORT: 'stdio', LOG_LEVEL: 'ERROR' },
  stderr: 'ignore',
}), timeoutMs: 60_000 });
try {
  const listing = await provider.listTools({ perPage: 100 });
  assert.ok(listing.data.some(tool => tool.slug === 'suno_generate_music'));
  const schema = await provider.getToolSchema('suno_generate_music');
  assert.equal(schema.properties.prompt.type, 'string');
  const tools = await provider.resolveTools(['suno_list_actions']);
  const result = await tools.suno_list_actions.execute({}, {});
  assert.match(JSON.stringify(result), /suno_get_task/);
  assert.equal(requests, 0);
  console.log(JSON.stringify({ package: 'mcp-suno==2026.10.12.1', tools: listing.pagination.total,
    staticTool: 'suno_list_actions', apiRequests: requests, paidGeneration: false }, null, 2));
} finally {
  await provider.disconnect();
  trap.closeAllConnections();
  await new Promise(resolve => trap.close(resolve));
}
