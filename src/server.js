#!/usr/bin/env node
// server.js — реєструє інструменти в MCP SDK і піднімає stdio-транспорт.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { nyxilumRun, nyxilumLint, nyxilumFormat, nyxilumCheck, nyxilumVersion, nyxilumDocs } from './tools.js';
import { nyxilumDevBuild, nyxilumDevTest } from './dev.js';

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
            section: z.string().optional().describe('Частина назви заголовка ### для фільтрації, напр. "Мапи"'),
        },
    },
    async (args) => {
        const result = await nyxilumDocs(args);
        return { content: [{ type: 'text', text: result.success ? result.content : `Помилка: ${result.error}` }] };
    }
);

const devTimeoutSchema = z.number().int().min(1000).max(300_000).optional()
    .describe('Таймаут виконання в мілісекундах (1000–300000, типово 120000 для build, 180000 для test)');

server.registerTool(
    'nyxilum_dev_build',
    {
        title: 'Зібрати NyxilumLang з джерела',
        description:
            'dotnet build самого репозиторію NyxilumLang (net10.0, без Windows Forms/GUI-нативів). ' +
            'НЕ пісочниться — на відміну від nyxilum_run/nyxilum_check, тут немає довільного .nx-коду від виклику, ' +
            'лише збірка довіреного джерельного дерева мови. Виклич перед nyxilum_dev_test після зміни C#-коду мови.',
        inputSchema: {
            configuration: z.enum(['Debug', 'Release']).optional().describe('Конфігурація збірки, типово Debug'),
            timeout_ms: devTimeoutSchema,
        },
    },
    async (args) => {
        const result = await nyxilumDevBuild(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

server.registerTool(
    'nyxilum_dev_test',
    {
        title: 'Прогнати тестовий набір NyxilumLang',
        description:
            'tests/run_all.sh самого репозиторію NyxilumLang проти щойно зібраного бінарника (NX_EXE - той самий, ' +
            'що знаходить nyxilum_version). Потребує попереднього nyxilum_dev_build, якщо збірки ще нема.',
        inputSchema: { timeout_ms: devTimeoutSchema },
    },
    async (args) => {
        const result = await nyxilumDevTest(args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
