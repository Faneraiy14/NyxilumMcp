// tools.js — чисті обробники інструментів, без жодної залежності від
// MCP SDK. Винесено окремо, щоб їх можна було викликати напряму в
// тестах (node:test) без піднімання реального MCP-транспорту.

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runNyxilumNode } from './run.js';
import { resolveNyxilumNode } from './locate.js';

function ecosystemRoot() {
    // Той самий дефолт, що й у locate.js: "NyxilumEcosystem" — стара назва,
    // якої на диску вже нема; GUIDE.md реально лежить у корені NyxilumLang.
    return process.env.NX_ECOSYSTEM_ROOT || join(import.meta.dirname, '..', '..', 'NyxilumLang');
}

// RunFile (NyxilumNode.cs) пише "Runtime Error: ..." / "Parse Error: ..."
// у STDOUT через Console.WriteLine, а не в stderr — це не хиба цього
// MCP-сервера, а поведінка самого NyxilumNode. Той, хто читає ці tools,
// має дивитись у stdout за помилками, не лише в exitCode.
export async function nyxilumRun({ code, timeout_ms, gc_max_objects }) {
    const result = await runNyxilumNode(code, [], { timeoutMs: timeout_ms, gcMaxObjects: gc_max_objects });
    return {
        ...result,
        note: 'Помилки виконання (Runtime/Parse Error) з\'являються у stdout з exitCode=1, а не в stderr.',
    };
}

// Linter.cs — це лише стильовий репортер (довжина рядка, порожні
// блоки, невикористані var), а НЕ перевірка синтаксису: він завжди
// повертає код 0, навіть якщо лексер провалився всередині. Для
// реальної валідації синтаксису використовуй nyxilum_run.
export async function nyxilumLint({ code, timeout_ms }) {
    const result = await runNyxilumNode(code, ['lint'], { timeoutMs: timeout_ms });
    return {
        ...result,
        note: 'lint — лише стильові попередження, завжди exitCode=0, НЕ перевіряє синтаксис. Для валідації коду використовуй nyxilum_run.',
    };
}

export async function nyxilumFormat({ code, timeout_ms }) {
    const result = await runNyxilumNode(code, ['format'], { timeoutMs: timeout_ms });
    return result;
}

// nx check - лише лексер+парсер (побудова AST), без компіляції в
// байткод і без виконання: на відміну від nyxilum_lint (стиль, завжди
// exitCode=0) це РЕАЛЬНА перевірка синтаксису, але дешевша й безпечніша
// за nyxilum_run для коду, який ще не мав виконуватись узагалі (change
// зі скрипта, довжелезний цикл, що ще не готовий запускатись) - немає
// сенсу гонити GC-ліміт/timeout заради самого лише "чи взагалі
// парситься".
export async function nyxilumCheck({ code, timeout_ms }) {
    const result = await runNyxilumNode(code, ['check'], { timeoutMs: timeout_ms });
    return {
        ...result,
        note: 'check — лише синтаксис (лексер+парсер), код НЕ виконується. Помилки — Parse Error у stdout з exitCode=1.',
    };
}

export async function nyxilumVersion() {
    const result = await runNyxilumNode('func main() {}', ['--version'], { timeoutMs: 5000 });
    return result;
}

// Кешується за mtime GUIDE.md: readFile на кожен виклик (навіть без
// зміни файлу) означало б диск-I/O на щоразовий запит документації від
// AI-асистента, який може питати секцію за секцією поспіль. mtimeMs
// у кеші - readFile пропускається, лише якщо файл ТОЧНО не змінювався
// відтоді (не таймер/TTL, а справжня перевірка свіжості).
let guideCache = null; // { mtimeMs: number, text: string } | null

export async function nyxilumDocs({ section } = {}) {
    const guidePath = join(ecosystemRoot(), 'GUIDE.md');

    let mtimeMs;
    try {
        mtimeMs = (await stat(guidePath)).mtimeMs;
    } catch (err) {
        return { success: false, error: `Не вдалося прочитати GUIDE.md: ${err.message}` };
    }

    if (!guideCache || guideCache.mtimeMs !== mtimeMs) {
        let text;
        try {
            text = await readFile(guidePath, 'utf8');
        } catch (err) {
            return { success: false, error: `Не вдалося прочитати GUIDE.md: ${err.message}` };
        }
        guideCache = { mtimeMs, text };
    }

    const guideText = guideCache.text;
    if (!section) return { success: true, content: guideText };

    const sections = splitBySections(guideText);
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

export function nyxilumNodeHealthPath() {
    return resolveNyxilumNode().path;
}
