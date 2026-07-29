#!/usr/bin/env node
// server.js — реєструє інструменти в MCP SDK і піднімає stdio-транспорт.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { arxlangRun, arxlangLint, arxlangFormat, arxlangVersion, arxlangDocs } from './tools.js';

const server = new McpServer({ name: 'arx-mcp', version: '0.1.0' });

const timeoutSchema = z.number().int().min(100).max(60_000).optional()
    .describe('Таймаут виконання в мілісекундах (100–60000, типово 10000)');

server.registerTool(
    'arxlang_run',
    {
        title: 'Запустити ArxLang-код',
        description:
            'Компілює й виконує довільний ArxLang (.arx) код у пісочниці (окремий процес, timeout, ліміт GC-виділень). ' +
            'Помилки виконання (Runtime Error/Parse Error) з\'являються у полі stdout з exitCode=1, а НЕ в stderr.',
        inputSchema: {
            code: z.string().describe('Вихідний код ArxLang для запуску'),
            timeout_ms: timeoutSchema,
            gc_max_objects: z.number().int().positive().optional()
                .describe('Ліміт кількості ArxLang-виділень (масиви/структури/мапи); типово 5000000. НЕ зупиняє чисті нескінченні цикли без виділень — від них захищає лише timeout.'),
        },
    },
    async (args) => {
        const result = await arxlangRun(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'arxlang_lint',
    {
        title: 'Перевірити стиль ArxLang-коду',
        description:
            'Стильовий лінтер (довжина рядка, порожні блоки, невикористані змінні). ' +
            'Завжди повертає exitCode=0 і НЕ перевіряє синтаксис — для валідації коду використовуй arxlang_run.',
        inputSchema: { code: z.string(), timeout_ms: timeoutSchema },
    },
    async (args) => {
        const result = await arxlangLint(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'arxlang_format',
    {
        title: 'Форматувати ArxLang-код',
        description: 'Форматує ArxLang-код і повертає результат у полі stdout.',
        inputSchema: { code: z.string(), timeout_ms: timeoutSchema },
    },
    async (args) => {
        const result = await arxlangFormat(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'arxlang_version',
    {
        title: 'Версія ArxNode',
        description: 'Повертає версію знайденого ArxNode — заодно перевірка, що інтерпретатор доступний.',
        inputSchema: {},
    },
    async () => {
        const result = await arxlangVersion();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'arxlang_docs',
    {
        title: 'Документація ArxLang',
        description: 'Повертає GUIDE.md (синтаксис ArxLang) цілком або конкретну секцію за назвою заголовка.',
        inputSchema: {
            section: z.string().optional().describe('Частина назви заголовка ## для фільтрації, напр. "Мапи"'),
        },
    },
    async (args) => {
        const result = await arxlangDocs(args);
        return { content: [{ type: 'text', text: result.success ? result.content : `Помилка: ${result.error}` }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
