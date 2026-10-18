import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MastraEditor } from '@mastra/editor';
import { Agent } from '@mastra/core/agent';
import { SunoToolProvider, AceToolError } from '../dist/index.js';

const service = 'suno';
const generation = `${service}_generate_music`;
const query = `${service}_get_task`;
const guide = `${service}_list_actions`;
const schema = { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] };
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });

async function fixture(t, { allowedTools, handler, failDiscovery = false } = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: 'loopback-service-fixture', version: '1' }, { capabilities: { tools: {} } });
  const calls = [];
  let discoveries = 0;
  server.setRequestHandler(ListToolsRequestSchema, async request => {
    discoveries++;
    if (failDiscovery && discoveries === 1) throw new Error('temporary list failure: secret-must-not-leak');
    return request.params?.cursor === 'next' ? { tools: [
      { name: guide, description: 'Static workflow guide', inputSchema: { type: 'object', properties: {} } },
      { name: 'unrelated_generate', inputSchema: schema },
    ] } : { tools: [
      { name: generation, description: 'Generate media from a prompt', inputSchema: schema },
      { name: query, description: 'Query the same task ID', inputSchema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
    ], nextCursor: 'next' };
  });
  server.setRequestHandler(CallToolRequestSchema, async request => {
    calls.push(request.params);
    return handler ? handler(request.params, calls) : text('Static guide from fixture');
  });
  await server.connect(serverTransport);
  const provider = new SunoToolProvider({ transport: clientTransport, allowedTools, timeoutMs: 1_000 });
  t.after(async () => { await provider.disconnect(); await server.close(); });
  return { provider, calls, get discoveries() { return discoveries; } };
}

test('registers a real ToolProvider in MastraEditor; metadata has no credential', async t => {
  const { provider } = await fixture(t);
  const editor = new MastraEditor({ toolProviders: { [service]: provider } });
  assert.equal(editor.getToolProviders()[service], provider);
  assert.equal(provider.info.name, 'Suno by Ace Data Cloud');
  const hosted = new SunoToolProvider({ apiKey: 'secret-must-not-leak' });
  t.after(() => hosted.disconnect());
  assert.doesNotMatch(JSON.stringify(hosted), /secret-must-not-leak|Authorization|Bearer/);
  assert.throws(() => new SunoToolProvider(), /application API key/);
});

test('discovers all pages once, filters service/search, paginates and returns original schema', async t => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([
    f.provider.listTools({ perPage: 1 }), f.provider.listTools({ page: 2, perPage: 1 }),
  ]);
  assert.equal(f.discoveries, 2);
  assert.equal(first.pagination.total, 3);
  assert.equal(first.pagination.hasMore, true);
  assert.equal(second.data[0].slug, query);
  assert.equal((await f.provider.listTools({ search: 'same task' })).data[0].slug, query);
  assert.equal((await f.provider.listTools({ search: 'SUNO' })).data.length, 3);
  assert.deepEqual((await f.provider.listTools({ toolkit: 'other' })).data, []);
  assert.equal((await f.provider.listToolkits()).data[0].slug, service);
  assert.deepEqual(await f.provider.getToolSchema(generation), schema);
  const copied = await f.provider.getToolSchema(generation);
  copied.required.push('wrong');
  assert.deepEqual(await f.provider.getToolSchema(generation), schema);
  assert.equal(await f.provider.getToolSchema('unrelated_generate'), null);
  await assert.rejects(f.provider.resolveTools(['unrelated_generate']), /unavailable or not allowed/);
  assert.equal(f.calls.length, 0);
});

test('allowlist limits discovery and executable tools', async t => {
  const { provider } = await fixture(t, { allowedTools: [query] });
  assert.deepEqual((await provider.listTools()).data.map(tool => tool.slug), [query]);
  await assert.rejects(provider.resolveTools([generation]), /not allowed/);
});

test('real Mastra tools preserve submission and same-ID polling without generating again', async t => {
  const f = await fixture(t, { handler: (request, calls) => {
    if (request.name === generation) return text({ task_id: 'existing-fixture-task', mcp_async_submission: { terminal_state_reached: false } });
    return text({ id: request.arguments.task_id, state: calls.length === 2 ? 'running' : 'complete', response: { success: calls.length === 2 ? undefined : true } });
  } });
  const tools = await f.provider.resolveTools([generation, query], { [generation]: { description: 'Project-specific description' } });
  assert.equal(tools[generation].description, 'Project-specific description');
  const submitted = await tools[generation].execute({ prompt: 'fixture only' }, {});
  assert.equal(JSON.parse(submitted.content[0].text).task_id, 'existing-fixture-task');
  const pending = await tools[query].execute({ task_id: 'existing-fixture-task' }, {});
  assert.equal(JSON.parse(pending.content[0].text).state, 'running');
  const complete = await tools[query].execute({ task_id: 'existing-fixture-task' }, {});
  assert.equal(JSON.parse(complete.content[0].text).response.success, true);
  assert.equal(f.calls.filter(call => call.name === generation).length, 1);
  assert.ok(f.calls.filter(call => call.name === query).every(call => call.arguments.task_id === 'existing-fixture-task'));
});

test('MCP and JSON errors fail safely and retain only supplied safe metadata', async t => {
  for (const payload of [
    { error: 'secret-must-not-leak', status_code: 429, code: 'rate_limit_exceeded', request_id: 'req_fixture' },
    { success: false, message: 'secret-must-not-leak' },
    { state: 'failed', response: { success: false } },
  ]) {
    const f = await fixture(t, { handler: () => text(payload) });
    const tools = await f.provider.resolveTools([generation]);
    await assert.rejects(tools[generation].execute({ prompt: 'fixture' }, {}), error => {
      assert.ok(error instanceof AceToolError);
      assert.doesNotMatch(error.stack, /secret-must-not-leak/);
      assert.equal(error.statusCode, payload.status_code);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
  const f = await fixture(t, { handler: () => ({ isError: true, ...text('secret-must-not-leak') }) });
  const tools = await f.provider.resolveTools([generation]);
  await assert.rejects(tools[generation].execute({ prompt: 'fixture' }, {}), AceToolError);
  assert.equal(f.calls.length, 1);
});

test('transport/tool exceptions are not retried and do not leak raw diagnostics', async t => {
  const f = await fixture(t, { handler: () => { throw new Error('Connection closed secret-must-not-leak'); } });
  const tools = await f.provider.resolveTools([generation]);
  await assert.rejects(tools[generation].execute({ prompt: 'fixture' }, {}), error => {
    assert.ok(error instanceof AceToolError);
    assert.doesNotMatch(error.stack, /secret-must-not-leak/);
    assert.equal(error.statusCode, undefined);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test('a failed catalog is surfaced, cleared, and never cached as partial success', async t => {
  const f = await fixture(t, { failDiscovery: true });
  await assert.rejects(f.provider.listTools(), /No partial catalog/);
  assert.equal((await f.provider.listTools()).data.length, 3);
  assert.equal(f.discoveries, 3);
});

test('HTTP auth stays in headers; a lost response or HTTP 429 never repeats a paid call', async t => {
  for (const failure of ['drop', '429']) {
    let calls = 0;
    const headers = [];
    const server = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      headers.push(req.headers.authorization);
      if (!('id' in message)) { res.writeHead(202).end(); return; }
      let result;
      if (message.method === 'initialize') result = {
        protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'loopback-http', version: '1' },
      };
      if (message.method === 'tools/list') result = { tools: [{ name: generation, inputSchema: schema }] };
      if (message.method === 'tools/call') {
        calls++;
        if (failure === 'drop') { req.socket.destroy(); return; }
        res.writeHead(429, { 'content-type': 'text/plain' }).end('private-host secret-must-not-leak');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const provider = new SunoToolProvider({ transport: new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp`),
      { requestInit: { headers: { Authorization: 'Bearer secret-must-not-leak' } } },
    ), timeoutMs: 1_000 });
    t.after(async () => { await provider.disconnect(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const tools = await provider.resolveTools([generation]);
    await assert.rejects(tools[generation].execute({ prompt: 'local fixture' }, {}), error => {
      assert.ok(error instanceof AceToolError);
      assert.doesNotMatch(error.stack, /secret-must-not-leak|private-host/);
      assert.equal(error.statusCode, failure === '429' ? 429 : undefined);
      return true;
    });
    assert.equal(calls, 1);
    assert.ok(headers.every(header => header === 'Bearer secret-must-not-leak'));
    assert.doesNotMatch(JSON.stringify(provider), /secret-must-not-leak/);
  }
});

test('a real Mastra Agent selects and executes the resolved tool through a local model fixture', async t => {
  const f = await fixture(t);
  const tools = await f.provider.resolveTools([guide]);
  let steps = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    steps++;
    assert.ok(request.tools.some(tool => tool.function.name === guide));
    const message = steps === 1 ? { role: 'assistant', content: null, tool_calls: [{
      id: 'fixture_tool_call', type: 'function', function: { name: guide, arguments: '{}' },
    }] } : { role: 'assistant', content: 'Static guide checked.' };
    const finish = steps === 1 ? 'tool_calls' : 'stop';
    const base = { id: 'local-model', model: 'fixture', created: 1 };
    if (!request.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message, finish_reason: finish }] }));
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ index: 0, ...call })) } : { content: message.content };
      for (const [part, reason] of [[delta, null], [{}, finish]])
        res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta: part, finish_reason: reason }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const agent = new Agent({
    id: 'offline-integration', name: 'Offline integration', instructions: 'Use the static guide.',
    errorProcessorDefaults: false, maxProcessorRetries: 0, tools,
    model: { id: 'local/fixture', api: 'chat', apiKey: 'fixture-not-a-key', url: `http://127.0.0.1:${server.address().port}` },
  });
  const result = await agent.generate('Read the guide.', { maxSteps: 2, modelSettings: { maxRetries: 0 } });
  assert.equal(result.text, 'Static guide checked.');
  assert.equal(steps, 2);
  assert.deepEqual(f.calls.map(call => call.name), [guide]);
});
