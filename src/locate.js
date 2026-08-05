// locate.js — знаходить зібраний NyxilumNode (компілятор/VM NyxilumLang), щоб
// запускати його як окремий процес. NyxilumMcp навмисно живе в ОКРЕМОМУ
// репозиторії від NyxilumLang (щоб node_modules не потрапляв у dotnet-збірку/
// publish), тож шлях до exe/dll треба або задати явно, або вгадати за
// відомою структурою збірки сусіднього репозиторію.
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
    // "NyxilumEcosystem" тут історична назва: обидва репо (NyxilumMcp, NyxilumLang)
    // зараз лежать як звичайні сусіди в ~/Projects, без жодної спільної
    // обгортки з такою назвою — той старий монорепо-задум не реалізувався,
    // а дефолт лишився. NX_ECOSYSTEM_ROOT (ім'я змінної збережено для
    // зворотної сумісності) без явного значення тепер вказує на NyxilumLang.
    return process.env.NX_ECOSYSTEM_ROOT || join(__dirname, '..', '..', 'NyxilumLang');
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
// СТАРУ версію NyxilumLang під виглядом "знайшли exe, все ок". bin/ з
// dotnet build — єдине джерело, що гарантовано відповідає поточному коду.
function candidatePaths(root) {
    // "non-Windows" тут означає "збірка без -windows у TFM" (без GUI-нативів),
    // а не "не на Windows" — саме такий net10.0-білд і на самій Windows теж
    // випускає Nx.exe (там .exe для будь-якого EXE незалежно від TFM).
    // На Linux/Mac dotnet build кладе бінарник БЕЗ розширення — назва "Nx.exe"
    // там просто не існує ніколи, тому цей список раніше ніколи нічого не
    // знаходив поза Windows.
    //
    // Бінарник називається "Nx" (AssemblyName у NyxilumLang.csproj), НЕ
    // "NyxilumLang" — те, що проєкт/репозиторій і команда мають різні
    // назви, навмисне: короткий CLI-бінарник окремо від довгої назви мови.
    const binName = process.platform === 'win32' ? 'Nx.exe' : 'Nx';
    return {
        nonWindows: [
            join(root, 'src', 'NyxilumLang', 'bin', 'Release', 'net10.0', binName),
            join(root, 'src', 'NyxilumLang', 'bin', 'Debug', 'net10.0', binName),
        ],
        windowsFallback: [
            join(root, 'src', 'NyxilumLang', 'bin', 'Release', 'net10.0-windows', 'Nx.exe'),
            join(root, 'src', 'NyxilumLang', 'bin', 'Debug', 'net10.0-windows', 'Nx.exe'),
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
export function resolveNyxilumNode() {
    const explicit = process.env.NX_NODE_PATH;
    if (explicit) {
        if (!existsSync(explicit)) {
            throw new Error(`NX_NODE_PATH задано, але файл не знайдено: ${explicit}`);
        }
        return toInvocation(explicit);
    }

    const root = defaultEcosystemRoot();
    const { nonWindows, windowsFallback } = candidatePaths(root);

    const best = newestExisting(nonWindows) ?? newestExisting(windowsFallback);
    if (best) return toInvocation(best);

    const tried = [...nonWindows, ...windowsFallback];
    throw new Error(
        'Не знайдено зібраний NyxilumNode. Перевірені шляхи:\n' +
        tried.map((p) => `  - ${p}`).join('\n') +
        '\nЗадай NX_NODE_PATH (шлях до Nx.exe або .dll) або NX_ECOSYSTEM_ROOT (корінь NyxilumEcosystem) вручну.'
    );
}

function toInvocation(p) {
    if (p.toLowerCase().endsWith('.dll')) {
        return { cmd: 'dotnet', preArgs: [p], path: p };
    }
    return { cmd: p, preArgs: [], path: p };
}
