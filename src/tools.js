// tools.js — чисті обробники інструментів, без жодної залежності від
// MCP SDK. Винесено окремо, щоб їх можна було викликати напряму в
// тестах (node:test) без піднімання реального MCP-транспорту.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runArxNode } from './run.js';
import { resolveArxNode } from './locate.js';

function ecosystemRoot() {
    // Той самий дефолт, що й у locate.js: "ArxEcosystem" — стара назва,
    // якої на диску вже нема; GUIDE.md реально лежить у корені ArxLang.
    return process.env.ARX_ECOSYSTEM_ROOT || join(import.meta.dirname, '..', '..', 'ArxLang');
}

// RunFile (ArxNode.cs) пише "Runtime Error: ..." / "Parse Error: ..."
// у STDOUT через Console.WriteLine, а не в stderr — це не хиба цього
// MCP-сервера, а поведінка самого ArxNode. Той, хто читає ці tools,
// має дивитись у stdout за помилками, не лише в exitCode.
export async function arxlangRun({ code, timeout_ms, gc_max_objects }) {
    const result = await runArxNode(code, [], { timeoutMs: timeout_ms, gcMaxObjects: gc_max_objects });
    return {
        ...result,
        note: 'Помилки виконання (Runtime/Parse Error) з\'являються у stdout з exitCode=1, а не в stderr.',
    };
}

// Linter.cs — це лише стильовий репортер (довжина рядка, порожні
// блоки, невикористані var), а НЕ перевірка синтаксису: він завжди
// повертає код 0, навіть якщо лексер провалився всередині. Для
// реальної валідації синтаксису використовуй arxlang_run.
export async function arxlangLint({ code, timeout_ms }) {
    const result = await runArxNode(code, ['lint'], { timeoutMs: timeout_ms });
    return {
        ...result,
        note: 'lint — лише стильові попередження, завжди exitCode=0, НЕ перевіряє синтаксис. Для валідації коду використовуй arxlang_run.',
    };
}

export async function arxlangFormat({ code, timeout_ms }) {
    const result = await runArxNode(code, ['format'], { timeoutMs: timeout_ms });
    return result;
}

export async function arxlangVersion() {
    const result = await runArxNode('func main() {}', ['--version'], { timeoutMs: 5000 });
    return result;
}

// Кешується за mtime GUIDE.md, щоб не перечитувати файл на кожен
// виклик, але й не подавати застарілий вміст після редагування мови.
let guideCache = null;

export async function arxlangDocs({ section } = {}) {
    const guidePath = join(ecosystemRoot(), 'GUIDE.md');
    const stat = await readFile(guidePath, 'utf8').then(
        (text) => ({ text }),
        (err) => ({ error: err.message })
    );
    if (stat.error) {
        return { success: false, error: `Не вдалося прочитати GUIDE.md: ${stat.error}` };
    }

    guideCache = stat.text;
    if (!section) return { success: true, content: guideCache };

    const sections = splitBySections(guideCache);
    const match = sections.find((s) => s.heading.toLowerCase().includes(section.toLowerCase()));
    if (!match) {
        return {
            success: false,
            error: `Секцію "${section}" не знайдено. Доступні: ${sections.map((s) => s.heading).join(', ')}`,
        };
    }
    return { success: true, content: match.body };
}

// GUIDE.md структурує конкретні теми (Мапи/словники, Структури та
// Методи тощо) заголовками рівня ### , не ## — верхній рівень ## там
// лише двічі на весь файл ("Основний синтаксис", "Як запустити").
function splitBySections(markdown) {
    const lines = markdown.split('\n');
    const sections = [];
    let current = null;
    for (const line of lines) {
        if (line.startsWith('### ')) {
            if (current) sections.push(current);
            current = { heading: line.slice(4).trim(), body: line + '\n' };
        } else if (current) {
            current.body += line + '\n';
        }
    }
    if (current) sections.push(current);
    return sections;
}

export function arxNodeHealthPath() {
    return resolveArxNode().path;
}
