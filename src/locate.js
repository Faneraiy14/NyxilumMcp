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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function defaultEcosystemRoot() {
    return process.env.ARX_ECOSYSTEM_ROOT || join(__dirname, '..', '..', 'ArxEcosystem');
}

// Порядок навмисний: Release/net10.0 (найшвидший, без GUI) →
// Debug/net10.0 (є майже завжди після dotnet build) →
// *-windows варіанти в кінці (є GUI natives, лише як останній шанс).
//
// publish/win-x64 навмисно НЕ в цьому списку: це заморожений артефакт
// GitHub Release (створюється вручну, окремо від dotnet build) — він
// не оновлюється разом із джерельним кодом і мовчки підсовував би
// СТАРУ версію ArxLang (без свіжих builtin-функцій типу gc_stats) під
// виглядом "знайшли exe, все ок". bin/ з dotnet build — єдине
// джерело, що гарантовано відповідає поточному коду репозиторію.
function candidatePaths(root) {
    return [
        join(root, 'src', 'ArxLang', 'bin', 'Release', 'net10.0', 'ArxLang.exe'),
        join(root, 'src', 'ArxLang', 'bin', 'Debug', 'net10.0', 'ArxLang.exe'),
        join(root, 'src', 'ArxLang', 'bin', 'Release', 'net10.0-windows', 'ArxLang.exe'),
        join(root, 'src', 'ArxLang', 'bin', 'Debug', 'net10.0-windows', 'ArxLang.exe'),
    ];
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
    const tried = candidatePaths(root);
    for (const p of tried) {
        if (existsSync(p)) return toInvocation(p);
    }

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
