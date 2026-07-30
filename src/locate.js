// locate.js — знаходить зібраний ArxNode (компілятор/VM ArxLang), щоб
// запускати його як окремий процес. ArxMcp навмисно живе ПОЗА
// ArxEcosystem (щоб node_modules не потрапляв у dotnet-збірку/publish),
// тож шлях до exe/dll треба або задати явно, або вгадати за відомою
// структурою збірки.
//
// net10.0-windows реєструє GUI-нативи (guiWindow/createCanvas) — вони
// відкривають РЕАЛЬНІ вікна Windows Forms. Для довільного,
// потенційно AI-згенерованого коду це неприйнятно, тож net10.0
// (без -windows) — пріоритетний вибір: там цих native-функцій просто
// нема в реєстрі, а не "somehow не спрацюють".

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function defaultEcosystemRoot() {
    return process.env.ARX_ECOSYSTEM_ROOT || join(__dirname, '..', '..', 'ArxEcosystem');
}

// НЕ фіксований пріоритет "Release завжди перед Debug": реально під час
// розробки послідовні `dotnet build` (Debug) і `dotnet build -c Release`
// відбуваються не одночасно, тож один з двох майже завжди старіший —
// фіксований порядок раз у раз підсовував саме СТАРІШУ збірку без
// щойно доданих builtin-функцій, поки хтось не збере обидві конфігурації
// одразу. Тепер серед net10.0-варіантів (без GUI) обираємо існуючий і
// НОВІШИЙ за часом модифікації; net10.0-windows — лише якщо жодного
// non-Windows білда взагалі нема.
//
// publish/win-x64 навмисно НЕ в цьому списку: це заморожений артефакт
// GitHub Release (створюється вручну, окремо від dotnet build) — він
// не оновлюється разом із джерельним кодом і мовчки підсовував би
// СТАРУ версію ArxLang під виглядом "знайшли exe, все ок". bin/ з
// dotnet build — єдине джерело, що гарантовано відповідає поточному коду.
function candidatePaths(root) {
    return {
        nonWindows: [
            join(root, 'src', 'ArxLang', 'bin', 'Release', 'net10.0', 'ArxLang.exe'),
            join(root, 'src', 'ArxLang', 'bin', 'Debug', 'net10.0', 'ArxLang.exe'),
        ],
        windowsFallback: [
            join(root, 'src', 'ArxLang', 'bin', 'Release', 'net10.0-windows', 'ArxLang.exe'),
            join(root, 'src', 'ArxLang', 'bin', 'Debug', 'net10.0-windows', 'ArxLang.exe'),
        ],
    };
}

function newestExisting(paths) {
    let best = null;
    for (const p of paths) {
        if (!existsSync(p)) continue;
        const mtime = statSync(p).mtimeMs;
        if (!best || mtime > best.mtime) best = { path: p, mtime };
    }
    return best?.path ?? null;
}

/**
 * @returns {{ cmd: string, preArgs: string[], path: string }}
 */
export function resolveArxNode() {
    const explicit = process.env.ARX_NODE_PATH;
    if (explicit) {
        if (!existsSync(explicit)) {
            throw new Error(`ARX_NODE_PATH задано, але файл не знайдено: ${explicit}`);
        }
        return toInvocation(explicit);
    }

    const root = defaultEcosystemRoot();
    const { nonWindows, windowsFallback } = candidatePaths(root);

    const best = newestExisting(nonWindows) ?? newestExisting(windowsFallback);
    if (best) return toInvocation(best);

    const tried = [...nonWindows, ...windowsFallback];
    throw new Error(
        'Не знайдено зібраний ArxNode. Перевірені шляхи:\n' +
        tried.map((p) => `  - ${p}`).join('\n') +
        '\nЗадай ARX_NODE_PATH (шлях до ArxLang.exe або .dll) або ARX_ECOSYSTEM_ROOT (корінь ArxEcosystem) вручну.'
    );
}

function toInvocation(p) {
    if (p.toLowerCase().endsWith('.dll')) {
        return { cmd: 'dotnet', preArgs: [p], path: p };
    }
    return { cmd: p, preArgs: [], path: p };
}
