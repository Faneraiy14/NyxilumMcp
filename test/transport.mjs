// transport.mjs — перевіряє РЕАЛЬНИЙ MCP-транспорт (StdioServerTransport
// + Client), а не лише прямі виклики функцій з tools.js. Валідує, що
// схеми zod, реєстрація інструментів і серіалізація відповіді дійсно
// працюють через протокол, без Claude Desktop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', 'src', 'server.js');

async function withClient(fn) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    await client.connect(transport);
    try {
        await fn(client);
    } finally {
        await client.close();
    }
}

test('tools/list повертає всі 11 зареєстрованих інструментів', async () => {
    await withClient(async (client) => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        assert.deepEqual(names, [
            'nyxilum_check',
            'nyxilum_dev_build',
            'nyxilum_dev_test',
            'nyxilum_docs',
            'nyxilum_format',
            'nyxilum_lint',
            'nyxilum_repl_eval',
            'nyxilum_repl_start',
            'nyxilum_repl_stop',
            'nyxilum_run',
            'nyxilum_version',
        ]);
    });
});

test('tools/call nyxilum_check через реальний MCP-протокол', async () => {
    await withClient(async (client) => {
        const result = await client.callTool({
            name: 'nyxilum_check',
            arguments: { code: 'func main() { print("з протоколу" }' },
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.exitCode, 1);
        assert.match(payload.stdout, /Parse Error/);
    });
});

test('tools/call nyxilum_run через реальний MCP-протокол', async () => {
    await withClient(async (client) => {
        const result = await client.callTool({
            name: 'nyxilum_run',
            arguments: { code: 'func main() { print("з протоколу") }' },
        });
        const payload = JSON.parse(result.content[0].text);
        assert.equal(payload.success, true);
        assert.match(payload.stdout, /з протоколу/);
    });
});

test('tools/call nyxilum_repl_start/eval/stop через реальний MCP-протокол', async () => {
    await withClient(async (client) => {
        const startResult = await client.callTool({ name: 'nyxilum_repl_start', arguments: {} });
        const startPayload = JSON.parse(startResult.content[0].text);
        assert.equal(startPayload.success, true);

        const evalResult = await client.callTool({
            name: 'nyxilum_repl_eval',
            arguments: { session_id: startPayload.sessionId, code: 'var y = 41\nprint(y + 1)' },
        });
        const evalPayload = JSON.parse(evalResult.content[0].text);
        assert.equal(evalPayload.success, true);
        assert.match(evalPayload.output, /42/);

        const stopResult = await client.callTool({
            name: 'nyxilum_repl_stop',
            arguments: { session_id: startPayload.sessionId },
        });
        const stopPayload = JSON.parse(stopResult.content[0].text);
        assert.equal(stopPayload.success, true);
    });
});

test('tools/call з невалідними аргументами повертає isError, не викидає', async () => {
    await withClient(async (client) => {
        const result = await client.callTool({ name: 'nyxilum_run', arguments: { code: 123 } });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /Invalid arguments|validation/i);
    });
});
