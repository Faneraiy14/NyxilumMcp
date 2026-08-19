#!/usr/bin/env node
// server.js — реєструє інструменти в MCP SDK і піднімає stdio-транспорт.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { nyxilumRun, nyxilumLint, nyxilumFormat, nyxilumCheck, nyxilumVersion, nyxilumDocs } from './tools.js';

const server = new McpServer({ name: 'nyxilum-mcp', version: '0.1.0' });

const timeoutSchema = z.number().int().min(100).max(60_000).optional()
    .describe('Таймаут виконання в мілісекундах (100–60000, типово 10000)');

server.registerTool(
    'nyxilum_run',
    {
        title: 'Запустити NyxilumLang-код',
        description:
            'Компілює й виконує довільний NyxilumLang (.nx) код у пісочниці (окремий процес, timeout, ліміт GC-виділень). ' +
            'Помилки виконання (Runtime Error/Parse Error) з\'являються у полі stdout з exitCode=1, а НЕ в stderr.',
        inputSchema: {
            code: z.string().describe('Вихідний код NyxilumLang для запуску'),
            timeout_ms: timeoutSchema,
            gc_max_objects: z.number().int().positive().optional()
                .describe('Ліміт кількості NyxilumLang-виділень (масиви/структури/мапи); типово 5000000. НЕ зупиняє чисті нескінченні цикли без виділень — від них захищає лише timeout.'),
        },
    },
    async (args) => {
        const result = await nyxilumRun(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_lint',
    {
        title: 'Перевірити стиль NyxilumLang-коду',
        description:
            'Стильовий лінтер (довжина рядка, порожні блоки, невикористані змінні). ' +
            'Завжди повертає exitCode=0 і НЕ перевіряє синтаксис — для валідації коду використовуй nyxilum_run.',
        inputSchema: { code: z.string(), timeout_ms: timeoutSchema },
    },
    async (args) => {
        const result = await nyxilumLint(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_format',
    {
        title: 'Форматувати NyxilumLang-код',
        description: 'Форматує NyxilumLang-код і повертає результат у полі stdout.',
        inputSchema: { code: z.string(), timeout_ms: timeoutSchema },
    },
    async (args) => {
        const result = await nyxilumFormat(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_check',
    {
        title: 'Перевірити синтаксис NyxilumLang-коду',
        description:
            'Лише лексер+парсер (побудова AST) — код НЕ виконується, компіляція в байткод не відбувається. ' +
            'Дешевша й безпечніша перевірка "чи взагалі парситься", ніж nyxilum_run, для коду, який ще не готовий запускатись. ' +
            'Помилки (Parse Error) з\'являються у полі stdout з exitCode=1, а НЕ в stderr.',
        inputSchema: { code: z.string(), timeout_ms: timeoutSchema },
    },
    async (args) => {
        const result = await nyxilumCheck(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_version',
    {
        title: 'Версія NyxilumNode',
        description: 'Повертає версію знайденого NyxilumNode — заодно перевірка, що інтерпретатор доступний.',
        inputSchema: {},
    },
    async () => {
        const result = await nyxilumVersion();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_docs',
    {
        title: 'Документація NyxilumLang',
        description: 'Повертає GUIDE.md (синтаксис NyxilumLang) цілком або конкретну секцію за назвою заголовка.',
        inputSchema: {
            section: z.string().optional().describe('Частина назви заголовка ## для фільтрації, напр. "Мапи"'),
        },
    },
    async (args) => {
        const result = await nyxilumDocs(args);
        return { content: [{ type: 'text', text: result.success ? result.content : `Помилка: ${result.error}` }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
